import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  Bookmark,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Layers,
  Link,
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
  ClipColorLabel,
  EditorTool,
  MediaAsset,
  RenderRange,
  SnapGuide,
  SnapOptions,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
} from '../types/editor';
import { formatTimecode, resolveMagneticSnap, snapToFrame } from '../engine/timecode';
import { getAllClipKeyframeTimes } from '../engine/keyframes';
import { ToolsPanel } from './ToolsPanel';

interface TimelineProps {
  activeTool: EditorTool;
  onSelectTool: (tool: EditorTool) => void;
  onCreateQuickOverlay: (tool: 'pen' | 'rectangle' | 'ellipse' | 'type' | 'verticalType') => void;
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
  snapOptions: SnapOptions;
  onUpdateSnapOptions: (patch: Partial<SnapOptions>) => void;
  renderRanges: RenderRange[];
  viewAllLayers: boolean;
  onToggleViewAllLayers: () => void;
  inPoint: number | null;
  outPoint: number | null;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pps: number) => void;
  onPlayheadChange: (time: number) => void;
  onSelectClip: (id: string | null) => void;
  onToggleSnap: () => void;
  onBladeSplit: (atTime?: number, clipId?: string) => void;
  onDeleteClip: (ripple: boolean) => void;
  onRippleTrimToPlayhead: (dir: 'prev' | 'next') => void;
  onCloseGap: () => void;
  onAutoMixAudio: () => void;
  onApplyJLcut: (kind: 'j' | 'l') => void;
  onAddMarker: () => void;
  onAddTrack: (kind: 'video' | 'audio') => void;
  onRemoveTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, dir: -1 | 1) => void;
  onCycleTrackColor: (trackId: string) => void;
  onToggleTrackFlag: (
    trackId: string,
    flag: 'muted' | 'solo' | 'locked' | 'visible' | 'syncLock' | 'targeted' | 'sourcePatched'
  ) => void;
  onMoveClip: (clipId: string, newStart: number, newTrackId?: string) => void;
  onTrackSelectForwardMove: (anchorClipId: string, deltaSec: number) => void;
  onTrimClip: (
    clipId: string,
    edge: 'left' | 'right',
    newTime: number,
    mode: 'normal' | 'ripple' | 'rolling' | 'rateStretch'
  ) => void;
  onUpdateClipFade: (clipId: string, side: 'in' | 'out', durationSec: number, isVideoTrack: boolean) => void;
  onSlipClip: (clipId: string, deltaSec: number) => void;
  onSlideClip: (clipId: string, deltaSec: number) => void;
  onRemoveThroughEdit: (clipId: string) => void;
  onOpenContextMenu: (clientX: number, clientY: number, clip: TimelineClip | null) => void;
  onCommitHistory: (label?: string) => void;
}

const LABEL_HEX: Record<ClipColorLabel, string> = {
  default: 'transparent',
  iris: '#818cf8',
  cerulean: '#38bdf8',
  forest: '#34d399',
  amber: '#fbbf24',
  rose: '#fb7185',
  violet: '#c084fc',
  mango: '#fb923c',
};

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
      return `M${(i * step).toFixed(1)},${h}V${(h - bh).toFixed(1)}`;
    })
    .join('');

  return (
    <svg className="clip-waveform" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={bars} stroke="rgba(165, 198, 255, 0.5)" strokeWidth={Math.max(1, step * 0.72)} fill="none" />
    </svg>
  );
});

