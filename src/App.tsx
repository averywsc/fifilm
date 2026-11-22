import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultCorrection,
  createDefaultEffects,
  createDefaultGrade,
  createDefaultGrading,
  createDefaultStabilization,
  type AudioMeterReading,
  type BeatAnalysisResult,
  type BeatSnapTarget,
  type ClipEffectsState,
  type ColorCorrectionState,
  type ColorGradingState,
  type HardwareCapabilities,
  type InspectorTab,
  type LutLibraryEntry,
  type LutRole,
  type LutStackLayer,
  type MediaAsset,
  type ScopeMode,
  type StabilizationState,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
} from './types/editor';
import { WebGL2ColorPipeline } from './engine/webglPipeline';
import { FifilmAudioEngine } from './engine/audioMixer';
import { renderVideoScope, type ScopeMetrics } from './engine/scopes';
import { bakeGradeToCube } from './engine/cubeParser';
import { extractAudioWaveformFromFile } from './engine/audioWaveform';
import {
  alignClipsToBeats,
  analyzeAudioBeatsInBrowser,
  collectTimelineBeatPoints,
} from './engine/beatSync';
import { snapToFrame } from './engine/timecode';
import {
  extractBackendWaveform,
  fetchCapabilities,
  fetchLutLibrary,
  getCachedLutMap,
  loadParsedLut,
  resolveLocalFilePath,
  runBackendBeatAnalysis,
  runBackendStabilize,
  saveNewCubeLut,
  stageFileToDiskIfNeeded,
} from './services/bridge';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { ExportModal, KeysModal } from './components/ExportModal';

const SEQUENCE_FPS = 24;

const INITIAL_TRACKS: TimelineTrack[] = [
  { id: 'v2', name: 'V2', kind: 'video', muted: false, solo: false, locked: false, visible: true },
  { id: 'v1', name: 'V1', kind: 'video', muted: false, solo: false, locked: false, visible: true },
  { id: 'a1', name: 'A1', kind: 'audio', muted: false, solo: false, locked: false, visible: true },
];

function computeClipEnvelopeMultiplier(clip: TimelineClip, elapsedInClip: number): number {
  let env = 1.0;
  if (clip.fadeIn > 0.01 && elapsedInClip < clip.fadeIn) {
    env *= Math.max(0, elapsedInClip / clip.fadeIn);
  }
  const remaining = clip.duration - elapsedInClip;
  if (clip.fadeOut > 0.01 && remaining < clip.fadeOut) {
    env *= Math.max(0, remaining / clip.fadeOut);
  }
  return env;
}

