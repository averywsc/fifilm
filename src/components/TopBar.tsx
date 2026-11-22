import React from 'react';
import {
  Download,
  FolderOpen,
  Keyboard,
  Music,
  Redo2,
  RotateCcw,
  SplitSquareHorizontal,
  Undo2,
} from 'lucide-react';
import type { HardwareCapabilities } from '../types/editor';

interface TopBarProps {
  capabilities: HardwareCapabilities | null;
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

export const TopBar: React.FC<TopBarProps> = ({
  capabilities,
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
      <h1 className="wordmark">Fifilm</h1>
      <span className="topbar-meta" title="Detected hardware acceleration engine">
        {hwLabel}
      </span>

      <div className="spacer" />

      <button
        type="button"
        className={compareHeld ? 'active' : ''}
        onPointerDown={onCompareStart}
        onPointerUp={onCompareEnd}
        onPointerLeave={onCompareEnd}
        title="Hold to view original ungraded and unstabilized footage"
      >
        Hold to compare
      </button>

      <label className="split-inline">
        <input
          type="checkbox"
          checked={splitEnabled}
          onChange={(e) => onSplitEnabledChange(e.target.checked)}
        />
        <SplitSquareHorizontal size={13} />
        <span>Split</span>
        <input
          type="range"
          min={5}
          max={95}
          value={Math.round(splitPos * 100)}
          disabled={!splitEnabled}
          onChange={(e) => onSplitPosChange(Number(e.target.value) / 100)}
          aria-label="Split wipe position"
        />
      </label>

      <button type="button" className="subtle" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
        <Undo2 size={14} />
      </button>
      <button type="button" className="subtle" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
        <Redo2 size={14} />
      </button>
      <button type="button" className="subtle" onClick={onResetLook} title="Reset color and effects on selected clip">
        <RotateCcw size={13} />
        Reset
      </button>

      <button type="button" onClick={onImportClick} title="Import video clips">
        <FolderOpen size={13} />
        Media
      </button>
      <button type="button" onClick={onImportMusicClick} title="Import music track (WAV/FLAC/MP3) and analyze beats">
        <Music size={13} />
        Music
      </button>
      {!window.fifilm && (
        <a
          href="/download"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 11px',
            borderRadius: 6,
            background: 'var(--surface-2)',
            color: 'var(--ink)',
            fontSize: 12,
            fontWeight: 500,
            textDecoration: 'none',
          }}
          title="Download Fifilm Windows .exe installer or portable app"
        >
          <Download size={13} />
          Get .exe
        </a>
      )}
      <button type="button" className="subtle icon-btn" onClick={onShowKeys} title="Keyboard shortcuts">
        <Keyboard size={14} />
      </button>
      <button type="button" className="primary" onClick={onOpenExport}>
        <Download size={13} />
        Export
      </button>
    </header>
  );
};
