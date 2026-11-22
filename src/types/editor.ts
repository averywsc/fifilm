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

export type BlendMode =
  | 'normal'
  | 'screen'
  | 'difference'
  | 'overlay'
  | 'multiply'
  | 'add'
  | 'lighten'
  | 'darken'
  | 'softLight'
  | 'hardLight'
  | 'exclusion';

export type EditorTool =
  | 'select'
  | 'trackForward'
  | 'ripple'
  | 'rolling'
  | 'rateStretch'
  | 'razor'
  | 'slip'
  | 'slide'
  | 'pen'
  | 'rectangle'
  | 'ellipse'
  | 'hand'
  | 'zoom'
  | 'type'
  | 'verticalType';

export type VideoTransitionType =
  | 'none'
  | 'crossDissolve'
  | 'additiveDissolve'
  | 'nonAdditiveDissolve'
  | 'dissolve'
  | 'dipToBlack'
  | 'dipToWhite'
  | 'crossZoom'
  | 'bandWipe'
  | 'bandSlide'
  | 'barnDoors'
  | 'centerSplit'
  | 'checkerWipe'
  | 'checkerBoard'
  | 'clockWipe'
  | 'radialWipe'
  | 'linearWipe'
  | 'wipe'
  | 'venetianBlinds'
  | 'inset'
  | 'blockDissolve'
  | 'paintSplatter'
  | 'irisBox'
  | 'irisCross'
  | 'irisDiamond'
  | 'irisRound'
  | 'irisSquare'
  | 'pagePeel'
  | 'pageRoll'
  | 'cubeSpin'
  | 'flipOver'
  | 'slide'
  | 'push'
  | 'split';

export type AudioTransitionType =
  | 'constantPower'
  | 'constantGain'
  | 'exponentialFade'
  | 'exponentialFadeIn'
  | 'exponentialFadeOut'
  | 'logarithmicFade'
  | 'crossfade';

export interface ClipTransition {
  type: VideoTransitionType;
  duration: number; // seconds
}

export type MaskMode = 'none' | 'rectangle' | 'ellipse' | 'pen' | 'hsl' | 'luminance';

