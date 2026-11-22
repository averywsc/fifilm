import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Magnet,
  Maximize2,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  BeatSnapTarget,
  MediaAsset,
  SnapGuide,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
} from '../types/editor';
import { formatTimecode, resolveMagneticSnap, snapToFrame } from '../engine/timecode';

interface TimelineProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  assets: Map<string, MediaAsset>;
  markers: TimelineMarker[];
  beatPoints: { beats: number[]; downbeats: number[]; transients: number[] };
  detectedBpm: number | null;
  showBeats: boolean;
  onToggleShowBeats: () => void;
  onAlignCutsToBeats: (target: BeatSnapTarget, toleranceMs: number) => void;
  alignFeedback: string;
  playhead: number;
  fps: number;
  selectedClipId: string | null;
  snapEnabled: boolean;
  viewAllLayers: boolean;
  onToggleViewAllLayers: () => void;
  inPoint: number | null;
  outPoint: number | null;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pps: number) => void;
  onPlayheadChange: (time: number) => void;
  onSelectClip: (id: string | null) => void;
  onToggleSnap: () => void;
  onBladeSplit: () => void;
  onDeleteClip: (ripple: boolean) => void;
  onAddMarker: () => void;
  onAddTrack: (kind: 'video' | 'audio') => void;
  onRemoveTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, dir: -1 | 1) => void;
  onToggleTrackFlag: (trackId: string, flag: 'muted' | 'solo' | 'locked' | 'visible') => void;
  onMoveClip: (clipId: string, newStart: number, newTrackId?: string) => void;
  onTrimClip: (clipId: string, edge: 'left' | 'right', newTime: number) => void;
  onCommitHistory: () => void;
}

const WaveformSvg: React.FC<{ peaks: number[]; clip: TimelineClip }> = React.memo(({ peaks, clip }) => {
  if (!peaks.length) return null;
  const startRatio = clip.sourceDuration > 0 ? clip.sourceIn / clip.sourceDuration : 0;
  const endRatio =
    clip.sourceDuration > 0 ? Math.min(1, (clip.sourceIn + clip.duration) / clip.sourceDuration) : 1;
  const i0 = Math.floor(startRatio * peaks.length);
  const i1 = Math.max(i0 + 2, Math.ceil(endRatio * peaks.length));
  const slice = peaks.slice(i0, i1);
  if (!slice.length) return null;

  const w = 220;
  const h = 24;
  const step = w / slice.length;
  const bars = slice
    .map((p, i) => {
      const bh = Math.max(1.5, p * (h - 2));
      const x = (i * step).toFixed(1);
      const y = (h - bh).toFixed(1);
      return `M${x},${h}V${y}`;
    })
    .join('');

  return (
    <svg className="clip-waveform" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={bars} stroke="rgba(165, 198, 255, 0.5)" strokeWidth={Math.max(1, step * 0.72)} fill="none" />
    </svg>
  );
});

