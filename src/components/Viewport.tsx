import React, { useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  FastForward,
  FolderOpen,
  Globe,
  Grid,
  Pause,
  Play,
  Repeat,
  Rewind,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { MonitorOverlaySettings, PlaybackQuality } from '../types/editor';
import { formatTimecode, secondsToFrames } from '../engine/timecode';

interface ViewportProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasMedia: boolean;
  playhead: number;
  duration: number;
  fps: number;
  measuredFps: number;
  droppedFrames: number;
  playbackQuality: PlaybackQuality;
  onPlaybackQualityChange: (q: PlaybackQuality) => void;
  overlays: MonitorOverlaySettings;
  onUpdateOverlays: (patch: Partial<MonitorOverlaySettings>) => void;
  loopInToOut: boolean;
  onToggleLoopInToOut: () => void;
  vrEnabled: boolean;
  onToggleVr: () => void;
  onVrDragDelta: (dyaw: number, dpitch: number) => void;
  multiCamEnabled: boolean;
  multiCamAngles: Array<{ trackId: string; label: string; active: boolean }>;
  onSwitchMultiCamAngle: (trackId: string) => void;
  isPlaying: boolean;
  shuttleSpeed: number;
  onSetShuttleSpeed: (speed: number) => void;
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
  onImportClick: () => void;
  onDropFiles: (files: FileList) => void;
}

