import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
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
  AudioMeterReading,
  ClipEffectsState,
  ColorCorrectionState,
  ColorGradingState,
  HardwareCapabilities,
  InspectorTab,
  LetterboxAspect,
  LutLibraryEntry,
  LutRole,
  LutStackLayer,
  ScopeMode,
  StabilizationEngine,
  StabilizationState,
  TimelineClip,
} from '../types/editor';
import type { ScopeMetrics } from '../engine/scopes';
import { linearToDbLabel } from '../engine/audioMixer';
import { ColorWheel } from './ColorWheel';

interface InspectorProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  clip: TimelineClip | null;
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
  onUpdateClipAudio: (patch: { volume?: number; fadeIn?: number; fadeOut?: number; muted?: boolean }) => void;
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
    name: 'Anamorphic Scope',
    desc: '2.39:1 matte, subtle lens fringe',
    patch: { enabled: true, letterbox: '2.39', chromaticAberration: 28, bloom: 28, vignette: 32, halation: 20 },
  },
  {
    name: 'Crisp Clean',
    desc: 'Optical sharpness, neutral optics',
    patch: { enabled: true, sharpen: 42, blur: 0, halation: 0, bloom: 0, chromaticAberration: 0, vignette: 8 },
  },
];

export const Inspector: React.FC<InspectorProps> = ({
  activeTab,
  onTabChange,
  clip,
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
  const [lutQuery, setLutQuery] = useState('');
  const [lutPackFilter, setLutPackFilter] = useState('All');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saveLutName, setSaveLutName] = useState('Fifilm - Custom Look');
  const [saveMsg, setSaveMsg] = useState('');

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
        {(['color', 'effects', 'luts', 'stabilize', 'audio', 'scopes'] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={activeTab === tab ? 'active' : ''}
            onClick={() => onTabChange(tab)}
          >
            {tab === 'color'
              ? 'Color'
              : tab === 'effects'
                ? 'Effects'
                : tab === 'luts'
                  ? `LUTs${clip && clip.color.lutStack.length ? ` ${clip.color.lutStack.length}` : ''}`
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

        {/* COLOR CORRECTION + CREATIVE GRADING */}
        {activeTab === 'color' && clip && (
          <>
            <div className="section-header">
              <span>Primary Correction</span>
              <button type="button" className="subtle ghost-sm" onClick={onResetCorrection}>
                Reset
              </button>
            </div>

            {CORRECTION_SLIDERS.map((s) => {
              const val = clip.color.correction[s.key];
              return (
                <div className="slider-row" key={s.key}>
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
                    title="Double-click to reset"
                    onDoubleClick={() =>
                      onUpdateCorrection({ [s.key]: 0 } as Partial<ColorCorrectionState>)
                    }
                  >
                    {s.fmt(val)}
                  </span>
                </div>
              );
            })}

            <div className="section-header">
              <span>Color Grading Wheels</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                  <input
                    type="checkbox"
                    checked={clip.color.grading.enabled}
                    onChange={(e) => onUpdateGrading({ enabled: e.target.checked })}
                  />
                  Active
                </label>
                <button type="button" className="subtle ghost-sm" onClick={onResetGrading}>
                  Reset
                </button>
              </div>
            </div>

            <div className="seg-group">
              {(['lift', 'gamma', 'gain'] as const).map((z) => (
                <button
                  key={z}
                  type="button"
                  className={wheelZone === z ? 'active' : ''}
                  onClick={() => setWheelZone(z)}
                >
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
              <span>Split Toning & Tone Curve</span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Split Amount</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.grading.splitAmount}
                onChange={(e) => onUpdateGrading({ splitAmount: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateGrading({ splitAmount: 0 })}>
                {clip.color.grading.splitAmount}%
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--mute)' }}>
                Shadows
                <input
                  type="color"
                  value={clip.color.grading.splitShadowHex}
                  onChange={(e) => onUpdateGrading({ splitShadowHex: e.target.value })}
                />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--mute)' }}>
                Highlights
                <input
                  type="color"
                  value={clip.color.grading.splitHighlightHex}
                  onChange={(e) => onUpdateGrading({ splitHighlightHex: e.target.value })}
                />
              </label>
            </div>

            <div className="slider-row">
              <span className="slider-label">Balance</span>
              <input
                type="range"
                min={-100}
                max={100}
                value={clip.color.grading.splitBalance}
                onChange={(e) => onUpdateGrading({ splitBalance: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateGrading({ splitBalance: 0 })}>
                {clip.color.grading.splitBalance}
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Shoulder</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.grading.filmicShoulder}
                onChange={(e) => onUpdateGrading({ filmicShoulder: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateGrading({ filmicShoulder: 0 })}>
                {clip.color.grading.filmicShoulder}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Matte Lift</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.grading.matteLift}
                onChange={(e) => onUpdateGrading({ matteLift: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateGrading({ matteLift: 0 })}>
                {clip.color.grading.matteLift}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Film Grain</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.grading.grain}
                onChange={(e) => onUpdateGrading({ grain: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateGrading({ grain: 0 })}>
                {clip.color.grading.grain}%
              </span>
            </div>
          </>
        )}

        {/* GPU OPTICAL & CINEMA EFFECTS */}
        {activeTab === 'effects' && clip && (
          <>
            <div className="section-header">
              <span>Optical Presets</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                  <input
                    type="checkbox"
                    checked={clip.color.effects.enabled}
                    onChange={(e) => onUpdateEffects({ enabled: e.target.checked })}
                  />
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
                    <Sparkles size={11} />
                    {p.name}
                  </strong>
                  <span>{p.desc}</span>
                </button>
              ))}
            </div>

            <div className="section-header">
              <span>Halation & Highlight Diffusion</span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Film Halation</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.effects.halation}
                onChange={(e) => onUpdateEffects({ halation: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ halation: 0 })}>
                {clip.color.effects.halation}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Halo Threshold</span>
              <input
                type="range"
                min={40}
                max={96}
                value={clip.color.effects.halationThreshold}
                onChange={(e) => onUpdateEffects({ halationThreshold: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ halationThreshold: 72 })}>
                {clip.color.effects.halationThreshold}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Pro-Mist Bloom</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.effects.bloom}
                onChange={(e) => onUpdateEffects({ bloom: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ bloom: 0 })}>
                {clip.color.effects.bloom}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Bloom Radius</span>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={clip.color.effects.bloomRadius}
                onChange={(e) => onUpdateEffects({ bloomRadius: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ bloomRadius: 4 })}>
                {clip.color.effects.bloomRadius.toFixed(1)}
              </span>
            </div>

            <div className="section-header">
              <span>Lens Optics</span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Sharpen</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.effects.sharpen}
                onChange={(e) => onUpdateEffects({ sharpen: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ sharpen: 0 })}>
                {clip.color.effects.sharpen}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Lens Blur</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.effects.blur}
                onChange={(e) => onUpdateEffects({ blur: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ blur: 0 })}>
                {clip.color.effects.blur}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Chromatic Ab.</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.effects.chromaticAberration}
                onChange={(e) => onUpdateEffects({ chromaticAberration: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ chromaticAberration: 0 })}>
                {clip.color.effects.chromaticAberration}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Vignette</span>
              <input
                type="range"
                min={0}
                max={100}
                value={clip.color.effects.vignette}
                onChange={(e) => onUpdateEffects({ vignette: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ vignette: 0 })}>
                {clip.color.effects.vignette}%
              </span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Vignette Soft</span>
              <input
                type="range"
                min={10}
                max={100}
                value={clip.color.effects.vignetteFeather}
                onChange={(e) => onUpdateEffects({ vignetteFeather: Number(e.target.value) })}
              />
              <span className="slider-val">{clip.color.effects.vignetteFeather}%</span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Grain Size</span>
              <input
                type="range"
                min={1}
                max={4}
                step={0.2}
                value={clip.color.effects.grainSize}
                onChange={(e) => onUpdateEffects({ grainSize: Number(e.target.value) })}
              />
              <span className="slider-val">{clip.color.effects.grainSize.toFixed(1)}px</span>
            </div>

            <div className="section-header">
              <span>Framing & Speed</span>
            </div>

            <div className="seg-group">
              {(['none', '2.39', '1.85', '1.66', '1.33'] as LetterboxAspect[]).map((asp) => (
                <button
                  key={asp}
                  type="button"
                  className={clip.color.effects.letterbox === asp ? 'active' : ''}
                  onClick={() => onUpdateEffects({ letterbox: asp })}
                >
                  {asp === 'none' ? 'Off' : asp === '1.33' ? '4:3' : asp}
                </button>
              ))}
            </div>

            <div className="slider-row">
              <span className="slider-label">Clip Speed</span>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={clip.color.effects.speed}
                onChange={(e) => onUpdateEffects({ speed: Number(e.target.value) })}
              />
              <span className="slider-val" onDoubleClick={() => onUpdateEffects({ speed: 1 })}>
                {clip.color.effects.speed.toFixed(2)}x
              </span>
            </div>
          </>
        )}

        {/* MULTI-LUT STACK + COLORSTUDIES BROWSER */}
        {activeTab === 'luts' && clip && (
          <>
            <div className="section-header">
              <span>Multi-LUT Stack ({clip.color.lutStack.length}/6)</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  className={`ghost-sm ${clip.color.lutInterpolation === 'tetrahedral' ? 'active' : ''}`}
                  onClick={() => onSetLutInterpolation('tetrahedral')}
                >
                  Tetra
                </button>
                <button
                  type="button"
                  className={`ghost-sm ${clip.color.lutInterpolation === 'trilinear' ? 'active' : ''}`}
                  onClick={() => onSetLutInterpolation('trilinear')}
                >
                  Trilinear
                </button>
              </div>
            </div>

            <p className="section-sub">
              Runs sequentially top to bottom after primary correction and grading. Drag layers to reorder.
            </p>

            {clip.color.lutStack.length === 0 ? (
              <div
                style={{
                  padding: '14px',
                  borderRadius: 6,
                  background: 'var(--bg)',
                  color: 'var(--mute)',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                No LUTs stacked yet. Pick a LUT from colorstudies below.
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
                      if (dragIndex !== null && dragIndex !== idx) {
                        onReorderLutStack(dragIndex, idx);
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`lut-layer-row ${layer.enabled ? '' : 'disabled'} ${
                      dragOverIndex === idx ? 'drag-over' : ''
                    }`}
                  >
                    <div className="lut-layer-top">
                      <GripVertical size={13} style={{ color: 'var(--mute)', cursor: 'grab' }} />
                      <select
                        className="lut-role-tag"
                        value={layer.role}
                        onChange={(e) =>
                          onUpdateLutLayer(layer.instanceId, { role: e.target.value as LutRole })
                        }
                        style={{ padding: '2px 5px', fontSize: 10 }}
                      >
                        <option value="input">LOG</option>
                        <option value="creative">LOOK</option>
                        <option value="trim">TRIM</option>
                        <option value="custom">LUT</option>
                      </select>
                      <span className="lut-name" title={layer.name}>
                        {layer.name}
                      </span>
                      <button
                        type="button"
                        className="subtle ghost-sm"
                        disabled={idx === 0}
                        onClick={() => onReorderLutStack(idx, idx - 1)}
                        title="Move earlier"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="subtle ghost-sm"
                        disabled={idx === clip.color.lutStack.length - 1}
                        onClick={() => onReorderLutStack(idx, idx + 1)}
                        title="Move later"
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        type="button"
                        className="subtle ghost-sm"
                        onClick={() => onUpdateLutLayer(layer.instanceId, { enabled: !layer.enabled })}
                        title={layer.enabled ? 'Bypass LUT' : 'Enable LUT'}
                      >
                        {layer.enabled ? <Eye size={11} /> : <EyeOff size={11} />}
                      </button>
                      <button
                        type="button"
                        className="subtle ghost-sm"
                        onClick={() => onRemoveLutLayer(layer.instanceId)}
                        title="Remove LUT"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    <div className="slider-row" style={{ margin: 0 }}>
                      <span className="slider-label">Intensity</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={layer.intensity}
                        onChange={(e) =>
                          onUpdateLutLayer(layer.instanceId, { intensity: Number(e.target.value) })
                        }
                      />
                      <span
                        className="slider-val"
                        onDoubleClick={() => onUpdateLutLayer(layer.instanceId, { intensity: 100 })}
                      >
                        {layer.intensity}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="section-header">
              <span>colorstudies ({filteredLuts.length})</span>
              <button
                type="button"
                className="subtle ghost-sm"
                onClick={onRefreshLuts}
                disabled={lutLibraryLoading}
              >
                <RefreshCw size={11} />
                Rescan
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                type="search"
                style={{ flex: 1 }}
                placeholder="Search LUTs..."
                value={lutQuery}
                onChange={(e) => setLutQuery(e.target.value)}
              />
              <select value={lutPackFilter} onChange={(e) => setLutPackFilter(e.target.value)}>
                {packs.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            <div className="lut-library-list">
              {filteredLuts.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="lut-lib-item"
                  onClick={() => onAddLutToStack(item)}
                >
                  <span className="lut-lib-meta">
                    <strong>{item.name}</strong>
                    <small>
                      {item.pack} ({item.format === 'cube' ? 'CUBE' : 'BIN'}
                      {item.isLogConversion ? ', Log to 709' : ''})
                    </small>
                  </span>
                  <Plus size={13} style={{ flex: 'none', color: 'var(--mute)' }} />
                </button>
              ))}
              {filteredLuts.length === 0 && (
                <div style={{ padding: 12, color: 'var(--mute)', fontSize: 12 }}>
                  No matching LUTs found.
                </div>
              )}
            </div>

            <div className="section-header">
              <span>Bake to colorstudies (.cube)</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                style={{ flex: 1 }}
                value={saveLutName}
                onChange={(e) => setSaveLutName(e.target.value)}
                placeholder="Fifilm - My Grade"
              />
              <button type="button" onClick={handleSaveLook}>
                <Save size={12} />
                Save
              </button>
            </div>
            {saveMsg && <p className="status-note" style={{ color: 'var(--acc)' }}>{saveMsg}</p>}
          </>
        )}

        {/* STABILIZATION — SMOOTH MOTION vs NO MOTION (TRIPOD LOCK) */}
        {activeTab === 'stabilize' && clip && (
          <>
            <div className="section-header">
              <span>Stabilization Mode</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--mute)' }}>
                <input
                  type="checkbox"
                  checked={clip.stabilization.enabled}
                  onChange={(e) => onUpdateStabilization({ enabled: e.target.checked })}
                />
                Enabled
              </label>
            </div>

            <div className="stab-mode-grid">
              <button
                type="button"
                className={`stab-mode-btn ${clip.stabilization.mode === 'smooth' ? 'active' : ''}`}
                onClick={() => onUpdateStabilization({ mode: 'smooth' })}
              >
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Waves size={13} />
                  Smooth Motion
                </strong>
                <span>Keeps intentional pans and walks silky like a gimbal</span>
              </button>
              <button
                type="button"
                className={`stab-mode-btn ${clip.stabilization.mode === 'lock' ? 'active' : ''}`}
                onClick={() => onUpdateStabilization({ mode: 'lock' })}
              >
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={13} />
                  No Motion
                </strong>
                <span>Locks camera completely still like a static tripod</span>
              </button>
            </div>

            <div className="section-header">
              <span>Tracking Engine</span>
            </div>
            <div className="seg-group">
              {(['hybrid', 'vidstab', 'opencv'] as StabilizationEngine[]).map((eng) => (
                <button
                  key={eng}
                  type="button"
                  className={clip.stabilization.engine === eng ? 'active' : ''}
                  onClick={() => onUpdateStabilization({ engine: eng })}
                >
                  {eng === 'hybrid' ? 'Hybrid' : eng === 'vidstab' ? 'libvidstab' : 'OpenCV'}
                </button>
              ))}
            </div>

            {clip.stabilization.mode === 'smooth' && (
              <>
                <div className="slider-row">
                  <span className="slider-label">Smoothness</span>
                  <input
                    type="range"
                    min={2}
                    max={60}
                    step={1}
                    value={clip.stabilization.smoothness}
                    onChange={(e) => onUpdateStabilization({ smoothness: Number(e.target.value) })}
                  />
                  <span className="slider-val">{clip.stabilization.smoothness}f</span>
                </div>

                <div className="slider-row">
                  <span className="slider-label">Strength</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={clip.stabilization.strength}
                    onChange={(e) => onUpdateStabilization({ strength: Number(e.target.value) })}
                  />
                  <span className="slider-val">{clip.stabilization.strength}%</span>
                </div>
              </>
            )}

            <div className="slider-row">
              <span className="slider-label">Auto-Crop</span>
              <input
                type="range"
                min={0}
                max={30}
                step={1}
                value={clip.stabilization.autoCropZoom}
                onChange={(e) => onUpdateStabilization({ autoCropZoom: Number(e.target.value) })}
              />
              <span className="slider-val">+{clip.stabilization.autoCropZoom}%</span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Rolling Shutter</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={clip.stabilization.rollingShutter}
                onChange={(e) => onUpdateStabilization({ rollingShutter: Number(e.target.value) })}
              />
              <span className="slider-val">{clip.stabilization.rollingShutter}%</span>
            </div>

            <div className="slider-row">
              <span className="slider-label">Edge Feather</span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={clip.stabilization.edgeFeather}
                onChange={(e) => onUpdateStabilization({ edgeFeather: Number(e.target.value) })}
              />
              <span className="slider-val">{clip.stabilization.edgeFeather}%</span>
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
              <button
                type="button"
                className="primary"
                style={{ flex: 1 }}
                disabled={clip.stabilization.status === 'analyzing'}
                onClick={onAnalyzeStabilize}
              >
                <Activity size={13} />
                {clip.stabilization.status === 'analyzing'
                  ? 'Analyzing Motion...'
                  : clip.stabilization.mode === 'lock'
                    ? 'Lock Camera (No Motion)'
                    : 'Analyze & Stabilize'}
              </button>
            </div>

            {clip.stabilization.status === 'analyzing' && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${clip.stabilization.progress}%` }} />
              </div>
            )}

            <p
              className="status-note"
              style={{ color: clip.stabilization.status === 'error' ? 'var(--danger)' : 'var(--mute)' }}
            >
              {clip.stabilization.statusMessage}
            </p>

            <div className="section-header">
              <span>Compare Result</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                style={{ flex: 1 }}
                className={splitEnabled ? 'active' : ''}
                onClick={() => onSplitEnabledChange(!splitEnabled)}
              >
                {splitEnabled ? 'Split Wipe On' : 'Split Wipe'}
              </button>
              <button
                type="button"
                style={{ flex: 1 }}
                onPointerDown={onCompareStart}
                onPointerUp={onCompareEnd}
                onPointerLeave={onCompareEnd}
              >
                Hold to compare
              </button>
            </div>

            <p className="status-note" style={{ marginTop: 14 }}>
              libvidstab: {capabilities?.vidstabAvailable ? 'Ready' : 'Offline'} | OpenCV:{' '}
              {capabilities?.opencvAvailable ? 'Ready' : 'Optional (pip install opencv-python-headless)'}
            </p>
          </>
        )}

        {/* AUDIO MIXER, FADES, NORMALIZE & LIVE PEAK / LUFS METERING */}
        {activeTab === 'audio' && (
          <>
            <div className="section-header">
              <span>Master Bus & Loudness</span>
              <button
                type="button"
                className={`ghost-sm ${masterMuted ? 'active' : 'subtle'}`}
                onClick={() => onMasterMutedChange(!masterMuted)}
              >
                {masterMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                {masterMuted ? 'Muted' : 'Live'}
              </button>
            </div>

            <div className="meter-card">
              <div className="meter-row">
                <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>L</span>
                <div className="meter-bar-bg">
                  <div
                    className="meter-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, ((audioMeters.peakLeftDb + 60) / 60) * 100))}%` }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 10, textAlign: 'right' }}>
                  {audioMeters.peakLeftDb <= -59.5 ? '-inf' : `${audioMeters.peakLeftDb.toFixed(1)}`}
                </span>
              </div>
              <div className="meter-row">
                <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>R</span>
                <div className="meter-bar-bg">
                  <div
                    className="meter-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, ((audioMeters.peakRightDb + 60) / 60) * 100))}%` }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 10, textAlign: 'right' }}>
                  {audioMeters.peakRightDb <= -59.5 ? '-inf' : `${audioMeters.peakRightDb.toFixed(1)}`}
                </span>
              </div>
              <div className="meter-readout-row">
                <span>Momentary LUFS</span>
                <strong
                  className="mono"
                  style={{ color: audioMeters.clipping ? 'var(--danger)' : 'var(--acc)', fontSize: 12 }}
                >
                  {audioMeters.lufs <= -59 ? '-inf LUFS' : `${audioMeters.lufs.toFixed(1)} LUFS`}
                  {audioMeters.clipping ? ' CLIP' : ''}
                </strong>
              </div>
            </div>

            <div className="slider-row">
              <span className="slider-label">Master Gain</span>
              <input
                type="range"
                min={0}
                max={2}
                step={0.02}
                value={masterVolume}
                onChange={(e) => onMasterVolumeChange(parseFloat(e.target.value))}
              />
              <span
                className="slider-val"
                title="Double-click to reset to 0.0 dB"
                onDoubleClick={() => onMasterVolumeChange(1.0)}
              >
                {linearToDbLabel(masterVolume)}
              </span>
            </div>

            <div className="section-header">
              <span>Selected Clip Audio</span>
              {clip && (
                <button
                  type="button"
                  className={`ghost-sm ${clip.muted ? 'active' : 'subtle'}`}
                  onClick={() => onUpdateClipAudio({ muted: !clip.muted })}
                >
                  {clip.muted ? 'Unmute' : 'Mute Clip'}
                </button>
              )}
            </div>

            {clip ? (
              <>
                <p className="section-sub">{clip.name}</p>

                <div className="slider-row">
                  <span className="slider-label">Clip Gain</span>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.02}
                    value={clip.volume}
                    onChange={(e) => onUpdateClipAudio({ volume: parseFloat(e.target.value) })}
                  />
                  <span
                    className="slider-val"
                    title="Double-click to reset to 0.0 dB"
                    onDoubleClick={() => onUpdateClipAudio({ volume: 1.0 })}
                  >
                    {linearToDbLabel(clip.volume)}
                  </span>
                </div>

                <div className="slider-row">
                  <span className="slider-label">Fade In</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.min(5, Number((clip.duration * 0.5).toFixed(2)))}
                    step={0.05}
                    value={clip.fadeIn}
                    onChange={(e) => onUpdateClipAudio({ fadeIn: parseFloat(e.target.value) })}
                  />
                  <span
                    className="slider-val"
                    onDoubleClick={() => onUpdateClipAudio({ fadeIn: 0 })}
                  >
                    {clip.fadeIn.toFixed(2)}s
                  </span>
                </div>

                <div className="slider-row">
                  <span className="slider-label">Fade Out</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.min(5, Number((clip.duration * 0.5).toFixed(2)))}
                    step={0.05}
                    value={clip.fadeOut}
                    onChange={(e) => onUpdateClipAudio({ fadeOut: parseFloat(e.target.value) })}
                  />
                  <span
                    className="slider-val"
                    onDoubleClick={() => onUpdateClipAudio({ fadeOut: 0 })}
                  >
                    {clip.fadeOut.toFixed(2)}s
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  <button type="button" style={{ flex: 1 }} onClick={onNormalizeClipAudio}>
                    Normalize Peak (-1 dBFS)
                  </button>
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => onUpdateClipAudio({ volume: 1, fadeIn: 0, fadeOut: 0, muted: false })}
                  >
                    Reset
                  </button>
                </div>

                <p className="status-note" style={{ marginTop: 12 }}>
                  48 kHz Web Audio sync bus with brickwall peak limiter. Volume, fades, mute/solo, and music tracks carry directly into FFmpeg export.
                </p>
              </>
            ) : (
              <p className="status-note">Select a video or audio clip on the timeline to adjust volume, fades, and gain normalization.</p>
            )}
          </>
        )}

        {/* LIVE VIDEO SCOPES */}
        {activeTab === 'scopes' && (
          <>
            <div className="section-header">
              <span>Post-Grade Live Scopes</span>
            </div>

            <div className="seg-group">
              {(['parade', 'waveform', 'histogram'] as ScopeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={scopeMode === m ? 'active' : ''}
                  onClick={() => onScopeModeChange(m)}
                >
                  {m === 'parade' ? 'RGB Parade' : m === 'waveform' ? 'Waveform' : 'Histogram'}
                </button>
              ))}
            </div>

            <canvas
              ref={scopeCanvasRef}
              width={344}
              height={210}
              className="scope-canvas"
              aria-label="Live post-grade video scope"
            />

            <div className="scope-stats">
              <div className="scope-stat">
                <span>Avg IRE</span>
                <strong>{scopeMetrics.avgIre}</strong>
              </div>
              <div className="scope-stat">
                <span>Peak</span>
                <strong>{scopeMetrics.peakIre}</strong>
              </div>
              <div className="scope-stat">
                <span>Floor</span>
                <strong>{scopeMetrics.minIre}</strong>
              </div>
              <div className="scope-stat">
                <span>Clip</span>
                <strong style={{ color: scopeMetrics.clipHighPct > 2 ? 'var(--warn)' : 'var(--ink)' }}>
                  {scopeMetrics.clipHighPct}%
                </strong>
              </div>
            </div>

            <p className="status-note" style={{ marginTop: 10 }}>
              Live Rec.709 0 to 100 IRE readouts sampled directly from the WebGL2 post-grade buffer.
            </p>
          </>
        )}
      </div>
    </aside>
  );
};
