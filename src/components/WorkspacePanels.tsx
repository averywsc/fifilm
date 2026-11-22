import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Camera,
  Clapperboard,
  FileText,
  Film,
  FolderOpen,
  Grid,
  History,
  Info,
  Layers,
  Library,
  Link2,
  List,
  Plus,
  Scissors,
  Settings,
  ShieldCheck,
  Snowflake,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  AudioTransitionType,
  BlendMode,
  ClipAudioEffectsState,
  ClipEffectsState,
  ColorCorrectionState,
  ContentCredentialsState,
  CustomEffectPreset,
  HistoryEntry,
  LeftPanelTab,
  MarkerType,
  MediaAsset,
  MonitorOverlaySettings,
  RailPresetId,
  SequenceSettings,
  TimelineClip,
  TimelineMarker,
  TrackPresetId,
  TranscriptSegment,
  VideoTransitionType,
} from '../types/editor';
import {
  AUDIO_EFFECT_CATALOG,
  AUDIO_TRANSITION_CATALOG,
  VIDEO_EFFECT_CATALOG,
  VIDEO_TRANSITION_CATALOG,
} from '../engine/effectCatalog';
import { formatTimecode } from '../engine/timecode';

interface WorkspacePanelsProps {
  activePanel: LeftPanelTab;
  onPanelChange: (tab: LeftPanelTab) => void;
  assets: Map<string, MediaAsset>;
  clips: TimelineClip[];
  markers: TimelineMarker[];
  selectedClip: TimelineClip | null;
  history: HistoryEntry[];
  transcript: TranscriptSegment[];
  credentials: ContentCredentialsState;
  effectPresets: CustomEffectPreset[];
  sequence: SequenceSettings;
  overlays: MonitorOverlaySettings;
  onUpdateOverlays: (patch: Partial<MonitorOverlaySettings>) => void;
  sourceMatchTarget: { assetId: string; timeSec: number; nonce: number } | null;
  fps: number;
  multiCamEnabled: boolean;
  onToggleMultiCam: () => void;
  onOpenSettings: () => void;
  onImportClick: () => void;
  onInsertAssetFromSource: (assetId: string, srcIn: number, srcOut: number, overwrite: boolean) => void;
  onLiftOrExtract: (mode: 'lift' | 'extract') => void;
  onUpdateAssetInterpret: (assetId: string, interpretedFps: number, pixelAspect: number) => void;
  onCreateAdjustmentLayer: () => void;
  onCreateNestedSequence: () => void;
  onCreateFreezeFrame: () => void;
  onCreateTextClip: (vertical: boolean) => void;
  onCreateShapeClip: (shape: 'rectangle' | 'ellipse' | 'pen') => void;
  onRunSceneEditDetect: () => void;
  sceneDetectBusy: boolean;
  onApplyVideoEffect: (
    patch: Partial<ClipEffectsState> | undefined,
    colorPatch: Partial<ColorCorrectionState> | undefined,
    blendMode: BlendMode | undefined,
    label: string
  ) => void;
  onApplyVideoTransition: (type: VideoTransitionType, side: 'in' | 'out') => void;
  onApplyAudioEffect: (patch: Partial<ClipAudioEffectsState>, label: string) => void;
  onApplyAudioTransition: (type: AudioTransitionType) => void;
  onApplyEffectPreset: (preset: CustomEffectPreset) => void;
  onSaveCurrentAsPreset: () => void;
  onDeleteEffectPreset: (id: string) => void;
  onAddMarkerOfType: (markerType: MarkerType) => void;
  onDeleteMarker: (id: string) => void;
  onClearAllMarkers: () => void;
  onApplyTrackPreset: (preset: TrackPresetId) => void;
  onApplyRailPreset: (preset: RailPresetId) => void;
  onJumpToTime: (timeSec: number) => void;
  onSelectClip: (clipId: string) => void;
  onRestoreHistory: (entryId: string) => void;
  onUpdateTranscript: (next: TranscriptSegment[]) => void;
  onGenerateTranscriptFromClips: () => void;
  onApplyPaperEditToTimeline: () => void;
  onUpdateCredentials: (patch: Partial<ContentCredentialsState>) => void;
  onOpenDynamicLinkTotone: () => void;
}

