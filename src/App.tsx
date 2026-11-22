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
import { extractAudioWaveformFromFile, generateFallbackWaveform } from './engine/audioWaveform';
import {
  alignClipsToBeats,
  analyzeAudioBeatsInBrowser,
  collectTimelineBeatPoints,
  createSampleBeatAnalysis,
} from './engine/beatSync';
import {
  computeSampleStabilizationTrajectory,
  drawProceduralCinemaFrame,
} from './engine/sampleMedia';
import { snapToFrame } from './engine/timecode';
import {
  fetchCapabilities,
  fetchLutLibrary,
  getCachedLutMap,
  loadParsedLut,
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

function createInitialAssets(): Map<string, MediaAsset> {
  const map = new Map<string, MediaAsset>();
  map.set('sample-twilight', {
    id: 'sample-twilight',
    name: 'A001_Twilight_Handheld.mov',
    kind: 'video',
    objectUrl: '',
    duration: 12,
    width: 1280,
    height: 720,
    fps: 24,
    hasAudio: true,
    waveform: generateFallbackWaveform(180, 0.72),
    isSample: true,
  });
  map.set('sample-coast', {
    id: 'sample-coast',
    name: 'B002_Coastline_Walk.mov',
    kind: 'video',
    objectUrl: '',
    duration: 10,
    width: 1280,
    height: 720,
    fps: 24,
    hasAudio: true,
    waveform: generateFallbackWaveform(160, 0.54),
    isSample: true,
  });
  map.set('sample-music', {
    id: 'sample-music',
    name: 'bebeat_NightDrive_124bpm.wav',
    kind: 'audio',
    objectUrl: '',
    duration: 24,
    width: 0,
    height: 0,
    fps: 24,
    hasAudio: true,
    waveform: generateFallbackWaveform(220, 0.88),
    beatAnalysis: createSampleBeatAnalysis(24, 124),
    isSample: true,
  });
  return map;
}

function createInitialClips(): TimelineClip[] {
  return [
    {
      id: 'clip-1',
      assetId: 'sample-twilight',
      trackId: 'v1',
      name: 'A001_Twilight_Handheld.mov',
      start: 0,
      sourceIn: 0,
      duration: 7.82,
      sourceDuration: 12,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      muted: false,
      color: createDefaultGrade(),
      stabilization: createDefaultStabilization(),
    },
    {
      id: 'clip-2',
      assetId: 'sample-coast',
      trackId: 'v1',
      name: 'B002_Coastline_Walk.mov',
      start: 7.82,
      sourceIn: 0,
      duration: 9.6,
      sourceDuration: 10,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      muted: false,
      color: createDefaultGrade(),
      stabilization: createDefaultStabilization(),
    },
    {
      id: 'clip-a1',
      assetId: 'sample-music',
      trackId: 'a1',
      name: 'bebeat_NightDrive_124bpm.wav',
      start: 0,
      sourceIn: 0,
      duration: 22,
      sourceDuration: 24,
      volume: 0.9,
      fadeIn: 0.4,
      fadeOut: 1.2,
      muted: false,
      color: createDefaultGrade(),
      stabilization: createDefaultStabilization(),
    },
  ];
}

export default function App() {
  const [capabilities, setCapabilities] = useState<HardwareCapabilities | null>(null);
  const [lutLibrary, setLutLibrary] = useState<LutLibraryEntry[]>([]);
  const [lutLibraryLoading, setLutLibraryLoading] = useState(false);

  const [tracks, setTracks] = useState<TimelineTrack[]>(INITIAL_TRACKS);
  const [assets, setAssets] = useState<Map<string, MediaAsset>>(() => createInitialAssets());
  const [clips, setClips] = useState<TimelineClip[]>(() => createInitialClips());
  const [markers, setMarkers] = useState<TimelineMarker[]>([
    { id: 'm1', time: 3.875, label: 'Drop' },
  ]);

  const [selectedClipId, setSelectedClipId] = useState<string | null>('clip-1');
  const [playhead, setPlayhead] = useState<number>(2.5);
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
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  const sequenceDuration = useMemo(
    () => Math.max(10, clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0)),
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

  const activeVideoClip = useMemo(() => {
    const visibleVideoTrackIds = tracks
      .filter((t) => t.kind === 'video' && t.visible)
      .map((t) => t.id);
    for (const trackId of visibleVideoTrackIds) {
      const hit = clips.find(
        (c) => c.trackId === trackId && playhead >= c.start && playhead < c.start + c.duration
      );
      if (hit) return hit;
    }
    return null;
  }, [tracks, clips, playhead]);

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
    const sampleC = document.createElement('canvas');
    sampleC.width = 1280;
    sampleC.height = 720;
    sampleCanvasRef.current = sampleC;

    return () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
    };
  }, []);

  // Sync master volume / mute with Web Audio engine
  useEffect(() => {
    audioEngineRef.current?.setMasterVolume(masterVolume, masterMuted);
  }, [masterVolume, masterMuted]);

  // Sample-accurate Web Audio playback sync on Play/Pause/Shuttle/Track Mute-Solo changes
  const trackAudioSignature = useMemo(
    () => tracks.map((t) => `${t.id}:${t.muted ? 1 : 0}:${t.solo ? 1 : 0}`).join('|'),
    [tracks]
  );

  useEffect(() => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const rate = shuttleSpeed !== 0 ? shuttleSpeed : isPlaying ? 1 : 0;
    if (rate > 0) {
      engine.ensureSampleMusicBuffer('sample-music', 24, 124);
      engine.startPlayback({
        playheadSec: playheadRef.current,
        rate,
        clips: clipsRef.current,
        tracks: tracksRef.current,
      });
    } else {
      engine.stop();
    }
    return () => {
      engine.stop();
    };
  }, [isPlaying, shuttleSpeed, trackAudioSignature]);

  const mutateSelectedClip = useCallback(
    (updater: (clip: TimelineClip) => TimelineClip, recordUndo = false) => {
      if (!selectedClipId) return;
      if (recordUndo) pushUndoSnapshot();
      setClips((prev) => prev.map((c) => (c.id === selectedClipId ? updater(c) : c)));
    },
    [selectedClipId, pushUndoSnapshot]
  );

  // Import both video and audio files with Web Audio decoding, disk staging, and beat analysis
  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      pushUndoSnapshot();

      const firstVideoTrack = tracks.find((t) => t.kind === 'video')?.id || 'v1';
      const firstAudioTrack = tracks.find((t) => t.kind === 'audio')?.id || 'a1';

      let videoCursor = clipsRef.current
        .filter((c) => c.trackId === firstVideoTrack)
        .reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
      let audioCursor = 0;

      const onlySampleVideos = clipsRef.current
        .filter((c) => tracks.find((t) => t.id === c.trackId)?.kind === 'video')
        .every((c) => assets.get(c.assetId)?.isSample);

      for (const file of list) {
        const isAudio =
          file.type.startsWith('audio/') || /\.(wav|flac|mp3|ogg|aac|m4a|aiff)$/i.test(file.name);
        const isVideo =
          file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name);
        if (!isAudio && !isVideo) continue;

        const objectUrl = URL.createObjectURL(file);
        const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // Resolve local disk path (Electron webUtils) or stage to local temp cache for FFmpeg/libvidstab
        const diskPath = await stageFileToDiskIfNeeded(file);

        // Decode sample-accurate Web Audio buffer for mixer playback & normalization
        const decodedAudio = await audioEngineRef.current?.decodeAndStore(assetId, file);

        if (isAudio) {
          const duration =
            decodedAudio?.duration ||
            (await new Promise<number>((resolve) => {
              const a = document.createElement('audio');
              a.src = objectUrl;
              a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 15);
              a.onerror = () => resolve(15);
              setTimeout(() => resolve(15), 4000);
            }));

          const { peaks } = await extractAudioWaveformFromFile(file, 220);

          let beatAnalysis: BeatAnalysisResult | undefined;
          if (diskPath) {
            try {
              beatAnalysis = await runBackendBeatAnalysis(diskPath);
            } catch {
              beatAnalysis = (await analyzeAudioBeatsInBrowser(file)) ?? undefined;
            }
          } else {
            beatAnalysis = (await analyzeAudioBeatsInBrowser(file)) ?? undefined;
          }

          const newAsset: MediaAsset = {
            id: assetId,
            name: file.name,
            kind: 'audio',
            objectUrl,
            filePath: diskPath,
            duration,
            width: 0,
            height: 0,
            fps: SEQUENCE_FPS,
            hasAudio: true,
            waveform: peaks,
            beatAnalysis,
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
          setClips((prev) => [
            ...prev.filter((c) => !(c.trackId === firstAudioTrack && assets.get(c.assetId)?.isSample)),
            newClip,
          ]);
          setSelectedClipId(newClipId);
          setShowBeats(true);
          if (beatAnalysis) {
            setAlignFeedback(`Analyzed ${beatAnalysis.bpm.toFixed(1)} BPM (${beatAnalysis.beats.length} beats)`);
            setTimeout(() => setAlignFeedback(''), 4000);
          }
          audioCursor += duration;
        } else {
          if (onlySampleVideos && videoCursor > 0) {
            videoCursor = 0;
            setClips((prev) =>
              prev.filter((c) => !assets.get(c.assetId)?.isSample || c.trackId === firstAudioTrack)
            );
          }
          const video = document.createElement('video');
          video.src = objectUrl;
          video.muted = true; // Audio plays exclusively through sample-accurate Web Audio mixer
          video.playsInline = true;
          video.preload = 'auto';
          await new Promise<void>((resolve) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => resolve();
            setTimeout(resolve, 4000);
          });
          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
          const width = video.videoWidth || 1280;
          const height = video.videoHeight || 720;
          const { peaks, hasAudio } = await extractAudioWaveformFromFile(file, 160);
          videoElementsRef.current.set(assetId, video);

          const newAsset: MediaAsset = {
            id: assetId,
            name: file.name,
            kind: 'video',
            objectUrl,
            filePath: diskPath,
            duration,
            width,
            height,
            fps: SEQUENCE_FPS,
            hasAudio: hasAudio || !!decodedAudio,
            waveform: peaks,
          };
          setAssets((prev) => new Map(prev).set(assetId, newAsset));

          const newClipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newClip: TimelineClip = {
            id: newClipId,
            assetId,
            trackId: firstVideoTrack,
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
          videoCursor += duration;
        }
      }
    },
    [assets, tracks, pushUndoSnapshot]
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

  // Hardened Two-Pass Stabilization with live progress reporting & dual-video split comparison
  const handleAnalyzeStabilize = useCallback(async () => {
    if (!selectedClip) return;
    const asset = assets.get(selectedClip.assetId);
    if (!asset) return;

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
      progress: 8,
      statusMessage:
        mode === 'lock'
          ? 'Pass 1/2: Computing No Motion tripod lock anchor...'
          : 'Pass 1/2: Analyzing handheld motion vectors...',
    });

    try {
      if (asset.filePath) {
        const res = await runBackendStabilize(
          {
            inputPath: asset.filePath,
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

        const stabVid = document.createElement('video');
        stabVid.src = res.previewUrl;
        stabVid.muted = true;
        stabVid.playsInline = true;
        stabVid.preload = 'auto';
        await new Promise<void>((resolve) => {
          stabVid.onloadeddata = () => resolve();
          stabVid.onerror = () => resolve();
          setTimeout(resolve, 4000);
        });
        videoElementsRef.current.set(`stab-${clipId}`, stabVid);

        setStab({
          enabled: true,
          status: 'ready',
          progress: 100,
          stabilizedUrl: res.previewUrl,
          stabilizedFilePath: res.stabilizedFilePath,
          trajectory: res.trajectory,
          statusMessage: res.message,
        });
      } else {
        await new Promise((r) => setTimeout(r, 280));
        setStab({ progress: 65, statusMessage: 'Pass 2/2: Solving counter-shake trajectory and crop...' });
        await new Promise((r) => setTimeout(r, 240));
        const traj = computeSampleStabilizationTrajectory(
          selectedClip.sourceDuration,
          asset.fps || SEQUENCE_FPS,
          selectedClip.stabilization.smoothness,
          mode
        );
        setStab({
          enabled: true,
          status: 'ready',
          progress: 100,
          trajectory: traj,
          statusMessage:
            mode === 'lock'
              ? `No Motion tripod lock ready (${traj.length} frames locked, zoom +${selectedClip.stabilization.autoCropZoom}%).`
              : `Smooth Motion ready (${traj.length} frames smoothed at ${selectedClip.stabilization.smoothness}f, zoom +${selectedClip.stabilization.autoCropZoom}%).`,
        });
      }
    } catch (err) {
      setStab({
        status: 'error',
        progress: 0,
        statusMessage: err instanceof Error ? err.message : 'Stabilization failed',
      });
    }
  }, [selectedClip, assets]);

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

  // Playback / J-K-L Shuttle clock
  useEffect(() => {
    if (!isPlaying && shuttleSpeed === 0) return;
    const speed = shuttleSpeed !== 0 ? shuttleSpeed : 1;
    let lastTs = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      setPlayhead((prev) => {
        const next = prev + dt * speed;
        if (next >= sequenceDuration) {
          setIsPlaying(false);
          setShuttleSpeed(0);
          return sequenceDuration;
        }
        if (next <= 0 && speed < 0) {
          setIsPlaying(false);
          setShuttleSpeed(0);
          return 0;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, shuttleSpeed, sequenceDuration]);

  // 60fps WebGL2 Render, Dual-Texture Stabilization Compare, Scopes & Audio Meter Loop
  useEffect(() => {
    let rafId = 0;
    let lastScopeTs = 0;
    let lastMeterTs = 0;

    const syncVideoTime = (vid: HTMLVideoElement, targetSec: number) => {
      if (vid.readyState < 2) return;
      if (Math.abs(vid.currentTime - targetSec) > (isPlaying ? 0.22 : 0.035)) {
        try {
          vid.currentTime = targetSec;
        } catch {
          // ignore seek race
        }
      }
    };

    const renderLoop = (now: number) => {
      const pipeline = pipelineRef.current;
      const sampleCanvas = sampleCanvasRef.current;
      if (pipeline && sampleCanvas) {
        const clip = activeVideoClip;
        const asset = clip ? assets.get(clip.assetId) : null;

        if (clip && asset && asset.kind === 'video') {
          const speedMul = clip.color.effects.enabled ? clip.color.effects.speed : 1;
          const clipTime = Math.max(0, clip.sourceIn + (playheadRef.current - clip.start) * speedMul);
          let source: TexImageSource = sampleCanvas;
          let stabilizedSource: TexImageSource | null = null;
          let w = asset.width || 1280;
          let h = asset.height || 720;

          if (asset.isSample) {
            const ctx = sampleCanvas.getContext('2d');
            if (ctx) {
              drawProceduralCinemaFrame(
                ctx,
                1280,
                720,
                clipTime,
                asset.id === 'sample-coast' ? 'coast' : 'twilight',
                true
              );
            }
            w = 1280;
            h = 720;
          } else {
            const rawVid = videoElementsRef.current.get(asset.id);
            if (rawVid && rawVid.readyState >= 2) {
              syncVideoTime(rawVid, clipTime);
              source = rawVid;
              w = rawVid.videoWidth || w;
              h = rawVid.videoHeight || h;
            }
            if (clip.stabilization.enabled && clip.stabilization.stabilizedUrl) {
              const stabVid = videoElementsRef.current.get(`stab-${clip.id}`);
              if (stabVid && stabVid.readyState >= 2) {
                syncVideoTime(stabVid, clipTime);
                stabilizedSource = stabVid;
              }
            }
          }

          const frameIndex = Math.floor(clipTime * (asset.fps || SEQUENCE_FPS));
          const frameTransform = clip.stabilization.trajectory?.length
            ? clip.stabilization.trajectory[
                Math.min(frameIndex, clip.stabilization.trajectory.length - 1)
              ]
            : undefined;

          pipeline.renderFrame({
            source,
            stabilizedSource,
            width: w,
            height: h,
            grade: clip.color,
            stabilization: clip.stabilization,
            frameTransform,
            compareOriginal: compareHeld,
            splitEnabled,
            splitPos,
            timeSec: playheadRef.current,
          });
        } else {
          const ctx = sampleCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#050811';
            ctx.fillRect(0, 0, 1280, 720);
          }
          pipeline.renderFrame({
            source: sampleCanvas,
            stabilizedSource: null,
            width: 1280,
            height: 720,
            grade: createDefaultGrade(),
            stabilization: createDefaultStabilization(),
            compareOriginal: true,
            splitEnabled: false,
            splitPos: 0.5,
            timeSec: 0,
          });
        }

        if (
          activeTab === 'scopes' &&
          viewportCanvasRef.current &&
          scopeCanvasRef.current &&
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
          setAudioMeters(audioEngineRef.current.getMeters(isPlaying || shuttleSpeed > 0));
        }
      }
      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafId);
  }, [activeVideoClip, assets, compareHeld, splitEnabled, splitPos, activeTab, scopeMode, isPlaying, shuttleSpeed]);

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
        setShuttleSpeed(0);
        setIsPlaying((p) => !p);
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
        setIsPlaying(true);
        setShuttleSpeed((s) => (s <= 0 ? 1 : Math.min(4, s * 2)));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setShuttleSpeed(0);
        const step = (e.shiftKey ? 10 : 1) / SEQUENCE_FPS;
        setPlayhead((p) => Math.max(0, snapToFrame(p - step, SEQUENCE_FPS)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setShuttleSpeed(0);
        const step = (e.shiftKey ? 10 : 1) / SEQUENCE_FPS;
        setPlayhead((p) => Math.min(sequenceDuration, snapToFrame(p + step, SEQUENCE_FPS)));
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
        setPixelsPerSecond(Math.max(4, Math.min(1600, 960 / Math.max(4, sequenceDuration))));
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
            setShuttleSpeed(0);
            setIsPlaying((p) => !p);
          }}
          onStepFrames={(delta) => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            setPlayhead((p) =>
              Math.max(0, Math.min(sequenceDuration, snapToFrame(p + delta / SEQUENCE_FPS, SEQUENCE_FPS)))
            );
          }}
          onShuttle={(dir) => {
            if (dir === 0) {
              setIsPlaying(false);
              setShuttleSpeed(0);
            } else if (dir < 0) {
              setIsPlaying(true);
              setShuttleSpeed((s) => (s >= 0 ? -1 : Math.max(-4, s * 2)));
            } else {
              setIsPlaying(true);
              setShuttleSpeed((s) => (s <= 0 ? 1 : Math.min(4, s * 2)));
            }
          }}
          onSeekStart={() => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            setPlayhead(0);
          }}
          onSeekEnd={() => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            setPlayhead(sequenceDuration);
          }}
          onMarkIn={() => setInPoint(snapToFrame(playhead, SEQUENCE_FPS))}
          onMarkOut={() => setOutPoint(snapToFrame(playhead, SEQUENCE_FPS))}
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
            audioEngineRef.current?.ensureSampleMusicBuffer('sample-music', 24, 124);
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
          setPlayhead(t);
        }}
        onSelectClip={setSelectedClipId}
        onToggleSnap={() => setSnapEnabled((s) => !s)}
        onBladeSplit={handleBladeSplit}
        onDeleteClip={handleDeleteClip}
        onAddMarker={() =>
          setMarkers((prev) => [
            ...prev,
            { id: `m-${Date.now()}`, time: snapToFrame(playhead, SEQUENCE_FPS), label: `M${prev.length + 1}` },
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
