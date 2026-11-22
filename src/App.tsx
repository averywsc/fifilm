import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultAudioEffects,
  createDefaultCorrection,
  createDefaultCredentials,
  createDefaultEffects,
  createDefaultGrade,
  createDefaultGrading,
  createDefaultMask,
  createDefaultOverlaySettings,
  createDefaultProjectSettings,
  createDefaultSequenceSettings,
  createDefaultSnapOptions,
  createDefaultStabilization,
  createDefaultTransform,
  type AudioMeterReading,
  type AudioTransitionType,
  type AutoScaleMode,
  type BeatAnalysisResult,
  type BeatSnapTarget,
  type BlendMode,
  type ClipAudioEffectsState,
  type ClipColorLabel,
  type ClipEffectsState,
  type ClipKeyframe,
  type ClipMaskState,
  type ClipTransformState,
  type ClipTransition,
  type ColorCorrectionState,
  type ColorGradingState,
  type ContentCredentialsState,
  type CustomEffectPreset,
  type EditorTool,
  type EssentialSoundRole,
  type FifilmProject,
  type HardwareCapabilities,
  type HistoryEntry,
  type InspectorTab,
  type KeyframeEasing,
  type KeyframeProperty,
  type LeftPanelTab,
  type LutLibraryEntry,
  type LutRole,
  type LutStackLayer,
  type MarkerType,
  type MediaAsset,
  type MonitorOverlaySettings,
  type PlaybackQuality,
  type ProjectSettings,
  type RailPresetId,
  type RenderRange,
  type ScopeMode,
  type SequenceSettings,
  type SnapOptions,
  type StabilizationState,
  type TextOverlayProps,
  type TimelineClip,
  type TimelineMarker,
  type TimelineTrack,
  type TrackPresetId,
  type TranscriptSegment,
  type VideoTransitionType,
} from './types/editor';
import { WebGL2ColorPipeline, type CompositeLayerInput } from './engine/webglPipeline';
import {
  autoMixAudioTrackClips,
  evaluateAudioFadeCurve,
  FifilmAudioEngine,
} from './engine/audioMixer';
import { renderVideoScope, type ScopeMetrics } from './engine/scopes';
import { bakeGradeToCube } from './engine/cubeParser';
import { extractAudioWaveformFromFile } from './engine/audioWaveform';
import { getOverlayTextureCanvas } from './engine/overlayRenderer';
import { detectSceneCuts } from './engine/sceneDetect';
import {
  alignClipsToBeats,
  analyzeAudioBeatsInBrowser,
  collectTimelineBeatPoints,
} from './engine/beatSync';
import {
  evaluateClipAtLocalTime,
  toggleKeyframeAtTime,
  upsertKeyframe,
} from './engine/keyframes';
import { snapToFrame } from './engine/timecode';
import {
  extractBackendWaveform,
  fetchCapabilities,
  fetchLutLibrary,
  getCachedLutMap,
  loadParsedLut,
  resolveLocalFilePath,
  revealPathInExplorer,
  runBackendBeatAnalysis,
  runBackendStabilize,
  saveNewCubeLut,
  stageFileToDiskIfNeeded,
} from './services/bridge';
import { TopBar } from './components/TopBar';
import { WorkspacePanels } from './components/WorkspacePanels';
import { Viewport } from './components/Viewport';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { ExportModal, KeysModal } from './components/ExportModal';
import { ProjectsModal } from './components/ProjectsModal';
import { SettingsModal } from './components/SettingsModal';
import { ContextMenu, type ContextMenuAction } from './components/ContextMenu';
import { HomeScreen } from './components/HomeScreen';

const PROJECTS_STORAGE_KEY = 'fifilm_projects_v1';
const TRACK_COLORS: ClipColorLabel[] = ['default', 'iris', 'cerulean', 'forest', 'amber', 'rose', 'violet', 'mango'];

function createInitialTracks(): TimelineTrack[] {
  return [
    {
      id: 'v2',
      name: 'V2',
      kind: 'video',
      muted: false,
      solo: false,
      locked: false,
      visible: true,
      syncLock: true,
      targeted: false,
      sourcePatched: false,
      gain: 1,
      pan: 0,
      colorLabel: 'iris',
    },
    {
      id: 'v1',
      name: 'V1',
      kind: 'video',
      muted: false,
      solo: false,
      locked: false,
      visible: true,
      syncLock: true,
      targeted: true,
      sourcePatched: true,
      gain: 1,
      pan: 0,
      colorLabel: 'cerulean',
    },
    {
      id: 'a1',
      name: 'A1',
      kind: 'audio',
      muted: false,
      solo: false,
      locked: false,
      visible: true,
      syncLock: true,
      targeted: true,
      sourcePatched: true,
      gain: 1,
      pan: 0,
      colorLabel: 'forest',
    },
  ];
}

function buildTracksForPreset(preset: TrackPresetId): TimelineTrack[] {
  const mk = (id: string, name: string, kind: 'video' | 'audio', patch: boolean, color: ClipColorLabel): TimelineTrack => ({
    id,
    name,
    kind,
    muted: false,
    solo: false,
    locked: false,
    visible: true,
    syncLock: true,
    targeted: patch,
    sourcePatched: patch,
    gain: 1,
    pan: 0,
    colorLabel: color,
  });
  if (preset === 'multicam4') {
    return [
      mk('v4', 'V4', 'video', false, 'violet'),
      mk('v3', 'V3', 'video', false, 'rose'),
      mk('v2', 'V2', 'video', false, 'iris'),
      mk('v1', 'V1', 'video', true, 'cerulean'),
      mk('a1', 'A1', 'audio', true, 'forest'),
      mk('a2', 'A2', 'audio', false, 'amber'),
    ];
  }
  if (preset === 'podcast') {
    return [
      mk('v1', 'V1', 'video', true, 'cerulean'),
      mk('a1', 'A1', 'audio', true, 'forest'),
      mk('a2', 'A2', 'audio', false, 'amber'),
      mk('a3', 'A3', 'audio', false, 'mango'),
      mk('a4', 'A4', 'audio', false, 'iris'),
    ];
  }
  if (preset === 'cinema') {
    return [
      mk('v4', 'V4', 'video', false, 'violet'),
      mk('v3', 'V3', 'video', false, 'amber'),
      mk('v2', 'V2', 'video', false, 'iris'),
      mk('v1', 'V1', 'video', true, 'cerulean'),
      mk('a1', 'A1', 'audio', true, 'forest'),
      mk('a2', 'A2', 'audio', false, 'cerulean'),
      mk('a3', 'A3', 'audio', false, 'amber'),
      mk('a4', 'A4', 'audio', false, 'rose'),
    ];
  }
  return createInitialTracks();
}

function normalizeTrack(tr: TimelineTrack): TimelineTrack {
  return {
    ...tr,
    syncLock: tr.syncLock ?? true,
    targeted: tr.targeted ?? (tr.id === 'v1' || tr.id === 'a1'),
    sourcePatched: tr.sourcePatched ?? (tr.id === 'v1' || tr.id === 'a1'),
    gain: tr.gain ?? 1,
    pan: tr.pan ?? 0,
    colorLabel: tr.colorLabel || 'default',
  };
}