export const Viewport: React.FC<ViewportProps> = ({
  canvasRef,
  hasMedia,
  playhead,
  duration,
  fps,
  measuredFps,
  droppedFrames,
  playbackQuality,
  onPlaybackQualityChange,
  overlays,
  onUpdateOverlays,
  loopInToOut,
  onToggleLoopInToOut,
  vrEnabled,
  onToggleVr,
  onVrDragDelta,
  multiCamEnabled,
  multiCamAngles,
  onSwitchMultiCamAngle,
  isPlaying,
  shuttleSpeed,
  onSetShuttleSpeed,
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
  onImportClick,
  onDropFiles,
}) => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const draggingSplitRef = useRef(false);
  const vrDragRef = useRef<{ x: number; y: number } | null>(null);
  const jogDragRef = useRef<{ lastX: number; accum: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [viewZoom, setViewZoom] = useState<number>(1);
  const [jogTick, setJogTick] = useState<number>(0);

  const updateSplitFromClientX = (clientX: number) => {
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const norm = Math.max(0.03, Math.min(0.97, (clientX - rect.left) / Math.max(1, rect.width)));
    onSplitPosChange(norm);
  };

  const anyGuideActive =
    overlays.programSafeGuides || overlays.programRuleOfThirds || overlays.programCenterCross;

  return (
    <section className="viewport-pane">
      <div
        className="viewport-stage"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files);
        }}
      >
        {dragOver && (
          <div className="viewport-drop-overlay">Drop video or music files to import into timeline</div>
        )}

        {/* Multi-Camera Live Switcher Bar */}
        {multiCamEnabled && multiCamAngles.length > 0 && (
          <div className="multicam-bar">
            <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
              MULTI-CAM
            </span>
            {multiCamAngles.map((ang) => (
              <button
                key={ang.trackId}
                type="button"
                className={`ghost-sm ${ang.active ? 'primary' : ''}`}
                onClick={() => onSwitchMultiCamAngle(ang.trackId)}
              >
                {ang.label}
              </button>
            ))}
          </div>
        )}

        <div
          ref={frameRef}
          className="canvas-frame"
          style={{
            display: hasMedia ? 'flex' : 'none',
            transform: `scale(${viewZoom})`,
            cursor: vrEnabled ? 'grab' : 'default',
          }}
          onPointerDown={(e) => {
            if (!vrEnabled) return;
            vrDragRef.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!vrDragRef.current) return;
            const dx = e.clientX - vrDragRef.current.x;
            const dy = e.clientY - vrDragRef.current.y;
            vrDragRef.current = { x: e.clientX, y: e.clientY };
            onVrDragDelta(dx * 0.006, dy * 0.006);
          }}
          onPointerUp={(e) => {
            if (!vrDragRef.current) return;
            vrDragRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <canvas
            ref={canvasRef}
            width={1280}
            height={720}
            className="viewport-canvas"
            aria-label="Real-time WebGL2 Program Monitor"
          />

          {/* Program Monitor Overlays (Action/Title Safe, Rule of Thirds, Crosshair) */}
          {anyGuideActive && (
            <div className="monitor-overlay-layer" aria-hidden="true">
              {overlays.programSafeGuides && (
                <>
                  <div className="guide-action-safe" />
                  <div className="guide-title-safe" />
                </>
              )}
              {overlays.programRuleOfThirds && (
                <>
                  <div className="guide-thirds-v" style={{ left: '33.33%' }} />
                  <div className="guide-thirds-v" style={{ left: '66.66%' }} />
                  <div className="guide-thirds-h" style={{ top: '33.33%' }} />
                  <div className="guide-thirds-h" style={{ top: '66.66%' }} />
                </>
              )}
              {overlays.programCenterCross && <div className="guide-crosshair" />}
            </div>
          )}

          {/* Timecode Burn-In Overlay */}
          {overlays.timecodeBurnIn && (
            <div className="tc-burnin-badge">
              {formatTimecode(playhead, fps)}
            </div>
          )}

          <div className="hud-badge">
            <span>{compareHeld ? 'Original Bypass' : activeClipName || 'Program Monitor'}</span>
            {!compareHeld && activeLutCount > 0 && (
              <span className="hud-chip">{activeLutCount} LUT{activeLutCount > 1 ? 's' : ''}</span>
            )}
            {!compareHeld && stabilizedLabel && <span className="hud-chip">{stabilizedLabel}</span>}
            {vrEnabled && <span className="hud-chip">VR 360</span>}
          </div>

          {splitEnabled && !compareHeld && (
            <div
              className="split-divider"
              style={{ left: `${splitPos * 100}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
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

        {!hasMedia && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
              textAlign: 'center',
              maxWidth: 360,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
              Drop video or music files here
            </div>
            <div style={{ fontSize: 12, color: 'var(--mute)' }}>
              MP4, MOV, WebM, MKV, WAV, FLAC, or MP3
            </div>
            <button type="button" className="primary" onClick={onImportClick}>
              <FolderOpen size={14} />
              Import Media
            </button>
          </div>
        )}
      </div>

      <div className="transport-bar">
        <span className="timecode-readout" title="Current SMPTE timecode">
          {formatTimecode(playhead, fps)}
        </span>
        <span className="frame-readout">
          F{String(secondsToFrames(playhead, fps)).padStart(4, '0')}
        </span>

        {/* Dropped Frame & Playback FPS Telemetry Indicator */}
        <span
          className="mono"
          title={`Playback FPS: ${measuredFps.toFixed(1)} | Dropped frames: ${droppedFrames}`}
          style={{
            fontSize: 10,
            padding: '2px 5px',
            borderRadius: 4,
            background: 'var(--bg)',
            color: droppedFrames > 0 ? 'var(--warn)' : 'var(--ok)',
          }}
        >
          {droppedFrames > 0 ? `DROP ${droppedFrames}` : `${Math.round(measuredFps || fps)} FPS`}
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
          style={{ minWidth: 66 }}
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

        {/* Interactive Jog Wheel Control */}
        <div
          className="jog-wheel"
          title="Jog Wheel: drag left/right to scrub frame-by-frame"
          style={{ backgroundPositionX: `${jogTick * 6}px` }}
          onPointerDown={(e) => {
            jogDragRef.current = { lastX: e.clientX, accum: 0 };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!jogDragRef.current) return;
            const dx = e.clientX - jogDragRef.current.lastX;
            jogDragRef.current.lastX = e.clientX;
            jogDragRef.current.accum += dx;
            const stepPx = 7;
            if (Math.abs(jogDragRef.current.accum) >= stepPx) {
              const frames = Math.trunc(jogDragRef.current.accum / stepPx);
              jogDragRef.current.accum -= frames * stepPx;
              setJogTick((t) => t + frames);
              onStepFrames(frames);
            }
          }}
          onPointerUp={(e) => {
            jogDragRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <span>JOG</span>
        </div>

        {/* Shuttle Speed Slider */}
        <input
          type="range"
          min={-4}
          max={4}
          step={0.5}
          value={shuttleSpeed}
          onChange={(e) => onSetShuttleSpeed(Number(e.target.value))}
          onPointerUp={() => onSetShuttleSpeed(0)}
          title={`Shuttle Speed Control (${shuttleSpeed}x)`}
          aria-label="Shuttle speed control"
          style={{ width: 54 }}
        />
        {shuttleSpeed !== 0 && <span className="shuttle-pill">{shuttleSpeed}x</span>}

        <div className="spacer" />

        <button
          type="button"
          className={`ghost-sm ${loopInToOut ? 'active' : 'subtle'}`}
          onClick={onToggleLoopInToOut}
          title="Play In to Out Loop"
        >
          <Repeat size={11} />
        </button>

        <button
          type="button"
          className={`ghost-sm ${anyGuideActive ? 'active' : 'subtle'}`}
          onClick={() => {
            if (!overlays.programSafeGuides && !overlays.programRuleOfThirds) {
              onUpdateOverlays({ programSafeGuides: true, programRuleOfThirds: true, programCenterCross: true });
            } else {
              onUpdateOverlays({ programSafeGuides: false, programRuleOfThirds: false, programCenterCross: false });
            }
          }}
          title="Toggle Program Monitor Overlays (Title/Action Safe, Rule of Thirds, Crosshair)"
        >
          <Grid size={11} />
        </button>

        <button
          type="button"
          className={`ghost-sm ${overlays.timecodeBurnIn ? 'active' : 'subtle'}`}
          onClick={() => onUpdateOverlays({ timecodeBurnIn: !overlays.timecodeBurnIn })}
          title="Toggle Timecode Burn-in Overlay"
        >
          <Clock size={11} />
          TC
        </button>

        <button
          type="button"
          className={`ghost-sm ${vrEnabled ? 'active' : 'subtle'}`}
          onClick={onToggleVr}
          title="Toggle VR 360 equirectangular preview"
        >
          <Globe size={11} />
          VR
        </button>

        <select
          value={playbackQuality}
          onChange={(e) => onPlaybackQualityChange(e.target.value as PlaybackQuality)}
          aria-label="Playback resolution quality"
          className="mono"
          style={{ padding: '4px 5px', fontSize: 11 }}
          title="High Quality / Half / Quarter playback resolution"
        >
          <option value="full">Full HQ</option>
          <option value="half">1/2</option>
          <option value="quarter">1/4</option>
        </select>

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
          <ZoomOut size={12} />
        </button>
        <select
          value={String(viewZoom)}
          onChange={(e) => setViewZoom(Number(e.target.value))}
          aria-label="Preview zoom"
          className="mono"
          style={{ padding: '4px 4px', fontSize: 11 }}
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
          <ZoomIn size={12} />
        </button>

        <span className="frame-readout">{formatTimecode(duration, fps)}</span>
      </div>
    </section>
  );
};