export const WorkspacePanels: React.FC<WorkspacePanelsProps> = ({
  activePanel,
  onPanelChange,
  assets,
  clips,
  markers,
  selectedClip,
  history,
  transcript,
  credentials,
  effectPresets,
  sequence,
  overlays,
  onUpdateOverlays,
  sourceMatchTarget,
  fps,
  multiCamEnabled,
  onToggleMultiCam,
  onOpenSettings,
  onImportClick,
  onInsertAssetFromSource,
  onLiftOrExtract,
  onUpdateAssetInterpret,
  onCreateAdjustmentLayer,
  onCreateNestedSequence,
  onCreateFreezeFrame,
  onCreateTextClip,
  onCreateShapeClip,
  onRunSceneEditDetect,
  sceneDetectBusy,
  onApplyVideoEffect,
  onApplyVideoTransition,
  onApplyAudioEffect,
  onApplyAudioTransition,
  onApplyEffectPreset,
  onSaveCurrentAsPreset,
  onDeleteEffectPreset,
  onAddMarkerOfType,
  onDeleteMarker,
  onClearAllMarkers,
  onApplyTrackPreset,
  onApplyRailPreset,
  onJumpToTime,
  onSelectClip,
  onRestoreHistory,
  onUpdateTranscript,
  onGenerateTranscriptFromClips,
  onApplyPaperEditToTimeline,
  onUpdateCredentials,
  onOpenDynamicLinkTotone,
}) => {
  const assetList = useMemo(() => Array.from(assets.values()), [assets]);
  const [sourceAssetId, setSourceAssetId] = useState<string>('');
  const [sourceIn, setSourceIn] = useState<number>(0);
  const [sourceOut, setSourceOut] = useState<number>(5);
  const [sourceCurTime, setSourceCurTime] = useState<number>(0);
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null);

  const [fxQuery, setFxQuery] = useState('');
  const [fxGroup, setFxGroup] = useState<'vfx' | 'vtrans' | 'afx' | 'presets'>('vfx');
  const [infoSub, setInfoSub] = useState<'index' | 'history' | 'info' | 'c2pa'>('index');
  const [interpretAssetId, setInterpretAssetId] = useState<string | null>(null);
  const [markerFilter, setMarkerFilter] = useState<'all' | MarkerType>('all');

  const activeSourceAsset =
    assets.get(sourceAssetId) || assetList.find((a) => a.kind === 'video') || assetList[0] || null;

  // Match Frame to Source Monitor sync
  useEffect(() => {
    if (!sourceMatchTarget) return;
    setSourceAssetId(sourceMatchTarget.assetId);
    const targetAsset = assets.get(sourceMatchTarget.assetId);
    setSourceIn(sourceMatchTarget.timeSec);
    if (targetAsset) {
      setSourceOut(Math.min(targetAsset.duration, sourceMatchTarget.timeSec + 4));
    }
    setTimeout(() => {
      if (sourceVideoRef.current) {
        try {
          sourceVideoRef.current.currentTime = sourceMatchTarget.timeSec;
          setSourceCurTime(sourceMatchTarget.timeSec);
        } catch {
          // ignore
        }
      }
    }, 60);
  }, [sourceMatchTarget, assets]);

  const toggleTab = (tab: LeftPanelTab) => {
    onPanelChange(activePanel === tab ? 'none' : tab);
  };

  const filteredVfx = useMemo(() => {
    const q = fxQuery.trim().toLowerCase();
    return q
      ? VIDEO_EFFECT_CATALOG.filter(
          (e) => e.name.toLowerCase().includes(q) || e.cat.toLowerCase().includes(q)
        )
      : VIDEO_EFFECT_CATALOG;
  }, [fxQuery]);

  const filteredVtrans = useMemo(() => {
    const q = fxQuery.trim().toLowerCase();
    return q
      ? VIDEO_TRANSITION_CATALOG.filter((e) => e.name.toLowerCase().includes(q))
      : VIDEO_TRANSITION_CATALOG;
  }, [fxQuery]);

  const filteredAfx = useMemo(() => {
    const q = fxQuery.trim().toLowerCase();
    return q
      ? AUDIO_EFFECT_CATALOG.filter(
          (e) => e.name.toLowerCase().includes(q) || e.cat.toLowerCase().includes(q)
        )
      : AUDIO_EFFECT_CATALOG;
  }, [fxQuery]);

  const filteredMarkers = useMemo(
    () =>
      markerFilter === 'all'
        ? markers
        : markers.filter((m) => (m.markerType || 'standard') === markerFilter),
    [markers, markerFilter]
  );

  return (
    <div className="left-studio-wrap">
      {/* Slim Left Icon Rail */}
      <nav className="left-rail" aria-label="Studio Panels">
        <button
          type="button"
          className={`rail-btn ${activePanel === 'project' ? 'active' : ''}`}
          onClick={() => toggleTab('project')}
          title="Project Panel (Media Bin, Interpret Footage, Layers, Multi-Cam)"
        >
          <FolderOpen size={15} />
        </button>
        <button
          type="button"
          className={`rail-btn ${activePanel === 'source' ? 'active' : ''}`}
          onClick={() => toggleTab('source')}
          title="Source Monitor (Preview, Overlay, Insert, Overwrite, Lift, Extract)"
        >
          <Film size={15} />
        </button>
        <button
          type="button"
          className={`rail-btn ${activePanel === 'effects' ? 'active' : ''}`}
          onClick={() => toggleTab('effects')}
          title="Effects, Transitions & Effect Presets Panel"
        >
          <Sparkles size={15} />
        </button>
        <button
          type="button"
          className={`rail-btn ${activePanel === 'markers' ? 'active' : ''}`}
          onClick={() => toggleTab('markers')}
          title="Markers Panel (Standard, Chapter, Web Link, Flash/Event Cue)"
        >
          <Bookmark size={15} />
        </button>
        <button
          type="button"
          className={`rail-btn ${activePanel === 'text' ? 'active' : ''}`}
          onClick={() => toggleTab('text')}
          title="Text-Based Editing & Paper Edit"
        >
          <FileText size={15} />
        </button>
        <button
          type="button"
          className={`rail-btn ${activePanel === 'libraries' ? 'active' : ''}`}
          onClick={() => toggleTab('libraries')}
          title="Libraries, Production & Track/Rail Presets"
        >
          <Library size={15} />
        </button>
        <button
          type="button"
          className={`rail-btn ${activePanel === 'info' ? 'active' : ''}`}
          onClick={() => toggleTab('info')}
          title="Sequence Index, History, Info, Metadata & C2PA"
        >
          <Info size={15} />
        </button>
      </nav>

      {/* Collapsible Left Drawer */}
      {activePanel !== 'none' && (
        <aside className="left-drawer">
          {/* PROJECT PANEL */}
          {activePanel === 'project' && (
            <div>
              <div className="panel-title-row">
                <h3>Project Bin</h3>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="ghost-sm" onClick={onOpenSettings} title="Sequence Settings">
                    <Settings size={11} />
                  </button>
                  <button type="button" className="ghost-sm primary" onClick={onImportClick}>
                    <Plus size={11} /> Import
                  </button>
                </div>
              </div>

              <div className="inspector-card" style={{ padding: 8, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                  <span style={{ color: 'var(--mute)' }}>{sequence.name}</span>
                  <span className="mono">
                    {sequence.width}x{sequence.height} {sequence.fps}fps
                  </span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--mute)', marginTop: 2 }}>
                  Auto-Scale: <strong style={{ color: 'var(--ink)' }}>{sequence.autoScaleMedia.toUpperCase()}</strong>
                </div>
              </div>

              <div className="panel-section">
                <div className="panel-title-row">
                  <h4>Create Layer / Workflow</h4>
                </div>
                <div className="stab-mode-grid" style={{ marginBottom: 8 }}>
                  <button type="button" className="stab-mode-btn" onClick={onCreateAdjustmentLayer}>
                    <strong>Adjustment</strong>
                    <span>Grade layers below</span>
                  </button>
                  <button type="button" className="stab-mode-btn" onClick={onCreateNestedSequence}>
                    <strong>Nest Clips</strong>
                    <span>Nested Sequence</span>
                  </button>
                  <button type="button" className="stab-mode-btn" onClick={onCreateFreezeFrame}>
                    <strong><Snowflake size={11} /> Freeze</strong>
                    <span>Frame Hold</span>
                  </button>
                  <button type="button" className="stab-mode-btn" onClick={() => onCreateTextClip(false)}>
                    <strong>Title</strong>
                    <span>Horizontal Type</span>
                  </button>
                  <button type="button" className="stab-mode-btn" onClick={() => onCreateTextClip(true)}>
                    <strong>Vert. Type</strong>
                    <span>Vertical Title</span>
                  </button>
                  <button type="button" className="stab-mode-btn" onClick={() => onCreateShapeClip('rectangle')}>
                    <strong>Shape</strong>
                    <span>Vector Graphic</span>
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    className="ghost-sm"
                    onClick={onRunSceneEditDetect}
                    disabled={sceneDetectBusy || !selectedClip}
                  >
                    <Scissors size={12} />
                    {sceneDetectBusy ? 'Detecting scene cuts...' : 'Scene Edit Detection'}
                  </button>
                  <button
                    type="button"
                    className={`ghost-sm ${multiCamEnabled ? 'primary' : ''}`}
                    onClick={onToggleMultiCam}
                  >
                    <Camera size={12} />
                    Multi-Camera Editing {multiCamEnabled ? '(On)' : ''}
                  </button>
                  <button type="button" className="ghost-sm" onClick={onOpenDynamicLinkTotone}>
                    <Link2 size={12} />
                    Dynamic Link (Send Frame to Totone)
                  </button>
                </div>
              </div>

              <div className="panel-section">
                <div className="panel-title-row">
                  <h4>Imported Media ({assetList.length})</h4>
                </div>
                {assetList.length === 0 ? (
                  <p style={{ fontSize: 11, color: 'var(--mute)' }}>
                    No media imported yet. Click Import or drop video/audio files.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {assetList.map((a) => (
                      <div key={a.id} className="inspector-card" style={{ padding: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {a.name}
                          </span>
                          <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
                            {a.kind === 'video' ? `${a.width}x${a.height}` : 'AUDIO'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mute)', marginTop: 3 }}>
                          <span className="mono">{formatTimecode(a.duration, fps)}</span>
                          <span className="mono">{a.interpretedFps ?? a.fps} fps</span>
                        </div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                          <button
                            type="button"
                            className="ghost-sm"
                            style={{ flex: 1 }}
                            onClick={() => {
                              setSourceAssetId(a.id);
                              setSourceIn(0);
                              setSourceOut(a.duration);
                              onPanelChange('source');
                            }}
                          >
                            Source
                          </button>
                          <button
                            type="button"
                            className="ghost-sm"
                            style={{ flex: 1 }}
                            onClick={() => onInsertAssetFromSource(a.id, 0, a.duration, true)}
                          >
                            + Add
                          </button>
                          <button
                            type="button"
                            className="ghost-sm"
                            onClick={() => setInterpretAssetId(interpretAssetId === a.id ? null : a.id)}
                            title="Interpret Footage"
                          >
                            FPS
                          </button>
                        </div>

                        {interpretAssetId === a.id && (
                          <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--surface-3)' }}>
                            <div className="field-row">
                              <span style={{ fontSize: 10 }}>Interpret FPS</span>
                              <select
                                value={a.interpretedFps ?? a.fps}
                                onChange={(e) =>
                                  onUpdateAssetInterpret(a.id, Number(e.target.value), a.pixelAspect ?? 1)
                                }
                                style={{ padding: '2px 5px', fontSize: 10 }}
                              >
                                <option value={23.976}>23.976 fps</option>
                                <option value={24}>24 fps</option>
                                <option value={25}>25 fps</option>
                                <option value={29.97}>29.97 fps</option>
                                <option value={30}>30 fps</option>
                                <option value={60}>60 fps</option>
                              </select>
                            </div>
                            <div className="field-row" style={{ marginTop: 4 }}>
                              <span style={{ fontSize: 10 }}>Pixel Aspect</span>
                              <select
                                value={a.pixelAspect ?? 1}
                                onChange={(e) =>
                                  onUpdateAssetInterpret(a.id, a.interpretedFps ?? a.fps, Number(e.target.value))
                                }
                                style={{ padding: '2px 5px', fontSize: 10 }}
                              >
                                <option value={1}>Square (1.0)</option>
                                <option value={1.333}>Anamorphic (1.33)</option>
                                <option value={2}>Scope (2.0)</option>
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SOURCE MONITOR PANEL */}
          {activePanel === 'source' && (
            <div>
              <div className="panel-title-row">
                <h3>Source Monitor</h3>
                <button
                  type="button"
                  className={`ghost-sm ${overlays.sourceOverlay ? 'active' : ''}`}
                  onClick={() => onUpdateOverlays({ sourceOverlay: !overlays.sourceOverlay })}
                  title="Toggle Source Monitor Overlay"
                >
                  <Grid size={11} /> Overlay
                </button>
              </div>
              {activeSourceAsset ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <select
                    value={activeSourceAsset.id}
                    onChange={(e) => {
                      const next = assets.get(e.target.value);
                      setSourceAssetId(e.target.value);
                      setSourceIn(0);
                      if (next) setSourceOut(next.duration);
                    }}
                  >
                    {assetList.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>

                  {activeSourceAsset.kind === 'video' ? (
                    <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', background: '#03050c' }}>
                      <video
                        ref={sourceVideoRef}
                        src={activeSourceAsset.objectUrl}
                        controls
                        onTimeUpdate={(e) => setSourceCurTime(e.currentTarget.currentTime)}
                        style={{ width: '100%', display: 'block', maxHeight: 170 }}
                      />
                      {overlays.sourceOverlay && (
                        <div className="source-overlay-hud">
                          <span>SRC {formatTimecode(sourceCurTime, fps)}</span>
                          <span>
                            {activeSourceAsset.width}x{activeSourceAsset.height}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <audio src={activeSourceAsset.objectUrl} controls style={{ width: '100%' }} />
                  )}

                  <div className="field-row">
                    <span>In</span>
                    <span className="mono">{formatTimecode(sourceIn, fps)}</span>
                    <button
                      type="button"
                      className="ghost-sm"
                      onClick={() => setSourceIn(sourceVideoRef.current?.currentTime ?? 0)}
                    >
                      Mark In
                    </button>
                  </div>
                  <div className="field-row">
                    <span>Out</span>
                    <span className="mono">{formatTimecode(sourceOut, fps)}</span>
                    <button
                      type="button"
                      className="ghost-sm"
                      onClick={() =>
                        setSourceOut(
                          Math.max(
                            sourceIn + 0.2,
                            sourceVideoRef.current?.currentTime ?? activeSourceAsset.duration
                          )
                        )
                      }
                    >
                      Mark Out
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <button
                      type="button"
                      className="ghost-sm primary"
                      onClick={() => onInsertAssetFromSource(activeSourceAsset.id, sourceIn, sourceOut, false)}
                      title="Source-Insert Edit (,)"
                    >
                      Insert (,)
                    </button>
                    <button
                      type="button"
                      className="ghost-sm"
                      onClick={() => onInsertAssetFromSource(activeSourceAsset.id, sourceIn, sourceOut, true)}
                      title="Source-Overwrite Edit (.)"
                    >
                      Overwrite (.)
                    </button>
                    <button
                      type="button"
                      className="ghost-sm"
                      onClick={() => onLiftOrExtract('lift')}
                      title="Lift Edit (;) removes In-to-Out leaving a gap"
                    >
                      Lift (;)
                    </button>
                    <button
                      type="button"
                      className="ghost-sm"
                      onClick={() => onLiftOrExtract('extract')}
                      title="Extract Edit (') removes In-to-Out and closes gap"
                    >
                      Extract (&apos;)
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--mute)' }}>
                  Import media first to preview and mark In/Out in the Source Monitor.
                </p>
              )}
            </div>
          )}

          {/* EFFECTS, TRANSITIONS & PRESETS PANEL */}
          {activePanel === 'effects' && (
            <div>
              <div className="panel-title-row">
                <h3>Effects &amp; Presets</h3>
                <button type="button" className="ghost-sm" onClick={onSaveCurrentAsPreset} disabled={!selectedClip}>
                  <Plus size={11} /> Save Preset
                </button>
              </div>
              <input
                type="search"
                placeholder="Search 160+ effects & transitions..."
                value={fxQuery}
                onChange={(e) => setFxQuery(e.target.value)}
                style={{ width: '100%', marginBottom: 8 }}
              />
              <div className="scope-mode-row" style={{ marginBottom: 10 }}>
                <button type="button" className={fxGroup === 'vfx' ? 'active' : ''} onClick={() => setFxGroup('vfx')}>
                  Video ({VIDEO_EFFECT_CATALOG.length})
                </button>
                <button type="button" className={fxGroup === 'vtrans' ? 'active' : ''} onClick={() => setFxGroup('vtrans')}>
                  Trans ({VIDEO_TRANSITION_CATALOG.length})
                </button>
                <button type="button" className={fxGroup === 'afx' ? 'active' : ''} onClick={() => setFxGroup('afx')}>
                  Audio ({AUDIO_EFFECT_CATALOG.length})
                </button>
                <button type="button" className={fxGroup === 'presets' ? 'active' : ''} onClick={() => setFxGroup('presets')}>
                  Presets
                </button>
              </div>

              {!selectedClip && (
                <p style={{ fontSize: 11, color: 'var(--warn)', marginBottom: 8 }}>
                  Select a clip on the timeline to apply effects or transitions.
                </p>
              )}

              {fxGroup === 'vfx' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filteredVfx.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      className="lut-lib-item"
                      disabled={!selectedClip}
                      onClick={() => onApplyVideoEffect(item.patch, item.colorPatch, item.blendMode, item.name)}
                    >
                      <div className="lut-lib-meta">
                        <span>{item.name}</span>
                        <small>{item.cat}</small>
                      </div>
                      <Wand2 size={12} />
                    </button>
                  ))}
                </div>
              )}

              {fxGroup === 'vtrans' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {filteredVtrans.map((tr) => (
                    <div
                      key={tr.id}
                      className="inspector-card"
                      style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                    >
                      <span style={{ fontSize: 11.5 }}>{tr.name}</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="ghost-sm"
                          disabled={!selectedClip}
                          onClick={() => onApplyVideoTransition(tr.id, 'in')}
                        >
                          In
                        </button>
                        <button
                          type="button"
                          className="ghost-sm"
                          disabled={!selectedClip}
                          onClick={() => onApplyVideoTransition(tr.id, 'out')}
                        >
                          Out
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {fxGroup === 'afx' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="panel-title-row">
                    <h4>Audio Effects</h4>
                  </div>
                  {filteredAfx.map((item) => (
                    <button
                      key={item.name}
                      type="button"
                      className="lut-lib-item"
                      disabled={!selectedClip}
                      onClick={() => onApplyAudioEffect(item.patch, item.name)}
                    >
                      <div className="lut-lib-meta">
                        <span>{item.name}</span>
                        <small>{item.cat}</small>
                      </div>
                      <Plus size={12} />
                    </button>
                  ))}

                  <div className="panel-title-row" style={{ marginTop: 8 }}>
                    <h4>Audio Transitions ({AUDIO_TRANSITION_CATALOG.length})</h4>
                  </div>
                  {AUDIO_TRANSITION_CATALOG.map((tr) => (
                    <button
                      key={tr.id}
                      type="button"
                      className="lut-lib-item"
                      disabled={!selectedClip}
                      onClick={() => onApplyAudioTransition(tr.id)}
                    >
                      <span>{tr.name}</span>
                      <Plus size={12} />
                    </button>
                  ))}
                </div>
              )}

              {fxGroup === 'presets' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    className="ghost-sm primary"
                    disabled={!selectedClip}
                    onClick={onSaveCurrentAsPreset}
                  >
                    <Plus size={12} /> Save Selected Clip FX as Preset
                  </button>
                  {effectPresets.length === 0 ? (
                    <p style={{ fontSize: 11, color: 'var(--mute)' }}>
                      No saved presets yet. Grade or style a clip and click Save Preset (or right-click a clip -&gt; Save Preset).
                    </p>
                  ) : (
                    effectPresets.map((p) => (
                      <div
                        key={p.id}
                        className="inspector-card"
                        style={{ padding: '7px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                      >
                        <button
                          type="button"
                          className="subtle"
                          style={{ flex: 1, justifyContent: 'flex-start', padding: '2px 4px' }}
                          disabled={!selectedClip}
                          onClick={() => onApplyEffectPreset(p)}
                        >
                          <Sparkles size={11} />
                          <span>{p.name}</span>
                        </button>
                        <button
                          type="button"
                          className="subtle icon-btn"
                          onClick={() => onDeleteEffectPreset(p.id)}
                          title="Delete preset"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* MARKERS PANEL */}
          {activePanel === 'markers' && (
            <div>
              <div className="panel-title-row">
                <h3>Markers ({markers.length})</h3>
                <button type="button" className="ghost-sm" onClick={onClearAllMarkers} disabled={markers.length === 0}>
                  Clear All
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
                <button type="button" className="ghost-sm" onClick={() => onAddMarkerOfType('standard')}>
                  + Marker (M)
                </button>
                <button type="button" className="ghost-sm" onClick={() => onAddMarkerOfType('chapter')}>
                  + Chapter
                </button>
                <button type="button" className="ghost-sm" onClick={() => onAddMarkerOfType('webLink')}>
                  + Web Link
                </button>
                <button type="button" className="ghost-sm" onClick={() => onAddMarkerOfType('flashCue')}>
                  + Flash Cue
                </button>
                <button type="button" className="ghost-sm" style={{ gridColumn: '1 / -1' }} onClick={() => onAddMarkerOfType('eventCue')}>
                  + Event Cue Point Marker
                </button>
              </div>
              <select
                value={markerFilter}
                onChange={(e) => setMarkerFilter(e.target.value as 'all' | MarkerType)}
                style={{ width: '100%', marginBottom: 8 }}
              >
                <option value="all">All Marker Types</option>
                <option value="standard">Standard Markers</option>
                <option value="chapter">Chapter Markers</option>
                <option value="webLink">Web Link Markers</option>
                <option value="flashCue">Flash Cue Point</option>
                <option value="eventCue">Event Cue Point</option>
              </select>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {filteredMarkers.length === 0 ? (
                  <p style={{ fontSize: 11, color: 'var(--mute)' }}>No markers in this category.</p>
                ) : (
                  filteredMarkers.map((m) => (
                    <div
                      key={m.id}
                      className="inspector-card"
                      style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}
                    >
                      <button
                        type="button"
                        className="subtle"
                        style={{ flex: 1, justifyContent: 'space-between', padding: '2px 4px' }}
                        onClick={() => onJumpToTime(m.time)}
                      >
                        <span style={{ fontSize: 11 }}>{m.label}</span>
                        <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
                          {formatTimecode(m.time, fps)}
                        </span>
                      </button>
                      <button type="button" className="subtle icon-btn" onClick={() => onDeleteMarker(m.id)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TEXT-BASED EDITING & PAPER EDIT PANEL */}
          {activePanel === 'text' && (
            <div>
              <div className="panel-title-row">
                <h3>Text-Based &amp; Paper Edit</h3>
              </div>
              <p style={{ fontSize: 11, color: 'var(--mute)', marginBottom: 8 }}>
                Build an editable script from your clips, uncheck lines to cut them, reorder shots, and apply your Paper Edit directly to the timeline.
              </p>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button type="button" className="ghost-sm" style={{ flex: 1 }} onClick={onGenerateTranscriptFromClips}>
                  Build Script
                </button>
                <button
                  type="button"
                  className="ghost-sm primary"
                  style={{ flex: 1 }}
                  disabled={transcript.length === 0}
                  onClick={onApplyPaperEditToTimeline}
                >
                  Apply Paper Edit
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {transcript.map((seg, idx) => (
                  <div
                    key={seg.id}
                    className="inspector-card"
                    style={{ padding: 8, opacity: seg.included ? 1 : 0.45 }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <input
                          type="checkbox"
                          checked={seg.included}
                          onChange={(e) => {
                            const next = transcript.map((s) =>
                              s.id === seg.id ? { ...s, included: e.target.checked } : s
                            );
                            onUpdateTranscript(next);
                          }}
                        />
                        <strong>{seg.speaker}</strong>
                      </label>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          type="button"
                          className="ghost-sm"
                          disabled={idx === 0}
                          onClick={() => {
                            const copy = [...transcript];
                            [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                            onUpdateTranscript(copy);
                          }}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="ghost-sm"
                          disabled={idx === transcript.length - 1}
                          onClick={() => {
                            const copy = [...transcript];
                            [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                            onUpdateTranscript(copy);
                          }}
                        >
                          Dn
                        </button>
                      </div>
                    </div>
                    <textarea
                      rows={2}
                      value={seg.text}
                      onChange={(e) => {
                        const next = transcript.map((s) =>
                          s.id === seg.id ? { ...s, text: e.target.value } : s
                        );
                        onUpdateTranscript(next);
                      }}
                      style={{
                        width: '100%',
                        background: 'var(--bg)',
                        color: 'var(--ink)',
                        border: 'none',
                        borderRadius: 4,
                        padding: 6,
                        fontSize: 11,
                        resize: 'vertical',
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* LIBRARIES & PRODUCTION PANEL */}
          {activePanel === 'libraries' && (
            <div>
              <div className="panel-title-row">
                <h3>Libraries &amp; Production</h3>
              </div>
              <div className="panel-section">
                <h4>Workspace Rail Presets</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                  {(
                    [
                      ['editorial', 'Editorial'],
                      ['color', 'Lumetri Color'],
                      ['audio', 'Audio Mix'],
                      ['effects', 'FX Studio'],
                      ['assembly', 'Assembly'],
                    ] as Array<[RailPresetId, string]>
                  ).map(([id, label]) => (
                    <button key={id} type="button" className="ghost-sm" onClick={() => onApplyRailPreset(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="panel-section">
                <h4>Track Presets</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                  <button type="button" className="ghost-sm" onClick={() => onApplyTrackPreset('standard')}>
                    Standard Edit (V2, V1 + A1)
                  </button>
                  <button type="button" className="ghost-sm" onClick={() => onApplyTrackPreset('multicam4')}>
                    Multi-Cam 4-Angle (V4..V1 + A1..A2)
                  </button>
                  <button type="button" className="ghost-sm" onClick={() => onApplyTrackPreset('podcast')}>
                    Podcast Studio (V1 + A1..A4)
                  </button>
                  <button type="button" className="ghost-sm" onClick={() => onApplyTrackPreset('cinema')}>
                    Cinema Master (V4..V1 + A1..A4)
                  </button>
                </div>
              </div>
              <div className="panel-section">
                <h4>Stock &amp; Graphic Generators</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                  <button type="button" className="ghost-sm" onClick={() => onCreateTextClip(false)}>
                    <Clapperboard size={11} /> Cinematic Lower Third Title
                  </button>
                  <button type="button" className="ghost-sm" onClick={() => onCreateShapeClip('ellipse')}>
                    <Layers size={11} /> Vignette / Spotlight Shape
                  </button>
                  <button type="button" className="ghost-sm" onClick={onCreateAdjustmentLayer}>
                    <Sparkles size={11} /> Master Film Grade Layer
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* INFO, SEQUENCE INDEX, HISTORY & C2PA PANEL */}
          {activePanel === 'info' && (
            <div>
              <div className="panel-title-row">
                <h3>Index, History &amp; Info</h3>
              </div>
              <div className="scope-mode-row" style={{ marginBottom: 10 }}>
                <button type="button" className={infoSub === 'index' ? 'active' : ''} onClick={() => setInfoSub('index')}>
                  <List size={11} /> Index
                </button>
                <button type="button" className={infoSub === 'history' ? 'active' : ''} onClick={() => setInfoSub('history')}>
                  <History size={11} /> History
                </button>
                <button type="button" className={infoSub === 'info' ? 'active' : ''} onClick={() => setInfoSub('info')}>
                  <Info size={11} /> Info
                </button>
                <button type="button" className={infoSub === 'c2pa' ? 'active' : ''} onClick={() => setInfoSub('c2pa')}>
                  <ShieldCheck size={11} /> C2PA
                </button>
              </div>

              {infoSub === 'index' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {clips.length === 0 ? (
                    <p style={{ fontSize: 11, color: 'var(--mute)' }}>Timeline is empty.</p>
                  ) : (
                    clips.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="lut-lib-item"
                        onClick={() => {
                          onSelectClip(c.id);
                          onJumpToTime(c.start);
                        }}
                      >
                        <div className="lut-lib-meta">
                          <span>{c.name}</span>
                          <small className="mono">
                            {formatTimecode(c.start, fps)} ({c.duration.toFixed(1)}s)
                          </small>
                        </div>
                        <span className="hud-chip">{c.clipKind.toUpperCase()}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              {infoSub === 'history' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {history
                    .slice()
                    .reverse()
                    .map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className="lut-lib-item"
                        onClick={() => onRestoreHistory(h.id)}
                      >
                        <div className="lut-lib-meta">
                          <span>{h.label}</span>
                          <small className="mono">{new Date(h.timestamp).toLocaleTimeString()}</small>
                        </div>
                      </button>
                    ))}
                </div>
              )}

              {infoSub === 'info' && (
                <div className="inspector-card" style={{ padding: 10, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="field-row">
                    <span>Sequence</span>
                    <span className="mono">{sequence.width}x{sequence.height} @ {sequence.fps}fps</span>
                  </div>
                  <div className="field-row">
                    <span>Color Space</span>
                    <span className="mono">{sequence.colorSpace}</span>
                  </div>
                  <div className="field-row">
                    <span>Sample Rate</span>
                    <span className="mono">{sequence.sampleRate} Hz</span>
                  </div>
                  {selectedClip && (
                    <>
                      <div style={{ height: 1, background: 'var(--surface-3)', margin: '4px 0' }} />
                      <div className="field-row">
                        <span>Selected Clip</span>
                        <span className="mono">{selectedClip.name}</span>
                      </div>
                      <div className="field-row">
                        <span>Scale / Rot</span>
                        <span className="mono">{selectedClip.transform.scale.toFixed(0)}% / {selectedClip.transform.rotation.toFixed(0)}°</span>
                      </div>
                      <div className="field-row">
                        <span>In / Duration</span>
                        <span className="mono">{formatTimecode(selectedClip.start, fps)} ({selectedClip.duration.toFixed(2)}s)</span>
                      </div>
                      <div className="field-row">
                        <span>Blend Mode</span>
                        <span className="mono">{selectedClip.blendMode}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {infoSub === 'c2pa' && (
                <div className="inspector-card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={credentials.enabled}
                      onChange={(e) => onUpdateCredentials({ enabled: e.target.checked })}
                    />
                    <span>Embed Content Credentials (C2PA)</span>
                  </label>
                  <label className="field-group">
                    <span>Creator</span>
                    <input
                      type="text"
                      value={credentials.creator}
                      onChange={(e) => onUpdateCredentials({ creator: e.target.value })}
                    />
                  </label>
                  <label className="field-group">
                    <span>Organization</span>
                    <input
                      type="text"
                      value={credentials.organization}
                      onChange={(e) => onUpdateCredentials({ organization: e.target.value })}
                    />
                  </label>
                  <label className="field-group">
                    <span>AI / Generative Tools Used</span>
                    <input
                      type="text"
                      value={credentials.aiToolsUsed}
                      onChange={(e) => onUpdateCredentials({ aiToolsUsed: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </aside>
      )}
    </div>
  );
};