export default function App() {
  const [capabilities, setCapabilities] = useState<HardwareCapabilities | null>(null);
  const [lutLibrary, setLutLibrary] = useState<LutLibraryEntry[]>([]);
  const [lutLibraryLoading, setLutLibraryLoading] = useState(false);

  const [tracks, setTracks] = useState<TimelineTrack[]>(INITIAL_TRACKS);
  const [assets, setAssets] = useState<Map<string, MediaAsset>>(() => new Map());
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [shuttleSpeed, setShuttleSpeed] = useState<number>(0);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [showBeats, setShowBeats] = useState<boolean>(true);
  const [viewAllLayers, setViewAllLayers] = useState<boolean>(false);
  const [alignFeedback, setAlignFeedback] = useState<string>('');
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(64);
  const [inPoint, setInPoint] = useState<number | null>(null);
  const [outPoint, setOutPoint] = useState<number | null>(null);

  // Audio master bus state & live metering
  const [masterVolume, setMasterVolume] = useState<number>(1.0);
  const [masterMuted, setMasterMuted] = useState<boolean>(false);
  const [audioMeters, setAudioMeters] = useState<AudioMeterReading>({
    peakLeftDb: -60,
    peakRightDb: -60,
    lufs: -60,
    clipping: false,
  });

  const [activeTab, setActiveTab] = useState<InspectorTab>('color');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('parade');
  const [scopeMetrics, setScopeMetrics] = useState<ScopeMetrics>({
    avgIre: 0,
    peakIre: 0,
    minIre: 0,
    clipHighPct: 0,
    clipLowPct: 0,
  });

  const [compareHeld, setCompareHeld] = useState<boolean>(false);
  const [splitEnabled, setSplitEnabled] = useState<boolean>(false);
  const [splitPos, setSplitPos] = useState<number>(0.5);
  const [showExport, setShowExport] = useState<boolean>(false);
  const [showKeys, setShowKeys] = useState<boolean>(false);

  const [undoStack, setUndoStack] = useState<TimelineClip[][]>([]);
  const [redoStack, setRedoStack] = useState<TimelineClip[][]>([]);

  const viewportCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  const musicFileInputRef = useRef<HTMLInputElement | null>(null);
  const pipelineRef = useRef<WebGL2ColorPipeline | null>(null);
  const audioEngineRef = useRef<FifilmAudioEngine | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const rawFilesRef = useRef<Map<string, File>>(new Map());
  const pendingSeekRef = useRef<Map<string, number>>(new Map());

  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const assetsRef = useRef(assets);
  assetsRef.current = assets;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const shuttleSpeedRef = useRef(shuttleSpeed);
  shuttleSpeedRef.current = shuttleSpeed;

  const sequenceDuration = useMemo(
    () => clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0),
    [clips]
  );

  const selectedClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) || null,
    [clips, selectedClipId]
  );

  const beatPoints = useMemo(
    () => collectTimelineBeatPoints(clips, (assetId) => assets.get(assetId)?.beatAnalysis),
    [clips, assets]
  );

  const detectedBpm = useMemo(() => {
    for (const c of clips) {
      const a = assets.get(c.assetId)?.beatAnalysis;
      if (a && a.bpm > 0) return a.bpm;
    }
    return null;
  }, [clips, assets]);

  // Helper: find topmost visible video clip at time t
  const findActiveVideoClipAt = useCallback((t: number): TimelineClip | null => {
    const visibleVideoTrackIds = tracksRef.current
      .filter((tr) => tr.kind === 'video' && tr.visible)
      .map((tr) => tr.id);
    for (const trackId of visibleVideoTrackIds) {
      const hit = clipsRef.current.find(
        (c) => c.trackId === trackId && t >= c.start && t < c.start + c.duration
      );
      if (hit) return hit;
    }
    return null;
  }, []);

  const activeVideoClip = useMemo(
    () => findActiveVideoClipAt(playhead),
    [findActiveVideoClipAt, playhead, tracks, clips]
  );

  const pushUndoSnapshot = useCallback((snapshot?: TimelineClip[]) => {
    const snap = structuredClone(snapshot ?? clipsRef.current);
    setUndoStack((prev) => [...prev.slice(-39), snap]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, structuredClone(clipsRef.current)]);
      setClips(last);
      return prev.slice(0, -1);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setUndoStack((u) => [...u, structuredClone(clipsRef.current)]);
      setClips(next);
      return prev.slice(0, -1);
    });
  }, []);

  const refreshLuts = useCallback(async () => {
    setLutLibraryLoading(true);
    try {
      const list = await fetchLutLibrary();
      setLutLibrary(list);
    } catch (err) {
      console.error('Failed to index colorstudies LUTs:', err);
    } finally {
      setLutLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCapabilities()
      .then(setCapabilities)
      .catch((err) => console.warn('Capability probe warning:', err));
    refreshLuts();
  }, [refreshLuts]);

  useEffect(() => {
    const canvas = viewportCanvasRef.current;
    if (!canvas) return;
    try {
      pipelineRef.current = new WebGL2ColorPipeline(canvas);
    } catch (err) {
      console.error('WebGL2 init failed:', err);
    }
    audioEngineRef.current = new FifilmAudioEngine();

    return () => {
      for (const vid of videoElementsRef.current.values()) {
        vid.pause();
        vid.src = '';
      }
      videoElementsRef.current.clear();
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioEngineRef.current?.setMasterVolume(masterVolume, masterMuted);
  }, [masterVolume, masterMuted]);

  // Pause all <video> elements cleanly helper
  const pauseAllVideos = useCallback(() => {
    for (const vid of videoElementsRef.current.values()) {
      if (!vid.paused) vid.pause();
    }
  }, []);

  // Safe non-thrashing seek helper for paused scrubbing / frame stepping
  const safeSeekVideo = useCallback((key: string, vid: HTMLVideoElement, targetSec: number) => {
    if (vid.readyState < 1) return;
    const clamped = Math.max(0, Math.min(Number.isFinite(vid.duration) ? Math.max(0, vid.duration - 0.004) : targetSec, targetSec));
    if (Math.abs(vid.currentTime - clamped) < 0.012) return;
    if (vid.seeking) {
      pendingSeekRef.current.set(key, clamped);
      return;
    }
    try {
      vid.currentTime = clamped;
    } catch {
      // ignore invalid seek state
    }
  }, []);

  // Sync standalone AudioBuffer music tracks when Play/Pause/Shuttle or Track Mute/Solo changes
  const trackAudioSignature = useMemo(
    () => tracks.map((t) => `${t.id}:${t.muted ? 1 : 0}:${t.solo ? 1 : 0}`).join('|'),
    [tracks]
  );

  useEffect(() => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const rate = shuttleSpeed !== 0 ? shuttleSpeed : isPlaying ? 1 : 0;
    if (rate > 0) {
      engine.resume();
      engine.startAudioTrackPlayback({
        playheadSec: playheadRef.current,
        rate,
        clips: clipsRef.current,
        tracks: tracksRef.current,
      });
    } else {
      engine.stopBufferVoices();
      pauseAllVideos();
    }
    return () => {
      engine.stopBufferVoices();
    };
  }, [isPlaying, shuttleSpeed, trackAudioSignature, pauseAllVideos]);

  // Lazy disk path staging (instant zero-copy path in Electron .exe, on-demand staging in browser dev mode)
  const ensureAssetDiskPath = useCallback(async (assetId: string): Promise<string | undefined> => {
    const existing = assetsRef.current.get(assetId)?.filePath;
    if (existing) return existing;
    const file = rawFilesRef.current.get(assetId);
    if (!file) return undefined;
    const staged = await stageFileToDiskIfNeeded(file);
    if (staged) {
      setAssets((prev) => {
        const cur = prev.get(assetId);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(assetId, { ...cur, filePath: staged });
        return next;
      });
    }
    return staged;
  }, []);

  const mutateSelectedClip = useCallback(
    (updater: (clip: TimelineClip) => TimelineClip, recordUndo = false) => {
      if (!selectedClipId) return;
      if (recordUndo) pushUndoSnapshot();
      setClips((prev) => prev.map((c) => (c.id === selectedClipId ? updater(c) : c)));
    },
    [selectedClipId, pushUndoSnapshot]
  );

  /**
   * Instant, non-blocking media import:
   * - Video clips appear on V1 in < 50ms with zero full-file RAM copies or blocking uploads.
   * - Hardware <video> audio routes zero-copy through Web Audio MediaElementAudioSourceNode.
   * - Waveforms & beat analysis run cleanly in the background without ever freezing the UI.
   */
  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      pushUndoSnapshot();

      const videoTracks = tracksRef.current.filter((t) => t.kind === 'video');
      const primaryVideoTrack = videoTracks[videoTracks.length - 1]?.id || 'v1';
      const firstAudioTrack = tracksRef.current.find((t) => t.kind === 'audio')?.id || 'a1';

      let videoCursor = clipsRef.current
        .filter((c) => c.trackId === primaryVideoTrack)
        .reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
      let audioCursor = clipsRef.current
        .filter((c) => c.trackId === firstAudioTrack)
        .reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);

      const wasEmpty = clipsRef.current.length === 0;

      for (const file of list) {
        const isAudio =
          file.type.startsWith('audio/') || /\.(wav|flac|mp3|ogg|aac|m4a|aiff)$/i.test(file.name);
        const isVideo =
          file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name);
        if (!isAudio && !isVideo) continue;

        const objectUrl = URL.createObjectURL(file);
        const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const directDiskPath = resolveLocalFilePath(file);
        rawFilesRef.current.set(assetId, file);

        if (isAudio) {
          const duration = await new Promise<number>((resolve) => {
            const a = document.createElement('audio');
            a.src = objectUrl;
            a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 10);
            a.onerror = () => resolve(10);
            setTimeout(() => resolve(10), 4000);
          });

          const newAsset: MediaAsset = {
            id: assetId,
            name: file.name,
            kind: 'audio',
            objectUrl,
            filePath: directDiskPath,
            duration,
            width: 0,
            height: 0,
            fps: SEQUENCE_FPS,
            hasAudio: true,
            waveform: [],
          };
          setAssets((prev) => new Map(prev).set(assetId, newAsset));

          const newClipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newClip: TimelineClip = {
            id: newClipId,
            assetId,
            trackId: firstAudioTrack,
            name: file.name,
            start: snapToFrame(audioCursor, SEQUENCE_FPS),
            sourceIn: 0,
            duration: snapToFrame(duration, SEQUENCE_FPS),
            sourceDuration: duration,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            muted: false,
            color: createDefaultGrade(),
            stabilization: createDefaultStabilization(),
          };
          setClips((prev) => [...prev, newClip]);
          setSelectedClipId(newClipId);
          audioCursor += duration;

          // Background Web Audio decode, waveform extraction & beat/transient analysis
          (async () => {
            await audioEngineRef.current?.decodeAndStore(assetId, file);
            const { peaks } = await extractAudioWaveformFromFile(file, 220);
            let beatAnalysis: BeatAnalysisResult | undefined;
            if (directDiskPath) {
              try {
                beatAnalysis = await runBackendBeatAnalysis(directDiskPath);
              } catch {
                beatAnalysis = (await analyzeAudioBeatsInBrowser(file)) ?? undefined;
              }
            } else {
              beatAnalysis = (await analyzeAudioBeatsInBrowser(file)) ?? undefined;
            }
            setAssets((prev) => {
              const cur = prev.get(assetId);
              if (!cur) return prev;
              const next = new Map(prev);
              next.set(assetId, { ...cur, waveform: peaks, beatAnalysis });
              return next;
            });
            if (beatAnalysis) {
              setShowBeats(true);
              setAlignFeedback(`Analyzed ${beatAnalysis.bpm.toFixed(1)} BPM (${beatAnalysis.beats.length} beats)`);
              setTimeout(() => setAlignFeedback(''), 3500);
            }
          })();
        } else {
          const video = document.createElement('video');
          video.src = objectUrl;
          video.muted = false;
          video.playsInline = true;
          video.preload = 'auto';
          video.crossOrigin = 'anonymous';

          // Drain queued scrub seeks cleanly when seek finishes
          video.addEventListener('seeked', () => {
            const pending = pendingSeekRef.current.get(assetId);
            if (pending !== undefined) {
              pendingSeekRef.current.delete(assetId);
              if (Math.abs(video.currentTime - pending) > 0.015) {
                try {
                  video.currentTime = pending;
                } catch {
                  // ignore
                }
              }
            }
          });

          await new Promise<void>((resolve) => {
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            video.addEventListener('loadeddata', done, { once: true });
            video.addEventListener('loadedmetadata', () => {
              // Nudge to frame 0.001 so first frame decodes reliably on Windows Chromium
              if (video.readyState < 2) {
                try {
                  video.currentTime = 0.001;
                } catch {
                  // ignore
                }
              }
            }, { once: true });
            video.addEventListener('error', done, { once: true });
            setTimeout(done, 5000);
          });

          const duration =
            Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
          const width = video.videoWidth || 1280;
          const height = video.videoHeight || 720;

          videoElementsRef.current.set(assetId, video);
          audioEngineRef.current?.attachVideoElement(assetId, video);

          const newAsset: MediaAsset = {
            id: assetId,
            name: file.name,
            kind: 'video',
            objectUrl,
            filePath: directDiskPath,
            duration,
            width,
            height,
            fps: SEQUENCE_FPS,
            hasAudio: true,
            waveform: [],
          };
          setAssets((prev) => new Map(prev).set(assetId, newAsset));

          const newClipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newClip: TimelineClip = {
            id: newClipId,
            assetId,
            trackId: primaryVideoTrack,
            name: file.name,
            start: snapToFrame(videoCursor, SEQUENCE_FPS),
            sourceIn: 0,
            duration: snapToFrame(duration, SEQUENCE_FPS),
            sourceDuration: duration,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            muted: false,
            color: createDefaultGrade(),
            stabilization: createDefaultStabilization(),
          };
          setClips((prev) => [...prev, newClip]);
          setSelectedClipId(newClipId);
          if (wasEmpty && videoCursor === 0) {
            setPlayhead(0);
          }
          videoCursor += duration;

          // Non-blocking background waveform extraction (FFmpeg PCM for disk paths, Web Audio only for <= 60 MB files)
          (async () => {
            try {
              let peaks: number[] = [];
              if (directDiskPath) {
                peaks = await extractBackendWaveform(directDiskPath);
              } else if (file.size <= 60 * 1024 * 1024) {
                const res = await extractAudioWaveformFromFile(file, 160);
                peaks = res.hasAudio ? res.peaks : [];
              }
              if (peaks.length > 0) {
                setAssets((prev) => {
                  const cur = prev.get(assetId);
                  if (!cur) return prev;
                  const next = new Map(prev);
                  next.set(assetId, { ...cur, waveform: peaks });
                  return next;
                });
              }
            } catch {
              // waveform is optional UI polish; never block editing
            }
          })();
        }
      }
    },
    [pushUndoSnapshot]
  );

  const handleAlignCutsToBeats = useCallback(
    (target: BeatSnapTarget, toleranceMs: number) => {
      const videoTrackIds = new Set(tracks.filter((t) => t.kind === 'video').map((t) => t.id));
      const selectedIsVideo = selectedClip && videoTrackIds.has(selectedClip.trackId);
      const targetIds = new Set<string>(
        selectedIsVideo
          ? [selectedClip.id]
          : clipsRef.current.filter((c) => videoTrackIds.has(c.trackId)).map((c) => c.id)
      );

      const { nextClips, alignedCount } = alignClipsToBeats({
        clips: clipsRef.current,
        targetClipIds: targetIds,
        beatPoints,
        target,
        toleranceMs,
        fps: SEQUENCE_FPS,
      });

      if (alignedCount > 0) {
        pushUndoSnapshot();
        setClips(nextClips);
        setAlignFeedback(`Aligned ${alignedCount} clip${alignedCount > 1 ? 's' : ''} to ${target}`);
      } else {
        setAlignFeedback(`No cuts within ±${toleranceMs}ms`);
      }
      setTimeout(() => setAlignFeedback(''), 3200);
    },
    [tracks, selectedClip, beatPoints, pushUndoSnapshot]
  );

  const handleAddTrack = useCallback((kind: 'video' | 'audio') => {
    setTracks((prev) => {
      const existingOfKind = prev.filter((t) => t.kind === kind);
      const nextNum = existingOfKind.length + 1;
      const newTrack: TimelineTrack = {
        id: `${kind[0]}${Date.now().toString(36)}`,
        name: `${kind === 'video' ? 'V' : 'A'}${nextNum}`,
        kind,
        muted: false,
        solo: false,
        locked: false,
        visible: true,
      };
      return kind === 'video' ? [newTrack, ...prev] : [...prev, newTrack];
    });
  }, []);

  const handleRemoveTrack = useCallback((trackId: string) => {
    setTracks((prev) => {
      const target = prev.find((t) => t.id === trackId);
      if (!target) return prev;
      if (prev.filter((t) => t.kind === target.kind).length <= 1) return prev;
      return prev.filter((t) => t.id !== trackId);
    });
    setClips((prev) => prev.filter((c) => c.trackId !== trackId));
  }, []);

  const handleMoveTrack = useCallback((trackId: string, dir: -1 | 1) => {
    setTracks((prev) => {
      const idx = prev.findIndex((t) => t.id === trackId);
      const nextIdx = idx + dir;
      if (idx < 0 || nextIdx < 0 || nextIdx >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(nextIdx, 0, item);
      return copy;
    });
  }, []);

  const handleAddLutToStack = useCallback(
    async (entry: LutLibraryEntry) => {
      if (!selectedClipId) return;
      try {
        const parsed = await loadParsedLut(entry);
        pipelineRef.current?.uploadLut(parsed);
        const role: LutRole = entry.isLogConversion ? 'input' : 'creative';
        const layer: LutStackLayer = {
          instanceId: `lut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          lutId: entry.id,
          name: entry.name,
          filePath: entry.filePath,
          format: entry.format,
          role,
          enabled: true,
          intensity: 100,
        };
        mutateSelectedClip(
          (clip) => ({
            ...clip,
            color: {
              ...clip.color,
              lutStack: [...clip.color.lutStack.slice(0, 5), layer],
            },
          }),
          true
        );
      } catch (err) {
        console.error('Failed to add LUT:', err);
      }
    },
    [selectedClipId, mutateSelectedClip]
  );

  useEffect(() => {
    const needed = new Set<string>();
    for (const c of clips) {
      for (const l of c.color.lutStack) needed.add(l.lutId);
    }
    needed.forEach(async (lutId) => {
      const existing = getCachedLutMap().get(lutId);
      if (existing) {
        pipelineRef.current?.uploadLut(existing);
        return;
      }
      const libEntry = lutLibrary.find((item) => item.id === lutId);
      if (libEntry) {
        try {
          const parsed = await loadParsedLut(libEntry);
          pipelineRef.current?.uploadLut(parsed);
        } catch {
          // ignore
        }
      }
    });
  }, [clips, lutLibrary]);

  // Real Two-Pass Stabilization (lazily stages file if running in browser preview)
  const handleAnalyzeStabilize = useCallback(async () => {
    if (!selectedClip) return;
    const asset = assetsRef.current.get(selectedClip.assetId);
    if (!asset || asset.kind !== 'video') return;

    const clipId = selectedClip.id;
    const mode = selectedClip.stabilization.mode;
    const setStab = (patch: Partial<StabilizationState>) => {
      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, stabilization: { ...c.stabilization, ...patch } } : c
        )
      );
    };

    setStab({
      status: 'analyzing',
      progress: 5,
      statusMessage: 'Preparing video for two-pass stabilization...',
    });

    try {
      const inputPath = await ensureAssetDiskPath(asset.id);
      if (!inputPath) {
        throw new Error('Could not access source video file on disk.');
      }

      const res = await runBackendStabilize(
        {
          inputPath,
          mode,
          engine: selectedClip.stabilization.engine,
          smoothness: selectedClip.stabilization.smoothness,
          strength: selectedClip.stabilization.strength,
          autoCropZoom: selectedClip.stabilization.autoCropZoom,
          rollingShutter: selectedClip.stabilization.rollingShutter,
        },
        (progress, stage) => {
          setStab({ progress, statusMessage: stage });
        }
      );

      const stabKey = `stab-${clipId}`;
      const stabVid = document.createElement('video');
      stabVid.src = res.previewUrl;
      stabVid.muted = true; // Audio comes from primary video/audio mixer
      stabVid.playsInline = true;
      stabVid.preload = 'auto';
      stabVid.crossOrigin = 'anonymous';
      stabVid.addEventListener('seeked', () => {
        const pending = pendingSeekRef.current.get(stabKey);
        if (pending !== undefined) {
          pendingSeekRef.current.delete(stabKey);
          if (Math.abs(stabVid.currentTime - pending) > 0.015) {
            try {
              stabVid.currentTime = pending;
            } catch {
              // ignore
            }
          }
        }
      });

      await new Promise<void>((resolve) => {
        stabVid.addEventListener('loadeddata', () => resolve(), { once: true });
        stabVid.addEventListener('error', () => resolve(), { once: true });
        setTimeout(resolve, 5000);
      });
      videoElementsRef.current.set(stabKey, stabVid);

      setStab({
        enabled: true,
        status: 'ready',
        progress: 100,
        stabilizedUrl: res.previewUrl,
        stabilizedFilePath: res.stabilizedFilePath,
        trajectory: res.trajectory,
        statusMessage: res.message,
      });
    } catch (err) {
      setStab({
        status: 'error',
        progress: 0,
        statusMessage: err instanceof Error ? err.message : 'Stabilization failed',
      });
    }
  }, [selectedClip, ensureAssetDiskPath]);

  const handleBladeSplit = useCallback(() => {
    const t = snapToFrame(playheadRef.current, SEQUENCE_FPS);
    const target =
      clipsRef.current.find((c) => c.id === selectedClipId && t > c.start + 0.08 && t < c.start + c.duration - 0.08) ||
      clipsRef.current.find((c) => t > c.start + 0.08 && t < c.start + c.duration - 0.08);
    if (!target) return;

    pushUndoSnapshot();
    const leftDur = snapToFrame(t - target.start, SEQUENCE_FPS);
    const rightDur = snapToFrame(target.duration - leftDur, SEQUENCE_FPS);
    const rightClip: TimelineClip = {
      ...structuredClone(target),
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      start: t,
      sourceIn: target.sourceIn + leftDur,
      duration: rightDur,
    };

    setClips((prev) =>
      prev.flatMap((c) => (c.id === target.id ? [{ ...c, duration: leftDur }, rightClip] : [c]))
    );
    setSelectedClipId(rightClip.id);
  }, [selectedClipId, pushUndoSnapshot]);

  const handleDeleteClip = useCallback(
    (ripple: boolean) => {
      if (!selectedClipId) return;
      const target = clipsRef.current.find((c) => c.id === selectedClipId);
      if (!target) return;
      pushUndoSnapshot();
      setClips((prev) =>
        prev
          .filter((c) => c.id !== selectedClipId)
          .map((c) => {
            if (ripple && c.trackId === target.trackId && c.start >= target.start + target.duration - 0.001) {
              return { ...c, start: Math.max(0, snapToFrame(c.start - target.duration, SEQUENCE_FPS)) };
            }
            return c;
          })
      );
      setSelectedClipId(null);
    },
    [selectedClipId, pushUndoSnapshot]
  );

  const handleMoveClip = useCallback((clipId: string, newStart: number, newTrackId?: string) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, start: newStart, trackId: newTrackId ?? c.trackId } : c))
    );
  }, []);

  const handleTrimClip = useCallback((clipId: string, edge: 'left' | 'right', newTime: number) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const minDur = 2 / SEQUENCE_FPS;
        if (edge === 'left') {
          const maxStart = c.start + c.duration - minDur;
          const clampedStart = Math.max(c.start - c.sourceIn, Math.min(maxStart, newTime));
          const delta = clampedStart - c.start;
          return {
            ...c,
            start: clampedStart,
            sourceIn: Math.max(0, c.sourceIn + delta),
            duration: c.duration - delta,
          };
        }
        const maxEnd = c.start + (c.sourceDuration - c.sourceIn);
        const clampedEnd = Math.max(c.start + minDur, Math.min(maxEnd, newTime));
        return { ...c, duration: clampedEnd - c.start };
      })
    );
  }, []);

  // Unified 60fps Hardware Video Playback, Clock, WebGL2 Render, Scopes & Audio Metering Loop
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();
    let lastScopeTs = 0;
    let lastMeterTs = 0;
    let lastUiPlayheadTs = 0;

    const loop = (now: number) => {
      const dt = Math.min(0.08, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      const playing = isPlayingRef.current;
      const shuttle = shuttleSpeedRef.current;
      const rate = shuttle !== 0 ? shuttle : playing ? 1 : 0;
      const seqDur = clipsRef.current.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);

      let curPlayhead = playheadRef.current;
      if (rate !== 0 && seqDur > 0) {
        curPlayhead += dt * rate;
        if (curPlayhead >= seqDur) {
          curPlayhead = seqDur;
          isPlayingRef.current = false;
          shuttleSpeedRef.current = 0;
          setIsPlaying(false);
          setShuttleSpeed(0);
          pauseAllVideos();
        } else if (curPlayhead <= 0 && rate < 0) {
          curPlayhead = 0;
          isPlayingRef.current = false;
          shuttleSpeedRef.current = 0;
          setIsPlaying(false);
          setShuttleSpeed(0);
          pauseAllVideos();
        }
        playheadRef.current = curPlayhead;
        if (now - lastUiPlayheadTs > 32 || curPlayhead === 0 || curPlayhead === seqDur) {
          lastUiPlayheadTs = now;
          setPlayhead(curPlayhead);
        }
      }

      const pipeline = pipelineRef.current;
      const clip = findActiveVideoClipAt(curPlayhead);
      const asset = clip ? assetsRef.current.get(clip.assetId) : null;
      const activeVideoKeys = new Set<string>();

      if (pipeline) {
        if (clip && asset && asset.kind === 'video') {
          const clipSpeed = clip.color.effects.enabled ? clip.color.effects.speed : 1;
          const elapsedInClip = Math.max(0, curPlayhead - clip.start);
          const clipTime = Math.max(0, clip.sourceIn + elapsedInClip * clipSpeed);

          const rawVid = videoElementsRef.current.get(asset.id);
          const stabKey = `stab-${clip.id}`;
          const stabVid =
            clip.stabilization.enabled && clip.stabilization.stabilizedUrl
              ? videoElementsRef.current.get(stabKey)
              : undefined;

          if (rawVid) activeVideoKeys.add(asset.id);
          if (stabVid) activeVideoKeys.add(stabKey);

          // Drive true hardware video playback (never seek-thrash while playing forward!)
          const driveVideo = (key: string, vid: HTMLVideoElement, isPrimaryAudio: boolean) => {
            if (rate > 0) {
              const effRate = Math.max(0.25, Math.min(4.0, rate * clipSpeed));
              if (Math.abs(vid.playbackRate - effRate) > 0.01) {
                vid.playbackRate = effRate;
              }
              if (vid.paused && vid.readyState >= 2) {
                try {
                  if (Math.abs(vid.currentTime - clipTime) > 0.08) {
                    vid.currentTime = clipTime;
                  }
                  vid.play().catch(() => {});
                } catch {
                  // ignore
                }
              } else if (!vid.seeking && Math.abs(vid.currentTime - clipTime) > 0.35) {
                try {
                  vid.currentTime = clipTime;
                } catch {
                  // ignore
                }
              }
              if (isPrimaryAudio && audioEngineRef.current) {
                const track = tracksRef.current.find((t) => t.id === clip.trackId);
                const anyAudioSolo = tracksRef.current.some((t) => t.kind === 'audio' && t.solo);
                const audible = !clip.muted && !track?.muted && !anyAudioSolo;
                const env = computeClipEnvelopeMultiplier(clip, elapsedInClip);
                audioEngineRef.current.setVideoClipEnvelopeGain(
                  asset.id,
                  audible ? clip.volume * env : 0
                );
              }
            } else {
              if (!vid.paused) vid.pause();
              safeSeekVideo(key, vid, clipTime);
            }
          };

          if (rawVid) driveVideo(asset.id, rawVid, true);
          if (stabVid) driveVideo(stabKey, stabVid, false);

          // Pause any non-active video elements so hidden clips never play or leak audio
          for (const [k, v] of videoElementsRef.current.entries()) {
            if (!activeVideoKeys.has(k) && !v.paused) {
              v.pause();
            }
          }

          if (rawVid && rawVid.readyState >= 2) {
            const frameIndex = Math.floor(clipTime * (asset.fps || SEQUENCE_FPS));
            const frameTransform = clip.stabilization.trajectory?.length
              ? clip.stabilization.trajectory[
                  Math.min(frameIndex, clip.stabilization.trajectory.length - 1)
                ]
              : undefined;

            pipeline.renderFrame({
              source: rawVid,
              stabilizedSource: stabVid && stabVid.readyState >= 2 ? stabVid : null,
              width: rawVid.videoWidth || asset.width || 1280,
              height: rawVid.videoHeight || asset.height || 720,
              grade: clip.color,
              stabilization: clip.stabilization,
              frameTransform,
              compareOriginal: compareHeld,
              splitEnabled,
              splitPos,
              timeSec: curPlayhead,
            });
          }
          // Hold last rendered frame while video keyframe seeks (prevents black flicker)
        } else {
          // Playhead is over an empty gap or empty timeline
          for (const v of videoElementsRef.current.values()) {
            if (!v.paused) v.pause();
          }
          pipeline.clear();
        }

        if (
          activeTab === 'scopes' &&
          viewportCanvasRef.current &&
          scopeCanvasRef.current &&
          clipsRef.current.length > 0 &&
          now - lastScopeTs > 55
        ) {
          lastScopeTs = now;
          const metrics = renderVideoScope(
            viewportCanvasRef.current,
            scopeCanvasRef.current,
            scopeMode
          );
          setScopeMetrics(metrics);
        }

        if (activeTab === 'audio' && audioEngineRef.current && now - lastMeterTs > 42) {
          lastMeterTs = now;
          setAudioMeters(audioEngineRef.current.getMeters(rate > 0));
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [findActiveVideoClipAt, pauseAllVideos, safeSeekVideo, compareHeld, splitEnabled, splitPos, activeTab, scopeMode]);

  // Global NLE Keyboard Shortcuts
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        audioEngineRef.current?.resume();
        setShuttleSpeed(0);
        setIsPlaying((p) => {
          if (!p && sequenceDuration > 0 && playheadRef.current >= sequenceDuration - 0.02) {
            playheadRef.current = 0;
            setPlayhead(0);
          }
          return !p;
        });
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setIsPlaying(true);
        setShuttleSpeed((s) => (s >= 0 ? -1 : Math.max(-4, s * 2)));
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setIsPlaying(false);
        setShuttleSpeed(0);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        audioEngineRef.current?.resume();
        setIsPlaying(true);
        setShuttleSpeed((s) => (s <= 0 ? 1 : Math.min(4, s * 2)));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setShuttleSpeed(0);
        const step = (e.shiftKey ? 10 : 1) / SEQUENCE_FPS;
        const next = Math.max(0, snapToFrame(playheadRef.current - step, SEQUENCE_FPS));
        playheadRef.current = next;
        setPlayhead(next);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setShuttleSpeed(0);
        const step = (e.shiftKey ? 10 : 1) / SEQUENCE_FPS;
        const next = Math.min(sequenceDuration, snapToFrame(playheadRef.current + step, SEQUENCE_FPS));
        playheadRef.current = next;
        setPlayhead(next);
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setSnapEnabled((s) => !s);
      } else if ((e.key === 'b' || e.key === 'B') && !e.altKey) {
        e.preventDefault();
        handleBladeSplit();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setInPoint(snapToFrame(playheadRef.current, SEQUENCE_FPS));
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        setOutPoint(snapToFrame(playheadRef.current, SEQUENCE_FPS));
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setMarkers((prev) => [
          ...prev,
          { id: `m-${Date.now()}`, time: snapToFrame(playheadRef.current, SEQUENCE_FPS), label: `M${prev.length + 1}` },
        ]);
      } else if (e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        setViewAllLayers((v) => !v);
      } else if (e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (sequenceDuration > 0) {
          setPixelsPerSecond(Math.max(4, Math.min(1600, 960 / Math.max(4, sequenceDuration))));
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteClip(e.shiftKey);
      } else if (e.key === '\\') {
        setCompareHeld(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === '\\') setCompareHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sequenceDuration, handleBladeSplit, handleDeleteClip, handleUndo, handleRedo]);

  const handleSaveGradeAsLut = async (name: string) => {
    if (!selectedClip) return;
    const cube = bakeGradeToCube(name, selectedClip.color, getCachedLutMap(), 33);
    await saveNewCubeLut(name, cube);
    await refreshLuts();
  };

  return (
    <div className="app-shell">
      <input
        ref={videoFileInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.mov,.mkv,.webm,.m4v,.wav,.flac,.mp3"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            importFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />
      <input
        ref={musicFileInputRef}
        type="file"
        accept="audio/*,.wav,.flac,.mp3,.ogg,.aac,.m4a"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) {
            importFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      <TopBar
        capabilities={capabilities}
        compareHeld={compareHeld}
        onCompareStart={() => setCompareHeld(true)}
        onCompareEnd={() => setCompareHeld(false)}
        splitEnabled={splitEnabled}
        splitPos={splitPos}
        onSplitEnabledChange={setSplitEnabled}
        onSplitPosChange={setSplitPos}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onImportClick={() => videoFileInputRef.current?.click()}
        onImportMusicClick={() => musicFileInputRef.current?.click()}
        onResetLook={() =>
          mutateSelectedClip((c) => ({ ...c, color: createDefaultGrade() }), true)
        }
        onShowKeys={() => setShowKeys(true)}
        onOpenExport={() => setShowExport(true)}
      />

      <main className="workspace-main">
        <Viewport
          canvasRef={viewportCanvasRef}
          hasMedia={clips.length > 0}
          playhead={playhead}
          duration={sequenceDuration}
          fps={SEQUENCE_FPS}
          isPlaying={isPlaying}
          shuttleSpeed={shuttleSpeed}
          splitEnabled={splitEnabled}
          splitPos={splitPos}
          compareHeld={compareHeld}
          activeClipName={activeVideoClip?.name || null}
          activeLutCount={
            activeVideoClip
              ? activeVideoClip.color.lutStack.filter((l) => l.enabled && l.intensity > 0).length
              : 0
          }
          stabilizedLabel={
            activeVideoClip?.stabilization.enabled
              ? activeVideoClip.stabilization.mode === 'lock'
                ? 'Tripod Lock'
                : 'Smooth Motion'
              : null
          }
          onSplitPosChange={setSplitPos}
          onTogglePlay={() => {
            audioEngineRef.current?.resume();
            setShuttleSpeed(0);
            setIsPlaying((p) => {
              if (!p && sequenceDuration > 0 && playheadRef.current >= sequenceDuration - 0.02) {
                playheadRef.current = 0;
                setPlayhead(0);
              }
              return !p;
            });
          }}
          onStepFrames={(delta) => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            const next = Math.max(
              0,
              Math.min(sequenceDuration, snapToFrame(playheadRef.current + delta / SEQUENCE_FPS, SEQUENCE_FPS))
            );
            playheadRef.current = next;
            setPlayhead(next);
          }}
          onShuttle={(dir) => {
            if (dir === 0) {
              setIsPlaying(false);
              setShuttleSpeed(0);
            } else if (dir < 0) {
              setIsPlaying(true);
              setShuttleSpeed((s) => (s >= 0 ? -1 : Math.max(-4, s * 2)));
            } else {
              audioEngineRef.current?.resume();
              setIsPlaying(true);
              setShuttleSpeed((s) => (s <= 0 ? 1 : Math.min(4, s * 2)));
            }
          }}
          onSeekStart={() => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            playheadRef.current = 0;
            setPlayhead(0);
          }}
          onSeekEnd={() => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            playheadRef.current = sequenceDuration;
            setPlayhead(sequenceDuration);
          }}
          onMarkIn={() => setInPoint(snapToFrame(playheadRef.current, SEQUENCE_FPS))}
          onMarkOut={() => setOutPoint(snapToFrame(playheadRef.current, SEQUENCE_FPS))}
          onImportClick={() => videoFileInputRef.current?.click()}
          onDropFiles={importFiles}
        />

        <Inspector
          activeTab={activeTab}
          onTabChange={setActiveTab}
          clip={selectedClip}
          lutLibrary={lutLibrary}
          lutLibraryLoading={lutLibraryLoading}
          onRefreshLuts={refreshLuts}
          capabilities={capabilities}
          scopeMode={scopeMode}
          onScopeModeChange={setScopeMode}
          scopeCanvasRef={scopeCanvasRef}
          scopeMetrics={scopeMetrics}
          audioMeters={audioMeters}
          masterVolume={masterVolume}
          masterMuted={masterMuted}
          onMasterVolumeChange={setMasterVolume}
          onMasterMutedChange={setMasterMuted}
          onUpdateClipAudio={(patch) => {
            mutateSelectedClip((c) => {
              const next = { ...c, ...patch };
              audioEngineRef.current?.updateClipVolumeLive(next.id, next.volume, next.muted);
              return next;
            });
          }}
          onNormalizeClipAudio={() => {
            if (!selectedClip) return;
            const normVol = audioEngineRef.current?.computeNormalizeVolume(selectedClip.assetId, -1.0);
            if (normVol !== null && normVol !== undefined) {
              mutateSelectedClip((c) => {
                audioEngineRef.current?.updateClipVolumeLive(c.id, normVol, c.muted);
                return { ...c, volume: normVol };
              }, true);
            }
          }}
          splitEnabled={splitEnabled}
          onSplitEnabledChange={setSplitEnabled}
          onCompareStart={() => setCompareHeld(true)}
          onCompareEnd={() => setCompareHeld(false)}
          onUpdateCorrection={(patch: Partial<ColorCorrectionState>) =>
            mutateSelectedClip((c) => ({
              ...c,
              color: { ...c.color, correction: { ...c.color.correction, ...patch } },
            }))
          }
          onResetCorrection={() =>
            mutateSelectedClip(
              (c) => ({ ...c, color: { ...c.color, correction: createDefaultCorrection() } }),
              true
            )
          }
          onUpdateGrading={(patch: Partial<ColorGradingState>) =>
            mutateSelectedClip((c) => ({
              ...c,
              color: { ...c.color, grading: { ...c.color.grading, ...patch } },
            }))
          }
          onResetGrading={() =>
            mutateSelectedClip(
              (c) => ({ ...c, color: { ...c.color, grading: createDefaultGrading() } }),
              true
            )
          }
          onUpdateEffects={(patch: Partial<ClipEffectsState>) =>
            mutateSelectedClip((c) => ({
              ...c,
              color: { ...c.color, effects: { ...c.color.effects, ...patch } },
            }))
          }
          onResetEffects={() =>
            mutateSelectedClip(
              (c) => ({ ...c, color: { ...c.color, effects: createDefaultEffects() } }),
              true
            )
          }
          onAddLutToStack={handleAddLutToStack}
          onUpdateLutLayer={(instanceId, patch) =>
            mutateSelectedClip((c) => ({
              ...c,
              color: {
                ...c.color,
                lutStack: c.color.lutStack.map((l) =>
                  l.instanceId === instanceId ? { ...l, ...patch } : l
                ),
              },
            }))
          }
          onRemoveLutLayer={(instanceId) =>
            mutateSelectedClip(
              (c) => ({
                ...c,
                color: {
                  ...c.color,
                  lutStack: c.color.lutStack.filter((l) => l.instanceId !== instanceId),
                },
              }),
              true
            )
          }
          onReorderLutStack={(fromIdx, toIdx) =>
            mutateSelectedClip((c) => {
              const copy = [...c.color.lutStack];
              const [moved] = copy.splice(fromIdx, 1);
              copy.splice(toIdx, 0, moved);
              return { ...c, color: { ...c.color, lutStack: copy } };
            }, true)
          }
          onSetLutInterpolation={(mode) =>
            mutateSelectedClip((c) => ({
              ...c,
              color: { ...c.color, lutInterpolation: mode },
            }))
          }
          onSaveGradeAsLut={handleSaveGradeAsLut}
          onUpdateStabilization={(patch) =>
            mutateSelectedClip((c) => ({
              ...c,
              stabilization: { ...c.stabilization, ...patch },
            }))
          }
          onAnalyzeStabilize={handleAnalyzeStabilize}
        />
      </main>

      <Timeline
        tracks={tracks}
        clips={clips}
        assets={assets}
        markers={markers}
        beatPoints={beatPoints}
        detectedBpm={detectedBpm}
        showBeats={showBeats}
        onToggleShowBeats={() => setShowBeats((b) => !b)}
        onAlignCutsToBeats={handleAlignCutsToBeats}
        alignFeedback={alignFeedback}
        playhead={playhead}
        fps={SEQUENCE_FPS}
        selectedClipId={selectedClipId}
        snapEnabled={snapEnabled}
        viewAllLayers={viewAllLayers}
        onToggleViewAllLayers={() => setViewAllLayers((v) => !v)}
        inPoint={inPoint}
        outPoint={outPoint}
        pixelsPerSecond={pixelsPerSecond}
        onPixelsPerSecondChange={setPixelsPerSecond}
        onPlayheadChange={(t) => {
          setIsPlaying(false);
          setShuttleSpeed(0);
          playheadRef.current = t;
          setPlayhead(t);
        }}
        onSelectClip={setSelectedClipId}
        onToggleSnap={() => setSnapEnabled((s) => !s)}
        onBladeSplit={handleBladeSplit}
        onDeleteClip={handleDeleteClip}
        onAddMarker={() =>
          setMarkers((prev) => [
            ...prev,
            { id: `m-${Date.now()}`, time: snapToFrame(playheadRef.current, SEQUENCE_FPS), label: `M${prev.length + 1}` },
          ])
        }
        onAddTrack={handleAddTrack}
        onRemoveTrack={handleRemoveTrack}
        onMoveTrack={handleMoveTrack}
        onToggleTrackFlag={(trackId, flag) =>
          setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, [flag]: !t[flag] } : t)))
        }
        onMoveClip={handleMoveClip}
        onTrimClip={handleTrimClip}
        onCommitHistory={() => pushUndoSnapshot()}
      />

      {showExport && (
        <ExportModal
          clip={selectedClip}
          asset={selectedClip ? assets.get(selectedClip.assetId) || null : null}
          clips={clips}
          tracks={tracks}
          assets={assets}
          masterVolume={masterVolume}
          masterMuted={masterMuted}
          ensureAssetDiskPath={ensureAssetDiskPath}
          capabilities={capabilities}
          inPoint={inPoint}
          outPoint={outPoint}
          onClose={() => setShowExport(false)}
          onLutSavedToColorstudies={refreshLuts}
        />
      )}

      {showKeys && <KeysModal onClose={() => setShowKeys(false)} />}
    </div>
  );
}