export interface ClipMaskState {
  mode: MaskMode;
  invert: boolean;
  centerX: number;     // 0..100 %
  centerY: number;     // 0..100 %
  width: number;       // 5..100 %
  height: number;      // 5..100 %
  feather: number;     // 0..50 %
  hslHue: number;      // 0..360 deg
  hslHueRange: number; // 5..180 deg
  hslSatMin: number;   // 0..100 %
  hslLumMin: number;   // 0..100 %
  lumaMin: number;     // 0..100 %
  lumaMax: number;     // 0..100 %
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
  balanceR: number;    // -100 .. +100
  balanceG: number;    // -100 .. +100
  balanceB: number;    // -100 .. +100
  hueShift: number;    // -180 .. +180 deg
  lightness: number;   // -100 .. +100
  gamma: number;       // 0.2 .. 3.0 (Gamma Correction / Levels)
  levelsBlack: number; // 0..50 %
  levelsWhite: number; // 50..100 %
  curveLow: number;    // -50..50 (Luma / RGB Curve low)
  curveMid: number;    // -50..50 (Luma / RGB Curve mid)
  curveHigh: number;   // -50..50 (Luma / RGB Curve high)
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
export type AutoReframeMode = 'off' | '16:9' | '9:16' | '1:1' | '4:5';
export type ClipColorLabel = 'default' | 'iris' | 'cerulean' | 'forest' | 'amber' | 'rose' | 'violet' | 'mango';
export type MarkerType = 'standard' | 'chapter' | 'webLink' | 'flashCue' | 'eventCue';
export type AutoScaleMode = 'fit' | 'fill' | 'none';
export type RailPresetId = 'editorial' | 'color' | 'audio' | 'effects' | 'assembly';
export type TrackPresetId = 'standard' | 'multicam4' | 'podcast' | 'cinema';

export interface SequenceSettings {
  name: string;
  width: number;
  height: number;
  fps: number;
  sampleRate: 44100 | 48000 | 96000;
  colorSpace: 'Rec.709' | 'Rec.2020' | 'Display P3' | 'ACEScg';
  autoScaleMedia: AutoScaleMode;
  autoSaveIntervalSec: 0 | 15 | 30 | 60 | 300;
}

export interface ProjectSettings {
  scratchDisk: string;
  renderer: 'WebGL2 GPU' | 'Software Fallback';
  autoSaveEnabled: boolean;
  autoSaveIntervalSec: 0 | 15 | 30 | 60 | 300;
  defaultTransitionSec: number;
  defaultAudioFadeSec: number;
  railPreset: RailPresetId;
}

export interface MonitorOverlaySettings {
  programSafeGuides: boolean;
  programRuleOfThirds: boolean;
  programCenterCross: boolean;
  timecodeBurnIn: boolean;
  sourceOverlay: boolean;
}

export interface SnapOptions {
  markers: boolean;
  editPoints: boolean;
  playhead: boolean;
  beats: boolean;
}

export interface ClipEffectsState {
  enabled: boolean;
  halation: number;
  halationThreshold: number;
  bloom: number;
  bloomRadius: number;
  sharpen: number;
  unsharpMask: number;        // 0..100
  blur: number;               // Gaussian Blur 0..100
  cameraBlur: number;         // Bokeh Camera Blur 0..100
  directionalBlur: number;    // Directional Blur 0..100
  directionalAngle: number;   // 0..360 deg
  chromaticAberration: number;
  vignette: number;
  vignetteFeather: number;
  grainSize: number;
  letterbox: LetterboxAspect;
  speed: number;              // 0.1..8.0
  // Keying & Generate
  invert: boolean;
  ultraKeyEnabled: boolean;
  ultraKeyHex: string;
  ultraKeyTolerance: number;  // 0..100
  ultraKeySpill: number;      // 0..100
  alphaGlow: number;          // 0..100
  alphaGlowHex: string;
  lensFlare: number;          // 0..100
  lensFlareX: number;         // 0..100
  lensFlareY: number;         // 0..100
  lightning: number;          // Advanced Lightning 0..100
  blockDissolve: number;      // 0..100
  // Crop & Reframe
  cropLeft: number;           // 0..45 %
  cropRight: number;          // 0..45 %
  cropTop: number;            // 0..45 %
  cropBottom: number;         // 0..45 %
  autoReframe: AutoReframeMode;
  // Extended Pro Video Effects (GPU Accelerated)
  posterizeTimeFps: number;   // 0 = off, else 1..30 fps
  strobeInterval: number;     // 0 = off, else 1..100
  broadcastSafe: boolean;     // Broadcast Colors legalizer (16-235)
  blackAndWhite: number;      // 0..100 %
  tintAmount: number;         // 0..100 %
  tintHex: string;            // Tint map white hex
  posterizeLevels: number;    // 0 = off, 2..32
  threshold: number;          // 0 = off, 1..100
  colorPassEnabled: boolean;  // Color Pass / Leave Color
  colorPassHex: string;
  colorPassTolerance: number; // 5..100
  changeColorEnabled: boolean; // Color Replace / Change to Color
  changeColorToHex: string;
  emboss: number;             // 0..100 (Emboss / Color Emboss)
  colorEmboss: boolean;
  edgeFeather: number;        // 0..100
  bevelEdges: number;         // 0..100
  radialShadow: number;       // 0..100
  mirrorMode: 0 | 1 | 2 | 3;  // 0=off, 1=Horiz, 2=Vert, 3=Quad
  kaleidoscope: number;       // 0 = off, 3..16 segments
  twirl: number;              // -100..100
  pinchSpherize: number;      // -100 (Pinch) .. +100 (Spherize)
  waveWarp: number;           // 0..100
  ripple: number;             // 0..100
  turbulentDisplace: number;  // 0..100
  zigZag: number;             // 0..100
  lensDistortion: number;     // -100..100
  mosaic: number;             // 0..100 (Mosaic / Pixelate)
  replicate: number;          // 1..6 NxN grid
  offsetX: number;            // -100..100 %
  offsetY: number;            // -100..100 %
  noiseAmount: number;        // 0..100
  rampAmount: number;         // 0..100 (Gradient Ramp)
  rampStartHex: string;
  rampEndHex: string;
  writeOnProgress: number;    // 100 = full, 0..99 animated write-on reveal
  cornerPinSkew: number;      // -50..50
  temporalSmooth: number;     // 0..100 (Temporal Smoothing / Remove Flicker / Median)
  rollingShutterRepair: number; // 0..100
  equalize: number;           // 0..100
}

export type EssentialSoundRole = 'none' | 'dialogue' | 'music' | 'sfx' | 'ambience';
export type AudioChannelMode = 'stereo' | 'mono' | 'fillLeftWithRight' | 'fillRightWithLeft' | 'swapChannels';

export interface ClipAudioEffectsState {
  essentialRole: EssentialSoundRole;
  amplifyDb: number;          // -24 .. +24 dB (Amplify / Gain / Volume)
  deEsser: number;            // 0 .. 100
  dynamicsComp: number;       // 0 .. 100 (Dynamics / Single-band / Multiband / Tube / Vintage)
  compModel: 'clean' | 'multiband' | 'tube' | 'vintage';
  expanderGate: number;       // 0 .. 100 (Expander / Gate)
  hardLimiterDb: number;      // -12 .. 0 dBFS
  lowpassHz: number;          // 200 .. 20000 Hz
  highpassHz: number;         // 20 .. 2000 Hz
  bandpassAmount: number;     // 0 .. 100
  notchHz: number;            // 0 = off, else 50..8000 Hz (Notch / DeHummer)
  deHummer: boolean;          // 50/60 Hz hum removal
  deNoise: number;            // 0 .. 100 (DeNoise / DeClicker / DeCrackler)
  deReverb: number;           // 0 .. 100
  eqLowDb: number;            // -12 .. +12 dB (Bass / 100Hz)
  eqLowMidDb: number;         // -12 .. +12 dB (Graphic EQ 400Hz)
  eqMidDb: number;            // -12 .. +12 dB (Parametric EQ 1.2kHz)
  eqHighMidDb: number;        // -12 .. +12 dB (Graphic EQ 3.5kHz)
  eqHighDb: number;           // -12 .. +12 dB (Treble / 8kHz)
  pitchCents: number;         // -1200 .. +1200 cents
  delayMix: number;           // 0 .. 100 (Delay / Analog Delay)
  delayTimeMs: number;        // 40 .. 1000 ms
  analogDelayWarmth: boolean;
  chorus: number;             // 0 .. 100
  flanger: number;            // 0 .. 100
  phaser: number;             // 0 .. 100
  studioReverb: number;       // 0 .. 100 %
  surroundReverb: number;     // 0 .. 100 %
  convolutionReverb: number;  // 0 .. 100 %
  ambisonicsAzimuth: number;  // -180 .. +180 deg
  stereoExpander: number;     // 0 .. 200 %
  balance: number;            // -100 .. +100
  channelMode: AudioChannelMode;
  masteringBoost: number;     // 0 .. 100
  fadeInType: AudioTransitionType;
  fadeOutType: AudioTransitionType;
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
  mode: StabilizationMode;
  engine: StabilizationEngine;
  smoothness: number;
  strength: number;
  autoCropZoom: number;
  rollingShutter: number;
  edgeFeather: number;
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
  beats: number[];
  downbeats: number[];
  transients: number[];
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
  interpretedFps?: number;
  pixelAspect?: number;
  hasAudio: boolean;
  waveform: number[];
  beatAnalysis?: BeatAnalysisResult;
  fileSizeBytes?: number;
  codecInfo?: string;
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
  syncLock: boolean;
  targeted: boolean;
  sourcePatched: boolean;
  visible: boolean;
  gain: number; // Audio Track Mixer gain (0..2)
  pan: number;  // Audio Track Mixer pan (-1..1)
  colorLabel?: ClipColorLabel;
}

export type KeyframeEasing = 'linear' | 'easeInOut' | 'easeIn' | 'easeOut' | 'hold';

export type KeyframeProperty =
  | 'scale'
  | 'positionX'
  | 'positionY'
  | 'rotation'
  | 'opacity'
  | 'exposure'
  | 'blur'
  | 'speed'
  | 'tilt3d'
  | 'swivel3d';

export interface ClipKeyframe {
  id: string;
  time: number;
  value: number;
  easing: KeyframeEasing;
}

export interface ClipTransformState {
  positionX: number; // -100..100 %
  positionY: number; // -100..100 %
  scale: number;     // 5..800 %
  rotation: number;  // -360..360 deg
  opacity: number;   // 0..100 %
  flipX: boolean;
  flipY: boolean;
  swivel3d: number;  // -90..90 deg (Basic 3D Swivel)
  tilt3d: number;    // -90..90 deg (Basic 3D Tilt)
}

export type ClipKind = 'media' | 'adjustment' | 'text' | 'vertical-text' | 'shape' | 'nested' | 'freeze';

export interface TextOverlayProps {
  text: string;
  vertical: boolean;
  fontSize: number;
  color: string;
  bgColor: string;
  bgOpacity: number;
  shapeKind?: 'rectangle' | 'ellipse' | 'pen';
}

export interface TimelineClip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  clipKind: ClipKind;
  start: number;
  sourceIn: number;
  duration: number;
  sourceDuration: number;
  volume: number;
  fadeIn: number;          // Audio fade in (seconds)
  fadeOut: number;         // Audio fade out (seconds)
  videoFadeIn?: number;    // Visual opacity fade in (seconds)
  videoFadeOut?: number;   // Visual opacity fade out (seconds)
  muted: boolean;
  disabled?: boolean;      // Enable / Disable clip without deleting
  linkGroupId?: string;    // Link / Unlink video+audio pairs
  groupId?: string;        // Group / Ungroup multiple clips
  colorLabel?: ClipColorLabel;
  blendMode: BlendMode;
  transform: ClipTransformState;
  keyframes: Partial<Record<KeyframeProperty, ClipKeyframe[]>>;
  mask: ClipMaskState;
  transitionIn: ClipTransition;
  transitionOut: ClipTransition;
  color: ClipColorGrade;
  stabilization: StabilizationState;
  audioEffects: ClipAudioEffectsState;
  textOverlay?: TextOverlayProps;
  nestedClips?: TimelineClip[];
  freezeFrameTime?: number;
  audioOffset?: number;    // J-Cut (<0) / L-Cut (>0) offset in seconds
  renderedProxy?: boolean; // Render and Replace flag
}

