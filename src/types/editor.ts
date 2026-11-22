export type LutRole = 'input' | 'creative' | 'trim' | 'custom';

export interface LutLibraryEntry {
  id: string;
  name: string;
  fileName: string;
  filePath: string;
  pack: string;
  format: 'cube' | 'colorstudies-bin';
  size?: number;
  isLogConversion?: boolean;
  modifiedAt?: number;
}

export interface ParsedLut3D {
  id: string;
  title: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Float32Array;
}

export interface LutStackLayer {
  instanceId: string;
  lutId: string;
  name: string;
  filePath: string;
  format: 'cube' | 'colorstudies-bin';
  role: LutRole;
  enabled: boolean;
  intensity: number; // 0..100
}

export interface ColorCorrectionState {
  exposure: number;    // -4.0 .. +4.0 EV
  contrast: number;    // -100 .. +100
  highlights: number;  // -100 .. +100
  shadows: number;     // -100 .. +100
  whites: number;      // -100 .. +100
  blacks: number;      // -100 .. +100
  temperature: number; // -100 .. +100
  tint: number;        // -100 .. +100
  saturation: number;  // -100 .. +100
  vibrance: number;    // -100 .. +100
}

export interface WheelOffset {
  x: number;
  y: number;
  luma: number;
}

export interface ColorGradingState {
  enabled: boolean;
  lift: WheelOffset;
  gamma: WheelOffset;
  gain: WheelOffset;
  splitAmount: number;
  splitBalance: number;
  splitShadowHex: string;
  splitHighlightHex: string;
  filmicShoulder: number;
  matteLift: number;
  grain: number;
}

export type LetterboxAspect = 'none' | '2.39' | '1.85' | '1.66' | '1.33';

export interface ClipEffectsState {
  enabled: boolean;
  halation: number;           // 0..100 red-amber optical highlight halo
  halationThreshold: number;  // 40..95 %
  bloom: number;              // 0..100 Pro-Mist highlight diffusion
  bloomRadius: number;        // 1..10
  sharpen: number;            // 0..100 unsharp crispness
  blur: number;               // 0..100 lens softness
  chromaticAberration: number;// 0..100 radial RGB fringe
  vignette: number;           // 0..100 edge darkening
  vignetteFeather: number;    // 10..100
  grainSize: number;          // 1..4
  letterbox: LetterboxAspect;
  speed: number;              // 0.25..4.0 playback rate
}

export type StabilizationEngine = 'hybrid' | 'vidstab' | 'opencv';
export type StabilizationMode = 'smooth' | 'lock';

export interface StabilizationFrameTransform {
  frame: number;
  dx: number;
  dy: number;
  da: number;
  scale: number;
}

export interface StabilizationState {
  enabled: boolean;
  mode: StabilizationMode; // 'smooth' = Smooth Motion (gimbal), 'lock' = No Motion (tripod lock)
  engine: StabilizationEngine;
  smoothness: number;      // 1..60
  strength: number;        // 0..100
  autoCropZoom: number;    // 0..35
  rollingShutter: number;  // 0..100
  edgeFeather: number;     // 0..100
  status: 'idle' | 'analyzing' | 'ready' | 'error';
  progress: number;
  statusMessage: string;
  stabilizedUrl?: string;
  stabilizedFilePath?: string;
  trajectory?: StabilizationFrameTransform[];
}

export interface ClipColorGrade {
  correction: ColorCorrectionState;
  grading: ColorGradingState;
  effects: ClipEffectsState;
  lutStack: LutStackLayer[];
  lutInterpolation: 'tetrahedral' | 'trilinear';
}

export interface BeatAnalysisResult {
  bpm: number;
  confidence: number;
  beats: number[];       // seconds relative to asset start
  downbeats: number[];   // bar 1 beat positions in seconds
  transients: number[];  // sharp percussive onset hits in seconds
  method: string;
}

export interface MediaAsset {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  objectUrl: string;
  filePath?: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  waveform: number[];
  beatAnalysis?: BeatAnalysisResult;
  isSample?: boolean;
}

export type TrackKind = 'video' | 'audio';

export interface TimelineTrack {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  visible: boolean;
}

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  start: number;
  sourceIn: number;
  duration: number;
  sourceDuration: number;
  volume: number;      // 0..2 linear (1 = 0 dB)
  fadeIn: number;      // seconds (0..5)
  fadeOut: number;     // seconds (0..5)
  muted: boolean;
  color: ClipColorGrade;
  stabilization: StabilizationState;
}