function createBlankProject(name = 'Untitled 1'): FifilmProject {
  const now = Date.now();
  return {
    id: `proj-${now}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    createdAt: now,
    updatedAt: now,
    sequence: createDefaultSequenceSettings(),
    projectSettings: createDefaultProjectSettings(),
    tracks: createInitialTracks(),
    clips: [],
    markers: [],
    transcript: [],
    credentials: createDefaultCredentials(),
    renderRanges: [],
    effectPresets: [],
    playhead: 0,
    inPoint: null,
    outPoint: null,
    masterVolume: 1.0,
    masterMuted: false,
    selectedClipId: null,
  };
}

function normalizeClip(clip: TimelineClip): TimelineClip {
  const grade = clip.color || createDefaultGrade();
  return {
    ...clip,
    clipKind: clip.clipKind || 'media',
    fadeIn: clip.fadeIn ?? 0,
    fadeOut: clip.fadeOut ?? 0,
    videoFadeIn: clip.videoFadeIn ?? 0,
    videoFadeOut: clip.videoFadeOut ?? 0,
    blendMode: clip.blendMode || 'normal',
    colorLabel: clip.colorLabel || 'default',
    transform: clip.transform
      ? { ...createDefaultTransform(), ...clip.transform }
      : createDefaultTransform(),
    keyframes: clip.keyframes || {},
    mask: clip.mask ? { ...createDefaultMask(), ...clip.mask } : createDefaultMask(),
    transitionIn: clip.transitionIn || { type: 'none', duration: 0.5 },
    transitionOut: clip.transitionOut || { type: 'none', duration: 0.5 },
    audioEffects: clip.audioEffects
      ? { ...createDefaultAudioEffects(), ...clip.audioEffects }
      : createDefaultAudioEffects(),
    color: {
      ...grade,
      correction: { ...createDefaultCorrection(), ...(grade.correction || {}) },
      grading: { ...createDefaultGrading(), ...(grade.grading || {}) },
      effects: { ...createDefaultEffects(), ...(grade.effects || {}) },
      lutStack: grade.lutStack || [],
      lutInterpolation: grade.lutInterpolation || 'tetrahedral',
    },
    stabilization: clip.stabilization
      ? { ...createDefaultStabilization(), ...clip.stabilization }
      : createDefaultStabilization(),
  };
}

function loadSavedProjects(): { projects: FifilmProject[]; activeId: string } {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { projects?: FifilmProject[]; activeId?: string };
      if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
        const cleaned = parsed.projects.map((p) => ({
          ...p,
          sequence: p.sequence
            ? { ...createDefaultSequenceSettings(), ...p.sequence }
            : createDefaultSequenceSettings(),
          projectSettings: p.projectSettings
            ? { ...createDefaultProjectSettings(), ...p.projectSettings }
            : createDefaultProjectSettings(),
          tracks: p.tracks?.length ? p.tracks.map(normalizeTrack) : createInitialTracks(),
          clips: (p.clips || []).map(normalizeClip),
          markers: p.markers || [],
          transcript: p.transcript || [],
          credentials: p.credentials
            ? { ...createDefaultCredentials(), ...p.credentials }
            : createDefaultCredentials(),
          renderRanges: p.renderRanges || [],
          effectPresets: p.effectPresets || [],
        }));
        const activeId =
          parsed.activeId && cleaned.some((p) => p.id === parsed.activeId)
            ? parsed.activeId
            : cleaned[0].id;
        return { projects: cleaned, activeId };
      }
    }
  } catch {
    // ignore corrupted storage
  }
  const first = createBlankProject('Untitled 1');
  return { projects: [first], activeId: first.id };
}

/**
 * Computes auto-scale % for a video clip on a given sequence resolution:
 * e.g., 1080p clip (1920x1080) on a 4K sequence (3840x2160) -> 200% (double size)
 * and 4K clip (3840x2160) on a 1080p sequence (1920x1080) -> 50%
 */
function computeAutoScalePercent(
  assetW: number,
  assetH: number,
  seqW: number,
  seqH: number,
  mode: AutoScaleMode
): number {
  if (mode === 'none' || assetW <= 0 || assetH <= 0 || seqW <= 0 || seqH <= 0) return 100;
  const rx = seqW / assetW;
  const ry = seqH / assetH;
  const ratio = mode === 'fill' ? Math.max(rx, ry) : Math.min(rx, ry);
  return Number(Math.max(10, Math.min(600, ratio * 100)).toFixed(1));
}

function computeClipEnvelopeMultiplier(clip: TimelineClip, elapsedInClip: number): number {
  let env = 1.0;
  const fadeInType = clip.audioEffects?.fadeInType || 'constantPower';
  const fadeOutType = clip.audioEffects?.fadeOutType || 'constantPower';
  if (clip.fadeIn > 0.01 && elapsedInClip < clip.fadeIn) {
    env *= evaluateAudioFadeCurve(fadeInType, elapsedInClip / clip.fadeIn);
  }
  const remaining = clip.duration - elapsedInClip;
  if (clip.fadeOut > 0.01 && remaining < clip.fadeOut) {
    env *= evaluateAudioFadeCurve(fadeOutType, remaining / clip.fadeOut);
  }
  return env;
}

function computeVideoFadeMultiplier(clip: TimelineClip, elapsedInClip: number): number {
  let env = 1.0;
  const vIn = clip.videoFadeIn ?? 0;
  const vOut = clip.videoFadeOut ?? 0;
  if (vIn > 0.01 && elapsedInClip < vIn) {
    env *= Math.max(0, Math.min(1, elapsedInClip / vIn));
  }
  const remaining = clip.duration - elapsedInClip;
  if (vOut > 0.01 && remaining < vOut) {
    env *= Math.max(0, Math.min(1, remaining / vOut));
  }
  return env;
}

const ESSENTIAL_SOUND_PRESETS: Record<EssentialSoundRole, Partial<ClipAudioEffectsState>> = {
  none: { essentialRole: 'none', eqLowDb: 0, eqMidDb: 0, eqHighDb: 0, deEsser: 0, dynamicsComp: 0, lowpassHz: 20000, studioReverb: 0, surroundReverb: 0 },
  dialogue: { essentialRole: 'dialogue', eqLowDb: -2, eqMidDb: 3.5, eqHighDb: 2.5, deEsser: 48, dynamicsComp: 55, hardLimiterDb: -1.5, lowpassHz: 16000, highpassHz: 85, studioReverb: 6, surroundReverb: 0 },
  music: { essentialRole: 'music', eqLowDb: 1.5, eqMidDb: -2.0, eqHighDb: 1.0, deEsser: 0, dynamicsComp: 25, hardLimiterDb: -1.0, lowpassHz: 20000, highpassHz: 20, studioReverb: 10, surroundReverb: 0 },
  sfx: { essentialRole: 'sfx', eqLowDb: 3, eqMidDb: 1.5, eqHighDb: 2.5, deEsser: 0, dynamicsComp: 65, hardLimiterDb: -0.5, lowpassHz: 20000, highpassHz: 30, studioReverb: 18, surroundReverb: 12 },
  ambience: { essentialRole: 'ambience', eqLowDb: -4, eqMidDb: -1.5, eqHighDb: -2, deEsser: 0, dynamicsComp: 18, hardLimiterDb: -3.0, lowpassHz: 9500, highpassHz: 120, studioReverb: 28, surroundReverb: 42 },
};

export default function App() {
  const initialStore = useMemo(() => loadSavedProjects(), []);
  const initialProject =
    initialStore.projects.find((p) => p.id === initialStore.activeId) || initialStore.projects[0];

  const [projects, setProjects] = useState<FifilmProject[]>(initialStore.projects);
  const [activeProjectId, setActiveProjectId] = useState<string>(initialProject.id);
  const [showHome, setShowHome] = useState<boolean>(true);
  const [showProjects, setShowProjects] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  const [sequence, setSequence] = useState<SequenceSettings>(initialProject.sequence);
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(initialProject.projectSettings);
  const [renderRanges, setRenderRanges] = useState<RenderRange[]>(initialProject.renderRanges || []);
  const [effectPresets, setEffectPresets] = useState<CustomEffectPreset[]>(initialProject.effectPresets || []);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<number | null>(null);

  const [capabilities, setCapabilities] = useState<HardwareCapabilities | null>(null);
  const [lutLibrary, setLutLibrary] = useState<LutLibraryEntry[]>([]);
  const [lutLibraryLoading, setLutLibraryLoading] = useState(false);

  const [tracks, setTracks] = useState<TimelineTrack[]>(initialProject.tracks);
  const [assets, setAssets] = useState<Map<string, MediaAsset>>(() => new Map());
  const [clips, setClips] = useState<TimelineClip[]>(initialProject.clips);
  const [markers, setMarkers] = useState<TimelineMarker[]>(initialProject.markers);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>(initialProject.transcript || []);
  const [credentials, setCredentials] = useState<ContentCredentialsState>(
    initialProject.credentials || createDefaultCredentials()
  );

  const [selectedClipId, setSelectedClipId] = useState<string | null>(initialProject.selectedClipId);
  const [playhead, setPlayhead] = useState<number>(initialProject.playhead);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [shuttleSpeed, setShuttleSpeed] = useState<number>(0);
  const [loopInToOut, setLoopInToOut] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [snapOptions, setSnapOptions] = useState<SnapOptions>(createDefaultSnapOptions);
  const [showBeats, setShowBeats] = useState<boolean>(true);
  const [viewAllLayers, setViewAllLayers] = useState<boolean>(false);
  const [alignFeedback, setAlignFeedback] = useState<string>('');
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(64);
  const [inPoint, setInPoint] = useState<number | null>(initialProject.inPoint);
  const [outPoint, setOutPoint] = useState<number | null>(initialProject.outPoint);

  // Studio UI State
  const [activeTool, setActiveTool] = useState<EditorTool>('select');
  const [leftPanel, setLeftPanel] = useState<LeftPanelTab>('none');
  const [playbackQuality, setPlaybackQuality] = useState<PlaybackQuality>('full');
  const [overlays, setOverlays] = useState<MonitorOverlaySettings>(createDefaultOverlaySettings);
  const [sourceMatchTarget, setSourceMatchTarget] = useState<{ assetId: string; timeSec: number; nonce: number } | null>(null);
  const [clipboardClip, setClipboardClip] = useState<TimelineClip | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clip: TimelineClip | null } | null>(null);

  const [vrEnabled, setVrEnabled] = useState<boolean>(false);
  const vrAnglesRef = useRef<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 });
  const [multiCamEnabled, setMultiCamEnabled] = useState<boolean>(false);
  const [measuredFps, setMeasuredFps] = useState<number>(initialProject.sequence.fps);
  const [droppedFrames, setDroppedFrames] = useState<number>(0);
  const [sceneDetectBusy, setSceneDetectBusy] = useState<boolean>(false);

  const [masterVolume, setMasterVolume] = useState<number>(initialProject.masterVolume);
  const [masterMuted, setMasterMuted] = useState<boolean>(initialProject.masterMuted);
  const [audioMeters, setAudioMeters] = useState<AudioMeterReading>({
    peakLeftDb: -60,
    peakRightDb: -60,
    lufs: -60,
    clipping: false,
    lra: 0,
  });

  const [activeTab, setActiveTab] = useState<InspectorTab>('motion');
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
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([
    { id: 'h-init', label: 'Session Opened', timestamp: Date.now(), clips: initialProject.clips },
  ]);

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
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const shuttleSpeedRef = useRef(shuttleSpeed);
  shuttleSpeedRef.current = shuttleSpeed;
  const qualityRef = useRef(playbackQuality);
  qualityRef.current = playbackQuality;
  const vrEnabledRef = useRef(vrEnabled);
  vrEnabledRef.current = vrEnabled;
  const loopInToOutRef = useRef(loopInToOut);
  loopInToOutRef.current = loopInToOut;
  const inPointRef = useRef(inPoint);
  inPointRef.current = inPoint;
  const outPointRef = useRef(outPoint);
  outPointRef.current = outPoint;

  const seqFps = Math.max(1, sequence.fps || 24);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || projects[0],
    [projects, activeProjectId]
  );

  // Persist current active project state + Sequence & Project Auto-Save timer
  const persistProjectNow = useCallback(() => {
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              updatedAt: Date.now(),
              sequence: sequenceRef.current,
              projectSettings,
              tracks: tracksRef.current,
              clips: clipsRef.current,
              markers,
              transcript,
              credentials,
              renderRanges,
              effectPresets,
              playhead: playheadRef.current,
              inPoint: inPointRef.current,
              outPoint: outPointRef.current,
              masterVolume,
              masterMuted,
              selectedClipId,
            }
          : p
      );
      try {
        localStorage.setItem(
          PROJECTS_STORAGE_KEY,
          JSON.stringify({ projects: next, activeId: activeProjectId })
        );
        setLastAutoSavedAt(Date.now());
      } catch {
        // ignore quota
      }
      return next;
    });
  }, [
    activeProjectId,
    projectSettings,
    markers,
    transcript,
    credentials,
    renderRanges,
    effectPresets,
    masterVolume,
    masterMuted,
    selectedClipId,
  ]);

  // Debounced auto-persist on edits
  useEffect(() => {
    const timer = setTimeout(persistProjectNow, 260);
    return () => clearTimeout(timer);
  }, [persistProjectNow, sequence, tracks, clips, inPoint, outPoint]);

  // Explicit Sequence & Project Auto-Save Interval Timer
  useEffect(() => {
    if (!projectSettings.autoSaveEnabled) return;
    const sec = Math.min(
      projectSettings.autoSaveIntervalSec || 60,
      sequence.autoSaveIntervalSec || 60
    );
    if (sec <= 0) return;
    const iv = setInterval(() => {
      persistProjectNow();
    }, sec * 1000);
    return () => clearInterval(iv);
  }, [projectSettings.autoSaveEnabled, projectSettings.autoSaveIntervalSec, sequence.autoSaveIntervalSec, persistProjectNow]);

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

  const findTopVideoClipAt = useCallback((t: number): TimelineClip | null => {
    const visibleVideoTrackIds = tracksRef.current
      .filter((tr) => tr.kind === 'video' && tr.visible)
      .map((tr) => tr.id);
    for (const trackId of visibleVideoTrackIds) {
      const hit = clipsRef.current.find(
        (c) => !c.disabled && c.trackId === trackId && t >= c.start && t < c.start + c.duration
      );
      if (hit) return hit;
    }
    return null;
  }, []);

  const activeVideoClip = useMemo(
    () => findTopVideoClipAt(playhead),
    [findTopVideoClipAt, playhead, tracks, clips]
  );

  const pushUndoSnapshot = useCallback((label = 'Timeline Edit', snapshot?: TimelineClip[]) => {
    const snap = structuredClone(snapshot ?? clipsRef.current);
    setUndoStack((prev) => [...prev.slice(-39), snap]);
    setRedoStack([]);
    setHistoryEntries((prev) => [
      ...prev.slice(-39),
      { id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, label, timestamp: Date.now(), clips: snap },
    ]);
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

  const handleRestoreHistory = useCallback(
    (entryId: string) => {
      const target = historyEntries.find((h) => h.id === entryId);
      if (!target) return;
      setUndoStack((u) => [...u.slice(-39), structuredClone(clipsRef.current)]);
      setClips(structuredClone(target.clips).map(normalizeClip));
    },
    [historyEntries]
  );

  const pauseAllVideos = useCallback(() => {
    for (const vid of videoElementsRef.current.values()) {
      if (!vid.paused) vid.pause();
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setAlignFeedback(msg);
    setTimeout(() => setAlignFeedback((cur) => (cur === msg ? '' : cur)), 3400);
  }, []);

  // Sequence & Project Settings save + optional live rescale of all existing clips
  const handleSaveSettings = useCallback(
    (nextSeq: SequenceSettings, nextProj: ProjectSettings, rescaleExistingClips: boolean) => {
      const resChanged =
        nextSeq.width !== sequenceRef.current.width || nextSeq.height !== sequenceRef.current.height;
      setSequence(nextSeq);
      setProjectSettings(nextProj);
      if (rescaleExistingClips && (resChanged || nextSeq.autoScaleMedia !== sequenceRef.current.autoScaleMedia)) {
        pushUndoSnapshot('Auto-Scale Clips to Sequence');
        setClips((prev) =>
          prev.map((c) => {
            if (c.clipKind !== 'media') return c;
            const asset = assetsRef.current.get(c.assetId);
            if (!asset || asset.kind !== 'video') return c;
            const newScale = computeAutoScalePercent(
              asset.width,
              asset.height,
              nextSeq.width,
              nextSeq.height,
              nextSeq.autoScaleMedia
            );
            return { ...c, transform: { ...c.transform, scale: newScale } };
          })
        );
      }
      showToast(`Sequence set to ${nextSeq.width}x${nextSeq.height} @ ${nextSeq.fps}fps`);
    },
    [pushUndoSnapshot, showToast]
  );

  // Rail & Track Presets
  const handleApplyRailPreset = useCallback(
    (preset: RailPresetId) => {
      setProjectSettings((prev) => ({ ...prev, railPreset: preset }));
      if (preset === 'editorial') {
        setLeftPanel('project');
        setActiveTab('motion');
      } else if (preset === 'color') {
        setLeftPanel('none');
        setActiveTab('color');
      } else if (preset === 'audio') {
        setLeftPanel('none');
        setActiveTab('audio');
      } else if (preset === 'effects') {
        setLeftPanel('effects');
        setActiveTab('effects');
      } else if (preset === 'assembly') {
        setLeftPanel('source');
        setActiveTab('motion');
      }
      showToast(`Workspace rail preset: ${preset}`);
    },
    [showToast]
  );

  const handleApplyTrackPreset = useCallback(
    (preset: TrackPresetId) => {
      setTracks(buildTracksForPreset(preset));
      showToast(`Applied ${preset} track layout preset`);
    },
    [showToast]
  );

  // Render In to Out & Delete Render Files
  const handleRenderInToOut = useCallback(() => {
    const s = inPointRef.current ?? 0;
    const e = outPointRef.current ?? Math.max(sequenceDuration, 2);
    if (e <= s) {
      showToast('Set valid In / Out range to render');
      return;
    }
    setRenderRanges((prev) => [...prev, { id: `rr-${Date.now()}`, start: s, end: e, renderedAt: Date.now() }]);
    showToast(`Rendered cache ${s.toFixed(1)}s - ${e.toFixed(1)}s`);
  }, [sequenceDuration, showToast]);

  const handleDeleteRenderFiles = useCallback(() => {
    setRenderRanges([]);
    showToast('Deleted all sequence render cache files');
  }, [showToast]);

  // Multi-project lifecycle
  const snapshotActiveProject = useCallback(
    (list: FifilmProject[]): FifilmProject[] =>
      list.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              updatedAt: Date.now(),
              sequence: structuredClone(sequenceRef.current),
              projectSettings: structuredClone(projectSettings),
              tracks: structuredClone(tracksRef.current),
              clips: structuredClone(clipsRef.current),
              markers: structuredClone(markers),
              transcript: structuredClone(transcript),
              credentials: structuredClone(credentials),
              renderRanges: structuredClone(renderRanges),
              effectPresets: structuredClone(effectPresets),
              playhead: playheadRef.current,
              inPoint,
              outPoint,
              masterVolume,
              masterMuted,
              selectedClipId,
            }
          : p
      ),
    [
      activeProjectId,
      projectSettings,
      markers,
      transcript,
      credentials,
      renderRanges,
      effectPresets,
      inPoint,
      outPoint,
      masterVolume,
      masterMuted,
      selectedClipId,
    ]
  );

  const loadProjectIntoEditor = useCallback(
    (proj: FifilmProject) => {
      setIsPlaying(false);
      setShuttleSpeed(0);
      pauseAllVideos();
      audioEngineRef.current?.stopBufferVoices();
      setActiveProjectId(proj.id);
      setSequence(proj.sequence ? { ...createDefaultSequenceSettings(), ...proj.sequence } : createDefaultSequenceSettings());
      setProjectSettings(
        proj.projectSettings ? { ...createDefaultProjectSettings(), ...proj.projectSettings } : createDefaultProjectSettings()
      );
      setTracks(proj.tracks.length ? proj.tracks.map(normalizeTrack) : createInitialTracks());
      // Never leave orphaned/unloaded media footage from previous cold sessions on the timeline
      const normClips = proj.clips
        .map(normalizeClip)
        .filter((c) => !c.assetId || assetsRef.current.has(c.assetId));
      setClips(normClips);
      setMarkers(structuredClone(proj.markers || []));
      setTranscript(structuredClone(proj.transcript || []));
      setCredentials(proj.credentials ? { ...createDefaultCredentials(), ...proj.credentials } : createDefaultCredentials());
      setRenderRanges(structuredClone(proj.renderRanges || []));
      setEffectPresets(structuredClone(proj.effectPresets || []));
      playheadRef.current = proj.playhead || 0;
      setPlayhead(proj.playhead || 0);
      setInPoint(proj.inPoint ?? null);
      setOutPoint(proj.outPoint ?? null);
      setMasterVolume(proj.masterVolume ?? 1.0);
      setMasterMuted(proj.masterMuted ?? false);
      setSelectedClipId(proj.selectedClipId ?? null);
      setUndoStack([]);
      setRedoStack([]);
      setHistoryEntries([{ id: `h-${Date.now()}`, label: `Loaded ${proj.name}`, timestamp: Date.now(), clips: normClips }]);
    },
    [pauseAllVideos]
  );

  const handleSelectProject = useCallback(
    (id: string) => {
      if (id === activeProjectId) return;
      const saved = snapshotActiveProject(projects);
      setProjects(saved);
      const target = saved.find((p) => p.id === id);
      if (target) loadProjectIntoEditor(target);
    },
    [activeProjectId, projects, snapshotActiveProject, loadProjectIntoEditor]
  );

  const handleCreateProject = useCallback(
    (name?: string) => {
      const saved = snapshotActiveProject(projects);
      const next = createBlankProject(name || `Untitled ${saved.length + 1}`);
      setProjects([next, ...saved]);
      loadProjectIntoEditor(next);
    },
    [projects, snapshotActiveProject, loadProjectIntoEditor]
  );

  const handleDuplicateProject = useCallback(
    (id: string) => {
      const saved = snapshotActiveProject(projects);
      const src = saved.find((p) => p.id === id);
      if (!src) return;
      const now = Date.now();
      const copy: FifilmProject = {
        ...structuredClone(src),
        id: `proj-${now}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${src.name} Copy`,
        createdAt: now,
        updatedAt: now,
      };
      setProjects([copy, ...saved]);
      loadProjectIntoEditor(copy);
    },
    [projects, snapshotActiveProject, loadProjectIntoEditor]
  );

  const handleRenameProject = useCallback((id: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)));
  }, []);

  const handleDeleteProject = useCallback(
    (id: string) => {
      if (projects.length <= 1) return;
      const remaining = projects.filter((p) => p.id !== id);
      setProjects(remaining);
      if (id === activeProjectId) loadProjectIntoEditor(remaining[0]);
    },
    [projects, activeProjectId, loadProjectIntoEditor]
  );

  const handleExportProjectFile = useCallback(
    (id: string) => {
      const saved = snapshotActiveProject(projects);
      const proj = saved.find((p) => p.id === id);
      if (!proj) return;
      const blob = new Blob([JSON.stringify({ fifilmVersion: '0.3.0', project: proj }, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${proj.name.replace(/[^a-zA-Z0-9_-]+/g, '_')}.fifilm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    [projects, snapshotActiveProject]
  );

  const handleImportProjectFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const rawProj = (data.project || data) as Partial<FifilmProject>;
        const now = Date.now();
        const imported: FifilmProject = {
          id: `proj-${now}-${Math.random().toString(36).slice(2, 6)}`,
          name: rawProj.name || file.name.replace(/\.(fifilm|json)$/i, ''),
          createdAt: now,
          updatedAt: now,
          sequence: rawProj.sequence
            ? { ...createDefaultSequenceSettings(), ...rawProj.sequence }
            : createDefaultSequenceSettings(),
          projectSettings: rawProj.projectSettings
            ? { ...createDefaultProjectSettings(), ...rawProj.projectSettings }
            : createDefaultProjectSettings(),
          tracks: rawProj.tracks?.length ? rawProj.tracks.map(normalizeTrack) : createInitialTracks(),
          clips: (rawProj.clips || []).map(normalizeClip),
          markers: rawProj.markers || [],
          transcript: rawProj.transcript || [],
          credentials: rawProj.credentials
            ? { ...createDefaultCredentials(), ...rawProj.credentials }
            : createDefaultCredentials(),
          renderRanges: rawProj.renderRanges || [],
          effectPresets: rawProj.effectPresets || [],
          playhead: rawProj.playhead || 0,
          inPoint: rawProj.inPoint ?? null,
          outPoint: rawProj.outPoint ?? null,
          masterVolume: rawProj.masterVolume ?? 1,
          masterMuted: rawProj.masterMuted ?? false,
          selectedClipId: rawProj.selectedClipId ?? null,
        };
        const saved = snapshotActiveProject(projects);
        setProjects([imported, ...saved]);
        loadProjectIntoEditor(imported);
      } catch (err) {
        console.error('Failed to import .fifilm project:', err);
      }
    },
    [projects, snapshotActiveProject, loadProjectIntoEditor]
  );

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
    if (showHome) return;
    const canvas = viewportCanvasRef.current;
    if (!canvas) return;
    try {
      pipelineRef.current = new WebGL2ColorPipeline(canvas);
    } catch (err) {
      console.error('WebGL2 init failed:', err);
    }
    if (!audioEngineRef.current) {
      audioEngineRef.current = new FifilmAudioEngine();
    }

    return () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, [showHome]);

  useEffect(() => {
    return () => {
      for (const vid of videoElementsRef.current.values()) {
        vid.pause();
        vid.src = '';
      }
      videoElementsRef.current.clear();
      audioEngineRef.current?.dispose();
      audioEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    audioEngineRef.current?.setMasterVolume(masterVolume, masterMuted);
  }, [masterVolume, masterMuted]);

  useEffect(() => {
    const engine = audioEngineRef.current;
    if (!engine) return;
    const fx = selectedClip?.audioEffects || createDefaultAudioEffects();
    const track = selectedClip ? tracks.find((t) => t.id === selectedClip.trackId) : undefined;
    engine.applyAudioEffects(fx, track?.pan ?? 0);
  }, [selectedClip, tracks]);

  const safeSeekVideo = useCallback((key: string, vid: HTMLVideoElement, targetSec: number) => {
    if (vid.readyState < 1) return;
    const clamped = Math.max(
      0,
      Math.min(Number.isFinite(vid.duration) ? Math.max(0, vid.duration - 0.004) : targetSec, targetSec)
    );
    if (Math.abs(vid.currentTime - clamped) < 0.012) return;
    if (vid.seeking) {
      pendingSeekRef.current.set(key, clamped);
      return;
    }
    try {
      vid.currentTime = clamped;
    } catch {
      // ignore
    }
  }, []);

  const trackAudioSignature = useMemo(
    () => tracks.map((t) => `${t.id}:${t.muted ? 1 : 0}:${t.solo ? 1 : 0}:${t.gain}`).join('|'),
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
    (updater: (clip: TimelineClip) => TimelineClip, recordUndo = false, label = 'Update Clip') => {
      if (!selectedClipId) return;
      if (recordUndo) pushUndoSnapshot(label);
      setClips((prev) => prev.map((c) => (c.id === selectedClipId ? updater(c) : c)));
    },
    [selectedClipId, pushUndoSnapshot]
  );

  const handleScaleToFrameSize = useCallback(
    (mode: 'fit' | 'fill') => {
      if (!selectedClip) return;
      const asset = assetsRef.current.get(selectedClip.assetId);
      const w = asset?.width || sequenceRef.current.width;
      const h = asset?.height || sequenceRef.current.height;
      const sc = computeAutoScalePercent(w, h, sequenceRef.current.width, sequenceRef.current.height, mode);
      mutateSelectedClip(
        (c) => ({ ...c, transform: { ...c.transform, scale: sc, positionX: 0, positionY: 0 } }),
        true,
        mode === 'fit' ? 'Set to Frame Size' : 'Scale to Frame Size'
      );
      showToast(`Scaled "${selectedClip.name}" to ${sc}% (${sequenceRef.current.width}x${sequenceRef.current.height})`);
    },
    [selectedClip, mutateSelectedClip, showToast]
  );

  const handleUpdateTransform = useCallback(
    (patch: Partial<ClipTransformState>) => {
      mutateSelectedClip((c) => {
        const localT = Math.max(0, Math.min(c.duration, playheadRef.current - c.start));
        const nextKf = { ...(c.keyframes || {}) };
        const numericProps: Array<
          'scale' | 'positionX' | 'positionY' | 'rotation' | 'opacity' | 'swivel3d' | 'tilt3d'
        > = ['scale', 'positionX', 'positionY', 'rotation', 'opacity', 'swivel3d', 'tilt3d'];
        for (const key of numericProps) {
          const val = patch[key];
          if (val !== undefined && nextKf[key] && nextKf[key]!.length > 0) {
            const lastEasing = nextKf[key]![0]?.easing || 'easeInOut';
            nextKf[key] = upsertKeyframe(nextKf[key], localT, val, lastEasing);
          }
        }
        return { ...c, transform: { ...c.transform, ...patch }, keyframes: nextKf };
      });
    },
    [mutateSelectedClip]
  );

  const handleToggleKeyframe = useCallback(
    (prop: KeyframeProperty, easing: KeyframeEasing) => {
      mutateSelectedClip(
        (c) => {
          const localT = Math.max(0, Math.min(c.duration, playheadRef.current - c.start));
          const evaluated = evaluateClipAtLocalTime(c, localT);
          const currentVal =
            prop === 'exposure'
              ? evaluated.exposure
              : prop === 'blur'
                ? evaluated.blur
                : prop === 'speed'
                  ? evaluated.speed
                  : evaluated.transform[prop];
          const nextList = toggleKeyframeAtTime(c, prop, localT, currentVal, easing);
          return { ...c, keyframes: { ...(c.keyframes || {}), [prop]: nextList } };
        },
        true,
        `Toggle Keyframe (${prop})`
      );
    },
    [mutateSelectedClip]
  );

  const makeBlankOverlayClip = useCallback(
    (opts: {
      name: string;
      clipKind: TimelineClip['clipKind'];
      trackId: string;
      start: number;
      duration: number;
      blendMode?: BlendMode;
      textOverlay?: TextOverlayProps;
      nestedClips?: TimelineClip[];
    }): TimelineClip => ({
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      assetId: '',
      trackId: opts.trackId,
      name: opts.name,
      clipKind: opts.clipKind,
      start: snapToFrame(opts.start, seqFps),
      sourceIn: 0,
      duration: snapToFrame(opts.duration, seqFps),
      sourceDuration: Math.max(30, opts.duration * 3),
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      videoFadeIn: 0,
      videoFadeOut: 0,
      muted: true,
      blendMode: opts.blendMode || 'normal',
      transform: createDefaultTransform(),
      keyframes: {},
      mask: createDefaultMask(),
      transitionIn: { type: 'none', duration: projectSettings.defaultTransitionSec },
      transitionOut: { type: 'none', duration: projectSettings.defaultTransitionSec },
      color: createDefaultGrade(),
      stabilization: createDefaultStabilization(),
      audioEffects: createDefaultAudioEffects(),
      textOverlay: opts.textOverlay,
      nestedClips: opts.nestedClips,
    }),
    [seqFps, projectSettings.defaultTransitionSec]
  );

  const pickOverlayTrackId = useCallback((start: number, duration: number): string => {
    const end = start + duration;
    const videoTracks = tracksRef.current.filter((t) => t.kind === 'video' && !t.locked);
    const candidates = videoTracks.slice().reverse();
    for (const tr of candidates) {
      const overlaps = clipsRef.current.some(
        (c) => c.trackId === tr.id && c.start < end - 0.01 && c.start + c.duration > start + 0.01
      );
      if (!overlaps) return tr.id;
    }
    const nextNum = tracksRef.current.filter((t) => t.kind === 'video').length + 1;
    const newId = `v${Date.now().toString(36)}`;
    const newTrack: TimelineTrack = {
      id: newId,
      name: `V${nextNum}`,
      kind: 'video',
      muted: false,
      solo: false,
      locked: false,
      visible: true,
      syncLock: true,
      targeted: false,
      sourcePatched: false,
      gain: 1,
      pan: 0,
      colorLabel: 'violet',
    };
    setTracks((prev) => [newTrack, ...prev]);
    return newId;
  }, []);

  const pickPatchedTrackId = useCallback((kind: 'video' | 'audio'): string => {
    const ofKind = tracksRef.current.filter((t) => t.kind === kind && !t.locked);
    const patched = ofKind.find((t) => t.sourcePatched);
    if (patched) return patched.id;
    return kind === 'video' ? ofKind[ofKind.length - 1]?.id || 'v1' : ofKind[0]?.id || 'a1';
  }, []);

  // Easy On-Clip Fade Handle Updater
  const handleUpdateClipFade = useCallback(
    (clipId: string, side: 'in' | 'out', durationSec: number, isVideoTrack: boolean) => {
      setClips((prev) =>
        prev.map((c) => {
          if (c.id !== clipId) return c;
          if (isVideoTrack) {
            return side === 'in'
              ? { ...c, videoFadeIn: durationSec, fadeIn: durationSec }
              : { ...c, videoFadeOut: durationSec, fadeOut: durationSec };
          }
          return side === 'in' ? { ...c, fadeIn: durationSec } : { ...c, fadeOut: durationSec };
        })
      );
    },
    []
  );

  // Smart Seamless Audio Auto-Mix (Song Cut Crossfade + Loudness Matching!)
  const handleAutoMixAudio = useCallback(() => {
    const audioTracks = tracksRef.current.filter((t) => t.kind === 'audio');
    const targetTrack =
      (selectedClip && audioTracks.find((t) => t.id === selectedClip.trackId)) ||
      audioTracks.find((t) => clipsRef.current.filter((c) => c.trackId === t.id).length >= 2);

    if (!targetTrack) {
      showToast('Split an audio track into 2+ clips to Auto-Mix them together');
      return;
    }

    pushUndoSnapshot('Auto-Mix Audio Crossfade');
    const res = autoMixAudioTrackClips({
      clips: clipsRef.current,
      trackId: targetTrack.id,
      detectedBpm,
      engine: audioEngineRef.current,
      fps: seqFps,
    });
    if (res.mixedCount > 0) {
      setClips(res.nextClips);
      showToast(
        `Auto-Mixed ${res.mixedCount} audio cut${res.mixedCount > 1 ? 's' : ''} (${(res.crossfadeSec * 1000).toFixed(0)}ms equal-power crossfade)`
      );
    } else {
      showToast('Need at least 2 clips on an audio track to Auto-Mix');
    }
  }, [selectedClip, detectedBpm, seqFps, pushUndoSnapshot, showToast]);

  // Overlay & Special Layer Creation
  const handleCreateAdjustmentLayer = useCallback(() => {
    pushUndoSnapshot('Add Adjustment Layer');
    const dur = Math.max(4, sequenceDuration > 0 ? Math.min(8, sequenceDuration) : 5);
    const trackId = pickOverlayTrackId(playheadRef.current, dur);
    const clip = makeBlankOverlayClip({
      name: 'Adjustment Layer',
      clipKind: 'adjustment',
      trackId,
      start: playheadRef.current,
      duration: dur,
    });
    setClips((prev) => [...prev, clip]);
    setSelectedClipId(clip.id);
    setActiveTab('color');
    showToast('Added Adjustment Layer');
  }, [pushUndoSnapshot, pickOverlayTrackId, sequenceDuration, makeBlankOverlayClip, showToast]);

  const handleCreateTextClip = useCallback(
    (vertical: boolean) => {
      pushUndoSnapshot(vertical ? 'Add Vertical Type' : 'Add Title');
      const trackId = pickOverlayTrackId(playheadRef.current, 4);
      const clip = makeBlankOverlayClip({
        name: vertical ? 'Vertical Title' : 'Title',
        clipKind: vertical ? 'vertical-text' : 'text',
        trackId,
        start: playheadRef.current,
        duration: 4,
        textOverlay: {
          text: vertical ? 'FIFILM' : 'FIFILM TITLE',
          vertical,
          fontSize: 64,
          color: '#ffffff',
          bgColor: '#080c18',
          bgOpacity: 0,
        },
      });
      setClips((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      setActiveTab('motion');
      showToast(vertical ? 'Added Vertical Type layer' : 'Added Title layer');
    },
    [pushUndoSnapshot, pickOverlayTrackId, makeBlankOverlayClip, showToast]
  );

  const handleCreateShapeClip = useCallback(
    (shapeKind: 'rectangle' | 'ellipse' | 'pen') => {
      pushUndoSnapshot(`Add ${shapeKind} shape`);
      const trackId = pickOverlayTrackId(playheadRef.current, 4);
      const label = shapeKind === 'rectangle' ? 'Rectangle' : shapeKind === 'ellipse' ? 'Ellipse' : 'Pen Shape';
      const clip = makeBlankOverlayClip({
        name: label,
        clipKind: 'shape',
        trackId,
        start: playheadRef.current,
        duration: 4,
        blendMode: 'overlay',
        textOverlay: {
          text: '',
          vertical: false,
          fontSize: 48,
          color: '#ffffff',
          bgColor: '#080c18',
          bgOpacity: 0,
          shapeKind,
        },
      });
      setClips((prev) => [...prev, clip]);
      setSelectedClipId(clip.id);
      setActiveTab('motion');
      showToast(`Added ${label} layer`);
    },
    [pushUndoSnapshot, pickOverlayTrackId, makeBlankOverlayClip, showToast]
  );

  const handleCreateQuickOverlay = useCallback(
    (tool: 'pen' | 'rectangle' | 'ellipse' | 'type' | 'verticalType') => {
      if (tool === 'type') handleCreateTextClip(false);
      else if (tool === 'verticalType') handleCreateTextClip(true);
      else handleCreateShapeClip(tool);
    },
    [handleCreateTextClip, handleCreateShapeClip]
  );

  const handleCreateFreezeFrame = useCallback(
    (durationSec = 2.0) => {
      const srcClip = selectedClip || findTopVideoClipAt(playheadRef.current);
      if (!srcClip || !srcClip.assetId) {
        showToast('Select a video clip to create a Freeze Frame');
        return;
      }
      pushUndoSnapshot('Frame Hold');
      const localT = Math.max(0, Math.min(srcClip.duration, playheadRef.current - srcClip.start));
      const holdTime = srcClip.sourceIn + localT;
      const freezeClip: TimelineClip = {
        ...structuredClone(srcClip),
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${srcClip.name} [Hold]`,
        clipKind: 'freeze',
        start: snapToFrame(playheadRef.current, seqFps),
        duration: durationSec,
        freezeFrameTime: holdTime,
        muted: true,
        keyframes: {},
      };
      setClips((prev) => [...prev, freezeClip]);
      setSelectedClipId(freezeClip.id);
      showToast(`Inserted ${durationSec.toFixed(1)}s Frame Hold at ${holdTime.toFixed(2)}s`);
    },
    [selectedClip, findTopVideoClipAt, pushUndoSnapshot, seqFps, showToast]
  );

  const handleCreateNestedSequence = useCallback(() => {
    const videoTrackIds = new Set(tracksRef.current.filter((t) => t.kind === 'video').map((t) => t.id));
    const sourceClips = clipsRef.current.filter((c) => videoTrackIds.has(c.trackId));
    if (sourceClips.length === 0) {
      showToast('Add video clips before nesting');
      return;
    }
    pushUndoSnapshot('Nest Sequence');
    const minStart = Math.min(...sourceClips.map((c) => c.start));
    const maxEnd = Math.max(...sourceClips.map((c) => c.start + c.duration));
    const targetTrackId = pickPatchedTrackId('video');
    const primaryMedia = sourceClips.find((c) => c.assetId);
    const nested = makeBlankOverlayClip({
      name: `Nested Seq (${sourceClips.length} clips)`,
      clipKind: 'nested',
      trackId: targetTrackId,
      start: minStart,
      duration: Math.max(1, maxEnd - minStart),
      nestedClips: structuredClone(sourceClips).map((c) => ({ ...c, start: c.start - minStart })),
    });
    if (primaryMedia) {
      nested.assetId = primaryMedia.assetId;
      nested.sourceDuration = primaryMedia.sourceDuration;
    }
    setClips((prev) => [...prev.filter((c) => !videoTrackIds.has(c.trackId)), nested]);
    setSelectedClipId(nested.id);
    showToast(`Nested ${sourceClips.length} clips into Nested Sequence`);
  }, [pushUndoSnapshot, pickPatchedTrackId, makeBlankOverlayClip, showToast]);

  const handleInsertAssetFromSource = useCallback(
    (assetId: string, srcIn: number, srcOut: number, overwrite: boolean) => {
      const asset = assetsRef.current.get(assetId);
      if (!asset) return;
      pushUndoSnapshot(overwrite ? 'Overwrite Edit' : 'Insert Edit');
      const trackId = pickPatchedTrackId(asset.kind);
      const start = snapToFrame(playheadRef.current, seqFps);
      const dur = snapToFrame(Math.max(0.2, srcOut - srcIn), seqFps);
      const autoScale =
        asset.kind === 'video'
          ? computeAutoScalePercent(
              asset.width,
              asset.height,
              sequenceRef.current.width,
              sequenceRef.current.height,
              sequenceRef.current.autoScaleMedia
            )
          : 100;
      const newClip: TimelineClip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        assetId: asset.id,
        trackId,
        name: asset.name,
        clipKind: 'media',
        start,
        sourceIn: Math.max(0, srcIn),
        duration: dur,
        sourceDuration: asset.duration,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        videoFadeIn: 0,
        videoFadeOut: 0,
        muted: false,
        blendMode: 'normal',
        transform: { ...createDefaultTransform(), scale: autoScale },
        keyframes: {},
        mask: createDefaultMask(),
        transitionIn: { type: 'none', duration: projectSettings.defaultTransitionSec },
        transitionOut: { type: 'none', duration: projectSettings.defaultTransitionSec },
        color: createDefaultGrade(),
        stabilization: createDefaultStabilization(),
        audioEffects: createDefaultAudioEffects(),
      };

      setClips((prev) => {
        if (!overwrite) {
          const syncTrackIds = new Set(tracksRef.current.filter((t) => t.syncLock).map((t) => t.id));
          return [
            ...prev.map((c) =>
              (c.trackId === trackId || syncTrackIds.has(c.trackId)) && c.start >= start - 0.001
                ? { ...c, start: snapToFrame(c.start + dur, seqFps) }
                : c
            ),
            newClip,
          ];
        }
        const next: TimelineClip[] = [];
        for (const c of prev) {
          if (c.trackId !== trackId) {
            next.push(c);
            continue;
          }
          const cEnd = c.start + c.duration;
          const nEnd = start + dur;
          if (cEnd <= start || c.start >= nEnd) {
            next.push(c);
          } else {
            if (c.start < start) next.push({ ...c, duration: snapToFrame(start - c.start, seqFps) });
            if (cEnd > nEnd) {
              const trimLeft = nEnd - c.start;
              next.push({
                ...structuredClone(c),
                id: `${c.id}-tail`,
                start: nEnd,
                sourceIn: c.sourceIn + trimLeft,
                duration: snapToFrame(cEnd - nEnd, seqFps),
              });
            }
          }
        }
        next.push(newClip);
        return next;
      });
      setSelectedClipId(newClip.id);
      playheadRef.current = start + dur;
      setPlayhead(start + dur);
    },
    [pushUndoSnapshot, pickPatchedTrackId, seqFps, projectSettings.defaultTransitionSec]
  );

  // Lift Edit (;) & Extract Edit (') between In and Out points
  const handleLiftOrExtract = useCallback(
    (mode: 'lift' | 'extract') => {
      const s = inPointRef.current;
      const e = outPointRef.current;
      if (s === null || e === null || e <= s) {
        showToast('Mark In (I) and Out (O) first for Lift / Extract Edit');
        return;
      }
      pushUndoSnapshot(mode === 'extract' ? 'Extract Edit' : 'Lift Edit');
      const span = e - s;
      const lockedIds = new Set(tracksRef.current.filter((t) => t.locked).map((t) => t.id));
      setClips((prev) => {
        const out: TimelineClip[] = [];
        for (const c of prev) {
          if (lockedIds.has(c.trackId)) {
            out.push(c);
            continue;
          }
          const cEnd = c.start + c.duration;
          if (cEnd <= s) {
            out.push(c);
          } else if (c.start >= e) {
            out.push(mode === 'extract' ? { ...c, start: Math.max(0, snapToFrame(c.start - span, seqFps)) } : c);
          } else {
            if (c.start < s) out.push({ ...c, duration: snapToFrame(s - c.start, seqFps) });
            if (cEnd > e) {
              const trimL = e - c.start;
              out.push({
                ...structuredClone(c),
                id: `${c.id}-ext`,
                start: mode === 'extract' ? s : e,
                sourceIn: c.sourceIn + trimL,
                duration: snapToFrame(cEnd - e, seqFps),
              });
            }
          }
        }
        return out;
      });
      showToast(mode === 'extract' ? `Extracted ${span.toFixed(2)}s and closed gap` : `Lifted ${span.toFixed(2)}s segment`);
    },
    [pushUndoSnapshot, seqFps, showToast]
  );

  // Close Gap & Ripple Delete Gaps
  const handleCloseGaps = useCallback(() => {
    pushUndoSnapshot('Close Gaps');
    const lockedIds = new Set(tracksRef.current.filter((t) => t.locked).map((t) => t.id));
    setClips((prev) => {
      const byTrack = new Map<string, TimelineClip[]>();
      for (const c of prev) {
        const arr = byTrack.get(c.trackId) || [];
        arr.push(c);
        byTrack.set(c.trackId, arr);
      }
      const next: TimelineClip[] = [];
      for (const [trackId, list] of byTrack.entries()) {
        if (lockedIds.has(trackId)) {
          next.push(...list);
          continue;
        }
        const sorted = list.slice().sort((a, b) => a.start - b.start);
        let cursor = 0;
        for (const c of sorted) {
          if (c.start > cursor + 0.02) {
            next.push({ ...c, start: snapToFrame(cursor, seqFps) });
            cursor += c.duration;
          } else {
            next.push(c);
            cursor = Math.max(cursor, c.start + c.duration);
          }
        }
      }
      return next;
    });
    showToast('Closed timeline gaps');
  }, [pushUndoSnapshot, seqFps, showToast]);

  // Ripple Trim Previous Edit (Q) / Next Edit (W) to Playhead
  const handleRippleTrimToPlayhead = useCallback(
    (dir: 'prev' | 'next') => {
      const t = snapToFrame(playheadRef.current, seqFps);
      const hit =
        clipsRef.current.find((c) => c.id === selectedClipId && t > c.start + 0.05 && t < c.start + c.duration - 0.05) ||
        clipsRef.current.find((c) => !c.disabled && t > c.start + 0.05 && t < c.start + c.duration - 0.05);
      if (!hit) {
        showToast('Move playhead inside a clip for Q / W Ripple Trim');
        return;
      }
      pushUndoSnapshot(dir === 'prev' ? 'Ripple Trim Previous (Q)' : 'Ripple Trim Next (W)');
      const syncIds = new Set(tracksRef.current.filter((tr) => tr.syncLock).map((tr) => tr.id));
      if (dir === 'prev') {
        const cut = t - hit.start;
        setClips((prev) =>
          prev.map((c) => {
            if (c.id === hit.id) {
              return { ...c, start: hit.start, sourceIn: c.sourceIn + cut, duration: snapToFrame(c.duration - cut, seqFps) };
            }
            if ((c.trackId === hit.trackId || syncIds.has(c.trackId)) && c.start >= hit.start + hit.duration - 0.01) {
              return { ...c, start: Math.max(0, snapToFrame(c.start - cut, seqFps)) };
            }
            return c;
          })
        );
        playheadRef.current = hit.start;
        setPlayhead(hit.start);
        showToast(`Ripple Trimmed head by ${cut.toFixed(2)}s (Q)`);
      } else {
        const cut = hit.start + hit.duration - t;
        setClips((prev) =>
          prev.map((c) => {
            if (c.id === hit.id) {
              return { ...c, duration: snapToFrame(t - hit.start, seqFps) };
            }
            if ((c.trackId === hit.trackId || syncIds.has(c.trackId)) && c.start >= hit.start + hit.duration - 0.01) {
              return { ...c, start: Math.max(0, snapToFrame(c.start - cut, seqFps)) };
            }
            return c;
          })
        );
        showToast(`Ripple Trimmed tail by ${cut.toFixed(2)}s (W)`);
      }
    },
    [selectedClipId, seqFps, pushUndoSnapshot, showToast]
  );

  // Remove Through Edit (rejoins contiguous split clips of the same source asset)
  const handleRemoveThroughEdit = useCallback(
    (clipId: string) => {
      const left = clipsRef.current.find((c) => c.id === clipId);
      if (!left || !left.assetId) return;
      const right = clipsRef.current.find(
        (c) =>
          c.id !== left.id &&
          c.trackId === left.trackId &&
          c.assetId === left.assetId &&
          Math.abs(c.start - (left.start + left.duration)) < 0.08 &&
          Math.abs(c.sourceIn - (left.sourceIn + left.duration)) < 0.1
      );
      if (!right) {
        showToast('No contiguous through edit found at clip boundary');
        return;
      }
      pushUndoSnapshot('Remove Through Edit');
      setClips((prev) =>
        prev
          .filter((c) => c.id !== right.id)
          .map((c) => (c.id === left.id ? { ...c, duration: snapToFrame(left.duration + right.duration, seqFps) } : c))
      );
      showToast('Removed Through Edit (rejoined split clips)');
    },
    [pushUndoSnapshot, seqFps, showToast]
  );

  // Match Frame to Source Monitor (F)
  const handleMatchFrame = useCallback(
    (targetClip?: TimelineClip | null) => {
      const clip = targetClip || selectedClip || findTopVideoClipAt(playheadRef.current);
      if (!clip || !clip.assetId) {
        showToast('Select a media clip for Match Frame');
        return;
      }
      const localT = Math.max(0, Math.min(clip.duration, playheadRef.current - clip.start));
      const srcT = clip.sourceIn + localT;
      setSourceMatchTarget({ assetId: clip.assetId, timeSec: srcT, nonce: Date.now() });
      setLeftPanel('source');
      showToast(`Matched frame to Source Monitor (${srcT.toFixed(2)}s)`);
    },
    [selectedClip, findTopVideoClipAt, showToast]
  );

  // Save Preset from Selected Clip
  const handleSaveCurrentAsPreset = useCallback(() => {
    if (!selectedClip) return;
    const preset: CustomEffectPreset = {
      id: `pre-${Date.now()}`,
      name: `${selectedClip.name.slice(0, 18)} Look`,
      createdAt: Date.now(),
      color: structuredClone(selectedClip.color),
      audioEffects: structuredClone(selectedClip.audioEffects),
      blendMode: selectedClip.blendMode,
    };
    setEffectPresets((prev) => [preset, ...prev]);
    showToast(`Saved Effect Preset "${preset.name}"`);
  }, [selectedClip, showToast]);

  // Markers
  const handleAddMarkerOfType = useCallback(
    (markerType: MarkerType) => {
      const prefix =
        markerType === 'chapter'
          ? 'CH'
          : markerType === 'webLink'
            ? 'WEB'
            : markerType === 'flashCue'
              ? 'FLASH'
              : markerType === 'eventCue'
                ? 'EVENT'
                : 'M';
      setMarkers((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}`,
          time: snapToFrame(playheadRef.current, seqFps),
          label: `${prefix}${prev.length + 1}`,
          markerType,
        },
      ]);
      showToast(`Added ${markerType} marker`);
    },
    [seqFps, showToast]
  );

  // Synchronize selected clip to nearest beat/clip start
  const handleSynchronizeClips = useCallback(() => {
    if (beatPoints.downbeats.length > 0 && selectedClip) {
      const nearest = beatPoints.downbeats.reduce((best, b) =>
        Math.abs(b - selectedClip.start) < Math.abs(best - selectedClip.start) ? b : best
      );
      pushUndoSnapshot('Synchronize Clip');
      setClips((prev) =>
        prev.map((c) => (c.id === selectedClip.id ? { ...c, start: snapToFrame(nearest, seqFps) } : c))
      );
      showToast(`Synchronized "${selectedClip.name}" to downbeat at ${nearest.toFixed(2)}s`);
    } else if (selectedClip) {
      pushUndoSnapshot('Synchronize to Playhead');
      setClips((prev) =>
        prev.map((c) => (c.id === selectedClip.id ? { ...c, start: snapToFrame(playheadRef.current, seqFps) } : c))
      );
      showToast(`Synchronized "${selectedClip.name}" to playhead`);
    }
  }, [beatPoints, selectedClip, pushUndoSnapshot, seqFps, showToast]);

  // Nudge / Track Move Precision Actions
  const handleMoveClipTrackVertical = useCallback(
    (dir: -1 | 1) => {
      if (!selectedClip) return;
      const curTrack = tracksRef.current.find((t) => t.id === selectedClip.trackId);
      if (!curTrack) return;
      const sameKind = tracksRef.current.filter((t) => t.kind === curTrack.kind && !t.locked);
      const idx = sameKind.findIndex((t) => t.id === curTrack.id);
      const target = sameKind[idx + dir];
      if (!target) return;
      pushUndoSnapshot(dir < 0 ? 'Move Clip Up Track' : 'Move Clip Down Track');
      setClips((prev) => prev.map((c) => (c.id === selectedClip.id ? { ...c, trackId: target.id } : c)));
    },
    [selectedClip, pushUndoSnapshot]
  );

  const handleNudgeSelectedClip = useCallback(
    (frames: number) => {
      if (!selectedClip) return;
      const delta = frames / seqFps;
      setClips((prev) =>
        prev.map((c) =>
          c.id === selectedClip.id ? { ...c, start: Math.max(0, snapToFrame(c.start + delta, seqFps)) } : c
        )
      );
    },
    [selectedClip, seqFps]
  );

  // Complete Right-Click Context Menu Dispatcher
  const handleContextMenuAction = useCallback(
    (action: ContextMenuAction) => {
      const target = contextMenu?.clip || selectedClip;
      switch (action.type) {
        case 'cut':
          if (!target) return;
          setClipboardClip(structuredClone(target));
          pushUndoSnapshot('Cut Clip');
          setClips((prev) => prev.filter((c) => c.id !== target.id));
          setSelectedClipId(null);
          showToast(`Cut "${target.name}"`);
          break;
        case 'copy':
          if (!target) return;
          setClipboardClip(structuredClone(target));
          showToast(`Copied "${target.name}"`);
          break;
        case 'paste':
        case 'pasteInsert': {
          if (!clipboardClip) return;
          pushUndoSnapshot(action.type === 'pasteInsert' ? 'Paste Insert' : 'Paste Clip');
          const start = snapToFrame(playheadRef.current, seqFps);
          const pasted: TimelineClip = {
            ...structuredClone(clipboardClip),
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            start,
          };
          setClips((prev) =>
            action.type === 'pasteInsert'
              ? [
                  ...prev.map((c) =>
                    c.trackId === pasted.trackId && c.start >= start - 0.001
                      ? { ...c, start: snapToFrame(c.start + pasted.duration, seqFps) }
                      : c
                  ),
                  pasted,
                ]
              : [...prev, pasted]
          );
          setSelectedClipId(pasted.id);
          break;
        }
        case 'pasteAttributes':
          if (!clipboardClip || !target) return;
          pushUndoSnapshot('Paste Attributes');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id
                ? {
                    ...c,
                    blendMode: clipboardClip.blendMode,
                    transform: structuredClone(clipboardClip.transform),
                    mask: structuredClone(clipboardClip.mask),
                    color: structuredClone(clipboardClip.color),
                    audioEffects: structuredClone(clipboardClip.audioEffects),
                  }
                : c
            )
          );
          showToast(`Pasted attributes onto "${target.name}"`);
          break;
        case 'clear':
          if (!target) return;
          pushUndoSnapshot('Clear Clip');
          setClips((prev) => prev.filter((c) => c.id !== target.id));
          setSelectedClipId(null);
          break;
        case 'rippleDelete':
          if (!target) return;
          setSelectedClipId(target.id);
          handleDeleteClip(true);
          break;
        case 'closeGap':
        case 'rippleDeleteGaps':
          handleCloseGaps();
          break;
        case 'selectAtOrAfterPlayhead': {
          const hits = clipsRef.current.filter((c) => c.start + c.duration >= playheadRef.current - 0.01);
          if (hits.length > 0) {
            setSelectedClipId(hits[0].id);
            setActiveTool('trackForward');
            showToast(`Selected ${hits.length} clip${hits.length > 1 ? 's' : ''} at or after playhead`);
          } else {
            showToast('No clips at or after playhead');
          }
          break;
        }
        case 'selectBeforePlayhead': {
          const hits = clipsRef.current.filter((c) => c.start < playheadRef.current + 0.01);
          if (hits.length > 0) {
            setSelectedClipId(hits[hits.length - 1].id);
            showToast(`Selected ${hits.length} clip${hits.length > 1 ? 's' : ''} before playhead`);
          } else {
            showToast('No clips before playhead');
          }
          break;
        }
        case 'removeThroughEdit':
          if (target) handleRemoveThroughEdit(target.id);
          break;
        case 'toggleEnabled':
          if (!target) return;
          pushUndoSnapshot(target.disabled ? 'Enable Clip' : 'Disable Clip');
          setClips((prev) => prev.map((c) => (c.id === target.id ? { ...c, disabled: !c.disabled } : c)));
          break;
        case 'toggleLink':
          if (!target) return;
          pushUndoSnapshot(target.linkGroupId ? 'Unlink Clip' : 'Link Clip');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id ? { ...c, linkGroupId: c.linkGroupId ? undefined : `lnk-${Date.now()}` } : c
            )
          );
          break;
        case 'toggleGroup':
          if (!target) return;
          pushUndoSnapshot(target.groupId ? 'Ungroup Clip' : 'Group Clip');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id ? { ...c, groupId: c.groupId ? undefined : `grp-${Date.now()}` } : c
            )
          );
          break;
        case 'setColorLabel':
          if (!target) return;
          setClips((prev) => prev.map((c) => (c.id === target.id ? { ...c, colorLabel: action.label } : c)));
          break;
        case 'nest':
        case 'nestNewSequence':
          handleCreateNestedSequence();
          break;
        case 'speedDuration':
        case 'timeRemapping':
          setActiveTab('effects');
          break;
        case 'frameHold':
          handleCreateFreezeFrame(2.0);
          break;
        case 'holdSegment':
          handleCreateFreezeFrame(4.0);
          break;
        case 'addEdit':
          handleBladeSplit();
          break;
        case 'matchFrame':
          handleMatchFrame(target);
          break;
        case 'replaceFromSource': {
          const srcAsset =
            (sourceMatchTarget && assetsRef.current.get(sourceMatchTarget.assetId)) ||
            Array.from(assetsRef.current.values()).find((a) => a.kind === 'video');
          if (!target || !srcAsset) {
            showToast('Load a clip in Source Monitor first');
            return;
          }
          pushUndoSnapshot('Replace from Source');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id
                ? { ...c, assetId: srcAsset.id, name: srcAsset.name, sourceDuration: srcAsset.duration }
                : c
            )
          );
          showToast(`Replaced with "${srcAsset.name}"`);
          break;
        }
        case 'markIn':
          setInPoint(snapToFrame(playheadRef.current, seqFps));
          break;
        case 'markOut':
          setOutPoint(snapToFrame(playheadRef.current, seqFps));
          break;
        case 'clearInOut':
          setInPoint(null);
          setOutPoint(null);
          break;
        case 'scaleToFrameSize':
          handleScaleToFrameSize('fill');
          break;
        case 'setToFrameSize':
          handleScaleToFrameSize('fit');
          break;
        case 'autoMixAudio':
          handleAutoMixAudio();
          break;
        case 'audioChannels':
          if (!target) return;
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id ? { ...c, audioEffects: { ...c.audioEffects, channelMode: action.mode } } : c
            )
          );
          setActiveTab('audio');
          showToast(`Audio Channels: ${action.mode}`);
          break;
        case 'audioGain':
          setActiveTab('audio');
          break;
        case 'synchronize':
          handleSynchronizeClips();
          break;
        case 'addMarker':
          handleAddMarkerOfType(action.markerType);
          break;
        case 'clearMarker':
          setMarkers((prev) => prev.filter((m) => Math.abs(m.time - playheadRef.current) > 0.25));
          break;
        case 'clearAllMarkers':
          setMarkers([]);
          break;
        case 'savePreset':
          handleSaveCurrentAsPreset();
          break;
        case 'removeVideoEffects':
          if (!target) return;
          pushUndoSnapshot('Remove Video Effects');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id ? { ...c, color: { ...c.color, effects: createDefaultEffects() } } : c
            )
          );
          break;
        case 'removeAudioEffects':
          if (!target) return;
          pushUndoSnapshot('Remove Audio Effects');
          setClips((prev) =>
            prev.map((c) => (c.id === target.id ? { ...c, audioEffects: createDefaultAudioEffects() } : c))
          );
          break;
        case 'removeEffects':
          if (!target) return;
          pushUndoSnapshot('Remove All Effects');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id
                ? { ...c, color: createDefaultGrade(), audioEffects: createDefaultAudioEffects() }
                : c
            )
          );
          break;
        case 'removeAttributes':
          if (!target) return;
          pushUndoSnapshot('Remove All Attributes');
          setClips((prev) =>
            prev.map((c) =>
              c.id === target.id
                ? {
                    ...c,
                    blendMode: 'normal',
                    transform: createDefaultTransform(),
                    mask: createDefaultMask(),
                    color: createDefaultGrade(),
                    audioEffects: createDefaultAudioEffects(),
                    keyframes: {},
                    fadeIn: 0,
                    fadeOut: 0,
                    videoFadeIn: 0,
                    videoFadeOut: 0,
                  }
                : c
            )
          );
          break;
        case 'renderAndReplace':
          if (!target) return;
          setRenderRanges((prev) => [
            ...prev,
            { id: `rr-${Date.now()}`, start: target.start, end: target.start + target.duration, renderedAt: Date.now() },
          ]);
          setClips((prev) => prev.map((c) => (c.id === target.id ? { ...c, renderedProxy: true } : c)));
          showToast(`Rendered and cached "${target.name}"`);
          break;
        case 'exportSelectedClip':
          if (target) {
            setSelectedClipId(target.id);
            setInPoint(target.start);
            setOutPoint(target.start + target.duration);
            setShowExport(true);
          }
          break;
        case 'properties':
          setLeftPanel('info');
          break;
        case 'interpretFootage':
        case 'revealInProject':
          setLeftPanel('project');
          break;
        case 'revealInExplorer': {
          const filePath = target ? assetsRef.current.get(target.assetId)?.filePath : undefined;
          if (filePath) {
            revealPathInExplorer(filePath).then((ok) => {
              showToast(ok ? `Revealed in Explorer: ${filePath}` : `Path: ${filePath}`);
            });
          } else {
            showToast('Available in the desktop .exe app for local files');
          }
          break;
        }
      }
    },
    [
      contextMenu,
      selectedClip,
      clipboardClip,
      seqFps,
      sourceMatchTarget,
      pushUndoSnapshot,
      showToast,
      handleCloseGaps,
      handleRemoveThroughEdit,
      handleCreateNestedSequence,
      handleCreateFreezeFrame,
      handleMatchFrame,
      handleScaleToFrameSize,
      handleAutoMixAudio,
      handleSynchronizeClips,
      handleAddMarkerOfType,
      handleSaveCurrentAsPreset,
    ]
  );

  // Import media files with Auto-Scale to Sequence Resolution!
  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (!list.length) return;
      pushUndoSnapshot('Import Media');

      const primaryVideoTrack = pickPatchedTrackId('video');
      const firstAudioTrack = pickPatchedTrackId('audio');

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
            a.onloadedmetadata = () =>
              resolve(Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 10);
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
            fps: seqFps,
            hasAudio: true,
            waveform: [],
            codecInfo: file.type || 'Audio',
            fileSizeBytes: file.size,
          };
          setAssets((prev) => new Map(prev).set(assetId, newAsset));

          const newClipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newClip: TimelineClip = {
            id: newClipId,
            assetId,
            trackId: firstAudioTrack,
            name: file.name,
            clipKind: 'media',
            start: snapToFrame(audioCursor, seqFps),
            sourceIn: 0,
            duration: snapToFrame(duration, seqFps),
            sourceDuration: duration,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            videoFadeIn: 0,
            videoFadeOut: 0,
            muted: false,
            blendMode: 'normal',
            transform: createDefaultTransform(),
            keyframes: {},
            mask: createDefaultMask(),
            transitionIn: { type: 'none', duration: projectSettings.defaultTransitionSec },
            transitionOut: { type: 'none', duration: projectSettings.defaultTransitionSec },
            color: createDefaultGrade(),
            stabilization: createDefaultStabilization(),
            audioEffects: createDefaultAudioEffects(),
          };
          setClips((prev) => [...prev, newClip]);
          setSelectedClipId(newClipId);
          audioCursor += duration;

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
              showToast(`Analyzed ${beatAnalysis.bpm.toFixed(1)} BPM (${beatAnalysis.beats.length} beats)`);
            }
          })();
        } else {
          const video = document.createElement('video');
          video.src = objectUrl;
          video.muted = false;
          video.playsInline = true;
          video.preload = 'auto';
          video.crossOrigin = 'anonymous';

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
            video.addEventListener(
              'loadedmetadata',
              () => {
                if (video.readyState < 2) {
                  try {
                    video.currentTime = 0.001;
                  } catch {
                    // ignore
                  }
                }
              },
              { once: true }
            );
            video.addEventListener('error', done, { once: true });
            setTimeout(done, 5000);
          });

          const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
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
            fps: seqFps,
            interpretedFps: seqFps,
            pixelAspect: 1.0,
            codecInfo: file.type || 'Video',
            fileSizeBytes: file.size,
            hasAudio: true,
            waveform: [],
          };
          setAssets((prev) => new Map(prev).set(assetId, newAsset));

          // Auto-Scale Media to Sequence Resolution (e.g. 1080p -> 4K = 200%, 4K -> 1080p = 50%)
          const autoScale = computeAutoScalePercent(
            width,
            height,
            sequenceRef.current.width,
            sequenceRef.current.height,
            sequenceRef.current.autoScaleMedia
          );

          const newClipId = `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const newClip: TimelineClip = {
            id: newClipId,
            assetId,
            trackId: primaryVideoTrack,
            name: file.name,
            clipKind: 'media',
            start: snapToFrame(videoCursor, seqFps),
            sourceIn: 0,
            duration: snapToFrame(duration, seqFps),
            sourceDuration: duration,
            volume: 1,
            fadeIn: 0,
            fadeOut: 0,
            videoFadeIn: 0,
            videoFadeOut: 0,
            muted: false,
            blendMode: 'normal',
            transform: { ...createDefaultTransform(), scale: autoScale },
            keyframes: {},
            mask: createDefaultMask(),
            transitionIn: { type: 'none', duration: projectSettings.defaultTransitionSec },
            transitionOut: { type: 'none', duration: projectSettings.defaultTransitionSec },
            color: createDefaultGrade(),
            stabilization: createDefaultStabilization(),
            audioEffects: createDefaultAudioEffects(),
          };
          setClips((prev) => [...prev, newClip]);
          setSelectedClipId(newClipId);
          if (Math.abs(autoScale - 100) > 1) {
            showToast(
              `Auto-scaled ${width}x${height} to ${autoScale}% for ${sequenceRef.current.width}x${sequenceRef.current.height} sequence`
            );
          }
          if (wasEmpty && videoCursor === 0) {
            playheadRef.current = 0;
            setPlayhead(0);
          }
          videoCursor += duration;

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
              // ignore waveform errors
            }
          })();
        }
      }
    },
    [pushUndoSnapshot, pickPatchedTrackId, seqFps, projectSettings.defaultTransitionSec, showToast]
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
        fps: seqFps,
      });

      if (alignedCount > 0) {
        pushUndoSnapshot('Align Cuts to Beats');
        setClips(nextClips);
        showToast(`Aligned ${alignedCount} clip${alignedCount > 1 ? 's' : ''} to ${target}`);
      } else {
        showToast(`No cuts within ±${toleranceMs}ms`);
      }
    },
    [tracks, selectedClip, beatPoints, seqFps, pushUndoSnapshot, showToast]
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
        syncLock: true,
        targeted: false,
        sourcePatched: false,
        gain: 1,
        pan: 0,
        colorLabel: kind === 'video' ? 'iris' : 'forest',
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

  const handleCycleTrackColor = useCallback((trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => {
        if (t.id !== trackId) return t;
        const idx = TRACK_COLORS.indexOf(t.colorLabel || 'default');
        return { ...t, colorLabel: TRACK_COLORS[(idx + 1) % TRACK_COLORS.length] };
      })
    );
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
            color: { ...clip.color, lutStack: [...clip.color.lutStack.slice(0, 5), layer] },
          }),
          true,
          `Add LUT (${entry.name})`
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

    setStab({ status: 'analyzing', progress: 5, statusMessage: 'Preparing video for two-pass stabilization...' });

    try {
      const inputPath = await ensureAssetDiskPath(asset.id);
      if (!inputPath) throw new Error('Could not access source video file on disk.');

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
        (progress, stage) => setStab({ progress, statusMessage: stage })
      );

      const stabKey = `stab-${clipId}`;
      const stabVid = document.createElement('video');
      stabVid.src = res.previewUrl;
      stabVid.muted = true;
      stabVid.playsInline = true;
      stabVid.preload = 'auto';
      stabVid.crossOrigin = 'anonymous';
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

  const handleBladeSplit = useCallback(
    (atTime?: number, clipId?: string) => {
      const t = snapToFrame(atTime ?? playheadRef.current, seqFps);
      const target = clipId
        ? clipsRef.current.find(
            (c) => c.id === clipId && t > c.start + 0.08 && t < c.start + c.duration - 0.08
          )
        : clipsRef.current.find(
            (c) => c.id === selectedClipId && t > c.start + 0.08 && t < c.start + c.duration - 0.08
          ) || clipsRef.current.find((c) => t > c.start + 0.08 && t < c.start + c.duration - 0.08);
      if (!target) return;

      pushUndoSnapshot('Razor Split');
      const leftDur = snapToFrame(t - target.start, seqFps);
      const rightDur = snapToFrame(target.duration - leftDur, seqFps);

      const leftKf: Partial<Record<KeyframeProperty, ClipKeyframe[]>> = {};
      const rightKf: Partial<Record<KeyframeProperty, ClipKeyframe[]>> = {};
      for (const [k, list] of Object.entries(target.keyframes || {}) as Array<
        [KeyframeProperty, ClipKeyframe[]]
      >) {
        if (!list) continue;
        leftKf[k] = list.filter((f) => f.time <= leftDur);
        rightKf[k] = list
          .filter((f) => f.time >= leftDur)
          .map((f) => ({ ...f, id: `${f.id}-r`, time: Number((f.time - leftDur).toFixed(4)) }));
      }

      const rightClip: TimelineClip = {
        ...structuredClone(target),
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        start: t,
        sourceIn: target.sourceIn + leftDur,
        duration: rightDur,
        keyframes: rightKf,
      };

      setClips((prev) =>
        prev.flatMap((c) =>
          c.id === target.id ? [{ ...c, duration: leftDur, keyframes: leftKf }, rightClip] : [c]
        )
      );
      setSelectedClipId(rightClip.id);
    },
    [selectedClipId, seqFps, pushUndoSnapshot]
  );

  const handleDeleteClip = useCallback(
    (ripple: boolean) => {
      if (!selectedClipId) return;
      const target = clipsRef.current.find((c) => c.id === selectedClipId);
      if (!target) return;
      pushUndoSnapshot(ripple ? 'Ripple Delete' : 'Delete Clip');
      const syncIds = new Set(tracksRef.current.filter((t) => t.syncLock).map((t) => t.id));
      setClips((prev) =>
        prev
          .filter((c) => c.id !== selectedClipId)
          .map((c) => {
            if (
              ripple &&
              (c.trackId === target.trackId || syncIds.has(c.trackId)) &&
              c.start >= target.start + target.duration - 0.001
            ) {
              return { ...c, start: Math.max(0, snapToFrame(c.start - target.duration, seqFps)) };
            }
            return c;
          })
      );
      setSelectedClipId(null);
    },
    [selectedClipId, seqFps, pushUndoSnapshot]
  );

  const handleMoveClip = useCallback((clipId: string, newStart: number, newTrackId?: string) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, start: newStart, trackId: newTrackId ?? c.trackId } : c))
    );
  }, []);

  const handleTrackSelectForwardMove = useCallback(
    (anchorClipId: string, deltaSec: number) => {
      const anchor = clipsRef.current.find((c) => c.id === anchorClipId);
      if (!anchor) return;
      const lockedIds = new Set(tracksRef.current.filter((t) => t.locked).map((t) => t.id));
      setClips((prev) =>
        prev.map((c) => {
          if (lockedIds.has(c.trackId)) return c;
          if (c.start >= anchor.start - 0.001) {
            return { ...c, start: Math.max(0, snapToFrame(c.start + deltaSec, seqFps)) };
          }
          return c;
        })
      );
    },
    [seqFps]
  );

  const handleTrimClip = useCallback(
    (
      clipId: string,
      edge: 'left' | 'right',
      newTime: number,
      mode: 'normal' | 'ripple' | 'rolling' | 'rateStretch'
    ) => {
      setClips((prev) => {
        const target = prev.find((c) => c.id === clipId);
        if (!target) return prev;
        const minDur = 2 / seqFps;
        const syncTrackIds = new Set(tracksRef.current.filter((t) => t.syncLock).map((t) => t.id));

        if (mode === 'rateStretch') {
          const origDur = target.duration;
          const origSpeed = target.color.effects.speed || 1;
          const nextDur =
            edge === 'right'
              ? Math.max(minDur, newTime - target.start)
              : Math.max(minDur, target.start + target.duration - newTime);
          const nextStart = edge === 'left' ? target.start + target.duration - nextDur : target.start;
          const nextSpeed = Number(Math.max(0.25, Math.min(4.0, origSpeed * (origDur / nextDur))).toFixed(2));
          return prev.map((c) =>
            c.id === clipId
              ? {
                  ...c,
                  start: Math.max(0, snapToFrame(nextStart, seqFps)),
                  duration: snapToFrame(nextDur, seqFps),
                  color: { ...c.color, effects: { ...c.color.effects, enabled: true, speed: nextSpeed } },
                }
              : c
          );
        }

        if (edge === 'left') {
          const maxStart = target.start + target.duration - minDur;
          const minStart = target.clipKind === 'media' ? target.start - target.sourceIn : 0;
          const clampedStart = Math.max(minStart, Math.min(maxStart, newTime));
          const delta = clampedStart - target.start;

          const neighbor =
            mode === 'rolling'
              ? prev.find(
                  (c) =>
                    c.id !== clipId &&
                    c.trackId === target.trackId &&
                    Math.abs(c.start + c.duration - target.start) < 0.08
                )
              : undefined;

          return prev.map((c) => {
            if (c.id === clipId) {
              return {
                ...c,
                start: mode === 'ripple' ? target.start : clampedStart,
                sourceIn: Math.max(0, c.sourceIn + delta),
                duration: c.duration - delta,
              };
            }
            if (neighbor && c.id === neighbor.id) {
              return { ...c, duration: Math.max(minDur, c.duration + delta) };
            }
            if (
              mode === 'ripple' &&
              (c.trackId === target.trackId || syncTrackIds.has(c.trackId)) &&
              c.start > target.start
            ) {
              return { ...c, start: Math.max(0, snapToFrame(c.start - delta, seqFps)) };
            }
            return c;
          });
        }

        const maxEnd =
          target.clipKind === 'media' ? target.start + (target.sourceDuration - target.sourceIn) : target.start + 300;
        const clampedEnd = Math.max(target.start + minDur, Math.min(maxEnd, newTime));
        const nextDur = clampedEnd - target.start;
        const delta = nextDur - target.duration;

        const neighbor =
          mode === 'rolling'
            ? prev.find(
                (c) =>
                  c.id !== clipId &&
                  c.trackId === target.trackId &&
                  Math.abs(c.start - (target.start + target.duration)) < 0.08
              )
            : undefined;

        return prev.map((c) => {
          if (c.id === clipId) return { ...c, duration: nextDur };
          if (neighbor && c.id === neighbor.id) {
            const nextNeighDur = Math.max(minDur, c.duration - delta);
            const appliedDelta = c.duration - nextNeighDur;
            return {
              ...c,
              start: Math.max(0, c.start + appliedDelta),
              sourceIn: Math.max(0, c.sourceIn + appliedDelta),
              duration: nextNeighDur,
            };
          }
          if (
            mode === 'ripple' &&
            (c.trackId === target.trackId || syncTrackIds.has(c.trackId)) &&
            c.start >= target.start + target.duration - 0.01
          ) {
            return { ...c, start: Math.max(0, snapToFrame(c.start + delta, seqFps)) };
          }
          return c;
        });
      });
    },
    [seqFps]
  );

  const handleSlipClip = useCallback((clipId: string, deltaSec: number) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const maxIn = Math.max(0, c.sourceDuration - c.duration);
        const nextIn = Math.max(0, Math.min(maxIn, c.sourceIn + deltaSec));
        return { ...c, sourceIn: Number(nextIn.toFixed(3)) };
      })
    );
  }, []);

  const handleSlideClip = useCallback(
    (clipId: string, deltaSec: number) => {
      setClips((prev) => {
        const target = prev.find((c) => c.id === clipId);
        if (!target) return prev;
        const minDur = 2 / seqFps;
        const prevNeighbor = prev.find(
          (c) =>
            c.id !== clipId &&
            c.trackId === target.trackId &&
            Math.abs(c.start + c.duration - target.start) < 0.08
        );
        const nextNeighbor = prev.find(
          (c) =>
            c.id !== clipId &&
            c.trackId === target.trackId &&
            Math.abs(c.start - (target.start + target.duration)) < 0.08
        );
        const nextStart = Math.max(0, snapToFrame(target.start + deltaSec, seqFps));
        const applied = nextStart - target.start;
        return prev.map((c) => {
          if (c.id === clipId) return { ...c, start: nextStart };
          if (prevNeighbor && c.id === prevNeighbor.id) {
            return { ...c, duration: Math.max(minDur, c.duration + applied) };
          }
          if (nextNeighbor && c.id === nextNeighbor.id) {
            return {
              ...c,
              start: Math.max(0, c.start + applied),
              sourceIn: Math.max(0, c.sourceIn + applied),
              duration: Math.max(minDur, c.duration - applied),
            };
          }
          return c;
        });
      });
    },
    [seqFps]
  );

  const handleApplyJLcut = useCallback(
    (kind: 'j' | 'l') => {
      if (!selectedClip) {
        showToast('Select a clip to apply J-Cut or L-Cut');
        return;
      }
      const targetOffset = kind === 'j' ? -0.6 : 0.6;
      const nextOffset = Math.abs((selectedClip.audioOffset ?? 0) - targetOffset) < 0.05 ? 0 : targetOffset;
      mutateSelectedClip((c) => ({ ...c, audioOffset: nextOffset }), true, kind === 'j' ? 'J-Cut' : 'L-Cut');
      showToast(
        nextOffset === 0
          ? 'Cleared J/L-Cut audio offset'
          : kind === 'j'
            ? 'Applied J-Cut (Audio leads -0.60s)'
            : 'Applied L-Cut (Audio trails +0.60s)'
      );
    },
    [selectedClip, mutateSelectedClip, showToast]
  );

  // Scene Edit Detection, Text/Paper Edit & Dynamic Link
  const handleRunSceneEditDetect = useCallback(async () => {
    const targetClip = selectedClip || findTopVideoClipAt(playheadRef.current);
    if (!targetClip || !targetClip.assetId) {
      showToast('Select a video clip first for Scene Edit Detection');
      return;
    }
    const vid = videoElementsRef.current.get(targetClip.assetId);
    if (!vid) return;
    setSceneDetectBusy(true);
    setIsPlaying(false);
    setShuttleSpeed(0);
    try {
      const cuts = await detectSceneCuts(vid, targetClip.sourceIn, targetClip.duration, 0.28);
      if (cuts.length === 0) {
        showToast('No sharp scene cuts detected in clip');
      } else {
        pushUndoSnapshot('Scene Edit Detection');
        setMarkers((prev) => [
          ...prev,
          ...cuts.map((offset, idx) => ({
            id: `scene-${Date.now()}-${idx}`,
            time: snapToFrame(targetClip.start + offset, seqFps),
            label: `SC${idx + 1}`,
            markerType: 'eventCue' as MarkerType,
          })),
        ]);
        const cutPoints = [0, ...cuts, targetClip.duration];
        const segments: TimelineClip[] = [];
        for (let i = 0; i < cutPoints.length - 1; i++) {
          const segStart = cutPoints[i];
          const segDur = snapToFrame(cutPoints[i + 1] - segStart, seqFps);
          if (segDur < 0.1) continue;
          segments.push({
            ...structuredClone(targetClip),
            id: i === 0 ? targetClip.id : `clip-${Date.now()}-${i}`,
            start: snapToFrame(targetClip.start + segStart, seqFps),
            sourceIn: targetClip.sourceIn + segStart,
            duration: segDur,
            keyframes: i === 0 ? targetClip.keyframes : {},
          });
        }
        if (segments.length > 1) {
          setClips((prev) => prev.flatMap((c) => (c.id === targetClip.id ? segments : [c])));
        }
        showToast(`Scene Edit Detection: ${cuts.length} cuts split & marked`);
      }
    } finally {
      setSceneDetectBusy(false);
    }
  }, [selectedClip, findTopVideoClipAt, pushUndoSnapshot, seqFps, showToast]);

  const handleGenerateTranscriptFromClips = useCallback(() => {
    const videoTrackIds = new Set(tracksRef.current.filter((t) => t.kind === 'video').map((t) => t.id));
    const vClips = clipsRef.current
      .filter((c) => videoTrackIds.has(c.trackId) && c.clipKind === 'media')
      .sort((a, b) => a.start - b.start);
    if (!vClips.length) {
      showToast('Import video clips to build a script');
      return;
    }
    setTranscript(
      vClips.map((c, idx) => ({
        id: `seg-${c.id}`,
        clipId: c.id,
        speaker: `Shot ${idx + 1}`,
        startSec: c.start,
        endSec: c.start + c.duration,
        text: `${c.name.replace(/\.[^.]+$/, '')} (${c.duration.toFixed(1)}s) - edit text or reorder for Paper Edit`,
        included: true,
      }))
    );
    showToast(`Built script from ${vClips.length} timeline clips`);
  }, [showToast]);

  const handleApplyPaperEditToTimeline = useCallback(() => {
    const included = transcript.filter((s) => s.included);
    if (!included.length) {
      showToast('Select at least one script segment');
      return;
    }
    pushUndoSnapshot('Apply Paper Edit');
    const byId = new Map(clipsRef.current.map((c) => [c.id, c]));
    let cursor = 0;
    const reassembled: TimelineClip[] = [];
    const usedIds = new Set<string>();
    for (const seg of included) {
      const orig = byId.get(seg.clipId);
      if (!orig) continue;
      usedIds.add(orig.id);
      const segDur = Math.max(0.2, snapToFrame(seg.endSec - seg.startSec, seqFps));
      reassembled.push({
        ...structuredClone(orig),
        id: `clip-pe-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        start: snapToFrame(cursor, seqFps),
        duration: Math.min(orig.duration, segDur),
      });
      cursor += Math.min(orig.duration, segDur);
    }
    if (reassembled.length > 0) {
      setClips((prev) => [...prev.filter((c) => !usedIds.has(c.id)), ...reassembled]);
      showToast(`Paper Edit assembled ${reassembled.length} shots`);
    }
  }, [transcript, pushUndoSnapshot, seqFps, showToast]);

  const handleOpenDynamicLinkTotone = useCallback(() => {
    const canvas = viewportCanvasRef.current;
    if (canvas && clipsRef.current.length > 0) {
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeProject?.name || 'fifilm'}_frame_totone.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }, 'image/png');
      showToast('Exported current frame PNG for Totone Dynamic Link');
    } else {
      showToast('Dynamic Link ready - import footage to send frame to Totone');
    }
  }, [activeProject, showToast]);

  const multiCamAngles = useMemo(() => {
    const vTracks = tracks.filter((t) => t.kind === 'video');
    return vTracks.slice(0, 4).map((t, idx) => ({
      trackId: t.id,
      label: `Cam ${idx + 1} (${t.name})`,
      active: t.visible && !vTracks.some((o) => o.id !== t.id && o.visible),
    }));
  }, [tracks]);

  const handleSwitchMultiCamAngle = useCallback(
    (trackId: string) => {
      setTracks((prev) => prev.map((t) => (t.kind === 'video' ? { ...t, visible: t.id === trackId } : t)));
      if (isPlayingRef.current) {
        setMarkers((prev) => [
          ...prev,
          {
            id: `mc-${Date.now()}`,
            time: snapToFrame(playheadRef.current, seqFps),
            label: tracksRef.current.find((t) => t.id === trackId)?.name || 'CAM',
            markerType: 'eventCue',
          },
        ]);
      }
    },
    [seqFps]
  );

  // Unified 60fps Multi-Layer WebGL2 Compositor + Loop In-to-Out + Posterize Time + Video Fades + Scopes
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();
    let lastScopeTs = 0;
    let lastMeterTs = 0;
    let lastUiPlayheadTs = 0;
    let lastFpsTs = performance.now();
    let frameCounter = 0;
    let dropCounter = 0;

    const loop = (now: number) => {
      const rawDt = (now - lastTs) / 1000;
      const dt = Math.min(0.08, Math.max(0, rawDt));
      lastTs = now;

      const playing = isPlayingRef.current;
      const shuttle = shuttleSpeedRef.current;
      const rate = shuttle !== 0 ? shuttle : playing ? 1 : 0;
      const seqDur = clipsRef.current.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0);
      const curFps = Math.max(1, sequenceRef.current.fps || 24);

      frameCounter++;
      if (rate !== 0 && rawDt > 1.85 / curFps) dropCounter++;
      if (now - lastFpsTs >= 650) {
        const fpsVal = (frameCounter * 1000) / Math.max(1, now - lastFpsTs);
        setMeasuredFps(Math.min(120, fpsVal));
        if (dropCounter > 0) {
          setDroppedFrames((d) => d + dropCounter);
          dropCounter = 0;
        }
        frameCounter = 0;
        lastFpsTs = now;
      }

      let curPlayhead = playheadRef.current;
      if (rate !== 0 && seqDur > 0) {
        curPlayhead += dt * rate;
        // Play In to Out Loop!
        const lpIn = inPointRef.current ?? 0;
        const lpOut = outPointRef.current ?? seqDur;
        if (loopInToOutRef.current && lpOut > lpIn && rate > 0 && curPlayhead >= lpOut) {
          curPlayhead = lpIn;
        } else if (curPlayhead >= seqDur) {
          if (loopInToOutRef.current) {
            curPlayhead = 0;
          } else {
            curPlayhead = seqDur;
            isPlayingRef.current = false;
            shuttleSpeedRef.current = 0;
            setIsPlaying(false);
            setShuttleSpeed(0);
            pauseAllVideos();
          }
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
      const activeVideoKeys = new Set<string>();

      if (pipeline) {
        const visibleVideoTracksBottomUp = tracksRef.current
          .filter((tr) => tr.kind === 'video' && tr.visible)
          .slice()
          .reverse();

        const compositeLayers: CompositeLayerInput[] = [];
        const canvasW = sequenceRef.current.width || 1920;
        const canvasH = sequenceRef.current.height || 1080;

        for (const tr of visibleVideoTracksBottomUp) {
          const clip = clipsRef.current.find(
            (c) => !c.disabled && c.trackId === tr.id && curPlayhead >= c.start && curPlayhead < c.start + c.duration
          );
          if (!clip) continue;

          const elapsedInClip = Math.max(0, curPlayhead - clip.start);
          const evaluated = evaluateClipAtLocalTime(clip, elapsedInClip);
          const videoFadeMultiplier = computeVideoFadeMultiplier(clip, elapsedInClip);

          let transitionType: VideoTransitionType = 'none';
          let transitionVisibility = 1.0;
          if (
            clip.transitionIn &&
            clip.transitionIn.type !== 'none' &&
            clip.transitionIn.duration > 0.01 &&
            elapsedInClip < clip.transitionIn.duration
          ) {
            transitionType = clip.transitionIn.type;
            transitionVisibility = Math.max(0, Math.min(1, elapsedInClip / clip.transitionIn.duration));
          } else if (
            clip.transitionOut &&
            clip.transitionOut.type !== 'none' &&
            clip.transitionOut.duration > 0.01 &&
            clip.duration - elapsedInClip < clip.transitionOut.duration
          ) {
            transitionType = clip.transitionOut.type;
            transitionVisibility = Math.max(
              0,
              Math.min(1, (clip.duration - elapsedInClip) / clip.transitionOut.duration)
            );
          }

          if (clip.clipKind === 'adjustment') {
            compositeLayers.push({
              source: null,
              isAdjustmentLayer: true,
              blendMode: clip.blendMode || 'normal',
              grade: clip.color,
              transform: evaluated.transform,
              mask: clip.mask || createDefaultMask(),
              exposureOverride: evaluated.exposure,
              blurOverride: evaluated.blur,
              stabilization: clip.stabilization,
              transitionType,
              transitionVisibility,
              videoFadeMultiplier,
              timeSec: curPlayhead,
            });
            continue;
          }

          if (
            (clip.clipKind === 'text' || clip.clipKind === 'vertical-text' || clip.clipKind === 'shape') &&
            clip.textOverlay
          ) {
            const overlayCanvas = getOverlayTextureCanvas(clip.id, clip.textOverlay, canvasW, canvasH);
            compositeLayers.push({
              source: overlayCanvas,
              isAlphaOverlay: true,
              blendMode: clip.blendMode || 'normal',
              grade: clip.color,
              transform: evaluated.transform,
              mask: clip.mask || createDefaultMask(),
              exposureOverride: evaluated.exposure,
              blurOverride: evaluated.blur,
              stabilization: clip.stabilization,
              transitionType,
              transitionVisibility,
              videoFadeMultiplier,
              timeSec: curPlayhead,
            });
            continue;
          }

          let resolvedAssetId = clip.assetId;
          let resolvedSourceIn = clip.sourceIn;
          let resolvedElapsed = elapsedInClip;
          if (clip.clipKind === 'nested' && clip.nestedClips?.length) {
            const inner =
              clip.nestedClips.find((nc) => elapsedInClip >= nc.start && elapsedInClip < nc.start + nc.duration) ||
              clip.nestedClips[0];
            if (inner) {
              resolvedAssetId = inner.assetId;
              resolvedSourceIn = inner.sourceIn;
              resolvedElapsed = Math.max(0, elapsedInClip - inner.start);
            }
          }

          const asset = assetsRef.current.get(resolvedAssetId);
          if (!asset || asset.kind !== 'video') continue;

          const clipSpeed = clip.color.effects.enabled ? evaluated.speed : 1;
          const postFps = clip.color.effects.enabled ? clip.color.effects.posterizeTimeFps : 0;
          const rawClipTime =
            clip.clipKind === 'freeze'
              ? clip.freezeFrameTime ?? resolvedSourceIn
              : Math.max(0, resolvedSourceIn + resolvedElapsed * clipSpeed);
          const clipTime = postFps > 0 ? Math.floor(rawClipTime * postFps) / postFps : rawClipTime;

          const rawVid = videoElementsRef.current.get(asset.id);
          const stabKey = `stab-${clip.id}`;
          const stabVid =
            clip.stabilization.enabled && clip.stabilization.stabilizedUrl
              ? videoElementsRef.current.get(stabKey)
              : undefined;

          if (rawVid) activeVideoKeys.add(asset.id);
          if (stabVid) activeVideoKeys.add(stabKey);

          const driveVideo = (key: string, vid: HTMLVideoElement, isPrimaryAudio: boolean) => {
            if (clip.clipKind === 'freeze' || postFps > 0) {
              if (!vid.paused) vid.pause();
              safeSeekVideo(key, vid, clipTime);
              if (isPrimaryAudio && clip.clipKind === 'freeze') {
                audioEngineRef.current?.setVideoClipEnvelopeGain(asset.id, 0);
              }
              return;
            }
            if (rate > 0) {
              const effRate = Math.max(0.25, Math.min(4.0, rate * clipSpeed));
              if (Math.abs(vid.playbackRate - effRate) > 0.01) vid.playbackRate = effRate;
              if (vid.paused && vid.readyState >= 2) {
                try {
                  if (Math.abs(vid.currentTime - clipTime) > 0.08) vid.currentTime = clipTime;
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
                const anyAudioSolo = tracksRef.current.some((t) => t.kind === 'audio' && t.solo);
                const audible = !clip.muted && !tr.muted && !anyAudioSolo;
                const env = computeClipEnvelopeMultiplier(clip, elapsedInClip);
                audioEngineRef.current.setVideoClipEnvelopeGain(
                  asset.id,
                  audible ? clip.volume * (tr.gain ?? 1) * env : 0
                );
              }
            } else {
              if (!vid.paused) vid.pause();
              safeSeekVideo(key, vid, clipTime);
            }
          };

          if (rawVid) driveVideo(asset.id, rawVid, true);
          if (stabVid) driveVideo(stabKey, stabVid, false);

          if (rawVid && rawVid.readyState >= 2) {
            const frameIndex = Math.floor(clipTime * (asset.fps || curFps));
            const frameTransform = clip.stabilization.trajectory?.length
              ? clip.stabilization.trajectory[Math.min(frameIndex, clip.stabilization.trajectory.length - 1)]
              : undefined;

            // Normalize relative scale to sequence canvas when rendering natively into sequence resolution
            const relW = (rawVid.videoWidth || asset.width || canvasW) / canvasW;
            const relH = (rawVid.videoHeight || asset.height || canvasH) / canvasH;
            const nativeScaleFactor = Math.min(relW, relH);
            const effTransform: ClipTransformState = {
              ...evaluated.transform,
              scale: Math.max(5, evaluated.transform.scale * nativeScaleFactor),
            };

            compositeLayers.push({
              source: rawVid,
              stabilizedSource: stabVid && stabVid.readyState >= 2 ? stabVid : null,
              blendMode: clip.blendMode || 'normal',
              grade: clip.color,
              transform: effTransform,
              mask: clip.mask || createDefaultMask(),
              exposureOverride: evaluated.exposure,
              blurOverride: evaluated.blur,
              stabilization: clip.stabilization,
              frameTransform,
              transitionType,
              transitionVisibility,
              videoFadeMultiplier,
              timeSec: curPlayhead,
            });
          }
        }

        for (const [k, v] of videoElementsRef.current.entries()) {
          if (!activeVideoKeys.has(k) && !v.paused) v.pause();
        }

        if (compositeLayers.length > 0) {
          const qualityScale =
            qualityRef.current === 'quarter' ? 0.25 : qualityRef.current === 'half' ? 0.5 : 1.0;
          pipeline.renderComposite({
            layers: compositeLayers,
            width: canvasW,
            height: canvasH,
            qualityScale,
            compareOriginal: compareHeld,
            splitEnabled,
            splitPos,
            vrEnabled: vrEnabledRef.current,
            vrYawRad: vrAnglesRef.current.yaw,
            vrPitchRad: vrAnglesRef.current.pitch,
          });
        } else {
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
          setScopeMetrics(renderVideoScope(viewportCanvasRef.current, scopeCanvasRef.current, scopeMode));
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
  }, [pauseAllVideos, safeSeekVideo, compareHeld, splitEnabled, splitPos, activeTab, scopeMode]);

  // Global Pro NLE Keyboard Shortcuts (Transport, Q/W, F Match Frame, Alt Nudge/Track Move/Slip/Slide, Ctrl+K, D, ;/')
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (showHome || isTyping(e.target)) return;

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
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        handleMoveClipTrackVertical(-1);
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        handleMoveClipTrackVertical(1);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNudgeSelectedClip(e.shiftKey ? -5 : -1);
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        handleNudgeSelectedClip(e.shiftKey ? 5 : 1);
      } else if (e.altKey && (e.key === ',' || e.key === '.')) {
        e.preventDefault();
        if (!selectedClipId) return;
        const delta = (e.key === ',' ? -1 : 1) / seqFps;
        if (e.ctrlKey || e.metaKey) handleSlideClip(selectedClipId, delta);
        else handleSlipClip(selectedClipId, delta);
      } else if (e.altKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        setInPoint(null);
        setOutPoint(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        handleBladeSplit();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedClip) {
          setClipboardClip(structuredClone(selectedClip));
          showToast(`Copied "${selectedClip.name}"`);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (selectedClip) handleContextMenuAction({ type: 'cut' });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (clipboardClip) handleContextMenuAction({ type: 'paste' });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
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
        const step = (e.shiftKey ? 10 : 1) / seqFps;
        const next = Math.max(0, snapToFrame(playheadRef.current - step, seqFps));
        playheadRef.current = next;
        setPlayhead(next);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setShuttleSpeed(0);
        const step = (e.shiftKey ? 10 : 1) / seqFps;
        const next = Math.min(sequenceDuration, snapToFrame(playheadRef.current + step, seqFps));
        playheadRef.current = next;
        setPlayhead(next);
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        handleRippleTrimToPlayhead('prev');
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        handleRippleTrimToPlayhead('next');
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (e.shiftKey) handleCreateFreezeFrame();
        else handleMatchFrame();
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        const under = findTopVideoClipAt(playheadRef.current);
        if (under) setSelectedClipId(under.id);
      } else if (e.key === ';') {
        e.preventDefault();
        handleLiftOrExtract('lift');
      } else if (e.key === "'") {
        e.preventDefault();
        handleLiftOrExtract('extract');
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setSnapEnabled((s) => !s);
      } else if ((e.key === 'b' || e.key === 'B') && !e.altKey) {
        e.preventDefault();
        handleBladeSplit();
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        setInPoint(snapToFrame(playheadRef.current, seqFps));
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        setOutPoint(snapToFrame(playheadRef.current, seqFps));
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleAddMarkerOfType('standard');
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
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'v' && !e.shiftKey) setActiveTool('select');
        else if (k === 'a') setActiveTool('trackForward');
        else if (k === 'r' && e.shiftKey) setActiveTool('ripple');
        else if (k === 'e' && e.shiftKey) setActiveTool('rolling');
        else if (k === 'r') setActiveTool('rateStretch');
        else if (k === 'c') setActiveTool('razor');
        else if (k === 'y') setActiveTool('slip');
        else if (k === 'u') setActiveTool('slide');
        else if (k === 'h') setActiveTool('hand');
        else if (k === 'z') setActiveTool('zoom');
        else if (k === 'p') {
          setActiveTool('pen');
          handleCreateShapeClip('pen');
        } else if (k === 't' && e.shiftKey) {
          setActiveTool('verticalType');
          handleCreateTextClip(true);
        } else if (k === 't') {
          setActiveTool('type');
          handleCreateTextClip(false);
        }
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
  }, [
    showHome,
    sequenceDuration,
    seqFps,
    selectedClip,
    selectedClipId,
    clipboardClip,
    handleBladeSplit,
    handleDeleteClip,
    handleUndo,
    handleRedo,
    handleCreateShapeClip,
    handleCreateTextClip,
    handleCreateFreezeFrame,
    handleMatchFrame,
    handleRippleTrimToPlayhead,
    handleLiftOrExtract,
    handleAddMarkerOfType,
    handleMoveClipTrackVertical,
    handleNudgeSelectedClip,
    handleSlipClip,
    handleSlideClip,
    handleContextMenuAction,
    findTopVideoClipAt,
    showToast,
  ]);

  const handleSaveGradeAsLut = async (name: string) => {
    if (!selectedClip) return;
    const cube = bakeGradeToCube(name, selectedClip.color, getCachedLutMap(), 33);
    await saveNewCubeLut(name, cube);
    await refreshLuts();
  };

  const handleOpenProjectFromHome = useCallback(
    (id: string) => {
      const target = projects.find((p) => p.id === id);
      if (target) loadProjectIntoEditor(target);
      setShowHome(false);
    },
    [projects, loadProjectIntoEditor]
  );

  const handleCreateProjectWithOptions = useCallback(
    (opts: { name: string; sequencePatch: Partial<SequenceSettings>; initialFiles: File[] }) => {
      const saved = snapshotActiveProject(projects);
      const next = createBlankProject(opts.name);
      next.sequence = { ...next.sequence, ...opts.sequencePatch };
      sequenceRef.current = next.sequence;
      setProjects([next, ...saved]);
      loadProjectIntoEditor(next);
      setShowHome(false);
      if (opts.initialFiles.length > 0) {
        setTimeout(() => {
          importFiles(opts.initialFiles);
        }, 120);
      }
    },
    [projects, snapshotActiveProject, loadProjectIntoEditor, importFiles]
  );

  if (showHome) {
    return (
      <HomeScreen
        projects={projects}
        activeProjectId={activeProjectId}
        onCreateProjectWithOptions={handleCreateProjectWithOptions}
        onOpenProject={handleOpenProjectFromHome}
        onDuplicateProject={handleDuplicateProject}
        onDeleteProject={handleDeleteProject}
        onExportProjectFile={handleExportProjectFile}
        onImportProjectFile={async (file) => {
          await handleImportProjectFile(file);
          setShowHome(false);
        }}
      />
    );
  }

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
        activeProjectName={activeProject?.name || 'Untitled 1'}
        projectCount={projects.length}
        sequence={sequence}
        railPreset={projectSettings.railPreset}
        lastAutoSavedAt={lastAutoSavedAt}
        onGoHome={() => {
          setIsPlaying(false);
          setShuttleSpeed(0);
          pauseAllVideos();
          audioEngineRef.current?.stopBufferVoices();
          persistProjectNow();
          setShowHome(true);
        }}
        onOpenProjects={() => setShowProjects(true)}
        onOpenSettings={() => setShowSettings(true)}
        onSelectRailPreset={handleApplyRailPreset}
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
          mutateSelectedClip(
            (c) => ({
              ...c,
              blendMode: 'normal',
              mask: createDefaultMask(),
              color: createDefaultGrade(),
              transform: createDefaultTransform(),
              keyframes: {},
            }),
            true,
            'Reset Look'
          )
        }
        onShowKeys={() => setShowKeys(true)}
        onOpenExport={() => setShowExport(true)}
      />

      <main className="workspace-main">
        <WorkspacePanels
          activePanel={leftPanel}
          onPanelChange={setLeftPanel}
          assets={assets}
          clips={clips}
          markers={markers}
          selectedClip={selectedClip}
          history={historyEntries}
          transcript={transcript}
          credentials={credentials}
          effectPresets={effectPresets}
          sequence={sequence}
          overlays={overlays}
          onUpdateOverlays={(patch) => setOverlays((prev) => ({ ...prev, ...patch }))}
          sourceMatchTarget={sourceMatchTarget}
          fps={seqFps}
          multiCamEnabled={multiCamEnabled}
          onToggleMultiCam={() => setMultiCamEnabled((m) => !m)}
          onOpenSettings={() => setShowSettings(true)}
          onImportClick={() => videoFileInputRef.current?.click()}
          onInsertAssetFromSource={handleInsertAssetFromSource}
          onLiftOrExtract={handleLiftOrExtract}
          onUpdateAssetInterpret={(assetId, interpretedFps, pixelAspect) => {
            setAssets((prev) => {
              const cur = prev.get(assetId);
              if (!cur) return prev;
              const next = new Map(prev);
              next.set(assetId, { ...cur, interpretedFps, pixelAspect });
              return next;
            });
            showToast(`Interpreted at ${interpretedFps} fps`);
          }}
          onCreateAdjustmentLayer={handleCreateAdjustmentLayer}
          onCreateNestedSequence={handleCreateNestedSequence}
          onCreateFreezeFrame={() => handleCreateFreezeFrame(2.0)}
          onCreateTextClip={handleCreateTextClip}
          onCreateShapeClip={handleCreateShapeClip}
          onRunSceneEditDetect={handleRunSceneEditDetect}
          sceneDetectBusy={sceneDetectBusy}
          onApplyVideoEffect={(patch, colorPatch, blendMode, label) => {
            if (!selectedClip) {
              showToast('Select a clip first');
              return;
            }
            mutateSelectedClip(
              (c) => ({
                ...c,
                blendMode: blendMode ?? c.blendMode,
                transform:
                  label === 'Horizontal Flip'
                    ? { ...c.transform, flipX: !c.transform.flipX }
                    : label === 'Vertical Flip'
                      ? { ...c.transform, flipY: !c.transform.flipY }
                      : c.transform,
                color: {
                  ...c.color,
                  correction: colorPatch ? { ...c.color.correction, ...colorPatch } : c.color.correction,
                  effects: patch ? { ...c.color.effects, ...patch } : c.color.effects,
                },
              }),
              true,
              `Apply ${label}`
            );
            setActiveTab(colorPatch ? 'color' : blendMode ? 'motion' : 'effects');
            showToast(`Applied ${label}`);
          }}
          onApplyVideoTransition={(type, side) => {
            if (!selectedClip) {
              showToast('Select a clip first');
              return;
            }
            mutateSelectedClip(
              (c) => ({
                ...c,
                [side === 'in' ? 'transitionIn' : 'transitionOut']: {
                  type,
                  duration: Math.min(projectSettings.defaultTransitionSec, Math.max(0.25, c.duration * 0.35)),
                },
              }),
              true,
              `Transition ${side} (${type})`
            );
            showToast(`Applied ${type} (${side.toUpperCase()})`);
          }}
          onApplyAudioEffect={(patch, label) => {
            if (!selectedClip) {
              showToast('Select a clip first');
              return;
            }
            mutateSelectedClip(
              (c) => ({ ...c, audioEffects: { ...c.audioEffects, ...patch } }),
              true,
              `Audio FX: ${label}`
            );
            setActiveTab('audio');
            showToast(`Applied ${label}`);
          }}
          onApplyAudioTransition={(type: AudioTransitionType) => {
            if (!selectedClip) {
              showToast('Select a clip first');
              return;
            }
            const defFade = projectSettings.defaultAudioFadeSec || 0.4;
            mutateSelectedClip(
              (c) => ({
                ...c,
                fadeIn: Math.max(defFade, c.fadeIn),
                fadeOut: Math.max(defFade, c.fadeOut),
                audioEffects: { ...c.audioEffects, fadeInType: type, fadeOutType: type },
              }),
              true,
              `Audio Transition (${type})`
            );
            setActiveTab('audio');
            showToast(`Applied ${type} audio fades`);
          }}
          onApplyEffectPreset={(preset) => {
            if (!selectedClip) return;
            mutateSelectedClip(
              (c) => ({
                ...c,
                blendMode: preset.blendMode ?? c.blendMode,
                color: preset.color ? { ...c.color, ...structuredClone(preset.color) } : c.color,
                audioEffects: preset.audioEffects
                  ? { ...c.audioEffects, ...structuredClone(preset.audioEffects) }
                  : c.audioEffects,
              }),
              true,
              `Preset: ${preset.name}`
            );
            showToast(`Applied preset "${preset.name}"`);
          }}
          onSaveCurrentAsPreset={handleSaveCurrentAsPreset}
          onDeleteEffectPreset={(id) => setEffectPresets((prev) => prev.filter((p) => p.id !== id))}
          onAddMarkerOfType={handleAddMarkerOfType}
          onDeleteMarker={(id) => setMarkers((prev) => prev.filter((m) => m.id !== id))}
          onClearAllMarkers={() => setMarkers([])}
          onApplyTrackPreset={handleApplyTrackPreset}
          onApplyRailPreset={handleApplyRailPreset}
          onJumpToTime={(t) => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            const clamped = Math.max(0, snapToFrame(t, seqFps));
            playheadRef.current = clamped;
            setPlayhead(clamped);
          }}
          onSelectClip={setSelectedClipId}
          onRestoreHistory={handleRestoreHistory}
          onUpdateTranscript={setTranscript}
          onGenerateTranscriptFromClips={handleGenerateTranscriptFromClips}
          onApplyPaperEditToTimeline={handleApplyPaperEditToTimeline}
          onUpdateCredentials={(patch) => setCredentials((prev) => ({ ...prev, ...patch }))}
          onOpenDynamicLinkTotone={handleOpenDynamicLinkTotone}
        />

        <Viewport
          canvasRef={viewportCanvasRef}
          hasMedia={clips.length > 0}
          playhead={playhead}
          duration={sequenceDuration}
          fps={seqFps}
          measuredFps={measuredFps}
          droppedFrames={droppedFrames}
          playbackQuality={playbackQuality}
          onPlaybackQualityChange={setPlaybackQuality}
          overlays={overlays}
          onUpdateOverlays={(patch) => setOverlays((prev) => ({ ...prev, ...patch }))}
          loopInToOut={loopInToOut}
          onToggleLoopInToOut={() => setLoopInToOut((l) => !l)}
          vrEnabled={vrEnabled}
          onToggleVr={() => setVrEnabled((v) => !v)}
          onVrDragDelta={(dyaw, dpitch) => {
            vrAnglesRef.current.yaw += dyaw;
            vrAnglesRef.current.pitch = Math.max(-1.45, Math.min(1.45, vrAnglesRef.current.pitch + dpitch));
          }}
          multiCamEnabled={multiCamEnabled}
          multiCamAngles={multiCamAngles}
          onSwitchMultiCamAngle={handleSwitchMultiCamAngle}
          isPlaying={isPlaying}
          shuttleSpeed={shuttleSpeed}
          onSetShuttleSpeed={(spd) => {
            setShuttleSpeed(spd);
            setIsPlaying(spd !== 0);
            if (spd > 0) audioEngineRef.current?.resume();
          }}
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
              Math.min(sequenceDuration, snapToFrame(playheadRef.current + delta / seqFps, seqFps))
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
          onMarkIn={() => setInPoint(snapToFrame(playheadRef.current, seqFps))}
          onMarkOut={() => setOutPoint(snapToFrame(playheadRef.current, seqFps))}
          onImportClick={() => videoFileInputRef.current?.click()}
          onDropFiles={importFiles}
        />

        <Inspector
          activeTab={activeTab}
          onTabChange={setActiveTab}
          clip={selectedClip}
          clips={clips}
          tracks={tracks}
          playhead={playhead}
          fps={seqFps}
          onSeekPlayhead={(t) => {
            setIsPlaying(false);
            setShuttleSpeed(0);
            const clamped = Math.max(0, snapToFrame(t, seqFps));
            playheadRef.current = clamped;
            setPlayhead(clamped);
          }}
          onUpdateTransform={handleUpdateTransform}
          onResetTransform={() =>
            mutateSelectedClip((c) => ({ ...c, transform: createDefaultTransform() }), true, 'Reset Motion')
          }
          onScaleToFrameSize={handleScaleToFrameSize}
          onUpdateBlendMode={(mode: BlendMode) =>
            mutateSelectedClip((c) => ({ ...c, blendMode: mode }), true, `Blend Mode (${mode})`)
          }
          onUpdateMask={(patch: Partial<ClipMaskState>) =>
            mutateSelectedClip((c) => ({ ...c, mask: { ...c.mask, ...patch } }))
          }
          onUpdateTransition={(side: 'in' | 'out', patch: Partial<ClipTransition>) =>
            mutateSelectedClip(
              (c) => ({
                ...c,
                [side === 'in' ? 'transitionIn' : 'transitionOut']: {
                  ...(side === 'in' ? c.transitionIn : c.transitionOut),
                  ...patch,
                },
              }),
              true,
              `Update ${side} Transition`
            )
          }
          onUpdateTextOverlay={(patch: Partial<TextOverlayProps>) =>
            mutateSelectedClip((c) => ({
              ...c,
              textOverlay: c.textOverlay ? { ...c.textOverlay, ...patch } : undefined,
            }))
          }
          onToggleKeyframe={handleToggleKeyframe}
          onClearClipKeyframes={() =>
            mutateSelectedClip((c) => ({ ...c, keyframes: {} }), true, 'Clear Keyframes')
          }
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
          onUpdateAnyClipVolume={(clipId, volume) => {
            setClips((prev) =>
              prev.map((c) => {
                if (c.id !== clipId) return c;
                audioEngineRef.current?.updateClipVolumeLive(c.id, volume, c.muted);
                return { ...c, volume };
              })
            );
          }}
          onAutoMixAudio={handleAutoMixAudio}
          onUpdateAudioEffects={(patch: Partial<ClipAudioEffectsState>) =>
            mutateSelectedClip((c) => ({ ...c, audioEffects: { ...c.audioEffects, ...patch } }))
          }
          onApplyEssentialSound={(role: EssentialSoundRole) =>
            mutateSelectedClip(
              (c) => ({ ...c, audioEffects: { ...c.audioEffects, ...ESSENTIAL_SOUND_PRESETS[role] } }),
              true,
              `Essential Sound: ${role}`
            )
          }
          onUpdateTrackMixer={(trackId, patch) => {
            setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...patch } : t)));
          }}
          onNormalizeClipAudio={() => {
            if (!selectedClip) return;
            const normVol = audioEngineRef.current?.computeNormalizeVolume(selectedClip.assetId, -1.0);
            if (normVol !== null && normVol !== undefined) {
              mutateSelectedClip(
                (c) => {
                  audioEngineRef.current?.updateClipVolumeLive(c.id, normVol, c.muted);
                  return { ...c, volume: normVol };
                },
                true,
                'Normalize Audio'
              );
            }
          }}
          splitEnabled={splitEnabled}
          onSplitEnabledChange={setSplitEnabled}
          onCompareStart={() => setCompareHeld(true)}
          onCompareEnd={() => setCompareHeld(false)}
          onUpdateCorrection={(patch: Partial<ColorCorrectionState>) =>
            mutateSelectedClip((c) => {
              const nextKf = { ...(c.keyframes || {}) };
              if (patch.exposure !== undefined && nextKf.exposure && nextKf.exposure.length > 0) {
                const localT = Math.max(0, Math.min(c.duration, playheadRef.current - c.start));
                nextKf.exposure = upsertKeyframe(
                  nextKf.exposure,
                  localT,
                  patch.exposure,
                  nextKf.exposure[0].easing
                );
              }
              return {
                ...c,
                keyframes: nextKf,
                color: { ...c.color, correction: { ...c.color.correction, ...patch } },
              };
            })
          }
          onResetCorrection={() =>
            mutateSelectedClip(
              (c) => ({ ...c, color: { ...c.color, correction: createDefaultCorrection() } }),
              true,
              'Reset Color'
            )
          }
          onUpdateGrading={(patch: Partial<ColorGradingState>) =>
            mutateSelectedClip((c) => ({ ...c, color: { ...c.color, grading: { ...c.color.grading, ...patch } } }))
          }
          onResetGrading={() =>
            mutateSelectedClip(
              (c) => ({ ...c, color: { ...c.color, grading: createDefaultGrading() } }),
              true,
              'Reset Grading'
            )
          }
          onUpdateEffects={(patch: Partial<ClipEffectsState>) =>
            mutateSelectedClip((c) => {
              const nextKf = { ...(c.keyframes || {}) };
              const localT = Math.max(0, Math.min(c.duration, playheadRef.current - c.start));
              if (patch.blur !== undefined && nextKf.blur && nextKf.blur.length > 0) {
                nextKf.blur = upsertKeyframe(nextKf.blur, localT, patch.blur, nextKf.blur[0].easing);
              }
              if (patch.speed !== undefined && nextKf.speed && nextKf.speed.length > 0) {
                nextKf.speed = upsertKeyframe(nextKf.speed, localT, patch.speed, nextKf.speed[0].easing);
              }
              return { ...c, keyframes: nextKf, color: { ...c.color, effects: { ...c.color.effects, ...patch } } };
            })
          }
          onResetEffects={() =>
            mutateSelectedClip(
              (c) => ({ ...c, color: { ...c.color, effects: createDefaultEffects() } }),
              true,
              'Reset Effects'
            )
          }
          onAddLutToStack={handleAddLutToStack}
          onUpdateLutLayer={(instanceId, patch) =>
            mutateSelectedClip((c) => ({
              ...c,
              color: {
                ...c.color,
                lutStack: c.color.lutStack.map((l) => (l.instanceId === instanceId ? { ...l, ...patch } : l)),
              },
            }))
          }
          onRemoveLutLayer={(instanceId) =>
            mutateSelectedClip(
              (c) => ({
                ...c,
                color: { ...c.color, lutStack: c.color.lutStack.filter((l) => l.instanceId !== instanceId) },
              }),
              true,
              'Remove LUT'
            )
          }
          onReorderLutStack={(fromIdx, toIdx) =>
            mutateSelectedClip(
              (c) => {
                const copy = [...c.color.lutStack];
                const [moved] = copy.splice(fromIdx, 1);
                copy.splice(toIdx, 0, moved);
                return { ...c, color: { ...c.color, lutStack: copy } };
              },
              true,
              'Reorder LUT Stack'
            )
          }
          onSetLutInterpolation={(mode) =>
            mutateSelectedClip((c) => ({ ...c, color: { ...c.color, lutInterpolation: mode } }))
          }
          onSaveGradeAsLut={handleSaveGradeAsLut}
          onUpdateStabilization={(patch) =>
            mutateSelectedClip((c) => ({ ...c, stabilization: { ...c.stabilization, ...patch } }))
          }
          onAnalyzeStabilize={handleAnalyzeStabilize}
        />
      </main>

      <Timeline
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        onCreateQuickOverlay={handleCreateQuickOverlay}
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
        fps={seqFps}
        selectedClipId={selectedClipId}
        snapEnabled={snapEnabled}
        snapOptions={snapOptions}
        onUpdateSnapOptions={(patch) => setSnapOptions((prev) => ({ ...prev, ...patch }))}
        renderRanges={renderRanges}
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
        onRippleTrimToPlayhead={handleRippleTrimToPlayhead}
        onCloseGap={handleCloseGaps}
        onAutoMixAudio={handleAutoMixAudio}
        onApplyJLcut={handleApplyJLcut}
        onAddMarker={() => handleAddMarkerOfType('standard')}
        onAddTrack={handleAddTrack}
        onRemoveTrack={handleRemoveTrack}
        onMoveTrack={handleMoveTrack}
        onCycleTrackColor={handleCycleTrackColor}
        onToggleTrackFlag={(trackId, flag) =>
          setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, [flag]: !t[flag] } : t)))
        }
        onMoveClip={handleMoveClip}
        onTrackSelectForwardMove={handleTrackSelectForwardMove}
        onTrimClip={handleTrimClip}
        onUpdateClipFade={handleUpdateClipFade}
        onSlipClip={handleSlipClip}
        onSlideClip={handleSlideClip}
        onRemoveThroughEdit={handleRemoveThroughEdit}
        onOpenContextMenu={(x, y, clip) => setContextMenu({ x, y, clip })}
        onCommitHistory={(label) => pushUndoSnapshot(label || 'Timeline Edit')}
      />

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          clip={contextMenu.clip}
          hasClipboard={!!clipboardClip}
          onAction={handleContextMenuAction}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          sequence={sequence}
          projectSettings={projectSettings}
          renderRanges={renderRanges}
          lastAutoSavedAt={lastAutoSavedAt}
          onSaveSettings={handleSaveSettings}
          onApplyTrackPreset={handleApplyTrackPreset}
          onApplyRailPreset={handleApplyRailPreset}
          onRenderInToOut={handleRenderInToOut}
          onDeleteRenderFiles={handleDeleteRenderFiles}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showProjects && (
        <ProjectsModal
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={handleSelectProject}
          onCreateProject={handleCreateProject}
          onDuplicateProject={handleDuplicateProject}
          onRenameProject={handleRenameProject}
          onDeleteProject={handleDeleteProject}
          onExportProjectFile={handleExportProjectFile}
          onImportProjectFile={handleImportProjectFile}
          onClose={() => setShowProjects(false)}
        />
      )}

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