export interface CustomEffectPreset {
  id: string;
  name: string;
  createdAt: number;
  color?: Partial<ClipColorGrade>;
  audioEffects?: Partial<ClipAudioEffectsState>;
  blendMode?: BlendMode;
}

export interface TranscriptSegment {
  id: string;
  clipId: string;
  speaker: string;
  startSec: number;
  endSec: number;
  text: string;
  included: boolean;
}

export interface ContentCredentialsState {
  enabled: boolean;
  creator: string;
  organization: string;
  aiToolsUsed: string;
  notes: string;
}

export interface RenderRange {
  id: string;
  start: number;
  end: number;
  renderedAt: number;
}

export interface FifilmProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  sequence: SequenceSettings;
  projectSettings: ProjectSettings;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  markers: TimelineMarker[];
  transcript: TranscriptSegment[];
  credentials: ContentCredentialsState;
  renderRanges: RenderRange[];
  effectPresets: CustomEffectPreset[];
  playhead: number;
  inPoint: number | null;
  outPoint: number | null;
  masterVolume: number;
  masterMuted: boolean;
  selectedClipId: string | null;
}

export interface AudioMeterReading {
  peakLeftDb: number;
  peakRightDb: number;
  lufs: number;
  clipping: boolean;
  lra?: number;
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
  markerType?: MarkerType;
  url?: string;
  notes?: string;
}

