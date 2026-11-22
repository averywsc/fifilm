import React, { useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatTimecode, secondsToFrames } from '../engine/timecode';

interface ViewportProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  playhead: number;
  duration: number;
  fps: number;
  isPlaying: boolean;
  shuttleSpeed: number;
  splitEnabled: boolean;
  splitPos: number;
  compareHeld: boolean;
  activeClipName: string | null;
  activeLutCount: number;
  stabilizedLabel: string | null;
  onSplitPosChange: (pos: number) => void;
  onTogglePlay: () => void;
  onStepFrames: (delta: number) => void;
  onShuttle: (dir: -1 | 0 | 1) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onDropFiles: (files: FileList) => void;
}

export const Viewport: React.FC<ViewportProps> = ({
  canvasRef,
  playhead,
  duration,
  fps,
  isPlaying,
  shuttleSpeed,
  splitEnabled,
  splitPos,
  compareHeld,
  activeClipName,
  activeLutCount,
  stabilizedLabel,
  onSplitPosChange,
  onTogglePlay,
  onStepFrames,
  onShuttle,
  onSeekStart,
  onSeekEnd,
  onMarkIn,
  onMarkOut,
  onDropFiles,
}) => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingSplitRef = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [viewZoom, setViewZoom] = useState<number>(1); // 1 = Fit, up to 4x

  const updateSplitFromClientX = (clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const norm = Math.max(0.03, Math.min(0.97, (clientX - rect.left) / Math.max(1, rect.width)));
    onSplitPosChange(norm);
  };

  return (
    <section
      className="viewport-pane"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) {
          onDropFiles(e.dataTransfer.files);
        }
      }}
    >
      <div
        className="viewport-stage"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
          setViewZoom((z) => Math.max(0.5, Math.min(4, Number((z * factor).toFixed(2)))));
        }}
      >
        {dragOver && (
          <div className="viewport-drop-overlay">
            Drop video or music files (MP4, MOV, WAV, FLAC, MP3) to import
          </div>
        )}

        <div
          className="canvas-frame"
          ref={frameRef}
          style={{ transform: viewZoom === 1 ? undefined : `scale(${viewZoom})` }}
        >
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="viewport-canvas"
            aria-label="Real-time WebGL2 graded video preview"
          />

          <div className="hud-badge">
            <span>{compareHeld ? 'Original Bypass' : activeClipName || 'No clip at playhead'}</span>
            {!compareHeld && activeLutCount > 0 && (
              <span className="hud-chip">{activeLutCount} LUT{activeLutCount > 1 ? 's' : ''}</span>
            )}
            {!compareHeld && stabilizedLabel && <span className="hud-chip">{stabilizedLabel}</span>}
          </div>

          {splitEnabled && !compareHeld && (
            <div
              className="split-divider"
              style={{ left: `${splitPos * 100}%` }}
              onPointerDown={(e) => {
                draggingSplitRef.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                updateSplitFromClientX(e.clientX);
              }}
              onPointerMove={(e) => {
                if (!draggingSplitRef.current) return;
                updateSplitFromClientX(e.clientX);
              }}
              onPointerUp={(e) => {
                draggingSplitRef.current = false;
                e.currentTarget.releasePointerCapture(e.pointerId);
              }}
            />
          )}
        </div>
      </div>

      <div className="transport-bar">
        <span className="timecode-readout" title="Current SMPTE timecode">
          {formatTimecode(playhead, fps)}
        </span>
        <span className="frame-readout">
          Frame {String(secondsToFrames(playhead, fps)).padStart(4, '0')}
        </span>

        <div className="spacer" />

        <button type="button" className="subtle icon-btn" onClick={onSeekStart} title="Jump to start">
          <SkipBack size={13} />
        </button>
        <button type="button" className="subtle icon-btn" onClick={() => onShuttle(-1)} title="Reverse shuttle (J)">
          <Rewind size={13} />
        </button>
        <button type="button" className="subtle icon-btn" onClick={() => onStepFrames(-1)} title="Previous frame (Left)">
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className={isPlaying ? 'active' : 'primary'}
          style={{ minWidth: 74 }}
          onClick={onTogglePlay}
          title="Play or Pause (Space)"
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="subtle icon-btn" onClick={() => onStepFrames(1)} title="Next frame (Right)">
          <ChevronRight size={14} />
        </button>
        <button type="button" className="subtle icon-btn" onClick={() => onShuttle(1)} title="Forward shuttle (L)">
          <FastForward size={13} />
        </button>
        <button type="button" className="subtle icon-btn" onClick={onSeekEnd} title="Jump to end">
          <SkipForward size={13} />
        </button>

        {shuttleSpeed !== 0 && <span className="shuttle-pill">{shuttleSpeed}x</span>}

        <div className="spacer" />

        <button type="button" className="subtle ghost-sm mono" onClick={onMarkIn} title="Mark In (I)">
          IN
        </button>
        <button type="button" className="subtle ghost-sm mono" onClick={onMarkOut} title="Mark Out (O)">
          OUT
        </button>

        <button
          type="button"
          className="subtle icon-btn"
          onClick={() => setViewZoom((z) => Math.max(0.5, Number((z / 1.25).toFixed(2))))}
          title="Zoom out preview"
        >
          <ZoomOut size={13} />
        </button>
        <select
          value={String(viewZoom)}
          onChange={(e) => setViewZoom(Number(e.target.value))}
          aria-label="Preview zoom"
          className="mono"
          style={{ padding: '4px 6px', fontSize: 11 }}
        >
          <option value="0.5">50%</option>
          <option value="1">Fit</option>
          <option value="1.5">150%</option>
          <option value="2">200%</option>
          <option value="3">300%</option>
          <option value="4">400%</option>
        </select>
        <button
          type="button"
          className="subtle icon-btn"
          onClick={() => setViewZoom((z) => Math.min(4, Number((z * 1.25).toFixed(2))))}
          title="Zoom in preview"
        >
          <ZoomIn size={13} />
        </button>

        <span className="frame-readout">{formatTimecode(duration, fps)}</span>
      </div>
    </section>
  );
};