export interface AudioMeterReading {
  peakLeftDb: number;
  peakRightDb: number;
  lufs: number;
  clipping: boolean;
}

export interface ExportAudioClipSpec {
  filePath: string;
  timelineStart: number;
  sourceIn: number;
  duration: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface TimelineMarker {
  id: string;
  time: number;
  label: string;
}

export interface SnapGuide {
  time: number;
  kind: 'playhead' | 'clip-edge' | 'marker' | 'sequence' | 'beat' | 'downbeat' | 'transient';
}

export type BeatSnapTarget = 'all' | 'beat' | 'downbeat' | 'transient';
export type ScopeMode = 'parade' | 'waveform' | 'histogram';
export type InspectorTab = 'color' | 'effects' | 'luts' | 'stabilize' | 'audio' | 'scopes';

export interface HardwareCapabilities {
  ffmpegAvailable: boolean;
  ffmpegPath: string;
  ffprobePath: string;
  vidstabAvailable: boolean;
  lut3dAvailable: boolean;
  pythonAvailable: boolean;
  opencvAvailable: boolean;
  librosaAvailable: boolean;
  hwaccels: string[];
  encoders: {
    h264Nvenc: boolean;
    hevcNvenc: boolean;
    h264Qsv: boolean;
    h264Amf: boolean;
    h264Videotoolbox: boolean;
    h264Vaapi: boolean;
    prores: boolean;
    libx264: boolean;
    libx265: boolean;
  };
  recommendedEncoder: string;
  colorstudiesPath: string;
}

export type ExportResolution = 'source' | '2160p' | '1080p' | '720p' | 'vertical1080';
export type ExportAudioFormat = 'aac_320' | 'aac_256' | 'pcm_24' | 'none';

export interface ExportRequest {
  inputPath: string;
  outputPath: string;
  codec: 'h264_hw' | 'hevc_hw' | 'prores' | 'prores_4444' | 'h264_cpu' | 'audio_wav' | 'audio_mp3';
  qualityMode: 'bitrate' | 'crf';
  bitrateMbps: number;
  crf: number;
  resolution: ExportResolution;
  fps: number; // 0 = source
  audioFormat: ExportAudioFormat;
  loudnessNormalize: boolean; // -14 LUFS EBU R128
  startSec: number;
  durationSec: number;
  masterVolume?: number;
  videoClipVolume?: number;
  videoClipFadeIn?: number;
  videoClipFadeOut?: number;
  videoClipMuted?: boolean;
  audioTracks?: ExportAudioClipSpec[];
  lutPaths: Array<{ path: string; intensity: number }>;
  stabilizedPath?: string;
  bakedCubeContent?: string;
}

export function createDefaultCorrection(): ColorCorrectionState {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    saturation: 0,
    vibrance: 0,
  };
}

export function createDefaultGrading(): ColorGradingState {
  return {
    enabled: true,
    lift: { x: 0, y: 0, luma: 0 },
    gamma: { x: 0, y: 0, luma: 0 },
    gain: { x: 0, y: 0, luma: 0 },
    splitAmount: 0,
    splitBalance: 0,
    splitShadowHex: '#0b2a7a',
    splitHighlightHex: '#ffd9a0',
    filmicShoulder: 0,
    matteLift: 0,
    grain: 0,
  };
}

export function createDefaultEffects(): ClipEffectsState {
  return {
    enabled: true,
    halation: 0,
    halationThreshold: 72,
    bloom: 0,
    bloomRadius: 4,
    sharpen: 0,
    blur: 0,
    chromaticAberration: 0,
    vignette: 0,
    vignetteFeather: 55,
    grainSize: 1.4,
    letterbox: 'none',
    speed: 1.0,
  };
}

export function createDefaultStabilization(): StabilizationState {
  return {
    enabled: false,
    mode: 'smooth',
    engine: 'hybrid',
    smoothness: 18,
    strength: 75,
    autoCropZoom: 6,
    rollingShutter: 35,
    edgeFeather: 12,
    status: 'idle',
    progress: 0,
    statusMessage: 'Ready to analyze camera motion',
  };
}

export function createDefaultGrade(): ClipColorGrade {
  return {
    correction: createDefaultCorrection(),
    grading: createDefaultGrading(),
    effects: createDefaultEffects(),
    lutStack: [],
    lutInterpolation: 'tetrahedral',
  };
}