const MIN_PPS = 4;
const MAX_PPS = 1600;
const ppsToSlider = (pps: number) =>
  Math.round((Math.log(Math.max(MIN_PPS, Math.min(MAX_PPS, pps)) / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 1000);
const sliderToPps = (val: number) =>
  MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Math.max(0, Math.min(1000, val)) / 1000);

export const Timeline: React.FC<TimelineProps> = ({
  activeTool,
  onSelectTool,
  onCreateQuickOverlay,
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
  snapOptions,
  onUpdateSnapOptions,
  renderRanges,
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
  onRippleTrimToPlayhead,
  onCloseGap,
  onAutoMixAudio,
  onApplyJLcut,
  onAddMarker,
  onAddTrack,
  onRemoveTrack,
  onMoveTrack,
  onCycleTrackColor,
  onToggleTrackFlag,
  onMoveClip,
  onTrackSelectForwardMove,
  onTrimClip,
  onUpdateClipFade,
  onSlipClip,
  onSlideClip,
  onRemoveThroughEdit,
  onOpenContextMenu,
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
    let count = 0;
    for (let t = 0; t <= totalTimelineSec && count < 1200; t += minorStep, count++) {
      const rounded = Math.round(t * 1000) / 1000;
      const rem = Math.abs(rounded % majorStepSec);
      out.push({ time: rounded, major: rem < 0.002 || Math.abs(rem - majorStepSec) < 0.002 });
    }
    return out;
  }, [totalTimelineSec, majorStepSec]);

  const clientXToTime = (clientX: number): number => {
    const sc = scrollRef.current;
    if (!sc) return 0;
    const rect = sc.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + sc.scrollLeft) / pixelsPerSecond);
  };

  const handleFitTimeline = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    const availW = Math.max(300, sc.clientWidth - 40);
    onPixelsPerSecondChange(Math.max(MIN_PPS, Math.min(MAX_PPS, availW / Math.max(4, sequenceEnd + 1))));
    sc.scrollLeft = 0;
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const sc = scrollRef.current;
    if (!sc) return;
    const rect = sc.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const timeAtCursor = (sc.scrollLeft + cursorX) / pixelsPerSecond;
    const nextPps = Math.max(MIN_PPS, Math.min(MAX_PPS, pixelsPerSecond * (e.deltaY < 0 ? 1.24 : 1 / 1.24)));
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

  const handleTimelineCanvasPointerDown = (e: React.PointerEvent) => {
    if (activeTool === 'hand') {
      const sc = scrollRef.current;
      if (!sc) return;
      const startX = e.clientX;
      const startScroll = sc.scrollLeft;
      const onMove = (ev: PointerEvent) => {
        sc.scrollLeft = Math.max(0, startScroll - (ev.clientX - startX));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    if (activeTool === 'zoom') {
      const factor = e.altKey ? 1 / 1.5 : 1.5;
      onPixelsPerSecondChange(Math.max(MIN_PPS, Math.min(MAX_PPS, pixelsPerSecond * factor)));
    }
  };

  const startClipInteraction = (e: React.PointerEvent, clip: TimelineClip) => {
    if (e.button !== 0) return;
    const track = tracks.find((t) => t.id === clip.trackId);
    if (track?.locked) return;
    e.stopPropagation();

    if (activeTool === 'razor') {
      const clickedTime = snapToFrame(clientXToTime(e.clientX), fps);
      onBladeSplit(clickedTime, clip.id);
      return;
    }
    if (activeTool === 'zoom') {
      onPixelsPerSecondChange(Math.max(MIN_PPS, Math.min(MAX_PPS, pixelsPerSecond * (e.altKey ? 1 / 1.5 : 1.5))));
      return;
    }

    onSelectClip(clip.id);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const origStart = clip.start;
    const origTrackIndex = tracks.findIndex((t) => t.id === clip.trackId);
    const sameKindTracks = tracks.filter((t) => t.kind === track?.kind);
    let lastDxSec = 0;
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / pixelsPerSecond;
      const deltaInc = dxSec - lastDxSec;
      lastDxSec = dxSec;

      if (activeTool === 'slip') {
        moved = true;
        onSlipClip(clip.id, deltaInc);
        return;
      }
      if (activeTool === 'slide') {
        moved = true;
        onSlideClip(clip.id, deltaInc);
        return;
      }
      if (activeTool === 'trackForward') {
        moved = true;
        onTrackSelectForwardMove(clip.id, deltaInc);
        return;
      }

      const dyTracks = Math.round((ev.clientY - startClientY) / (trackRowHeight + 2));
      const candidate = Math.max(0, origStart + dxSec);
      const { snappedTime, guide } = resolveMagneticSnap({
        candidateTime: candidate,
        clipDuration: clip.duration,
        excludeClipId: clip.id,
        playhead: snapOptions.playhead ? playhead : -999,
        clips: snapOptions.editPoints ? clips : [],
        markers: snapOptions.markers ? markers : [],
        beatPoints,
        snapToBeats: showBeats && snapOptions.beats,
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
      if (moved) onCommitHistory(activeTool === 'slip' ? 'Slip Edit' : activeTool === 'slide' ? 'Slide Edit' : 'Move Clip');
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
    const trimMode =
      activeTool === 'ripple'
        ? 'ripple'
        : activeTool === 'rolling'
          ? 'rolling'
          : activeTool === 'rateStretch'
            ? 'rateStretch'
            : 'normal';
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxSec = (ev.clientX - startClientX) / pixelsPerSecond;
      const candidate = Math.max(0, origEdgeTime + dxSec);
      const { snappedTime, guide } = resolveMagneticSnap({
        candidateTime: candidate,
        excludeClipId: clip.id,
        playhead: snapOptions.playhead ? playhead : -999,
        clips: snapOptions.editPoints ? clips : [],
        markers: snapOptions.markers ? markers : [],
        beatPoints,
        snapToBeats: showBeats && snapOptions.beats,
        sequenceEnd,
        pixelsPerSecond,
        snapEnabled,
      });
      setActiveGuide(guide);
      moved = true;
      onTrimClip(clip.id, edge, snapToFrame(snappedTime, fps), trimMode);
    };

    const onUp = () => {
      setActiveGuide(null);
      if (moved) onCommitHistory(`Trim (${trimMode})`);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Drag top-left / top-right corner fade handles directly on any video or audio clip!
  const startClipFadeDrag = (
    e: React.PointerEvent,
    clip: TimelineClip,
    side: 'in' | 'out',
    isVideoTrack: boolean
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onSelectClip(clip.id);
    const startClientX = e.clientX;
    const origFade = isVideoTrack
      ? (side === 'in' ? clip.videoFadeIn ?? clip.fadeIn : clip.videoFadeOut ?? clip.fadeOut)
      : (side === 'in' ? clip.fadeIn : clip.fadeOut);
    const maxFade = Math.max(0.1, clip.duration * 0.5);
    let moved = false;

    const onMove = (ev: PointerEvent) => {
      const dxPx = ev.clientX - startClientX;
      const deltaSec = (side === 'in' ? dxPx : -dxPx) / pixelsPerSecond;
      const nextDur = Math.max(0, Math.min(maxFade, Number((origFade + deltaSec).toFixed(2))));
      moved = true;
      onUpdateClipFade(clip.id, side, nextDur, isVideoTrack);
    };

    const onUp = () => {
      if (moved) onCommitHistory(`Adjust Fade ${side === 'in' ? 'In' : 'Out'}`);
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
        <button type="button" className={snapEnabled ? 'active' : ''} onClick={onToggleSnap} title="Magnetic Snapping (N)">
          <Magnet size={12} /> Snap
        </button>
        <div className="snap-pill-group" title="Granular Snap Targets">
          <button
            type="button"
            className={`snap-mini ${snapOptions.editPoints ? 'on' : ''}`}
            onClick={() => onUpdateSnapOptions({ editPoints: !snapOptions.editPoints })}
            title="Snap to Edit Points"
          >
            Edits
          </button>
          <button
            type="button"
            className={`snap-mini ${snapOptions.markers ? 'on' : ''}`}
            onClick={() => onUpdateSnapOptions({ markers: !snapOptions.markers })}
            title="Snap to Markers"
          >
            Mrk
          </button>
          <button
            type="button"
            className={`snap-mini ${snapOptions.playhead ? 'on' : ''}`}
            onClick={() => onUpdateSnapOptions({ playhead: !snapOptions.playhead })}
            title="Snap to Playhead"
          >
            PH
          </button>
        </div>
        <button type="button" onClick={() => onBladeSplit()} title="Split / Razor at playhead (B)">
          <Scissors size={12} /> Split
        </button>
        <button type="button" className="subtle ghost-sm mono" onClick={() => onRippleTrimToPlayhead('prev')} title="Ripple Trim Previous Edit to Playhead (Q)">
          Q
        </button>
        <button type="button" className="subtle ghost-sm mono" onClick={() => onRippleTrimToPlayhead('next')} title="Ripple Trim Next Edit to Playhead (W)">
          W
        </button>
        <button type="button" className="subtle" disabled={!selectedClipId} onClick={() => onDeleteClip(false)} title="Delete">
          <Trash2 size={12} />
        </button>
        <button type="button" className="subtle ghost-sm" disabled={!selectedClipId} onClick={() => onDeleteClip(true)} title="Ripple Delete (Shift+Del)">
          Ripple
        </button>
        <button type="button" className="subtle ghost-sm" onClick={onCloseGap} title="Close Gap / Ripple Delete Gaps">
          Gap
        </button>
        <button type="button" className="subtle ghost-sm mono" disabled={!selectedClipId} onClick={() => onApplyJLcut('j')} title="Apply J-Cut (audio leads video by 0.6s)">
          J
        </button>
        <button type="button" className="subtle ghost-sm mono" disabled={!selectedClipId} onClick={() => onApplyJLcut('l')} title="Apply L-Cut (audio trails video by 0.6s)">
          L
        </button>
        <button type="button" className="ghost-sm" onClick={onAutoMixAudio} title="Auto-Mix Song Cuts: seamlessly overlap, crossfade, and loudness-match cut audio clips">
          <Sparkles size={11} /> Auto-Mix
        </button>
        <button type="button" className="subtle icon-btn" onClick={onAddMarker} title="Add marker (M)">
          <Bookmark size={12} />
        </button>

        <button type="button" className={showBeats ? 'active' : 'subtle'} onClick={onToggleShowBeats}>
          <AudioWaveform size={13} />
          {detectedBpm ? `${detectedBpm.toFixed(1)} BPM` : 'Beat Grid'}
        </button>

        <div className="align-popover">
          <select value={beatTarget} onChange={(e) => setBeatTarget(e.target.value as BeatSnapTarget)} style={{ padding: '3px 5px', fontSize: 11, background: 'var(--bg)' }}>
            <option value="all">All Hits</option>
            <option value="beat">Beats</option>
            <option value="downbeat">Downbeats</option>
            <option value="transient">Transients</option>
          </select>
          <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>±{toleranceMs}ms</span>
          <input type="range" min={30} max={350} step={10} value={toleranceMs} style={{ width: 46 }} onChange={(e) => setToleranceMs(Number(e.target.value))} />
          <button type="button" className="ghost-sm" onClick={() => onAlignCutsToBeats(beatTarget, toleranceMs)}>
            <Sparkles size={11} /> Align
          </button>
        </div>

        {alignFeedback && <span className="mono" style={{ fontSize: 11, color: 'var(--ok)' }}>{alignFeedback}</span>}

        <div className="spacer" />

        <button type="button" className="subtle ghost-sm" onClick={() => onAddTrack('video')}>
          <Plus size={11} />V
        </button>
        <button type="button" className="subtle ghost-sm" onClick={() => onAddTrack('audio')}>
          <Plus size={11} />A
        </button>
        <button type="button" className={viewAllLayers ? 'active' : ''} onClick={onToggleViewAllLayers} title="Shrink to view all layers (Shift+V)">
          <Layers size={13} /> All ({tracks.length})
        </button>
        <button type="button" className="subtle icon-btn" onClick={handleFitTimeline} title="Fit sequence (Shift+Z)">
          <Maximize2 size={12} />
        </button>
        <button type="button" className="subtle icon-btn" onClick={() => onPixelsPerSecondChange(Math.max(MIN_PPS, pixelsPerSecond / 1.5))}>
          <ZoomOut size={13} />
        </button>
        <input type="range" min={0} max={1000} value={ppsToSlider(pixelsPerSecond)} style={{ width: 92 }} onChange={(e) => onPixelsPerSecondChange(sliderToPps(Number(e.target.value)))} />
        <button type="button" className="subtle icon-btn" onClick={() => onPixelsPerSecondChange(Math.min(MAX_PPS, pixelsPerSecond * 1.5))}>
          <ZoomIn size={13} />
        </button>
      </div>

      <div className="timeline-shell-row">
        <ToolsPanel
          activeTool={activeTool}
          onSelectTool={onSelectTool}
          onCreateQuickOverlay={onCreateQuickOverlay}
        />

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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      type="button"
                      className="track-color-dot"
                      style={{ background: LABEL_HEX[track.colorLabel || 'default'] !== 'transparent' ? LABEL_HEX[track.colorLabel || 'default'] : track.kind === 'video' ? '#3b82f6' : '#22c55e' }}
                      onClick={() => onCycleTrackColor(track.id)}
                      title="Click to cycle Track Color Coding"
                    />
                    <button
                      type="button"
                      className={`track-mini-btn ${track.sourcePatched ? 'on' : ''}`}
                      onClick={() => onToggleTrackFlag(track.id, 'sourcePatched')}
                      title="Source Patching"
                    >
                      {track.name}
                    </button>
                    <button
                      type="button"
                      className={`track-mini-btn ${track.targeted ? 'on' : ''}`}
                      onClick={() => onToggleTrackFlag(track.id, 'targeted')}
                      title="Track Targeting"
                    >
                      T
                    </button>
                  </div>

                  <div className="track-controls">
                    <button
                      type="button"
                      className={`track-mini-btn ${track.syncLock ? 'on' : ''}`}
                      onClick={() => onToggleTrackFlag(track.id, 'syncLock')}
                      title="Sync Lock"
                    >
                      <Link size={10} />
                    </button>
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
                          title="Mute"
                        >
                          {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                        </button>
                        <button
                          type="button"
                          className={`track-mini-btn ${track.solo ? 'solo' : ''}`}
                          onClick={() => onToggleTrackFlag(track.id, 'solo')}
                          title="Solo"
                        >
                          S
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className={`track-mini-btn ${track.locked ? 'on' : ''}`}
                      onClick={() => onToggleTrackFlag(track.id, 'locked')}
                      title="Track Lock"
                    >
                      {track.locked ? <Lock size={11} /> : <Unlock size={11} />}
                    </button>
                    {!compactTrack && (
                      <>
                        <button type="button" className="track-mini-btn" disabled={idx === 0} onClick={() => onMoveTrack(track.id, -1)}>
                          <ChevronUp size={10} />
                        </button>
                        <button type="button" className="track-mini-btn" disabled={idx === tracks.length - 1} onClick={() => onMoveTrack(track.id, 1)}>
                          <ChevronDown size={10} />
                        </button>
                        {countSame > 1 && (
                          <button type="button" className="track-mini-btn" onClick={() => onRemoveTrack(track.id)}>
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

          <div
            className="timeline-scroll"
            ref={scrollRef}
            onWheel={handleWheel}
            onPointerDown={handleTimelineCanvasPointerDown}
            style={{
              cursor:
                activeTool === 'hand'
                  ? 'grab'
                  : activeTool === 'zoom'
                    ? 'zoom-in'
                    : activeTool === 'razor'
                      ? 'crosshair'
                      : undefined,
            }}
          >
            <div className="timeline-canvas-inner" style={{ width: timelineWidthPx }}>
              <div
                className="time-ruler"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setScrubbing(true);
                  onPlayheadChange(snapToFrame(clientXToTime(e.clientX), fps));
                }}
              >
                {inPoint !== null && outPoint !== null && outPoint > inPoint && (
                  <div className="io-range-bar" style={{ left: inPoint * pixelsPerSecond, width: (outPoint - inPoint) * pixelsPerSecond }} />
                )}
                {renderRanges.map((rr) => (
                  <div
                    key={rr.id}
                    className="render-cache-bar"
                    style={{ left: rr.start * pixelsPerSecond, width: Math.max(4, (rr.end - rr.start) * pixelsPerSecond) }}
                    title={`Rendered cache: ${formatTimecode(rr.start, fps)} - ${formatTimecode(rr.end, fps)}`}
                  />
                ))}
                {ticks.map((tk) => (
                  <React.Fragment key={tk.time}>
                    <div className="ruler-tick" style={{ left: tk.time * pixelsPerSecond, height: tk.major ? 10 : 4 }} />
                    {tk.major && <span className="ruler-label" style={{ left: tk.time * pixelsPerSecond }}>{formatTimecode(tk.time, fps)}</span>}
                  </React.Fragment>
                ))}
                {markers.map((m) => (
                  <div key={m.id} className="marker-flag" style={{ left: m.time * pixelsPerSecond }} title={`${m.label} (${formatTimecode(m.time, fps)})`} />
                ))}
              </div>

              {showBeats && (
                <>
                  {beatPoints.beats.map((t, i) => <div key={`b-${i}`} className="beat-line beat" style={{ left: t * pixelsPerSecond }} />)}
                  {beatPoints.downbeats.map((t, i) => <div key={`db-${i}`} className="beat-line downbeat" style={{ left: t * pixelsPerSecond }} />)}
                </>
              )}

              {tracks.map((track, idx) => {
                const laneClips = clips.filter((c) => c.trackId === track.id);
                return (
                  <div
                    key={track.id}
                    className={`track-lane ${idx % 2 === 1 ? 'alt' : ''}`}
                    style={{ height: trackRowHeight }}
                    onPointerDown={() => activeTool === 'select' && onSelectClip(null)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onOpenContextMenu(e.clientX, e.clientY, null);
                    }}
                  >
                    {showBeats &&
                      track.kind === 'audio' &&
                      beatPoints.transients.map((t, i) => <div key={`tr-${i}`} className="beat-line transient" style={{ left: t * pixelsPerSecond }} />)}

                    {laneClips.map((clip) => {
                      const asset = assets.get(clip.assetId);
                      const isSelected = clip.id === selectedClipId;
                      const activeLuts = clip.color.lutStack.filter((l) => l.enabled && l.intensity > 0).length;
                      const kfTimes = getAllClipKeyframeTimes(clip);
                      const isVideoTrack = track.kind === 'video';
                      const dispFadeIn = isVideoTrack ? Math.max(clip.videoFadeIn ?? 0, clip.fadeIn) : clip.fadeIn;
                      const dispFadeOut = isVideoTrack ? Math.max(clip.videoFadeOut ?? 0, clip.fadeOut) : clip.fadeOut;
                      const labelAccent = LABEL_HEX[clip.colorLabel || 'default'];
                      const clipBg =
                        clip.clipKind === 'adjustment'
                          ? '#2b1e4d'
                          : clip.clipKind === 'text' || clip.clipKind === 'vertical-text' || clip.clipKind === 'shape'
                            ? '#1f324a'
                            : clip.clipKind === 'nested'
                              ? '#16382b'
                              : undefined;

                      // Detect Through Edit (contiguous split of same source asset on same track)
                      const hasThroughEditRight = laneClips.some(
                        (other) =>
                          other.id !== clip.id &&
                          other.assetId &&
                          other.assetId === clip.assetId &&
                          Math.abs(other.start - (clip.start + clip.duration)) < 0.06 &&
                          Math.abs(other.sourceIn - (clip.sourceIn + clip.duration)) < 0.09
                      );

                      // Detect Audio Crossfade overlap with next clip
                      const crossfadeOverlap =
                        track.kind === 'audio'
                          ? laneClips.find(
                              (other) =>
                                other.id !== clip.id &&
                                other.start >= clip.start &&
                                other.start < clip.start + clip.duration - 0.02
                            )
                          : undefined;

                      const fadeInPx = Math.min(clip.duration * pixelsPerSecond * 0.5, dispFadeIn * pixelsPerSecond);
                      const fadeOutPx = Math.min(clip.duration * pixelsPerSecond * 0.5, dispFadeOut * pixelsPerSecond);

                      return (
                        <div
                          key={clip.id}
                          className={`timeline-clip ${track.kind === 'audio' ? 'audio-clip' : ''} ${isSelected ? 'selected' : ''} ${clip.disabled ? 'clip-disabled' : ''}`}
                          style={{
                            left: clip.start * pixelsPerSecond,
                            width: Math.max(14, clip.duration * pixelsPerSecond),
                            background: clipBg,
                            borderTop: labelAccent !== 'transparent' ? `2px solid ${labelAccent}` : undefined,
                          }}
                          onPointerDown={(e) => startClipInteraction(e, clip)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectClip(clip.id);
                            onOpenContextMenu(e.clientX, e.clientY, clip);
                          }}
                        >
                          <div className="clip-header">
                            <span className="clip-title">{clip.name}</span>
                            {!compactTrack && (
                              <span className="clip-badges">
                                {clip.disabled && <span className="clip-badge">OFF</span>}
                                {clip.linkGroupId && <span className="clip-badge">LNK</span>}
                                {clip.groupId && <span className="clip-badge">GRP</span>}
                                {clip.blendMode !== 'normal' && <span className="clip-badge">{clip.blendMode.toUpperCase()}</span>}
                                {clip.transitionIn.type !== 'none' && <span className="clip-badge">TR</span>}
                                {dispFadeIn > 0.02 && <span className="clip-badge">IN {dispFadeIn.toFixed(1)}s</span>}
                                {dispFadeOut > 0.02 && <span className="clip-badge">OUT {dispFadeOut.toFixed(1)}s</span>}
                                {clip.muted && <span className="clip-badge">MUTE</span>}
                                {activeLuts > 0 && <span className="clip-badge">LUT {activeLuts}</span>}
                                {clip.stabilization.enabled && (
                                  <span className="clip-badge">{clip.stabilization.mode === 'lock' ? 'LOCK' : 'STAB'}</span>
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
                          {(dispFadeIn > 0.01 || dispFadeOut > 0.01) && (
                            <svg className="clip-fade-overlay" viewBox="0 0 100 40" preserveAspectRatio="none">
                              {dispFadeIn > 0.01 && (
                                <polygon points={`0,0 ${Math.min(50, (dispFadeIn / Math.max(0.1, clip.duration)) * 100).toFixed(2)},0 0,40`} fill="rgba(7, 11, 22, 0.58)" />
                              )}
                              {dispFadeOut > 0.01 && (
                                <polygon points={`${Math.max(50, 100 - (dispFadeOut / Math.max(0.1, clip.duration)) * 100).toFixed(2)},0 100,0 100,40`} fill="rgba(7, 11, 22, 0.58)" />
                              )}
                            </svg>
                          )}

                          {/* Easy Draggable Fade Handles on both ends of every clip */}
                          <div
                            className="fade-handle left"
                            style={{ left: Math.max(2, fadeInPx) }}
                            title={`Drag to Fade In (${dispFadeIn.toFixed(2)}s)`}
                            onPointerDown={(e) => startClipFadeDrag(e, clip, 'in', isVideoTrack)}
                          />
                          <div
                            className="fade-handle right"
                            style={{ right: Math.max(2, fadeOutPx) }}
                            title={`Drag to Fade Out (${dispFadeOut.toFixed(2)}s)`}
                            onPointerDown={(e) => startClipFadeDrag(e, clip, 'out', isVideoTrack)}
                          />

                          {/* Seamless Audio Crossfade Bridge Badge */}
                          {crossfadeOverlap && (
                            <div
                              className="xfade-bridge"
                              style={{
                                left: (crossfadeOverlap.start - clip.start) * pixelsPerSecond,
                                width: Math.max(16, (clip.start + clip.duration - crossfadeOverlap.start) * pixelsPerSecond),
                              }}
                              title="Seamless Equal-Power Audio Crossfade"
                            >
                              X-FADE
                            </div>
                          )}

                          {/* Through Edit Seam Badge (click to remove through edit / rejoin) */}
                          {hasThroughEditRight && (
                            <button
                              type="button"
                              className="through-edit-badge"
                              title="Through Edit detected — click to Remove Through Edit and rejoin clips"
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                onRemoveThroughEdit(clip.id);
                              }}
                            >
                              //
                            </button>
                          )}

                          {kfTimes.map((kt) => (
                            <div
                              key={`kf-${kt}`}
                              className="clip-kf-diamond"
                              style={{ left: kt * pixelsPerSecond }}
                              title={`Keyframe at ${formatTimecode(kt, fps)}`}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                onSelectClip(clip.id);
                                onPlayheadChange(snapToFrame(clip.start + kt, fps));
                              }}
                            />
                          ))}
                          <div className="trim-handle left" onPointerDown={(e) => startClipTrim(e, clip, 'left')} />
                          <div className="trim-handle right" onPointerDown={(e) => startClipTrim(e, clip, 'right')} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {activeGuide && <div className={`snap-guide-line ${activeGuide.kind}`} style={{ left: activeGuide.time * pixelsPerSecond }} />}
              <div className="playhead-line" style={{ left: playhead * pixelsPerSecond }}>
                <div className="playhead-head" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