export interface SnapGuide {
  time: number;
  kind: 'playhead' | 'clip-edge' | 'marker' | 'sequence' | 'beat' | 'downbeat' | 'transient';
}

export type BeatSnapTarget = 'all' | 'beat' | 'downbeat' | 'transient';
export type ScopeMode = 'parade' | 'waveform' | 'histogram';
export type InspectorTab = 'motion' | 'color' | 'effects' | 'luts' | 'stabilize' | 'audio' | 'scopes';
export type LeftPanelTab = 'none' | 'project' | 'source' | 'effects' | 'markers' | 'text' | 'libraries' | 'info';
export type PlaybackQuality = 'full' | 'half' | 'quarter';

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: number;
  clips: TimelineClip[];
}

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
  fps: number;
  audioFormat: ExportAudioFormat;
  loudnessNormalize: boolean;
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

export function createDefaultSequenceSettings(): SequenceSettings {
  return {
    name: 'Sequence 01',
    width: 1920,
    height: 1080,
    fps: 24,
    sampleRate: 48000,
    colorSpace: 'Rec.709',
    autoScaleMedia: 'fit',
    autoSaveIntervalSec: 30,
  };
}

export function createDefaultProjectSettings(): ProjectSettings {
  return {
    scratchDisk: 'Local App Cache',
    renderer: 'WebGL2 GPU',
    autoSaveEnabled: true,
    autoSaveIntervalSec: 30,
    defaultTransitionSec: 0.5,
    defaultAudioFadeSec: 0.4,
    railPreset: 'editorial',
  };
}

export function createDefaultOverlaySettings(): MonitorOverlaySettings {
  return {
    programSafeGuides: false,
    programRuleOfThirds: false,
    programCenterCross: false,
    timecodeBurnIn: false,
    sourceOverlay: true,
  };
}

