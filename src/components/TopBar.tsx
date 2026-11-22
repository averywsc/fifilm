import React from 'react';
import {
  ChevronDown,
  Download,
  FolderKanban,
  FolderOpen,
  Home,
  Keyboard,
  Music,
  Redo2,
  RotateCcw,
  Settings,
  SplitSquareHorizontal,
  Undo2,
} from 'lucide-react';
import type { HardwareCapabilities, RailPresetId, SequenceSettings } from '../types/editor';

interface TopBarProps {
  capabilities: HardwareCapabilities | null;
  activeProjectName: string;
  projectCount: number;
  sequence: SequenceSettings;
  railPreset: RailPresetId;
  lastAutoSavedAt: number | null;
  onGoHome: () => void;
  onOpenProjects: () => void;
  onOpenSettings: () => void;
  onSelectRailPreset: (preset: RailPresetId) => void;
  compareHeld: boolean;
  onCompareStart: () => void;
  onCompareEnd: () => void;
  splitEnabled: boolean;
  splitPos: number;
  onSplitEnabledChange: (enabled: boolean) => void;
  onSplitPosChange: (pos: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onImportClick: () => void;
  onImportMusicClick: () => void;
  onResetLook: () => void;
  onShowKeys: () => void;
  onOpenExport: () => void;
}

function formatSeqBadge(seq: SequenceSettings): string {
  const res =
    seq.width >= 3840 && seq.height >= 2160
      ? '4K'
      : seq.width === 1080 && seq.height === 1920
        ? '9:16'
        : seq.width === seq.height
          ? '1:1'
          : `${seq.height}p`;
  return `${res} ${seq.fps}fps`;
}

export const TopBar: React.FC<TopBarProps> = ({
  capabilities,
  activeProjectName,
  projectCount,
  sequence,
  railPreset,
  lastAutoSavedAt,
  onGoHome,
  onOpenProjects,
  onOpenSettings,
  onSelectRailPreset,
  compareHeld,
  onCompareStart,
  onCompareEnd,
  splitEnabled,
  splitPos,
  onSplitEnabledChange,
  onSplitPosChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onImportClick,
  onImportMusicClick,
  onResetLook,
  onShowKeys,
  onOpenExport,
}) => {
  const hwLabel = capabilities?.ffmpegAvailable
    ? capabilities.recommendedEncoder.replace('_', ' ').toUpperCase()
    : 'WEBGL2';

  return (
    <header className="topbar">
      <button
        type="button"
        className="subtle icon-btn"
        onClick={onGoHome}
        title="Return to Home Screen & Tutorial Guide"
      >
        <Home size={13} />
      </button>
      <h1 className="wordmark" style={{ cursor: 'pointer' }} onClick={onGoHome}>
        Fifilm
      </h1>
      <button
        type="button"
        onClick={onOpenProjects}
        title="Switch or manage multiple projects"
        style={{ maxWidth: 148 }}
      >
        <FolderKanban size={13} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {activeProjectName}
        </span>
        {projectCount > 1 && (
          <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
            {projectCount}
          </span>
        )}
        <ChevronDown size={11} style={{ color: 'var(--mute)' }} />
      </button>

      <button
        type="button"
        className="subtle"
        onClick={onOpenSettings}
        title={`Sequence & Project Settings (${sequence.width}x${sequence.height} @ ${sequence.fps}fps | Auto-Scale: ${sequence.autoScaleMedia})`}
      >
        <Settings size={12} />
        <span className="mono" style={{ fontSize: 11 }}>
          {formatSeqBadge(sequence)}
        </span>
      </button>

      <select
        value={railPreset}
        onChange={(e) => onSelectRailPreset(e.target.value as RailPresetId)}
        title="Custom Rail / Workspace Preset"
        style={{ padding: '4px 6px', fontSize: 11, background: 'var(--bg)', color: 'var(--ink)' }}
      >
        <option value="editorial">Editorial</option>
        <option value="color">Color</option>
        <option value="audio">Audio</option>
        <option value="effects">Effects</option>
        <option value="assembly">Assembly</option>
      </select>

      <span className="topbar-meta" title="Hardware engine & auto-save status">
        {hwLabel}
        {lastAutoSavedAt ? ' OK' : ''}
      </span>

      <div className="spacer" />

      <button
        type="button"
        className={compareHeld ? 'active' : ''}
        onPointerDown={onCompareStart}
        onPointerUp={onCompareEnd}
        onPointerLeave={onCompareEnd}
        title="Hold (\) to view original ungraded and unstabilized footage"
      >
        Compare
      </button>

      <label className="split-inline">
        <input
          type="checkbox"
          checked={splitEnabled}
          onChange={(e) => onSplitEnabledChange(e.target.checked)}
        />
        <SplitSquareHorizontal size={12} />
        <span>Split</span>
        <input
          type="range"
          min={5}
          max={95}
          value={Math.round(splitPos * 100)}
          disabled={!splitEnabled}
          onChange={(e) => onSplitPosChange(Number(e.target.value) / 100)}
          aria-label="Split wipe position"
          style={{ width: 52 }}
        />
      </label>

      <button type="button" className="subtle icon-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Undo2 size={13} />
      </button>
      <button type="button" className="subtle icon-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={13} />
      </button>
      <button type="button" className="subtle icon-btn" onClick={onResetLook} title="Reset look on selected clip">
        <RotateCcw size={13} />
      </button>

      <button type="button" onClick={onImportClick} title="Import video clips">
        <FolderOpen size={12} />
        Media
      </button>
      <button type="button" onClick={onImportMusicClick} title="Import music track (WAV/FLAC/MP3) and analyze beats">
        <Music size={12} />
        Music
      </button>
      {!window.fifilm && (
        <a
          href="/download"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 8px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            color: 'var(--ink)',
            fontSize: 11.5,
            fontWeight: 500,
            textDecoration: 'none',
          }}
          title="Download Fifilm Windows .exe installer or portable app"
        >
          <Download size={12} />
          .exe
        </a>
      )}
      <button type="button" className="subtle icon-btn" onClick={onShowKeys} title="Keyboard shortcuts">
        <Keyboard size={13} />
      </button>
      <button type="button" className="primary" onClick={onOpenExport}>
        <Download size={12} />
        Export
      </button>
    </header>
  );
};