// Logarithmic zoom slider mapping for smooth zoom from 4 px/s up to 1600 px/s
const MIN_PPS = 4;
const MAX_PPS = 1600;
const ppsToSlider = (pps: number) =>
  Math.round((Math.log(Math.max(MIN_PPS, Math.min(MAX_PPS, pps)) / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000);
const sliderToPps = (val: number) =>
  MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Math.max(0, Math.min(1000, val)) / 1000);

export const Timeline: React.FC<TimelineProps> = ({
  tracks,
  clips,
  assets,
  markers,
  beatPoints,
  detectedBpm,
  showBeats,
  onToggleShowBeats,
  onAlignCutsToBeats,
  alignFeedback,
  playhead,
  fps,
  selectedClipId,
  snapEnabled,
  viewAllLayers,
  onToggleViewAllLayers,
  inPoint,
  outPoint,
  pixelsPerSecond,
  onPixelsPerSecondChange,
  onPlayheadChange,
  onSelectClip,
  onToggleSnap,
  onBladeSplit,
  onDeleteClip,
  onAddMarker,
  onAddTrack,
  onRemoveTrack,
  onMoveTrack,
  onToggleTrackFlag,
  onMoveClip,
  onTrimClip,
  onCommitHistory,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [activeGuide, setActiveGuide] = useState<SnapGuide | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(250);
  const [beatTarget, setBeatTarget] = useState<BeatSnapTarget>('all');
  const [toleranceMs, setToleranceMs] = useState(140);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setBodyHeight(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Dynamic track height: View All Layers shrinks every track to fit cleanly without scrolling
  const trackRowHeight = useMemo(() => {
    if (!viewAllLayers) return 54;
    const avail = Math.max(80, bodyHeight - 34);
    const perTrack = Math.floor(avail / Math.max(1, tracks.length)) - 2;
    return Math.max(24, Math.min(68, perTrack));
  }, [viewAllLayers, bodyHeight, tracks.length]);

  const sequenceEnd = useMemo(
    () => clips.reduce((acc, c) => Math.max(acc, c.start + c.duration), 0),
    [clips]
  );

  const totalTimelineSec = Math.max(30, sequenceEnd + 15);
  const timelineWidthPx = Math.max(1100, Math.ceil(totalTimelineSec * pixelsPerSecond));

  const majorStepSec = useMemo(() => {
    if (pixelsPerSecond >= 600) return 0.25;
    if (pixelsPerSecond >= 240) return 0.5;
    if (pixelsPerSecond >= 110) return 1;
    if (pixelsPerSecond >= 55) return 2;
    if (pixelsPerSecond >= 22) return 5;
    if (pixelsPerSecond >= 10) return 10;
    return 30;
  }, [pixelsPerSecond]);

  const ticks = useMemo(() => {
    const out: Array<{ time: number; major: boolean }> = [];
    const minorStep = majorStepSec >= 1 ? majorStepSec / 4 : majorStepSec / 2;
    const maxTicks = 1200;
    let count = 0;
    for (let t = 0; t <= totalTimelineSec && count < maxTicks; t += minorStep, count++) {
      const rounded = Math.round(t * 1000) / 1000;
      const rem = Math.abs(rounded % majorStepSec);
      const isMajor = rem < 0.002 || Math.abs(rem - majorStepSec) < 0.002;
      out.push({ time: rounded, major: isMajor });
    }
    return out;
  }, [totalTimelineSec, majorStepSec]);

  const clientXToTime = (clientX: number): number => {
    const sc = scrollRef.current;
    if (!sc) return 0;
    const rect = sc.getBoundingClientRect();
    const x = clientX - rect.left + sc.scrollLeft;
    return Math.max(0, x / pixelsPerSecond);
  };

  const handleFitTimeline = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    const availW = Math.max(300, sc.clientWidth - 40);
    const fitDur = Math.max(4, sequenceEnd + 1);
    onPixelsPerSecondChange(Math.max(MIN_PPS, Math.min(MAX_PPS, availW / fitDur)));
    sc.scrollLeft = 0;
  };

  // Cursor-centered Ctrl+Wheel zoom across 4..1600 px/s
  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const sc = scrollRef.current;
    if (!sc) return;
    const rect = sc.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const timeAtCursor = (sc.scrollLeft + cursorX) / pixelsPerSecond;
    const factor = e.deltaY < 0 ? 1.24 : 1 / 1.24;
    const nextPps = Math.max(MIN_PPS, Math.min(MAX_PPS, pixelsPerSecond * factor));
    onPixelsPerSecondChange(nextPps);
    requestAnimationFrame(() => {
      sc.scrollLeft = Math.max(0, timeAtCursor * nextPps - cursorX);
    });
  };

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (e: PointerEvent) => {
      const raw = clientXToTime(e.clientX);
      const { snappedTime, guide } = resolveMagneticSnap({
        candidateTime: raw,
        playhead: -999,
        clips,
        markers,
        beatPoints,
        snapToBeats: showBeats,
        sequenceEnd,
        pixelsPerSecond,
        snapEnabled,
      });
      setActiveGuide(guide);
      onPlayheadChange(snapToFrame(snappedTime, fps));
    };
    const onUp = () => {
      setScrubbing(false);
      setActiveGuide(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [scrubbing, clips, markers, beatPoints, showBeats, sequenceEnd, pixelsPerSecond, snapEnabled, fps]);

  const startClipDrag = (e: React.PointerEvent, clip: TimelineClip) => {
    if (e.button !== 0) return;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    e.stopPropagation();
    onSelectClip(clip.id);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origStart = clip.start;
    const origTrackIndex = tracks.findIndex((t) => t.id === clip.trackId);
    const sameKindTracks = tracks.filter((t) => t.kind === track?.kind);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / pixelsPerSecond;
      const dyTracks = Math.round((ev.clientY - startClientY) / (trackRowHeight + 2));
      const candidate = Math.max(0, origStart + dxSec);
      const { snappedTime, guide } = resolveMagneticSnap({
        candidateTime: candidate,
        clipDuration: clip.duration,
        excludeClipId: clip.id,
        playhead,
        clips,
        markers,
        beatPoints,
        snapToBeats: showBeats,
        sequenceEnd,
        pixelsPerSecond,
        snapEnabled,
      });
      setActiveGuide(guide);

      let nextTrackId = clip.trackId;
      const targetIdx = Math.max(0, Math.min(tracks.length - 1, origTrackIndex + dyTracks));
      const targetTrack = tracks[targetIdx];
      if (targetTrack && targetTrack.kind === track?.kind && !targetTrack.locked && sameKindTracks.length > 1) {
        nextTrackId = targetTrack.id;
      }

      moved = true;
      onMoveClip(clip.id, snapToFrame(snappedTime, fps), nextTrackId);
    };

    const onUp = () => {
      setActiveGuide(null);
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startClipTrim = (e: React.PointerEvent, clip: TimelineClip, edge: 'left' | 'right') => {
    if (e.button !== 0) return;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    e.stopPropagation();
    onSelectClip(clip.id);

    const startClientX = e.clientX;
    const origEdgeTime = edge === 'left' ? clip.start : clip.start + clip.duration;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / pixelsPerSecond;
      const candidate = Math.max(0, origEdgeTime + dxSec);
      const { snappedTime, guide } = resolveMagneticSnap({
        candidateTime: candidate,
        excludeClipId: clip.id,
        playhead,
        clips,
        markers,
        beatPoints,
        snapToBeats: showBeats,
        sequenceEnd,
        pixelsPerSecond,
        snapEnabled,
      });
      setActiveGuide(guide);
      moved = true;
      onTrimClip(clip.id, edge, snapToFrame(snappedTime, fps));
    };

    const onUp = () => {
      setActiveGuide(null);
      if (moved) onCommitHistory();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const compactTrack = trackRowHeight < 34;

  return (
    <section className="timeline-dock">
      <div className="timeline-toolbar">
        <button
          type="button"
          className={snapEnabled ? 'active' : ''}
          onClick={onToggleSnap}
          title="Toggle magnetic snapping to clips, playhead, and musical beats (N)"
        >
          <Magnet size={13} />
          Snap
        </button>

        <button type="button" onClick={onBladeSplit} title="Split clip at playhead (B)">
          <Scissors size={13} />
          Split
        </button>

        <button
          type="button"
          className="subtle"
          disabled={!selectedClipId}
          onClick={() => onDeleteClip(false)}
          title="Delete selected clip"
        >
          <Trash2 size={13} />
        </button>

        <button
          type="button"
          className="subtle"
          disabled={!selectedClipId}
          onClick={() => onDeleteClip(true)}
          title="Ripple delete selected clip (Shift+Delete)"
        >
          Ripple
        </button>

        <button type="button" className="subtle" onClick={onAddMarker} title="Add marker (M)">
          <Bookmark size={13} />
        </button>

        {/* Music-to-Timeline Sync Controls */}
        <button
          type="button"
          className={showBeats ? 'active' : 'subtle'}
          onClick={onToggleShowBeats}
          title="Toggle beat, downbeat, and percussive transient overlay and snapping"
        >
          <AudioWaveform size={13} />
          {detectedBpm ? `${detectedBpm.toFixed(1)} BPM` : 'Beat Grid'}
        </button>

        <div className="align-popover" title="Auto-align cuts to nearest musical beat or transient">
          <select
            value={beatTarget}
            onChange={(e) => setBeatTarget(e.target.value as BeatSnapTarget)}
            style={{ padding: '3px 6px', fontSize: 11, background: 'var(--bg)' }}
          >
            <option value="all">All Hits</option>
            <option value="beat">Beats</option>
            <option value="downbeat">Downbeats</option>
            <option value="transient">Transients</option>
          </select>
          <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
            ±{toleranceMs}ms
          </span>
          <input
            type="range"
            min={30}
            max={350}
            step={10}
            value={toleranceMs}
            style={{ width: 52 }}
            onChange={(e) => setToleranceMs(Number(e.target.value))}
            aria-label="Beat align snap tolerance in milliseconds"
          />
          <button
            type="button"
            className="ghost-sm"
            onClick={() => onAlignCutsToBeats(beatTarget, toleranceMs)}
          >
            <Sparkles size={11} />
            Align Cuts
          </button>
        </div>

        {alignFeedback && (
          <span className="mono" style={{ fontSize: 11, color: 'var(--ok)' }}>
            {alignFeedback}
          </span>
        )}

        <div className="spacer" />

        {/* Layer Controls & View All Layers */}
        <button type="button" className="subtle ghost-sm" onClick={() => onAddTrack('video')} title="Add video layer">
          <Plus size={11} />V
        </button>
        <button type="button" className="subtle ghost-sm" onClick={() => onAddTrack('audio')} title="Add audio layer">
          <Plus size={11} />A
        </button>

        <button
          type="button"
          className={viewAllLayers ? 'active' : ''}
          onClick={onToggleViewAllLayers}
          title="Shrink tracks to view all layers at once (Shift+V)"
        >
          <Layers size={13} />
          All Layers ({tracks.length})
        </button>

        {/* Extended Timeline Zoom Controls (4 px/s -> 1600 px/s) */}
        <button
          type="button"
          className="subtle icon-btn"
          onClick={handleFitTimeline}
          title="Fit entire sequence horizontally (Shift+Z)"
        >
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          className="subtle icon-btn"
          onClick={() => onPixelsPerSecondChange(Math.max(MIN_PPS, pixelsPerSecond / 1.5))}
          title="Zoom out timeline"
        >
          <ZoomOut size={13} />
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={ppsToSlider(pixelsPerSecond)}
          style={{ width: 108 }}
          onChange={(e) => onPixelsPerSecondChange(sliderToPps(Number(e.target.value)))}
          aria-label="Timeline horizontal zoom"
        />
        <button
          type="button"
          className="subtle icon-btn"
          onClick={() => onPixelsPerSecondChange(Math.min(MAX_PPS, pixelsPerSecond * 1.5))}
          title="Zoom in timeline (up to frame level)"
        >
          <ZoomIn size={13} />
        </button>
      </div>

      <div className="timeline-body" ref={bodyRef}>
        <div className="track-headers">
          <div className="ruler-corner">
            <span>{fps} fps</span>
            <span>{Math.round(pixelsPerSecond)}px/s</span>
          </div>
          {tracks.map((track, idx) => {
            const countSame = tracks.filter((t) => t.kind === track.kind).length;
            return (
              <div
                className={`track-header-row ${idx % 2 === 1 ? 'alt' : ''}`}
                key={track.id}
                style={{ height: trackRowHeight }}
              >
                <span className="track-tag">{track.name}</span>
                <div className="track-controls">
                  {track.kind === 'video' ? (
                    <button
                      type="button"
                      className={`track-mini-btn ${!track.visible ? 'on' : ''}`}
                      onClick={() => onToggleTrackFlag(track.id, 'visible')}
                      title={track.visible ? 'Hide layer' : 'Show layer'}
                    >
                      {track.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`track-mini-btn ${track.muted ? 'on' : ''}`}
                        onClick={() => onToggleTrackFlag(track.id, 'muted')}
                        title={track.muted ? 'Unmute track' : 'Mute track'}
                      >
                        {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                      </button>
                      <button
                        type="button"
                        className={`track-mini-btn ${track.solo ? 'solo' : ''}`}
                        onClick={() => onToggleTrackFlag(track.id, 'solo')}
                        title="Solo audio track"
                      >
                        S
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={`track-mini-btn ${track.locked ? 'on' : ''}`}
                    onClick={() => onToggleTrackFlag(track.id, 'locked')}
                    title={track.locked ? 'Unlock layer' : 'Lock layer'}
                  >
                    {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
                  </button>
                  {!compactTrack && (
                    <>
                      <button
                        type="button"
                        className="track-mini-btn"
                        disabled={idx === 0}
                        onClick={() => onMoveTrack(track.id, -1)}
                        title="Move layer up"
                      >
                        <ChevronUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="track-mini-btn"
                        disabled={idx === tracks.length - 1}
                        onClick={() => onMoveTrack(track.id, 1)}
                        title="Move layer down"
                      >
                        <ChevronDown size={11} />
                      </button>
                      {countSame > 1 && (
                        <button
                          type="button"
                          className="track-mini-btn"
                          onClick={() => onRemoveTrack(track.id)}
                          title="Delete layer"
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="timeline-scroll" ref={scrollRef} onWheel={handleWheel}>
          <div className="timeline-canvas-inner" style={{ width: timelineWidthPx }}>
            {/* Time Ruler */}
            <div
              className="time-ruler"
              onPointerDown={(e) => {
                setScrubbing(true);
                const raw = clientXToTime(e.clientX);
                onPlayheadChange(snapToFrame(raw, fps));
              }}
            >
              {inPoint !== null && outPoint !== null && outPoint > inPoint && (
                <div
                  className="io-range-bar"
                  style={{
                    left: inPoint * pixelsPerSecond,
                    width: (outPoint - inPoint) * pixelsPerSecond,
                  }}
                />
              )}

              {ticks.map((tk) => (
                <React.Fragment key={tk.time}>
                  <div
                    className="ruler-tick"
                    style={{
                      left: tk.time * pixelsPerSecond,
                      height: tk.major ? 10 : 4,
                    }}
                  />
                  {tk.major && (
                    <span className="ruler-label" style={{ left: tk.time * pixelsPerSecond }}>
                      {formatTimecode(tk.time, fps)}
                    </span>
                  )}
                </React.Fragment>
              ))}

              {markers.map((m) => (
                <div
                  key={m.id}
                  className="marker-flag"
                  style={{ left: m.time * pixelsPerSecond }}
                  title={`${m.label} (${formatTimecode(m.time, fps)})`}
                />
              ))}
            </div>

            {/* Musical Beat & Downbeat Grid Lines */}
            {showBeats && (
              <>
                {beatPoints.beats.map((t, i) => (
                  <div
                    key={`b-${i}`}
                    className="beat-line beat"
                    style={{ left: t * pixelsPerSecond }}
                  />
                ))}
                {beatPoints.downbeats.map((t, i) => (
                  <div
                    key={`db-${i}`}
                    className="beat-line downbeat"
                    style={{ left: t * pixelsPerSecond }}
                  />
                ))}
              </>
            )}

            {/* Track Lanes & Clips */}
            {tracks.map((track, idx) => {
              const laneClips = clips.filter((c) => c.trackId === track.id);
              return (
                <div
                  key={track.id}
                  className={`track-lane ${idx % 2 === 1 ? 'alt' : ''}`}
                  style={{ height: trackRowHeight }}
                  onPointerDown={() => onSelectClip(null)}
                >
                  {/* Percussive transient ticks rendered directly along audio track lanes */}
                  {showBeats &&
                    track.kind === 'audio' &&
                    beatPoints.transients.map((t, i) => (
                      <div
                        key={`tr-${i}`}
                        className="beat-line transient"
                        style={{ left: t * pixelsPerSecond }}
                      />
                    ))}

                  {laneClips.map((clip) => {
                    const asset = assets.get(clip.assetId);
                    const isSelected = clip.id === selectedClipId;
                    const activeLuts = clip.color.lutStack.filter((l) => l.enabled && l.intensity > 0).length;
                    const hasFx =
                      clip.color.effects.enabled &&
                      (clip.color.effects.halation > 0 ||
                        clip.color.effects.bloom > 0 ||
                        clip.color.effects.chromaticAberration > 0 ||
                        clip.color.effects.sharpen > 0 ||
                        clip.color.effects.blur > 0 ||
                        clip.color.effects.vignette > 0 ||
                        clip.color.effects.letterbox !== 'none');

                    return (
                      <div
                        key={clip.id}
                        className={`timeline-clip ${track.kind === 'audio' ? 'audio-clip' : ''} ${
                          isSelected ? 'selected' : ''
                        }`}
                        style={{
                          left: clip.start * pixelsPerSecond,
                          width: Math.max(14, clip.duration * pixelsPerSecond),
                        }}
                        onPointerDown={(e) => startClipDrag(e, clip)}
                      >
                        <div className="clip-header">
                          <span className="clip-title">{clip.name}</span>
                          {!compactTrack && (
                            <span className="clip-badges">
                              {clip.muted && <span className="clip-badge">MUTE</span>}
                              {activeLuts > 0 && <span className="clip-badge">LUT {activeLuts}</span>}
                              {hasFx && <span className="clip-badge">FX</span>}
                              {clip.stabilization.enabled && (
                                <span className="clip-badge">
                                  {clip.stabilization.mode === 'lock' ? 'LOCK' : 'SMOOTH'}
                                </span>
                              )}
                              {asset?.beatAnalysis && track.kind === 'audio' && (
                                <span className="clip-badge" style={{ color: 'var(--beat-accent)' }}>
                                  {asset.beatAnalysis.bpm.toFixed(0)} BPM
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                        {asset && <WaveformSvg peaks={asset.waveform} clip={clip} />}
                        {(clip.fadeIn > 0.01 || clip.fadeOut > 0.01) && (
                          <svg
                            className="clip-fade-overlay"
                            viewBox="0 0 100 40"
                            preserveAspectRatio="none"
                          >
                            {clip.fadeIn > 0.01 && (
                              <polygon
                                points={`0,0 ${Math.min(50, (clip.fadeIn / Math.max(0.1, clip.duration)) * 100).toFixed(2)},0 0,40`}
                                fill="rgba(7, 11, 22, 0.55)"
                              />
                            )}
                            {clip.fadeOut > 0.01 && (
                              <polygon
                                points={`${Math.max(50, 100 - (clip.fadeOut / Math.max(0.1, clip.duration)) * 100).toFixed(2)},0 100,0 100,40`}
                                fill="rgba(7, 11, 22, 0.55)"
                              />
                            )}
                          </svg>
                        )}
                        <div
                          className="trim-handle left"
                          onPointerDown={(e) => startClipTrim(e, clip, 'left')}
                        />
                        <div
                          className="trim-handle right"
                          onPointerDown={(e) => startClipTrim(e, clip, 'right')}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Snap Guide Line */}
            {activeGuide && (
              <div
                className={`snap-guide-line ${activeGuide.kind}`}
                style={{ left: activeGuide.time * pixelsPerSecond }}
              />
            )}

            {/* Playhead */}
            <div className="playhead-line" style={{ left: playhead * pixelsPerSecond }}>
              <div className="playhead-head" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
