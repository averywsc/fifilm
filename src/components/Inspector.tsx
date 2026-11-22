import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Diamond,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  GripVertical,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import type {
  AudioChannelMode,
  AudioMeterReading,
  AudioTransitionType,
  AutoReframeMode,
  BlendMode,
  ClipAudioEffectsState,
  ClipEffectsState,
  ClipMaskState,
  ClipTransformState,
  ClipTransition,
  ColorCorrectionState,
  ColorGradingState,
  EssentialSoundRole,
  HardwareCapabilities,
  InspectorTab,
  KeyframeEasing,
  KeyframeProperty,
  LetterboxAspect,
  LutLibraryEntry,
  LutRole,
  LutStackLayer,
  MaskMode,
  ScopeMode,
  StabilizationEngine,
  StabilizationState,
  TextOverlayProps,
  TimelineClip,
  TimelineTrack,
  VideoTransitionType,
} from '../types/editor';
import { AUDIO_TRANSITION_CATALOG, VIDEO_TRANSITION_CATALOG } from '../engine/effectCatalog';
import type { ScopeMetrics } from '../engine/scopes';
import { linearToDbLabel } from '../engine/audioMixer';
import {
  evaluateClipAtLocalTime,
  findAdjacentKeyframeTime,
  findKeyframeNear,
  getAllClipKeyframeTimes,
} from '../engine/keyframes';
import { formatTimecode } from '../engine/timecode';
import { ColorWheel } from './ColorWheel';

interface InspectorProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  clip: TimelineClip | null;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  playhead: number;
  fps: number;
  onSeekPlayhead: (timeSec: number) => void;
  onUpdateTransform: (patch: Partial<ClipTransformState>) => void;
  onResetTransform: () => void;
  onScaleToFrameSize: (mode: 'fit' | 'fill') => void;
  onUpdateBlendMode: (mode: BlendMode) => void;
  onUpdateMask: (patch: Partial<ClipMaskState>) => void;
  onUpdateTransition: (side: 'in' | 'out', patch: Partial<ClipTransition>) => void;
  onUpdateTextOverlay: (patch: Partial<TextOverlayProps>) => void;
  onToggleKeyframe: (prop: KeyframeProperty, easing: KeyframeEasing) => void;
  onClearClipKeyframes: () => void;
  lutLibrary: LutLibraryEntry[];
  lutLibraryLoading: boolean;
  onRefreshLuts: () => void;
  capabilities: HardwareCapabilities | null;
  scopeMode: ScopeMode;
  onScopeModeChange: (m: ScopeMode) => void;
  scopeCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  scopeMetrics: ScopeMetrics;
  audioMeters: AudioMeterReading;
  masterVolume: number;
  masterMuted: boolean;
  onMasterVolumeChange: (vol: number) => void;
  onMasterMutedChange: (muted: boolean) => void;
  onUpdateClipAudio: (patch: {
    volume?: number;
    fadeIn?: number;
    fadeOut?: number;
    videoFadeIn?: number;
    videoFadeOut?: number;
    muted?: boolean;
    audioOffset?: number;
  }) => void;
  onUpdateAnyClipVolume: (clipId: string, volume: number) => void;
  onAutoMixAudio: () => void;
  onUpdateAudioEffects: (patch: Partial<ClipAudioEffectsState>) => void;
  onApplyEssentialSound: (role: EssentialSoundRole) => void;
  onUpdateTrackMixer: (trackId: string, patch: { gain?: number; pan?: number }) => void;
  onNormalizeClipAudio: () => void;
  splitEnabled: boolean;
  onSplitEnabledChange: (enabled: boolean) => void;
  onCompareStart: () => void;
  onCompareEnd: () => void;
  onUpdateCorrection: (patch: Partial<ColorCorrectionState>) => void;
  onResetCorrection: () => void;
  onUpdateGrading: (patch: Partial<ColorGradingState>) => void;
  onResetGrading: () => void;
  onUpdateEffects: (patch: Partial<ClipEffectsState>) => void;
  onResetEffects: () => void;
  onAddLutToStack: (entry: LutLibraryEntry) => void;
  onUpdateLutLayer: (instanceId: string, patch: Partial<LutStackLayer>) => void;
  onRemoveLutLayer: (instanceId: string) => void;
  onReorderLutStack: (fromIdx: number, toIdx: number) => void;
  onSetLutInterpolation: (mode: 'tetrahedral' | 'trilinear') => void;
  onSaveGradeAsLut: (name: string) => Promise<void>;
  onUpdateStabilization: (patch: Partial<StabilizationState>) => void;
  onAnalyzeStabilize: () => void;
}

