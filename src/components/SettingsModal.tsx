import React, { useState } from 'react';
import { Check, Cpu, Film, Layers, Save, Settings, Trash2, X } from 'lucide-react';
import type {
  AutoScaleMode,
  ProjectSettings,
  RailPresetId,
  RenderRange,
  SequenceSettings,
  TrackPresetId,
} from '../types/editor';

interface SettingsModalProps {
  sequence: SequenceSettings;
  projectSettings: ProjectSettings;
  renderRanges: RenderRange[];
  lastAutoSavedAt: number | null;
  onSaveSettings: (
    nextSeq: SequenceSettings,
    nextProj: ProjectSettings,
    rescaleExistingClips: boolean
  ) => void;
  onApplyTrackPreset: (preset: TrackPresetId) => void;
  onApplyRailPreset: (preset: RailPresetId) => void;
  onRenderInToOut: () => void;
  onDeleteRenderFiles: () => void;
  onClose: () => void;
}

const RES_PRESETS: Array<{ label: string; w: number; h: number }> = [
  { label: '4K UHD (3840x2160)', w: 3840, h: 2160 },
  { label: '4K DCI (4096x2160)', w: 4096, h: 2160 },
  { label: '2.7K (2704x1520)', w: 2704, h: 1520 },
  { label: '1080p HD (1920x1080)', w: 1920, h: 1080 },
  { label: '720p HD (1280x720)', w: 1280, h: 720 },
  { label: 'Vertical 9:16 (1080x1920)', w: 1080, h: 1920 },
  { label: 'Square 1:1 (1080x1080)', w: 1080, h: 1080 },
];