export function createDefaultSnapOptions(): SnapOptions {
  return {
    markers: true,
    editPoints: true,
    playhead: true,
    beats: true,
  };
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
    balanceR: 0,
    balanceG: 0,
    balanceB: 0,
    hueShift: 0,
    lightness: 0,
    gamma: 1.0,
    levelsBlack: 0,
    levelsWhite: 100,
    curveLow: 0,
    curveMid: 0,
    curveHigh: 0,
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
    unsharpMask: 0,
    blur: 0,
    cameraBlur: 0,
    directionalBlur: 0,
    directionalAngle: 0,
    chromaticAberration: 0,
    vignette: 0,
    vignetteFeather: 55,
    grainSize: 1.4,
    letterbox: 'none',
    speed: 1.0,
    invert: false,
    ultraKeyEnabled: false,
    ultraKeyHex: '#00b140',
    ultraKeyTolerance: 32,
    ultraKeySpill: 45,
    alphaGlow: 0,
    alphaGlowHex: '#60a5fa',
    lensFlare: 0,
    lensFlareX: 30,
    lensFlareY: 32,
    lightning: 0,
    blockDissolve: 0,
    cropLeft: 0,
    cropRight: 0,
    cropTop: 0,
    cropBottom: 0,
    autoReframe: 'off',
    posterizeTimeFps: 0,
    strobeInterval: 0,
    broadcastSafe: false,
    blackAndWhite: 0,
    tintAmount: 0,
    tintHex: '#f5c28b',
    posterizeLevels: 0,
    threshold: 0,
    colorPassEnabled: false,
    colorPassHex: '#e11d48',
    colorPassTolerance: 28,
    changeColorEnabled: false,
    changeColorToHex: '#38bdf8',
    emboss: 0,
    colorEmboss: false,
    edgeFeather: 0,
    bevelEdges: 0,
    radialShadow: 0,
    mirrorMode: 0,
    kaleidoscope: 0,
    twirl: 0,
    pinchSpherize: 0,
    waveWarp: 0,
    ripple: 0,
    turbulentDisplace: 0,
    zigZag: 0,
    lensDistortion: 0,
    mosaic: 0,
    replicate: 1,
    offsetX: 0,
    offsetY: 0,
    noiseAmount: 0,
    rampAmount: 0,
    rampStartHex: '#080c18',
    rampEndHex: '#3b82f6',
    writeOnProgress: 100,
    cornerPinSkew: 0,
    temporalSmooth: 0,
    rollingShutterRepair: 0,
    equalize: 0,
  };
}

export function createDefaultAudioEffects(): ClipAudioEffectsState {
  return {
    essentialRole: 'none',
    amplifyDb: 0,
    deEsser: 0,
    dynamicsComp: 0,
    compModel: 'clean',
    expanderGate: 0,
    hardLimiterDb: -1.0,
    lowpassHz: 20000,
    highpassHz: 20,
    bandpassAmount: 0,
    notchHz: 0,
    deHummer: false,
    deNoise: 0,
    deReverb: 0,
    eqLowDb: 0,
    eqLowMidDb: 0,
    eqMidDb: 0,
    eqHighMidDb: 0,
    eqHighDb: 0,
    pitchCents: 0,
    delayMix: 0,
    delayTimeMs: 280,
    analogDelayWarmth: false,
    chorus: 0,
    flanger: 0,
    phaser: 0,
    studioReverb: 0,
    surroundReverb: 0,
    convolutionReverb: 0,
    ambisonicsAzimuth: 0,
    stereoExpander: 100,
    balance: 0,
    channelMode: 'stereo',
    masteringBoost: 0,
    fadeInType: 'constantPower',
    fadeOutType: 'constantPower',
  };
}

export function createDefaultMask(): ClipMaskState {
  return {
    mode: 'none',
    invert: false,
    centerX: 50,
    centerY: 50,
    width: 60,
    height: 60,
    feather: 8,
    hslHue: 120,
    hslHueRange: 40,
    hslSatMin: 15,
    hslLumMin: 10,
    lumaMin: 30,
    lumaMax: 100,
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

export function createDefaultTransform(): ClipTransformState {
  return {
    positionX: 0,
    positionY: 0,
    scale: 100,
    rotation: 0,
    opacity: 100,
    flipX: false,
    flipY: false,
    swivel3d: 0,
    tilt3d: 0,
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

export function createDefaultCredentials(): ContentCredentialsState {
  return {
    enabled: true,
    creator: 'Avery',
    organization: 'Fifilm Studio',
    aiToolsUsed: 'None',
    notes: 'Edited and colour graded in Fifilm.',
  };
}