const CORRECTION_SLIDERS: Array<{
  key: keyof ColorCorrectionState;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}> = [
  { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}` },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'balanceR', label: 'Red Balance', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'balanceG', label: 'Green Balance', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'balanceB', label: 'Blue Balance', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'hueShift', label: 'HLS Hue', min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
  { key: 'lightness', label: 'HLS Lightness', min: -100, max: 100, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'gamma', label: 'Gamma', min: 0.25, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'levelsBlack', label: 'Levels Black', min: 0, max: 45, step: 1, fmt: (v) => `${v}%` },
  { key: 'levelsWhite', label: 'Levels White', min: 55, max: 100, step: 1, fmt: (v) => `${v}%` },
  { key: 'curveLow', label: 'Curve Low', min: -50, max: 50, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'curveMid', label: 'Curve Mid', min: -50, max: 50, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
  { key: 'curveHigh', label: 'Curve High', min: -50, max: 50, step: 1, fmt: (v) => `${v >= 0 ? '+' : ''}${v}` },
];

const BLEND_MODES: Array<{ id: BlendMode; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'screen', label: 'Screen' },
  { id: 'difference', label: 'Difference' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'add', label: 'Add (Linear Dodge)' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'darken', label: 'Darken' },
  { id: 'softLight', label: 'Soft Light' },
  { id: 'hardLight', label: 'Hard Light' },
  { id: 'exclusion', label: 'Exclusion' },
];

const VIDEO_TRANSITIONS: Array<{ id: VideoTransitionType; label: string }> = [
  { id: 'none', label: 'None' },
  ...VIDEO_TRANSITION_CATALOG.map((t) => ({ id: t.id, label: t.name })),
];

const EFFECT_PRESETS: Array<{
  name: string;
  desc: string;
  patch: Partial<ClipEffectsState>;
  grain?: number;
}> = [
  {
    name: '35mm Halation',
    desc: 'Warm highlight halo, fine grain',
    patch: { enabled: true, halation: 58, halationThreshold: 68, bloom: 22, bloomRadius: 4, vignette: 24, sharpen: 10 },
    grain: 24,
  },
  {
    name: 'Black Pro-Mist 1/4',
    desc: 'Silky optical highlight bloom',
    patch: { enabled: true, bloom: 62, bloomRadius: 6, halation: 14, sharpen: 0, vignette: 16 },
  },
  {
    name: 'Anamorphic Flare',
    desc: '2.39:1 matte, streak flare, fringe',
    patch: { enabled: true, letterbox: '2.39', chromaticAberration: 26, lensFlare: 48, bloom: 26, vignette: 28 },
  },
  {
    name: 'Electric Surge',
    desc: 'Advanced lightning + alpha glow',
    patch: { enabled: true, lightning: 72, alphaGlow: 42, chromaticAberration: 30 },
  },
];

export const Inspector: React.FC<InspectorProps> = ({
  activeTab,
  onTabChange,
  clip,
  clips,
  tracks,
  playhead,
  fps,
  onSeekPlayhead,
  onUpdateTransform,
  onResetTransform,
  onScaleToFrameSize,
  onUpdateBlendMode,
  onUpdateMask,
  onUpdateTransition,
  onUpdateTextOverlay,
  onToggleKeyframe,
  onClearClipKeyframes,
  lutLibrary,
  lutLibraryLoading,
  onRefreshLuts,
  capabilities,
  scopeMode,
  onScopeModeChange,
  scopeCanvasRef,
  scopeMetrics,
  audioMeters,
  masterVolume,
  masterMuted,
  onMasterVolumeChange,
  onMasterMutedChange,
  onUpdateClipAudio,
  onUpdateAnyClipVolume,
  onAutoMixAudio,
  onUpdateAudioEffects,
  onApplyEssentialSound,
  onUpdateTrackMixer,
  onNormalizeClipAudio,
  splitEnabled,
  onSplitEnabledChange,
  onCompareStart,
  onCompareEnd,
  onUpdateCorrection,
  onResetCorrection,
  onUpdateGrading,
  onResetGrading,
  onUpdateEffects,
  onResetEffects,
  onAddLutToStack,
  onUpdateLutLayer,
  onRemoveLutLayer,
  onReorderLutStack,
  onSetLutInterpolation,
  onSaveGradeAsLut,
  onUpdateStabilization,
  onAnalyzeStabilize,
}) => {
  const [wheelZone, setWheelZone] = useState<'lift' | 'gamma' | 'gain'>('lift');
  const [kfEasing, setKfEasing] = useState<KeyframeEasing>('easeInOut');
  const [lutQuery, setLutQuery] = useState('');
  const [lutPackFilter, setLutPackFilter] = useState('All');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saveLutName, setSaveLutName] = useState('Fifilm - Custom Look');
  const [saveMsg, setSaveMsg] = useState('');

  const clipLocalTime = clip ? Math.max(0, Math.min(clip.duration, playhead - clip.start)) : 0;
  const evaluated = clip ? evaluateClipAtLocalTime(clip, clipLocalTime) : null;
  const allKfTimes = clip ? getAllClipKeyframeTimes(clip) : [];
  const prevKfLocal = clip ? findAdjacentKeyframeTime(clip, clipLocalTime, -1) : null;
  const nextKfLocal = clip ? findAdjacentKeyframeTime(clip, clipLocalTime, 1) : null;

  const renderKfButton = (prop: KeyframeProperty) => {
    if (!clip) return null;
    const list = clip.keyframes?.[prop];
    const hasAny = !!list && list.length > 0;
    const isOn = !!findKeyframeNear(list, clipLocalTime);
    return (
      <button
        type="button"
        className={`kf-btn ${isOn ? 'on' : hasAny ? 'has-any' : ''}`}
        title={isOn ? `Remove ${prop} keyframe` : `Add ${prop} keyframe at playhead`}
        onClick={() => onToggleKeyframe(prop, kfEasing)}
      >
        <Diamond size={11} fill={isOn ? 'currentColor' : 'none'} />
      </button>
    );
  };

  const packs = useMemo(() => {
    const s = new Set<string>(['All']);
    for (const item of lutLibrary) s.add(item.pack);
    return Array.from(s);
  }, [lutLibrary]);

  const filteredLuts = useMemo(() => {
    const q = lutQuery.trim().toLowerCase();
    return lutLibrary.filter((item) => {
      if (lutPackFilter !== 'All' && item.pack !== lutPackFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.pack.toLowerCase().includes(q) ||
        item.fileName.toLowerCase().includes(q)
      );
    });
  }, [lutLibrary, lutQuery, lutPackFilter]);

  const handleSaveLook = async () => {
    if (!saveLutName.trim()) return;
    setSaveMsg('Baking 33³ .cube...');
    try {
      await onSaveGradeAsLut(saveLutName.trim());
      setSaveMsg('Saved to colorstudies/luts');
      setTimeout(() => setSaveMsg(''), 3500);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <aside className="inspector">
      <div className="inspector-tabs" role="tablist">
        {(['motion', 'color', 'effects', 'luts', 'stabilize', 'audio', 'scopes'] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => onTabChange(tab)}
          >
            {tab === 'motion'
              ? 'Motion'
              : tab === 'color'
                ? 'Color'
                : tab === 'effects'
                  ? 'FX'
                  : tab === 'luts'
                    ? `LUT${clip && clip.color.lutStack.length ? ` ${clip.color.lutStack.length}` : 's'}`
                    : tab === 'stabilize'
                      ? 'Stab'
                      : tab === 'audio'
                        ? 'Audio'
                        : 'Scopes'}
          </button>
        ))}
      </div>

      <div className="inspector-body">
        {!clip && activeTab !== 'scopes' && activeTab !== 'audio' ? (
          <p className="status-note">Select a clip on the timeline to inspect and edit it.</p>
        ) : null}

        {/* MOTION, BLEND MODES, BASIC 3D, CROP, MASKS & KEYFRAMES */}
        {activeTab === 'motion' && clip && evaluated && (
          <>
            {clip.textOverlay && (
              <>
                <div className="section-header">
                  <span>{clip.textOverlay.shapeKind ? 'Vector Shape' : clip.textOverlay.vertical ? 'Vertical Type' : 'Title Text'}</span>
                </div>
                {!clip.textOverlay.shapeKind && (
                  <textarea
                    rows={2}
                    value={clip.textOverlay.text}
                    onChange={(e) => onUpdateTextOverlay({ text: e.target.value })}
                    style={{
                      width: '100%',
                      background: 'var(--bg)',
                      color: 'var(--ink)',
                      border: 'none',
                      borderRadius: 6,
                      padding: 8,
                      fontSize: 12,
                      fontFamily: 'var(--font-ui)',
                      marginBottom: 8,
                    }}
                  />
                )}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mute)' }}>
                    Color
                    <input
                      type="color"
                      value={clip.textOverlay.color}
                      onChange={(e) => onUpdateTextOverlay({ color: e.target.value })}
                    />
                  </label>
                  {!clip.textOverlay.shapeKind && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mute)' }}>
                      Size
                      <input
                        type="number"
                        min={16}
                        max={220}
                        value={clip.textOverlay.fontSize}
                        onChange={(e) => onUpdateTextOverlay({ fontSize: Number(e.target.value) })}
                        style={{ width: 64 }}
                      />
                    </label>
                  )}
                </div>
              </>
            )}

            <div className="section-header">
              <span>Blend & Compositing</span>
              <button type="button" className="subtle ghost-sm" onClick={onResetTransform}>
                Reset
              </button>
            </div>

            <div className="slider-row" style={{ gridTemplateColumns: '86px 1fr' }}>
              <span className="slider-label">Blend Mode</span>
              <select
                value={clip.blendMode}
                onChange={(e) => onUpdateBlendMode(e.target.value as BlendMode)}
              >
                {BLEND_MODES.map((bm) => (
                  <option key={bm.id} value={bm.id}>
                    {bm.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="slider-row kf">
              <span className="slider-label">Opacity</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(evaluated.transform.opacity)}
                onChange={(e) => onUpdateTransform({ opacity: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ opacity: 100 })}>
                {Math.round(evaluated.transform.opacity)}%
              </span>
              {renderKfButton('opacity')}
            </div>

            <div className="section-header">
              <span>Motion & Basic 3D</span>
            </div>

            <div className="slider-row kf">
              <span className="slider-label">Scale</span>
              <input
                type="range"
                min={10}
                max={400}
                step={1}
                value={Math.round(evaluated.transform.scale)}
                onChange={(e) => onUpdateTransform({ scale: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ scale: 100 })}>
                {Math.round(evaluated.transform.scale)}%
              </span>
              {renderKfButton('scale')}
            </div>

            <div className="slider-row kf">
              <span className="slider-label">Rotation</span>
              <input
                type="range"
                min={-360}
                max={360}
                step={0.5}
                value={Number(evaluated.transform.rotation.toFixed(1))}
                onChange={(e) => onUpdateTransform({ rotation: parseFloat(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ rotation: 0 })}>
                {evaluated.transform.rotation.toFixed(1)}°
              </span>
              {renderKfButton('rotation')}
            </div>

            <div className="slider-row kf">
              <span className="slider-label">Position X</span>
              <input
                type="range"
                min={-100}
                max={100}
                step={0.5}
                value={Number(evaluated.transform.positionX.toFixed(1))}
                onChange={(e) => onUpdateTransform({ positionX: parseFloat(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ positionX: 0 })}>
                {evaluated.transform.positionX >= 0 ? '+' : ''}
                {evaluated.transform.positionX.toFixed(1)}%
              </span>
              {renderKfButton('positionX')}
            </div>

            <div className="slider-row kf">
              <span className="slider-label">Position Y</span>
              <input
                type="range"
                min={-100}
                max={100}
                step={0.5}
                value={Number(evaluated.transform.positionY.toFixed(1))}
                onChange={(e) => onUpdateTransform({ positionY: parseFloat(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ positionY: 0 })}>
                {evaluated.transform.positionY >= 0 ? '+' : ''}
                {evaluated.transform.positionY.toFixed(1)}%
              </span>
              {renderKfButton('positionY')}
            </div>

            <div className="slider-row kf">
              <span className="slider-label">3D Swivel</span>
              <input
                type="range"
                min={-65}
                max={65}
                step={0.5}
                value={Number((evaluated.transform.swivel3d ?? 0).toFixed(1))}
                onChange={(e) => onUpdateTransform({ swivel3d: parseFloat(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ swivel3d: 0 })}>
                {(evaluated.transform.swivel3d ?? 0).toFixed(1)}°
              </span>
              {renderKfButton('swivel3d')}
            </div>

            <div className="slider-row kf">
              <span className="slider-label">3D Tilt</span>
              <input
                type="range"
                min={-65}
                max={65}
                step={0.5}
                value={Number((evaluated.transform.tilt3d ?? 0).toFixed(1))}
                onChange={(e) => onUpdateTransform({ tilt3d: parseFloat(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateTransform({ tilt3d: 0 })}>
                {(evaluated.transform.tilt3d ?? 0).toFixed(1)}°
              </span>
              {renderKfButton('tilt3d')}
            </div>

            <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
              <button
                type="button"
                style={{ flex: 1 }}
                className={clip.transform.flipX ? 'active' : ''}
                onClick={() => onUpdateTransform({ flipX: !clip.transform.flipX })}
              >
                <FlipHorizontal2 size={13} />
                Flip H
              </button>
              <button
                type="button"
                style={{ flex: 1 }}
                className={clip.transform.flipY ? 'active' : ''}
                onClick={() => onUpdateTransform({ flipY: !clip.transform.flipY })}
              >
                <FlipVertical2 size={13} />
                Flip V
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button type="button" className="ghost-sm" style={{ flex: 1 }} onClick={() => onScaleToFrameSize('fit')}>
                Set to Frame Size
              </button>
              <button type="button" className="ghost-sm" style={{ flex: 1 }} onClick={() => onScaleToFrameSize('fill')}>
                Scale to Fill
              </button>
            </div>

            <div className="section-header">
              <span>Easy Clip Opacity Fades</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Video Fade In</span>
              <input
                type="range"
                min={0}
                max={5}
                step={0.05}
                value={clip.videoFadeIn ?? 0}
                onChange={(e) => onUpdateClipAudio({ videoFadeIn: parseFloat(e.target.value) })}
              />
              <span className="slider-val">{(clip.videoFadeIn ?? 0).toFixed(2)}s</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Video Fade Out</span>
              <input
                type="range"
                min={0}
                max={5}
                step={0.05}
                value={clip.videoFadeOut ?? 0}
                onChange={(e) => onUpdateClipAudio({ videoFadeOut: parseFloat(e.target.value) })}
              />
              <span className="slider-val">{(clip.videoFadeOut ?? 0).toFixed(2)}s</span>
            </div>

            <div className="section-header">
              <span>Crop & Auto Reframe</span>
            </div>
            <div className="seg-group">
              {(['off', '16:9', '9:16', '1:1', '4:5'] as AutoReframeMode[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={clip.color.effects.autoReframe === r ? 'active' : ''}
                  onClick={() => onUpdateEffects({ autoReframe: r })}
                >
                  {r === 'off' ? 'Off' : r}
                </button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {(['cropLeft', 'cropRight', 'cropTop', 'cropBottom'] as const).map((k) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mute)' }}>
                  <span style={{ width: 22 }}>{k.replace('crop', '')[0]}</span>
                  <input
                    type="range"
                    min={0}
                    max={45}
                    value={clip.color.effects[k]}
                    onChange={(e) => onUpdateEffects({ [k]: Number(e.target.value) })}
                  />
                  <span className="mono" style={{ width: 26, textAlign: 'right' }}>{clip.color.effects[k]}%</span>
                </label>
              ))}
            </div>

            <div className="section-header">
              <span>Masks (Shape, HSL, Luminance)</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                <input
                  type="checkbox"
                  checked={clip.mask.invert}
                  onChange={(e) => onUpdateMask({ invert: e.target.checked })}
                />
                Invert
              </label>
            </div>

            <div className="seg-group">
              {(['none', 'rectangle', 'ellipse', 'pen', 'hsl', 'luminance'] as MaskMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  style={{ fontSize: 10, padding: '4px 2px' }}
                  className={clip.mask.mode === m ? 'active' : ''}
                  onClick={() => onUpdateMask({ mode: m })}
                >
                  {m === 'none'
                    ? 'Off'
                    : m === 'rectangle'
                      ? 'Rect'
                      : m === 'ellipse'
                        ? 'Oval'
                        : m === 'pen'
                          ? 'Pen'
                          : m === 'hsl'
                            ? 'HSL'
                            : 'Luma'}
                </button>
              ))}
            </div>

            {clip.mask.mode !== 'none' && (
              <>
                {(clip.mask.mode === 'rectangle' || clip.mask.mode === 'ellipse' || clip.mask.mode === 'pen') && (
                  <>
                    <div className="slider-row">
                      <span className="slider-label">Mask Width</span>
                      <input type="range" min={5} max={100} value={clip.mask.width} onChange={(e) => onUpdateMask({ width: Number(e.target.value) })} />
                      <span className="slider-val">{clip.mask.width}%</span>
                    </div>
                    <div className="slider-row">
                      <span className="slider-label">Mask Height</span>
                      <input type="range" min={5} max={100} value={clip.mask.height} onChange={(e) => onUpdateMask({ height: Number(e.target.value) })} />
                      <span className="slider-val">{clip.mask.height}%</span>
                    </div>
                  </>
                )}
                {clip.mask.mode === 'hsl' && (
                  <>
                    <div className="slider-row">
                      <span className="slider-label">Key Hue</span>
                      <input type="range" min={0} max={360} value={clip.mask.hslHue} onChange={(e) => onUpdateMask({ hslHue: Number(e.target.value) })} />
                      <span className="slider-val">{clip.mask.hslHue}°</span>
                    </div>
                    <div className="slider-row">
                      <span className="slider-label">Hue Range</span>
                      <input type="range" min={5} max={180} value={clip.mask.hslHueRange} onChange={(e) => onUpdateMask({ hslHueRange: Number(e.target.value) })} />
                      <span className="slider-val">{clip.mask.hslHueRange}°</span>
                    </div>
                  </>
                )}
                {clip.mask.mode === 'luminance' && (
                  <>
                    <div className="slider-row">
                      <span className="slider-label">Luma Min</span>
                      <input type="range" min={0} max={100} value={clip.mask.lumaMin} onChange={(e) => onUpdateMask({ lumaMin: Number(e.target.value) })} />
                      <span className="slider-val">{clip.mask.lumaMin}%</span>
                    </div>
                    <div className="slider-row">
                      <span className="slider-label">Luma Max</span>
                      <input type="range" min={0} max={100} value={clip.mask.lumaMax} onChange={(e) => onUpdateMask({ lumaMax: Number(e.target.value) })} />
                      <span className="slider-val">{clip.mask.lumaMax}%</span>
                    </div>
                  </>
                )}
                <div className="slider-row">
                  <span className="slider-label">Feather</span>
                  <input type="range" min={0} max={50} value={clip.mask.feather} onChange={(e) => onUpdateMask({ feather: Number(e.target.value) })} />
                  <span className="slider-val">{clip.mask.feather}%</span>
                </div>
              </>
            )}

            <div className="section-header">
              <span>Keyframes ({allKfTimes.length})</span>
              {allKfTimes.length > 0 && (
                <button type="button" className="subtle ghost-sm" onClick={onClearClipKeyframes}>
                  Clear All
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
              <button
                type="button"
                className="ghost-sm"
                disabled={prevKfLocal === null}
                onClick={() => prevKfLocal !== null && onSeekPlayhead(clip.start + prevKfLocal)}
              >
                <ChevronLeft size={13} /> Prev
              </button>
              <span className="mono" style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--mute)' }}>
                {formatTimecode(clipLocalTime, fps)}
              </span>
              <button
                type="button"
                className="ghost-sm"
                disabled={nextKfLocal === null}
                onClick={() => nextKfLocal !== null && onSeekPlayhead(clip.start + nextKfLocal)}
              >
                Next <ChevronRight size={13} />
              </button>
            </div>

            <div className="slider-row" style={{ gridTemplateColumns: '86px 1fr' }}>
              <span className="slider-label">Easing</span>
              <select value={kfEasing} onChange={(e) => setKfEasing(e.target.value as KeyframeEasing)}>
                <option value="easeInOut">Ease In / Out</option>
                <option value="linear">Linear</option>
                <option value="easeIn">Ease In</option>
                <option value="easeOut">Ease Out</option>
                <option value="hold">Hold</option>
              </select>
            </div>
          </>
        )}

        {/* COLOR CORRECTION + BALANCE + HLS + WHEELS */}
        {activeTab === 'color' && clip && (
          <>
            <div className="section-header">
              <span>Primary, Color Balance & HLS</span>
              <button type="button" className="subtle ghost-sm" onClick={onResetCorrection}>
                Reset
              </button>
            </div>

            {CORRECTION_SLIDERS.map((s) => {
              const isExp = s.key === 'exposure';
              const val = isExp && evaluated ? evaluated.exposure : (clip.color.correction[s.key] ?? 0);
              return (
                <div className={isExp ? 'slider-row kf' : 'slider-row'} key={s.key}>
                  <span className="slider-label">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={val}
                    onChange={(e) =>
                      onUpdateCorrection({ [s.key]: parseFloat(e.target.value) } as Partial<ColorCorrectionState>)
                    }
                  />
                  <span
                    className="slider-val"
                    onDoubleClick={() =>
                      onUpdateCorrection({ [s.key]: 0 } as Partial<ColorCorrectionState>)
                    }
                  >
                    {s.fmt(val)}
                  </span>
                  {isExp && renderKfButton('exposure')}
                </div>
              );
            })}

            <div className="section-header">
              <span>Lift / Gamma / Gain Wheels</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                  <input
                    type="checkbox"
                    checked={clip.color.grading.enabled}
                    onChange={(e) => onUpdateGrading({ enabled: e.target.checked })}
                  />
                  On
                </label>
                <button type="button" className="subtle ghost-sm" onClick={onResetGrading}>
                  Reset
                </button>
              </div>
            </div>

            <div className="seg-group">
              {(['lift', 'gamma', 'gain'] as const).map((z) => (
                <button key={z} type="button" className={wheelZone === z ? 'active' : ''} onClick={() => setWheelZone(z)}>
                  {z === 'lift' ? 'Lift' : z === 'gamma' ? 'Gamma' : 'Gain'}
                </button>
              ))}
            </div>

            <ColorWheel
              label={wheelZone === 'lift' ? 'Lift' : wheelZone === 'gamma' ? 'Gamma' : 'Gain'}
              value={clip.color.grading[wheelZone]}
              onChange={(next) => onUpdateGrading({ [wheelZone]: next } as Partial<ColorGradingState>)}
            />

            <div className="section-header">
              <span>Split Toning & Film Curve</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Split Amount</span>
              <input type="range" min={0} max={100} value={clip.color.grading.splitAmount} onChange={(e) => onUpdateGrading({ splitAmount: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.grading.splitAmount}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', margin: '6px 0' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mute)' }}>
                Shadows <input type="color" value={clip.color.grading.splitShadowHex} onChange={(e) => onUpdateGrading({ splitShadowHex: e.target.value })} />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--mute)' }}>
                Highlights <input type="color" value={clip.color.grading.splitHighlightHex} onChange={(e) => onUpdateGrading({ splitHighlightHex: e.target.value })} />
              </label>
            </div>
            <div className="slider-row">
              <span className="slider-label">Shoulder</span>
              <input type="range" min={0} max={100} value={clip.color.grading.filmicShoulder} onChange={(e) => onUpdateGrading({ filmicShoulder: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.grading.filmicShoulder}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Matte Lift</span>
              <input type="range" min={0} max={100} value={clip.color.grading.matteLift} onChange={(e) => onUpdateGrading({ matteLift: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.grading.matteLift}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Film Grain</span>
              <input type="range" min={0} max={100} value={clip.color.grading.grain} onChange={(e) => onUpdateGrading({ grain: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.grading.grain}%</span>
            </div>
          </>
        )}

        {/* GPU VIDEO EFFECTS, TRANSITIONS & TIME REMAPPING */}
        {activeTab === 'effects' && clip && (
          <>
            <div className="section-header">
              <span>Effect Presets</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                  <input type="checkbox" checked={clip.color.effects.enabled} onChange={(e) => onUpdateEffects({ enabled: e.target.checked })} />
                  Active
                </label>
                <button type="button" className="subtle ghost-sm" onClick={onResetEffects}>
                  Reset
                </button>
              </div>
            </div>

            <div className="preset-grid">
              {EFFECT_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className="preset-card"
                  onClick={() => {
                    onUpdateEffects(p.patch);
                    if (p.grain !== undefined) onUpdateGrading({ grain: p.grain });
                  }}
                >
                  <strong style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Sparkles size={11} /> {p.name}
                  </strong>
                  <span>{p.desc}</span>
                </button>
              ))}
            </div>

            <div className="section-header">
              <span>Video Transitions (In / Out)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px', gap: 6, marginBottom: 6 }}>
              <select
                value={clip.transitionIn.type}
                onChange={(e) => onUpdateTransition('in', { type: e.target.value as VideoTransitionType })}
              >
                {VIDEO_TRANSITIONS.map((t) => (
                  <option key={t.id} value={t.id}>In: {t.label}</option>
                ))}
              </select>
              <input
                type="number"
                min={0.1}
                max={4}
                step={0.1}
                value={clip.transitionIn.duration}
                onChange={(e) => onUpdateTransition('in', { duration: Math.max(0.1, Number(e.target.value)) })}
                title="In transition duration (sec)"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 62px', gap: 6, marginBottom: 8 }}>
              <select
                value={clip.transitionOut.type}
                onChange={(e) => onUpdateTransition('out', { type: e.target.value as VideoTransitionType })}
              >
                {VIDEO_TRANSITIONS.map((t) => (
                  <option key={t.id} value={t.id}>Out: {t.label}</option>
                ))}
              </select>
              <input
                type="number"
                min={0.1}
                max={4}
                step={0.1}
                value={clip.transitionOut.duration}
                onChange={(e) => onUpdateTransition('out', { duration: Math.max(0.1, Number(e.target.value)) })}
                title="Out transition duration (sec)"
              />
            </div>

            <div className="section-header">
              <span>Speed / Time Remapping</span>
            </div>
            <div className="slider-row kf">
              <span className="slider-label">Speed</span>
              <input
                type="range"
                min={0.1}
                max={6}
                step={0.05}
                value={Number((evaluated?.speed ?? clip.color.effects.speed).toFixed(2))}
                onChange={(e) => onUpdateEffects({ speed: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ speed: 1 })}>
                {(evaluated?.speed ?? clip.color.effects.speed).toFixed(2)}x
              </span>
              {renderKfButton('speed')}
            </div>

            <div className="section-header">
              <span>Blur, Optics & Film</span>
            </div>
            <div className="slider-row kf">
              <span className="slider-label">Gaussian Blur</span>
              <input type="range" min={0} max={100} value={Math.round(evaluated ? evaluated.blur : clip.color.effects.blur)} onChange={(e) => onUpdateEffects({ blur: Number(e.target.value) })} />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ blur: 0 })}>{Math.round(evaluated ? evaluated.blur : clip.color.effects.blur)}%</span>
              {renderKfButton('blur')}
            </div>
            <div className="slider-row">
              <span className="slider-label">Camera Blur</span>
              <input type="range" min={0} max={100} value={clip.color.effects.cameraBlur} onChange={(e) => onUpdateEffects({ cameraBlur: Number(e.target.value) })} />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ cameraBlur: 0 })}>{clip.color.effects.cameraBlur}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Dir. Blur</span>
              <input type="range" min={0} max={100} value={clip.color.effects.directionalBlur} onChange={(e) => onUpdateEffects({ directionalBlur: Number(e.target.value) })} />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ directionalBlur: 0 })}>{clip.color.effects.directionalBlur}%</span>
            </div>
            {clip.color.effects.directionalBlur > 0 && (
              <div className="slider-row">
                <span className="slider-label">Blur Angle</span>
                <input type="range" min={0} max={360} value={clip.color.effects.directionalAngle} onChange={(e) => onUpdateEffects({ directionalAngle: Number(e.target.value) })} />
                <span className="slider-val">{clip.color.effects.directionalAngle}°</span>
              </div>
            )}
            <div className="slider-row">
              <span className="slider-label">Sharpen</span>
              <input type="range" min={0} max={100} value={clip.color.effects.sharpen} onChange={(e) => onUpdateEffects({ sharpen: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.sharpen}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Film Halation</span>
              <input type="range" min={0} max={100} value={clip.color.effects.halation} onChange={(e) => onUpdateEffects({ halation: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.halation}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Pro-Mist Bloom</span>
              <input type="range" min={0} max={100} value={clip.color.effects.bloom} onChange={(e) => onUpdateEffects({ bloom: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.bloom}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Chromatic Ab.</span>
              <input type="range" min={0} max={100} value={clip.color.effects.chromaticAberration} onChange={(e) => onUpdateEffects({ chromaticAberration: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.chromaticAberration}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Vignette</span>
              <input type="range" min={0} max={100} value={clip.color.effects.vignette} onChange={(e) => onUpdateEffects({ vignette: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.vignette}%</span>
            </div>

            <div className="section-header">
              <span>Keying, Generate & Stylize</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                <input type="checkbox" checked={clip.color.effects.invert} onChange={(e) => onUpdateEffects({ invert: e.target.checked })} />
                Invert
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink)' }}>
                <input type="checkbox" checked={clip.color.effects.ultraKeyEnabled} onChange={(e) => onUpdateEffects({ ultraKeyEnabled: e.target.checked })} />
                Ultra Key (Chroma)
              </label>
              <input type="color" value={clip.color.effects.ultraKeyHex} onChange={(e) => onUpdateEffects({ ultraKeyHex: e.target.value })} />
            </div>
            {clip.color.effects.ultraKeyEnabled && (
              <>
                <div className="slider-row">
                  <span className="slider-label">Key Tolerance</span>
                  <input type="range" min={5} max={90} value={clip.color.effects.ultraKeyTolerance} onChange={(e) => onUpdateEffects({ ultraKeyTolerance: Number(e.target.value) })} />
                  <span className="slider-val">{clip.color.effects.ultraKeyTolerance}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Spill Suppress</span>
                  <input type="range" min={0} max={100} value={clip.color.effects.ultraKeySpill} onChange={(e) => onUpdateEffects({ ultraKeySpill: Number(e.target.value) })} />
                  <span className="slider-val">{clip.color.effects.ultraKeySpill}%</span>
                </div>
              </>
            )}
            <div className="slider-row">
              <span className="slider-label">Lens Flare</span>
              <input type="range" min={0} max={100} value={clip.color.effects.lensFlare} onChange={(e) => onUpdateEffects({ lensFlare: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.lensFlare}%</span>
            </div>
            {clip.color.effects.lensFlare > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mute)' }}>
                  X <input type="range" min={0} max={100} value={clip.color.effects.lensFlareX} onChange={(e) => onUpdateEffects({ lensFlareX: Number(e.target.value) })} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mute)' }}>
                  Y <input type="range" min={0} max={100} value={clip.color.effects.lensFlareY} onChange={(e) => onUpdateEffects({ lensFlareY: Number(e.target.value) })} />
                </label>
              </div>
            )}
            <div className="slider-row">
              <span className="slider-label">Adv. Lightning</span>
              <input type="range" min={0} max={100} value={clip.color.effects.lightning} onChange={(e) => onUpdateEffects({ lightning: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.lightning}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Alpha Glow</span>
              <input type="range" min={0} max={100} value={clip.color.effects.alphaGlow} onChange={(e) => onUpdateEffects({ alphaGlow: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.alphaGlow}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Block Dissolve</span>
              <input type="range" min={0} max={100} value={clip.color.effects.blockDissolve} onChange={(e) => onUpdateEffects({ blockDissolve: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.blockDissolve}%</span>
            </div>

            <div className="section-header">
              <span>Distort, Warp &amp; Stylize</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--mute)' }}>
                <input
                  type="checkbox"
                  checked={clip.color.effects.broadcastSafe}
                  onChange={(e) => onUpdateEffects({ broadcastSafe: e.target.checked })}
                />
                Broadcast Safe
              </label>
            </div>
            <div className="slider-row">
              <span className="slider-label">Black &amp; White</span>
              <input type="range" min={0} max={100} value={clip.color.effects.blackAndWhite} onChange={(e) => onUpdateEffects({ blackAndWhite: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.blackAndWhite}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Tint</span>
              <input type="range" min={0} max={100} value={clip.color.effects.tintAmount} onChange={(e) => onUpdateEffects({ tintAmount: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.tintAmount}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Posterize</span>
              <input type="range" min={0} max={24} value={clip.color.effects.posterizeLevels} onChange={(e) => onUpdateEffects({ posterizeLevels: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.posterizeLevels || 'Off'}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Threshold</span>
              <input type="range" min={0} max={100} value={clip.color.effects.threshold} onChange={(e) => onUpdateEffects({ threshold: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.threshold || 'Off'}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Emboss</span>
              <input type="range" min={0} max={100} value={clip.color.effects.emboss} onChange={(e) => onUpdateEffects({ emboss: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.emboss}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Mosaic / Pixel</span>
              <input type="range" min={0} max={100} value={clip.color.effects.mosaic} onChange={(e) => onUpdateEffects({ mosaic: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.mosaic}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Kaleidoscope</span>
              <input type="range" min={0} max={16} value={clip.color.effects.kaleidoscope} onChange={(e) => onUpdateEffects({ kaleidoscope: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.kaleidoscope || 'Off'}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Twirl</span>
              <input type="range" min={-100} max={100} value={clip.color.effects.twirl} onChange={(e) => onUpdateEffects({ twirl: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.twirl}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Pinch / Sphere</span>
              <input type="range" min={-100} max={100} value={clip.color.effects.pinchSpherize} onChange={(e) => onUpdateEffects({ pinchSpherize: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.pinchSpherize}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Wave Warp</span>
              <input type="range" min={0} max={100} value={clip.color.effects.waveWarp} onChange={(e) => onUpdateEffects({ waveWarp: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.waveWarp}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Ripple</span>
              <input type="range" min={0} max={100} value={clip.color.effects.ripple} onChange={(e) => onUpdateEffects({ ripple: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.ripple}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Turb. Displace</span>
              <input type="range" min={0} max={100} value={clip.color.effects.turbulentDisplace} onChange={(e) => onUpdateEffects({ turbulentDisplace: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.turbulentDisplace}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Lens Distort</span>
              <input type="range" min={-100} max={100} value={clip.color.effects.lensDistortion} onChange={(e) => onUpdateEffects({ lensDistortion: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.lensDistortion}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Replicate</span>
              <input type="range" min={1} max={6} value={clip.color.effects.replicate} onChange={(e) => onUpdateEffects({ replicate: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.replicate}x</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Edge Feather</span>
              <input type="range" min={0} max={100} value={clip.color.effects.edgeFeather} onChange={(e) => onUpdateEffects({ edgeFeather: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.edgeFeather}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Unsharp Mask</span>
              <input type="range" min={0} max={100} value={clip.color.effects.unsharpMask} onChange={(e) => onUpdateEffects({ unsharpMask: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.unsharpMask}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Posterize Time</span>
              <input type="range" min={0} max={24} value={clip.color.effects.posterizeTimeFps} onChange={(e) => onUpdateEffects({ posterizeTimeFps: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.posterizeTimeFps ? `${clip.color.effects.posterizeTimeFps}fps` : 'Off'}</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Write-on</span>
              <input type="range" min={0} max={100} value={clip.color.effects.writeOnProgress} onChange={(e) => onUpdateEffects({ writeOnProgress: Number(e.target.value) })} />
              <span className="slider-val">{clip.color.effects.writeOnProgress}%</span>
            </div>

            <div className="section-header">
              <span>Cinema Letterbox</span>
            </div>
            <div className="seg-group">
              {(['none', '2.39', '1.85', '1.66', '1.33'] as LetterboxAspect[]).map((asp) => (
                <button key={asp} type="button" className={clip.color.effects.letterbox === asp ? 'active' : ''} onClick={() => onUpdateEffects({ letterbox: asp })}>
                  {asp === 'none' ? 'Off' : asp === '1.33' ? '4:3' : asp}
                </button>
              ))}
            </div>
          </>
        )}

        {/* MULTI-LUT STACK */}
        {activeTab === 'luts' && clip && (
          <>
            <div className="section-header">
              <span>Multi-LUT Stack ({clip.color.lutStack.length}/6)</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className={`ghost-sm ${clip.color.lutInterpolation === 'tetrahedral' ? 'active' : ''}`} onClick={() => onSetLutInterpolation('tetrahedral')}>
                  Tetra
                </button>
                <button type="button" className={`ghost-sm ${clip.color.lutInterpolation === 'trilinear' ? 'active' : ''}`} onClick={() => onSetLutInterpolation('trilinear')}>
                  Trilinear
                </button>
              </div>
            </div>

            {clip.color.lutStack.length === 0 ? (
              <div style={{ padding: '12px', borderRadius: 6, background: 'var(--bg)', color: 'var(--mute)', fontSize: 12, textAlign: 'center' }}>
                No LUTs stacked. Click any LUT from colorstudies below.
              </div>
            ) : (
              <div className="lut-stack-list">
                {clip.color.lutStack.map((layer, idx) => (
                  <div
                    key={layer.instanceId}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverIndex(idx);
                    }}
                    onDragLeave={() => setDragOverIndex(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== idx) onReorderLutStack(dragIndex, idx);
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`lut-layer-row ${layer.enabled ? '' : 'disabled'} ${dragOverIndex === idx ? 'drag-over' : ''}`}
                  >
                    <div className="lut-layer-top">
                      <GripVertical size={13} style={{ color: 'var(--mute)', cursor: 'grab' }} />
                      <select
                        className="lut-role-tag"
                        value={layer.role}
                        onChange={(e) => onUpdateLutLayer(layer.instanceId, { role: e.target.value as LutRole })}
                      >
                        <option value="input">LOG</option>
                        <option value="creative">LOOK</option>
                        <option value="trim">TRIM</option>
                        <option value="custom">LUT</option>
                      </select>
                      <span className="lut-name">{layer.name}</span>
                      <button type="button" className="subtle ghost-sm" disabled={idx === 0} onClick={() => onReorderLutStack(idx, idx - 1)}>
                        <ArrowUp size={11} />
                      </button>
                      <button type="button" className="subtle ghost-sm" disabled={idx === clip.color.lutStack.length - 1} onClick={() => onReorderLutStack(idx, idx + 1)}>
                        <ArrowDown size={11} />
                      </button>
                      <button type="button" className="subtle ghost-sm" onClick={() => onUpdateLutLayer(layer.instanceId, { enabled: !layer.enabled })}>
                        {layer.enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <button type="button" className="subtle ghost-sm" onClick={() => onRemoveLutLayer(layer.instanceId)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <div className="slider-row" style={{ margin: 0 }}>
                      <span className="slider-label">Intensity</span>
                      <input type="range" min={0} max={100} value={layer.intensity} onChange={(e) => onUpdateLutLayer(layer.instanceId, { intensity: Number(e.target.value) })} />
                      <span className="slider-val">{layer.intensity}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="section-header">
              <span>colorstudies ({filteredLuts.length})</span>
              <button type="button" className="subtle ghost-sm" onClick={onRefreshLuts} disabled={lutLibraryLoading}>
                <RefreshCw size={11} /> Rescan
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input type="search" style={{ flex: 1 }} placeholder="Search LUTs..." value={lutQuery} onChange={(e) => setLutQuery(e.target.value)} />
              <select value={lutPackFilter} onChange={(e) => setLutPackFilter(e.target.value)}>
                {packs.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="lut-library-list">
              {filteredLuts.map((item) => (
                <button key={item.id} type="button" className="lut-lib-item" onClick={() => onAddLutToStack(item)}>
                  <span className="lut-lib-meta">
                    <strong>{item.name}</strong>
                    <small>{item.pack} ({item.format === 'cube' ? 'CUBE' : 'BIN'})</small>
                  </span>
                  <Plus size={13} style={{ flex: 'none', color: 'var(--mute)' }} />
                </button>
              ))}
            </div>
            <div className="section-header"><span>Bake to colorstudies (.cube)</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="text" style={{ flex: 1 }} value={saveLutName} onChange={(e) => setSaveLutName(e.target.value)} />
              <button type="button" onClick={handleSaveLook}><Save size={12} /> Save</button>
            </div>
            {saveMsg && <p className="status-note" style={{ color: 'var(--acc)' }}>{saveMsg}</p>}
          </>
        )}

        {/* WARP STABILIZER */}
        {activeTab === 'stabilize' && clip && (
          <>
            <div className="section-header">
              <span>Warp Stabilizer</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                <input type="checkbox" checked={clip.stabilization.enabled} onChange={(e) => onUpdateStabilization({ enabled: e.target.checked })} />
                Enabled
              </label>
            </div>

            <div className="stab-mode-grid">
              <button type="button" className={`stab-mode-btn ${clip.stabilization.mode === 'smooth' ? 'active' : ''}`} onClick={() => onUpdateStabilization({ mode: 'smooth' })}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Waves size={13} /> Smooth Motion</strong>
                <span>Keeps pans and walks silky like a gimbal</span>
              </button>
              <button type="button" className={`stab-mode-btn ${clip.stabilization.mode === 'lock' ? 'active' : ''}`} onClick={() => onUpdateStabilization({ mode: 'lock' })}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Lock size={13} /> No Motion</strong>
                <span>Locks camera still like a tripod</span>
              </button>
            </div>

            <div className="seg-group">
              {(['hybrid', 'vidstab', 'opencv'] as StabilizationEngine[]).map((eng) => (
                <button key={eng} type="button" className={clip.stabilization.engine === eng ? 'active' : ''} onClick={() => onUpdateStabilization({ engine: eng })}>
                  {eng === 'hybrid' ? 'Hybrid' : eng === 'vidstab' ? 'libvidstab' : 'OpenCV'}
                </button>
              ))}
            </div>

            {clip.stabilization.mode === 'smooth' && (
              <>
                <div className="slider-row">
                  <span className="slider-label">Smoothness</span>
                  <input type="range" min={2} max={60} value={clip.stabilization.smoothness} onChange={(e) => onUpdateStabilization({ smoothness: Number(e.target.value) })} />
                  <span className="slider-val">{clip.stabilization.smoothness}f</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Strength</span>
                  <input type="range" min={0} max={100} value={clip.stabilization.strength} onChange={(e) => onUpdateStabilization({ strength: Number(e.target.value) })} />
                  <span className="slider-val">{clip.stabilization.strength}%</span>
                </div>
              </>
            )}
            <div className="slider-row">
              <span className="slider-label">Auto-Crop</span>
              <input type="range" min={0} max={30} value={clip.stabilization.autoCropZoom} onChange={(e) => onUpdateStabilization({ autoCropZoom: Number(e.target.value) })} />
              <span className="slider-val">+{clip.stabilization.autoCropZoom}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Rolling Shutter</span>
              <input type="range" min={0} max={100} value={clip.stabilization.rollingShutter} onChange={(e) => onUpdateStabilization({ rollingShutter: Number(e.target.value) })} />
              <span className="slider-val">{clip.stabilization.rollingShutter}%</span>
            </div>
            <div className="slider-row">
              <span className="slider-label">Edge Feather</span>
              <input type="range" min={0} max={100} value={clip.stabilization.edgeFeather} onChange={(e) => onUpdateStabilization({ edgeFeather: Number(e.target.value) })} />
              <span className="slider-val">{clip.stabilization.edgeFeather}%</span>
            </div>

            <button type="button" className="primary" style={{ width: '100%', marginTop: 12 }} disabled={clip.stabilization.status === 'analyzing'} onClick={onAnalyzeStabilize}>
              <Activity size={13} />
              {clip.stabilization.status === 'analyzing' ? 'Analyzing...' : clip.stabilization.mode === 'lock' ? 'Lock Camera (No Motion)' : 'Analyze & Stabilize'}
            </button>
            {clip.stabilization.status === 'analyzing' && (
              <div className="progress-track"><div className="progress-fill" style={{ width: `${clip.stabilization.progress}%` }} /></div>
            )}
            <p className="status-note" style={{ color: clip.stabilization.status === 'error' ? 'var(--danger)' : 'var(--mute)' }}>
              {clip.stabilization.statusMessage}
            </p>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button type="button" style={{ flex: 1 }} className={splitEnabled ? 'active' : ''} onClick={() => onSplitEnabledChange(!splitEnabled)}>
                {splitEnabled ? 'Split Wipe On' : 'Split Wipe'}
              </button>
              <button type="button" style={{ flex: 1 }} onPointerDown={onCompareStart} onPointerUp={onCompareEnd} onPointerLeave={onCompareEnd}>
                Hold to compare
              </button>
            </div>
          </>
        )}

        {/* ESSENTIAL SOUND, AUDIO EFFECTS RACK, TRACK MIXER & LUFS METERS */}
        {activeTab === 'audio' && (
          <>
            <div className="section-header">
              <span>Master Bus & Loudness</span>
              <button type="button" className={`ghost-sm ${masterMuted ? 'active' : 'subtle'}`} onClick={() => onMasterMutedChange(!masterMuted)}>
                {masterMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                {masterMuted ? 'Muted' : 'Live'}
              </button>
            </div>

            <div className="meter-card">
              <div className="meter-row">
                <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>L</span>
                <div className="meter-bar-bg"><div className="meter-bar-fill" style={{ width: `${Math.max(0, Math.min(100, ((audioMeters.peakLeftDb + 60) / 60) * 100))}%` }} /></div>
                <span className="mono" style={{ fontSize: 10, textAlign: 'right' }}>{audioMeters.peakLeftDb <= -59.5 ? '-inf' : audioMeters.peakLeftDb.toFixed(1)}</span>
              </div>
              <div className="meter-row">
                <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>R</span>
                <div className="meter-bar-bg"><div className="meter-bar-fill" style={{ width: `${Math.max(0, Math.min(100, ((audioMeters.peakRightDb + 60) / 60) * 100))}%` }} /></div>
                <span className="mono" style={{ fontSize: 10, textAlign: 'right' }}>{audioMeters.peakRightDb <= -59.5 ? '-inf' : audioMeters.peakRightDb.toFixed(1)}</span>
              </div>
              <div className="meter-readout-row">
                <span>Loudness Radar (LUFS / LRA)</span>
                <strong className="mono" style={{ color: audioMeters.clipping ? 'var(--danger)' : 'var(--acc)', fontSize: 12 }}>
                  {audioMeters.lufs <= -59 ? '-inf LUFS' : `${audioMeters.lufs.toFixed(1)} LUFS`}
                  {audioMeters.lra !== undefined ? ` / ${audioMeters.lra.toFixed(1)} LU` : ''}
                </strong>
              </div>
            </div>

            <button
              type="button"
              className="primary"
              style={{ width: '100%', marginBottom: 10 }}
              onClick={onAutoMixAudio}
              title="Automatically closes gaps, overlaps split song cuts with equal-power crossfades, and loudness-matches sections for a seamless blend"
            >
              <Sparkles size={13} />
              Auto-Mix &amp; Crossfade Song Cuts
            </button>

            <div className="slider-row">
              <span className="slider-label">Master Gain</span>
              <input type="range" min={0} max={2} step={0.02} value={masterVolume} onChange={(e) => onMasterVolumeChange(parseFloat(e.target.value))} />
              <span className="slider-val" onDoubleClick={() => onMasterVolumeChange(1.0)}>{linearToDbLabel(masterVolume)}</span>
            </div>

            {clip && (
              <>
                <div className="section-header">
                  <span>Essential Sound Presets</span>
                  <button type="button" className="ghost-sm subtle" onClick={onNormalizeClipAudio}>Normalize -1dB</button>
                </div>
                <div className="seg-group">
                  {(['dialogue', 'music', 'sfx', 'ambience'] as EssentialSoundRole[]).map((role) => (
                    <button
                      key={role}
                      type="button"
                      className={clip.audioEffects.essentialRole === role ? 'active' : ''}
                      onClick={() => onApplyEssentialSound(role)}
                    >
                      {role === 'dialogue' ? 'Dialogue' : role === 'music' ? 'Music' : role === 'sfx' ? 'SFX' : 'Ambience'}
                    </button>
                  ))}
                </div>

                <div className="section-header">
                  <span>Clip Volume, Fades & J/L-Cut</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Clip Gain</span>
                  <input type="range" min={0} max={2} step={0.02} value={clip.volume} onChange={(e) => onUpdateClipAudio({ volume: parseFloat(e.target.value) })} />
                  <span className="slider-val" onDoubleClick={() => onUpdateClipAudio({ volume: 1 })}>{linearToDbLabel(clip.volume)}</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Fade In</span>
                  <input type="range" min={0} max={5} step={0.05} value={clip.fadeIn} onChange={(e) => onUpdateClipAudio({ fadeIn: parseFloat(e.target.value) })} />
                  <span className="slider-val">{clip.fadeIn.toFixed(2)}s</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Fade Out</span>
                  <input type="range" min={0} max={5} step={0.05} value={clip.fadeOut} onChange={(e) => onUpdateClipAudio({ fadeOut: parseFloat(e.target.value) })} />
                  <span className="slider-val">{clip.fadeOut.toFixed(2)}s</span>
                </div>
                <div className="slider-row" style={{ gridTemplateColumns: '92px 1fr' }}>
                  <span className="slider-label">Fade Curve</span>
                  <select
                    value={clip.audioEffects.fadeInType}
                    onChange={(e) =>
                      onUpdateAudioEffects({
                        fadeInType: e.target.value as AudioTransitionType,
                        fadeOutType: e.target.value as AudioTransitionType,
                      })
                    }
                  >
                    {AUDIO_TRANSITION_CATALOG.map((tr) => (
                      <option key={tr.id} value={tr.id}>
                        {tr.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="slider-row">
                  <span className="slider-label">J / L Offset</span>
                  <input type="range" min={-3} max={3} step={0.05} value={clip.audioOffset ?? 0} onChange={(e) => onUpdateClipAudio({ audioOffset: parseFloat(e.target.value) })} />
                  <span className="slider-val" onDoubleClick={() => onUpdateClipAudio({ audioOffset: 0 })}>{(clip.audioOffset ?? 0).toFixed(2)}s</span>
                </div>

                <div className="section-header">
                  <span>Audio Effects DSP Rack</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Amplify</span>
                  <input type="range" min={-24} max={24} step={0.5} value={clip.audioEffects.amplifyDb} onChange={(e) => onUpdateAudioEffects({ amplifyDb: parseFloat(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.amplifyDb} dB</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">EQ Low / Mid / Hi</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                    <input type="range" min={-12} max={12} value={clip.audioEffects.eqLowDb} onChange={(e) => onUpdateAudioEffects({ eqLowDb: Number(e.target.value) })} title="EQ Low" />
                    <input type="range" min={-12} max={12} value={clip.audioEffects.eqMidDb} onChange={(e) => onUpdateAudioEffects({ eqMidDb: Number(e.target.value) })} title="EQ Mid" />
                    <input type="range" min={-12} max={12} value={clip.audioEffects.eqHighDb} onChange={(e) => onUpdateAudioEffects({ eqHighDb: Number(e.target.value) })} title="EQ High" />
                  </div>
                  <span className="slider-val">{clip.audioEffects.eqMidDb}dB</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">DeEsser</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.deEsser} onChange={(e) => onUpdateAudioEffects({ deEsser: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.deEsser}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Dynamics</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.dynamicsComp} onChange={(e) => onUpdateAudioEffects({ dynamicsComp: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.dynamicsComp}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Hard Limiter</span>
                  <input type="range" min={-12} max={0} step={0.5} value={clip.audioEffects.hardLimiterDb} onChange={(e) => onUpdateAudioEffects({ hardLimiterDb: parseFloat(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.hardLimiterDb} dB</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Lowpass</span>
                  <input type="range" min={400} max={20000} step={100} value={clip.audioEffects.lowpassHz} onChange={(e) => onUpdateAudioEffects({ lowpassHz: Number(e.target.value) })} />
                  <span className="slider-val">{(clip.audioEffects.lowpassHz / 1000).toFixed(1)}k</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Pitch Shifter</span>
                  <input type="range" min={-1200} max={1200} step={25} value={clip.audioEffects.pitchCents} onChange={(e) => onUpdateAudioEffects({ pitchCents: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.pitchCents}c</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Studio Reverb</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.studioReverb} onChange={(e) => onUpdateAudioEffects({ studioReverb: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.studioReverb}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Surround Rev.</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.surroundReverb} onChange={(e) => onUpdateAudioEffects({ surroundReverb: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.surroundReverb}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Ambisonics</span>
                  <input type="range" min={-180} max={180} value={clip.audioEffects.ambisonicsAzimuth} onChange={(e) => onUpdateAudioEffects({ ambisonicsAzimuth: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.ambisonicsAzimuth}°</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Highpass</span>
                  <input type="range" min={20} max={1200} step={10} value={clip.audioEffects.highpassHz ?? 20} onChange={(e) => onUpdateAudioEffects({ highpassHz: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.highpassHz ?? 20}Hz</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">DeNoise / Hum</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.deNoise ?? 0} onChange={(e) => onUpdateAudioEffects({ deNoise: Number(e.target.value) })} />
                  <label style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <input type="checkbox" checked={!!clip.audioEffects.deHummer} onChange={(e) => onUpdateAudioEffects({ deHummer: e.target.checked })} />
                    60Hz
                  </label>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Delay / Echo</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.delayMix ?? 0} onChange={(e) => onUpdateAudioEffects({ delayMix: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.delayMix ?? 0}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Chorus / Flang</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.chorus ?? 0} onChange={(e) => onUpdateAudioEffects({ chorus: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.chorus ?? 0}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Phaser</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.phaser ?? 0} onChange={(e) => onUpdateAudioEffects({ phaser: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.phaser ?? 0}%</span>
                </div>
                <div className="slider-row">
                  <span className="slider-label">Mastering</span>
                  <input type="range" min={0} max={100} value={clip.audioEffects.masteringBoost ?? 0} onChange={(e) => onUpdateAudioEffects({ masteringBoost: Number(e.target.value) })} />
                  <span className="slider-val">{clip.audioEffects.masteringBoost ?? 0}%</span>
                </div>
                <div className="slider-row" style={{ gridTemplateColumns: '92px 1fr' }}>
                  <span className="slider-label">Channels</span>
                  <select
                    value={clip.audioEffects.channelMode ?? 'stereo'}
                    onChange={(e) => onUpdateAudioEffects({ channelMode: e.target.value as AudioChannelMode })}
                  >
                    <option value="stereo">Stereo</option>
                    <option value="mono">Mono Sum</option>
                    <option value="fillLeftWithRight">Fill Left with Right</option>
                    <option value="fillRightWithLeft">Fill Right with Left</option>
                    <option value="swapChannels">Swap L / R Channels</option>
                  </select>
                </div>
              </>
            )}

            <div className="section-header">
              <span>Audio Clip Mixer</span>
            </div>
            {clips.filter((c) => !c.disabled && c.clipKind === 'media').slice(0, 8).map((c) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '86px 1fr 48px', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.02}
                  value={c.volume}
                  onChange={(e) => onUpdateAnyClipVolume(c.id, parseFloat(e.target.value))}
                />
                <span className="mono" style={{ fontSize: 10, textAlign: 'right' }}>{linearToDbLabel(c.volume)}</span>
              </div>
            ))}

            <div className="section-header">
              <span>Audio Track Mixer</span>
            </div>
            {tracks
              .filter((t) => t.kind === 'audio')
              .map((tr) => (
                <div key={tr.id} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 64px', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--acc)' }}>{tr.name}</span>
                  <input type="range" min={0} max={2} step={0.02} value={tr.gain ?? 1} onChange={(e) => onUpdateTrackMixer(tr.id, { gain: parseFloat(e.target.value) })} />
                  <input type="range" min={-1} max={1} step={0.05} value={tr.pan ?? 0} onChange={(e) => onUpdateTrackMixer(tr.id, { pan: parseFloat(e.target.value) })} title="Track Pan" />
                </div>
              ))}
          </>
        )}

        {/* LIVE VIDEO SCOPES */}
        {activeTab === 'scopes' && (
          <>
            <div className="section-header"><span>Post-Grade Live Scopes</span></div>
            <div className="seg-group">
              {(['parade', 'waveform', 'histogram'] as ScopeMode[]).map((m) => (
                <button key={m} type="button" className={scopeMode === m ? 'active' : ''} onClick={() => onScopeModeChange(m)}>
                  {m === 'parade' ? 'RGB Parade' : m === 'waveform' ? 'Waveform' : 'Histogram'}
                </button>
              ))}
            </div>
            <canvas ref={scopeCanvasRef} width={344} height={210} className="scope-canvas" />
            <div className="scope-stats">
              <div className="scope-stat"><span>Avg IRE</span><strong>{scopeMetrics.avgIre}</strong></div>
              <div className="scope-stat"><span>Peak</span><strong>{scopeMetrics.peakIre}</strong></div>
              <div className="scope-stat"><span>Floor</span><strong>{scopeMetrics.minIre}</strong></div>
              <div className="scope-stat"><span>Clip</span><strong>{scopeMetrics.clipHighPct}%</strong></div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