const FPS_OPTIONS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  sequence,
  projectSettings,
  renderRanges,
  lastAutoSavedAt,
  onSaveSettings,
  onApplyTrackPreset,
  onApplyRailPreset,
  onRenderInToOut,
  onDeleteRenderFiles,
  onClose,
}) => {
  const [tab, setTab] = useState<'sequence' | 'project' | 'presets'>('sequence');
  const [seq, setSeq] = useState<SequenceSettings>({ ...sequence });
  const [proj, setProj] = useState<ProjectSettings>({ ...projectSettings });
  const [rescaleExisting, setRescaleExisting] = useState<boolean>(true);

  const handleApply = () => {
    onSaveSettings(seq, proj, rescaleExisting);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ width: 'min(660px, 94vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={15} />
            <h3>Project &amp; Sequence Settings</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className="scope-mode-row" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={tab === 'sequence' ? 'active' : ''}
            onClick={() => setTab('sequence')}
          >
            <Film size={12} /> Sequence Settings
          </button>
          <button
            type="button"
            className={tab === 'project' ? 'active' : ''}
            onClick={() => setTab('project')}
          >
            <Cpu size={12} /> Project &amp; Auto-Save
          </button>
          <button
            type="button"
            className={tab === 'presets' ? 'active' : ''}
            onClick={() => setTab('presets')}
          >
            <Layers size={12} /> Rail &amp; Track Presets
          </button>
        </div>

        {tab === 'sequence' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="modal-grid">
              <label className="field-group">
                <span>Sequence Name</span>
                <input
                  type="text"
                  value={seq.name}
                  onChange={(e) => setSeq({ ...seq, name: e.target.value })}
                />
              </label>

              <label className="field-group">
                <span>Frame Rate (FPS)</span>
                <select
                  value={seq.fps}
                  onChange={(e) => setSeq({ ...seq, fps: Number(e.target.value) })}
                >
                  {FPS_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-group">
              <span>Resolution Presets</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {RES_PRESETS.map((p) => {
                  const active = seq.width === p.w && seq.height === p.h;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`ghost-sm ${active ? 'primary' : ''}`}
                      onClick={() => setSeq({ ...seq, width: p.w, height: p.h })}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="modal-grid">
              <label className="field-group">
                <span>Frame Width (px)</span>
                <input
                  type="number"
                  min={320}
                  max={7680}
                  step={2}
                  value={seq.width}
                  onChange={(e) => setSeq({ ...seq, width: Math.max(320, Number(e.target.value) || 1920) })}
                />
              </label>
              <label className="field-group">
                <span>Frame Height (px)</span>
                <input
                  type="number"
                  min={240}
                  max={4320}
                  step={2}
                  value={seq.height}
                  onChange={(e) => setSeq({ ...seq, height: Math.max(240, Number(e.target.value) || 1080) })}
                />
              </label>
            </div>

            <div className="inspector-card" style={{ padding: 12 }}>
              <div className="panel-title-row" style={{ marginBottom: 6 }}>
                <h4>Auto-Scale Media to Sequence Resolution</h4>
                <span className="hud-chip">
                  {seq.width}x{seq.height}
                </span>
              </div>
              <p style={{ fontSize: 11, color: 'var(--mute)', marginBottom: 10 }}>
                Automatically fits mismatched footage: e.g. uploading 1080p footage to a 4K sequence scales to 200%, and 4K footage on a 1080p sequence scales to 50%.
              </p>
              <div className="scope-mode-row" style={{ marginBottom: 8 }}>
                {(
                  [
                    ['fit', 'Auto Fit (Recommended)'],
                    ['fill', 'Auto Fill (Cover)'],
                    ['none', 'Native 100% (Off)'],
                  ] as Array<[AutoScaleMode, string]>
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={seq.autoScaleMedia === mode ? 'active' : ''}
                    onClick={() => setSeq({ ...seq, autoScaleMedia: mode })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="toggle-row" style={{ marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={rescaleExisting}
                  onChange={(e) => setRescaleExisting(e.target.checked)}
                />
                <span>Auto-rescale existing clips to match new sequence resolution</span>
              </label>
            </div>

            <div className="modal-grid">
              <label className="field-group">
                <span>Audio Sample Rate</span>
                <select
                  value={seq.sampleRate}
                  onChange={(e) =>
                    setSeq({ ...seq, sampleRate: Number(e.target.value) as 44100 | 48000 | 96000 })
                  }
                >
                  <option value={44100}>44,100 Hz (CD / Music)</option>
                  <option value={48000}>48,000 Hz (Broadcast / Film)</option>
                  <option value={96000}>96,000 Hz (Hi-Res Studio)</option>
                </select>
              </label>
              <label className="field-group">
                <span>Working Color Space</span>
                <select
                  value={seq.colorSpace}
                  onChange={(e) =>
                    setSeq({
                      ...seq,
                      colorSpace: e.target.value as SequenceSettings['colorSpace'],
                    })
                  }
                >
                  <option value="Rec.709">Rec.709 (Standard HD/Web)</option>
                  <option value="Rec.2020">Rec.2020 (HDR / 4K)</option>
                  <option value="Display P3">Display P3 (Wide Gamut)</option>
                  <option value="ACEScg">ACEScg (Cinema Linear)</option>
                </select>
              </label>
            </div>
          </div>
        )}

        {tab === 'project' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="modal-grid">
              <label className="field-group">
                <span>GPU Renderer</span>
                <select
                  value={proj.renderer}
                  onChange={(e) =>
                    setProj({ ...proj, renderer: e.target.value as ProjectSettings['renderer'] })
                  }
                >
                  <option value="WebGL2 GPU">WebGL2 Hardware GPU Pipeline</option>
                  <option value="Software Fallback">Software Compatibility</option>
                </select>
              </label>
              <label className="field-group">
                <span>Scratch Disk / Cache</span>
                <input
                  type="text"
                  value={proj.scratchDisk}
                  onChange={(e) => setProj({ ...proj, scratchDisk: e.target.value })}
                />
              </label>
            </div>

            <div className="inspector-card" style={{ padding: 12 }}>
              <div className="panel-title-row" style={{ marginBottom: 8 }}>
                <h4>Project &amp; Sequence Auto-Save</h4>
                {lastAutoSavedAt && (
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ok)' }}>
                    Saved {new Date(lastAutoSavedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <label className="toggle-row" style={{ marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={proj.autoSaveEnabled}
                  onChange={(e) => setProj({ ...proj, autoSaveEnabled: e.target.checked })}
                />
                <span>Enable automatic Project &amp; Sequence backups</span>
              </label>
              <div className="modal-grid">
                <label className="field-group">
                  <span>Project Auto-Save Interval</span>
                  <select
                    value={proj.autoSaveIntervalSec}
                    onChange={(e) =>
                      setProj({
                        ...proj,
                        autoSaveIntervalSec: Number(e.target.value) as ProjectSettings['autoSaveIntervalSec'],
                      })
                    }
                  >
                    <option value={0}>Off</option>
                    <option value={15}>Every 15 seconds</option>
                    <option value={30}>Every 30 seconds</option>
                    <option value={60}>Every 1 minute</option>
                    <option value={300}>Every 5 minutes</option>
                  </select>
                </label>
                <label className="field-group">
                  <span>Sequence Auto-Save Interval</span>
                  <select
                    value={seq.autoSaveIntervalSec}
                    onChange={(e) =>
                      setSeq({
                        ...seq,
                        autoSaveIntervalSec: Number(e.target.value) as SequenceSettings['autoSaveIntervalSec'],
                      })
                    }
                  >
                    <option value={0}>Off</option>
                    <option value={15}>Every 15 seconds</option>
                    <option value={30}>Every 30 seconds</option>
                    <option value={60}>Every 1 minute</option>
                    <option value={300}>Every 5 minutes</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="modal-grid">
              <label className="field-group">
                <span>Default Video Transition (sec)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0.1}
                  max={5}
                  value={proj.defaultTransitionSec}
                  onChange={(e) =>
                    setProj({ ...proj, defaultTransitionSec: Math.max(0.1, Number(e.target.value) || 0.5) })
                  }
                />
              </label>
              <label className="field-group">
                <span>Default Audio Fade / Crossfade (sec)</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  max={5}
                  value={proj.defaultAudioFadeSec}
                  onChange={(e) =>
                    setProj({ ...proj, defaultAudioFadeSec: Math.max(0.05, Number(e.target.value) || 0.4) })
                  }
                />
              </label>
            </div>

            <div className="inspector-card" style={{ padding: 12 }}>
              <div className="panel-title-row" style={{ marginBottom: 8 }}>
                <h4>Sequence Render Cache ({renderRanges.length} cached segments)</h4>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="ghost-sm" onClick={onRenderInToOut}>
                  <Save size={12} /> Render In to Out
                </button>
                <button type="button" className="ghost-sm" onClick={onDeleteRenderFiles}>
                  <Trash2 size={12} /> Delete Render Files
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'presets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="inspector-card" style={{ padding: 12 }}>
              <h4 style={{ marginBottom: 8 }}>Custom Rail / Workspace Presets</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(
                  [
                    ['editorial', 'Editorial', 'Project Bin + Motion'],
                    ['color', 'Lumetri Color', 'Scopes + Color Grading'],
                    ['audio', 'Audio & Mix', 'Essential Sound + Mixers'],
                    ['effects', 'Effects Studio', 'FX Browser + FX Controls'],
                    ['assembly', 'Assembly', 'Source Monitor + Timeline'],
                  ] as Array<[RailPresetId, string, string]>
                ).map(([id, title, sub]) => (
                  <button
                    key={id}
                    type="button"
                    className={`stab-mode-btn ${proj.railPreset === id ? 'active' : ''}`}
                    onClick={() => {
                      setProj({ ...proj, railPreset: id });
                      onApplyRailPreset(id);
                    }}
                  >
                    <strong>{title}</strong>
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="inspector-card" style={{ padding: 12 }}>
              <h4 style={{ marginBottom: 8 }}>Track Layout Presets</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {(
                  [
                    ['standard', 'Standard Edit', 'V2, V1 + A1'],
                    ['multicam4', 'Multi-Cam 4-Angle', 'V4, V3, V2, V1 + A1, A2'],
                    ['podcast', 'Podcast / Dialogue', 'V1 + A1 Host, A2 Guest, A3 Music, A4 SFX'],
                    ['cinema', 'Cinema Master', 'V4 Title, V3 Adj, V2 B-Roll, V1 Main + 4 Audio'],
                  ] as Array<[TrackPresetId, string, string]>
                ).map(([id, title, sub]) => (
                  <button
                    key={id}
                    type="button"
                    className="stab-mode-btn"
                    onClick={() => onApplyTrackPreset(id)}
                  >
                    <strong>{title}</strong>
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="modal-actions" style={{ marginTop: 18 }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={handleApply}>
            <Check size={13} /> Save Settings
          </button>
        </div>
      </div>
    </div>
  );
};
