import type { SnapGuide, TimelineClip, TimelineMarker } from '../types/editor';

export function formatTimecode(seconds: number, fps = 24): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.round(safe * fps);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

export function secondsToFrames(seconds: number, fps = 24): number {
  return Math.round(Math.max(0, seconds) * fps);
}

export function snapToFrame(seconds: number, fps = 24): number {
  return Math.max(0, Math.round(seconds * fps) / fps);
}

export interface SnapResult {
  snappedTime: number;
  guide: SnapGuide | null;
}

/**
 * Magnetic NLE snapping resolver:
 * Snaps to playhead, clip edges, markers, sequence start/end, AND musical beats/downbeats/transients.
 */
export function resolveMagneticSnap(params: {
  candidateTime: number;
  clipDuration?: number;
  excludeClipId?: string;
  playhead: number;
  clips: TimelineClip[];
  markers: TimelineMarker[];
  beatPoints?: { beats: number[]; downbeats: number[]; transients: number[] };
  snapToBeats?: boolean;
  sequenceEnd: number;
  pixelsPerSecond: number;
  snapEnabled: boolean;
  thresholdPx?: number;
}): SnapResult {
  if (!params.snapEnabled) {
    return { snappedTime: Math.max(0, params.candidateTime), guide: null };
  }

  const thresholdSec = (params.thresholdPx ?? 10) / Math.max(4, params.pixelsPerSecond);

  const targets: SnapGuide[] = [
    { time: 0, kind: 'sequence' },
    { time: params.playhead, kind: 'playhead' },
  ];
  if (params.sequenceEnd > 0) {
    targets.push({ time: params.sequenceEnd, kind: 'sequence' });
  }
  for (const m of params.markers) {
    targets.push({ time: m.time, kind: 'marker' });
  }
  for (const c of params.clips) {
    if (c.id === params.excludeClipId) continue;
    targets.push({ time: c.start, kind: 'clip-edge' });
    targets.push({ time: c.start + c.duration, kind: 'clip-edge' });
  }

  if (params.snapToBeats !== false && params.beatPoints) {
    for (const t of params.beatPoints.downbeats) {
      targets.push({ time: t, kind: 'downbeat' });
    }
    for (const t of params.beatPoints.beats) {
      targets.push({ time: t, kind: 'beat' });
    }
    for (const t of params.beatPoints.transients) {
      targets.push({ time: t, kind: 'transient' });
    }
  }

  let bestDelta = thresholdSec + 1;
  let bestTime = params.candidateTime;
  let bestGuide: SnapGuide | null = null;

  for (const t of targets) {
    const dStart = Math.abs(params.candidateTime - t.time);
    if (dStart <= thresholdSec && dStart < bestDelta) {
      bestDelta = dStart;
      bestTime = t.time;
      bestGuide = t;
    }
    if (params.clipDuration && params.clipDuration > 0) {
      const endCandidate = params.candidateTime + params.clipDuration;
      const dEnd = Math.abs(endCandidate - t.time);
      if (dEnd <= thresholdSec && dEnd < bestDelta) {
        bestDelta = dEnd;
        bestTime = Math.max(0, t.time - params.clipDuration);
        bestGuide = t;
      }
    }
  }

  return {
    snappedTime: Math.max(0, bestTime),
    guide: bestGuide,
  };
}
