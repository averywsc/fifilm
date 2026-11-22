import type {
  ClipKeyframe,
  ClipTransformState,
  KeyframeEasing,
  KeyframeProperty,
  TimelineClip,
} from '../types/editor';

const KEYFRAME_EPSILON_SEC = 0.025; // ~half a frame at 24fps

export function applyEasing(t: number, easing: KeyframeEasing): number {
  const x = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'hold':
      return 0;
    case 'easeIn':
      return x * x * x;
    case 'easeOut':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOut':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'linear':
    default:
      return x;
  }
}

export function evaluateKeyframes(
  frames: ClipKeyframe[] | undefined,
  localTime: number,
  fallbackValue: number
): number {
  if (!frames || frames.length === 0) return fallbackValue;
  if (frames.length === 1) return frames[0].value;

  const sorted = frames; // maintained sorted on write
  if (localTime <= sorted[0].time) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (localTime >= last.time) return last.value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (localTime >= a.time && localTime <= b.time) {
      const span = b.time - a.time;
      if (span <= 1e-6) return b.value;
      const u = applyEasing((localTime - a.time) / span, a.easing);
      return a.value + (b.value - a.value) * u;
    }
  }
  return last.value;
}

export function evaluateClipAtLocalTime(clip: TimelineClip, localTime: number): {
  transform: ClipTransformState;
  exposure: number;
  blur: number;
  speed: number;
} {
  const t = Math.max(0, Math.min(clip.duration, localTime));
  const kf = clip.keyframes || {};
  return {
    transform: {
      positionX: evaluateKeyframes(kf.positionX, t, clip.transform.positionX),
      positionY: evaluateKeyframes(kf.positionY, t, clip.transform.positionY),
      scale: evaluateKeyframes(kf.scale, t, clip.transform.scale),
      rotation: evaluateKeyframes(kf.rotation, t, clip.transform.rotation),
      opacity: evaluateKeyframes(kf.opacity, t, clip.transform.opacity),
      flipX: clip.transform.flipX,
      flipY: clip.transform.flipY,
      swivel3d: evaluateKeyframes(kf.swivel3d, t, clip.transform.swivel3d ?? 0),
      tilt3d: evaluateKeyframes(kf.tilt3d, t, clip.transform.tilt3d ?? 0),
    },
    exposure: evaluateKeyframes(kf.exposure, t, clip.color.correction.exposure),
    blur: evaluateKeyframes(kf.blur, t, clip.color.effects.blur),
    speed: evaluateKeyframes(kf.speed, t, clip.color.effects.speed),
  };
}

export function findKeyframeNear(
  frames: ClipKeyframe[] | undefined,
  localTime: number
): ClipKeyframe | null {
  if (!frames || !frames.length) return null;
  for (const f of frames) {
    if (Math.abs(f.time - localTime) <= KEYFRAME_EPSILON_SEC) return f;
  }
  return null;
}

export function upsertKeyframe(
  frames: ClipKeyframe[] | undefined,
  localTime: number,
  value: number,
  easing: KeyframeEasing = 'easeInOut'
): ClipKeyframe[] {
  const list = [...(frames || [])];
  const roundedTime = Math.max(0, Number(localTime.toFixed(4)));
  const existingIdx = list.findIndex((f) => Math.abs(f.time - roundedTime) <= KEYFRAME_EPSILON_SEC);
  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], value, easing };
  } else {
    list.push({
      id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time: roundedTime,
      value,
      easing,
    });
  }
  list.sort((a, b) => a.time - b.time);
  return list;
}

export function removeKeyframeNear(
  frames: ClipKeyframe[] | undefined,
  localTime: number
): ClipKeyframe[] {
  if (!frames || !frames.length) return [];
  return frames.filter((f) => Math.abs(f.time - localTime) > KEYFRAME_EPSILON_SEC);
}

export function toggleKeyframeAtTime(
  clip: TimelineClip,
  prop: KeyframeProperty,
  localTime: number,
  currentValue: number,
  easing: KeyframeEasing = 'easeInOut'
): ClipKeyframe[] {
  const existing = clip.keyframes?.[prop];
  if (findKeyframeNear(existing, localTime)) {
    return removeKeyframeNear(existing, localTime);
  }
  return upsertKeyframe(existing, localTime, currentValue, easing);
}

/** Collects deduplicated sorted local timestamps across all keyframed properties on a clip. */
export function getAllClipKeyframeTimes(clip: TimelineClip): number[] {
  const times: number[] = [];
  const kf = clip.keyframes || {};
  for (const list of Object.values(kf)) {
    if (!list) continue;
    for (const item of list) {
      if (!times.some((t) => Math.abs(t - item.time) <= KEYFRAME_EPSILON_SEC)) {
        times.push(item.time);
      }
    }
  }
  times.sort((a, b) => a - b);
  return times;
}

export function findAdjacentKeyframeTime(
  clip: TimelineClip,
  localTime: number,
  direction: -1 | 1
): number | null {
  const times = getAllClipKeyframeTimes(clip);
  if (!times.length) return null;
  if (direction < 0) {
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] < localTime - KEYFRAME_EPSILON_SEC) return times[i];
    }
    return null;
  }
  for (let i = 0; i < times.length; i++) {
    if (times[i] > localTime + KEYFRAME_EPSILON_SEC) return times[i];
  }
  return null;
}
