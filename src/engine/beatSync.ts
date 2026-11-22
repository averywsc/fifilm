import type { BeatAnalysisResult, BeatSnapTarget, TimelineClip } from '../types/editor';
import { snapToFrame } from './timecode';

/**
 * Pure Web Audio / browser-side onset & beat analyzer for dropped WAV/FLAC/MP3
 * files (e.g. exports from bebeat) when running without a local disk path.
 * Uses multi-band energy-flux onset envelope + autocorrelation tempo estimation.
 */
export async function analyzeAudioBeatsInBrowser(file: Blob): Promise<BeatAnalysisResult | null> {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const arr = await file.arrayBuffer();
    const ctx = new AudioCtx();
    let audioBuf: AudioBuffer;
    try {
      audioBuf = await ctx.decodeAudioData(arr.slice(0));
    } finally {
      await ctx.close();
    }

    const sr = audioBuf.sampleRate;
    const ch0 = audioBuf.getChannelData(0);
    const ch1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : null;
    const len = ch0.length;
    const hop = 512;
    const frameCount = Math.floor(len / hop);
    if (frameCount < 16) return null;

    // Short-time energy & high-frequency difference (percussive proxy)
    const energy = new Float32Array(frameCount);
    const hfEnergy = new Float32Array(frameCount);
    for (let f = 0; f < frameCount; f++) {
      const start = f * hop;
      let sum = 0;
      let hf = 0;
      let prev = 0;
      for (let i = 0; i < hop; i++) {
        const s = ch1 ? 0.5 * (ch0[start + i] + ch1[start + i]) : ch0[start + i];
        sum += s * s;
        const d = s - prev;
        hf += d * d;
        prev = s;
      }
      energy[f] = Math.log1p(40 * Math.sqrt(sum / hop));
      hfEnergy[f] = Math.log1p(40 * Math.sqrt(hf / hop));
    }

    // Half-wave rectified onset flux
    const flux = new Float32Array(frameCount);
    let maxFlux = 1e-6;
    for (let f = 1; f < frameCount; f++) {
      const v =
        Math.max(0, energy[f] - energy[f - 1]) * 0.65 +
        Math.max(0, hfEnergy[f] - hfEnergy[f - 1]) * 0.35;
      flux[f] = v;
      if (v > maxFlux) maxFlux = v;
    }

    // Adaptive local threshold subtraction
    const win = Math.max(4, Math.round((0.25 * sr) / hop));
    const onset = new Float32Array(frameCount);
    let maxOnset = 1e-6;
    for (let f = 0; f < frameCount; f++) {
      const lo = Math.max(0, f - win);
      const hi = Math.min(frameCount - 1, f + win);
      let avg = 0;
      for (let k = lo; k <= hi; k++) avg += flux[k];
      avg /= hi - lo + 1;
      const o = Math.max(0, flux[f] - avg * 1.15);
      onset[f] = o;
      if (o > maxOnset) maxOnset = o;
    }
    for (let f = 0; f < frameCount; f++) onset[f] /= maxOnset;

    const frameRate = sr / hop;
    const minDist = Math.max(1, Math.round(0.095 * frameRate));
    const transients: number[] = [];
    let lastPeak = -minDist;
    for (let f = 1; f < frameCount - 1; f++) {
      if (
        onset[f] > 0.24 &&
        onset[f] >= onset[f - 1] &&
        onset[f] >= onset[f + 1] &&
        f - lastPeak >= minDist
      ) {
        transients.push(Number((f / frameRate).toFixed(4)));
        lastPeak = f;
      }
    }

    // Autocorrelation tempo search [70..176] BPM
    const minLag = Math.max(2, Math.round((frameRate * 60) / 176));
    const maxLag = Math.min(frameCount - 1, Math.round((frameRate * 60) / 70));
    let bestLag = Math.round((frameRate * 60) / 120);
    let bestScore = -1;
    let zeroLag = 1e-6;
    for (let f = 0; f < frameCount; f++) zeroLag += onset[f] * onset[f];

    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let f = 0; f < frameCount - lag; f++) {
        sum += onset[f] * onset[f + lag];
      }
      const candBpm = (60 * frameRate) / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(candBpm / 118) / 0.55, 2));
      const score = sum * prior;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    const bpm = Number(((60 * frameRate) / bestLag).toFixed(2));
    const beatPeriod = 60 / bpm;
    const duration = audioBuf.duration;

    // Phase-lock beat grid
    let bestPhase = 0;
    let bestPhaseScore = -1;
    for (let s = 0; s < 36; s++) {
      const p = (s / 36) * beatPeriod;
      let sc = 0;
      for (let t = p; t < duration; t += beatPeriod) {
        const f = Math.round(t * frameRate);
        if (f >= 0 && f < frameCount) sc += onset[f];
      }
      if (sc > bestPhaseScore) {
        bestPhaseScore = sc;
        bestPhase = p;
      }
    }

    const beats: number[] = [];
    for (let t = bestPhase; t < duration; t += beatPeriod) {
      beats.push(Number(t.toFixed(4)));
    }

    // Downbeat phase (strongest every 4th beat)
    let bestDbPhase = 0;
    let bestDbEnergy = -1;
    for (let ph = 0; ph < 4; ph++) {
      let e = 0;
      for (let i = ph; i < beats.length; i += 4) {
        const f = Math.min(frameCount - 1, Math.round(beats[i] * frameRate));
        e += onset[f];
      }
      if (e > bestDbEnergy) {
        bestDbEnergy = e;
        bestDbPhase = ph;
      }
    }
    const downbeats = beats.filter((_t, idx) => idx % 4 === bestDbPhase);

    return {
      bpm,
      confidence: Number(Math.min(0.95, Math.max(0.35, (bestScore / zeroLag) * 3)).toFixed(2)),
      beats,
      downbeats,
      transients,
      method: 'webaudio-spectral-flux',
    };
  } catch {
    return null;
  }
}

/**
 * Generates a realistic 124 BPM beat/downbeat/transient grid for the starter sample audio clip
 * so Music-to-Timeline Sync, beat markers, magnetic beat snapping, and Auto-Align Cuts
 * are immediately demonstrable out of the box.
 */
export function createSampleBeatAnalysis(durationSec: number, bpm = 124): BeatAnalysisResult {
  const period = 60 / bpm;
  const beats: number[] = [];
  const downbeats: number[] = [];
  const transients: number[] = [];

  let idx = 0;
  for (let t = 0; t < durationSec; t += period) {
    const rounded = Number(t.toFixed(4));
    beats.push(rounded);
    if (idx % 4 === 0) {
      downbeats.push(rounded);
    }
    // Kick + snare + off-beat hi-hat/percussive transient hits
    transients.push(rounded);
    const half = t + period * 0.5;
    if (half < durationSec && (idx % 2 === 1 || idx % 4 === 0)) {
      transients.push(Number(half.toFixed(4)));
    }
    idx++;
  }

  return {
    bpm,
    confidence: 0.94,
    beats,
    downbeats,
    transients,
    method: 'sample-124bpm-grid',
  };
}

/**
 * Collects all musical snap timestamps in timeline coordinates from audio clips.
 */
export function collectTimelineBeatPoints(
  clips: TimelineClip[],
  getAnalysis: (assetId: string) => BeatAnalysisResult | undefined
): { beats: number[]; downbeats: number[]; transients: number[] } {
  const beats: number[] = [];
  const downbeats: number[] = [];
  const transients: number[] = [];

  for (const clip of clips) {
    const analysis = getAnalysis(clip.assetId);
    if (!analysis) continue;
    const minSrc = clip.sourceIn;
    const maxSrc = clip.sourceIn + clip.duration;
    const mapTime = (srcT: number) => clip.start + (srcT - clip.sourceIn);

    for (const t of analysis.beats) {
      if (t >= minSrc && t <= maxSrc) beats.push(mapTime(t));
    }
    for (const t of analysis.downbeats) {
      if (t >= minSrc && t <= maxSrc) downbeats.push(mapTime(t));
    }
    for (const t of analysis.transients) {
      if (t >= minSrc && t <= maxSrc) transients.push(mapTime(t));
    }
  }

  return { beats, downbeats, transients };
}

/**
 * One-click Auto-Align Cuts to Nearest Beat/Transient within a configurable tolerance (ms).
 * Gently locks cut edges (start/end) of target video clips to musical hits while
 * keeping out-of-tolerance intentional edits untouched.
 */
export function alignClipsToBeats(params: {
  clips: TimelineClip[];
  targetClipIds: Set<string>;
  beatPoints: { beats: number[]; downbeats: number[]; transients: number[] };
  target: BeatSnapTarget;
  toleranceMs: number;
  fps: number;
}): { nextClips: TimelineClip[]; alignedCount: number } {
  const tolSec = Math.max(0.015, params.toleranceMs / 1000);
  const pool: number[] =
    params.target === 'downbeat'
      ? params.beatPoints.downbeats
      : params.target === 'transient'
        ? params.beatPoints.transients
        : params.target === 'beat'
          ? params.beatPoints.beats
          : [
              ...params.beatPoints.downbeats,
              ...params.beatPoints.beats,
              ...params.beatPoints.transients,
            ];

  if (pool.length === 0) {
    return { nextClips: params.clips, alignedCount: 0 };
  }

  const findNearest = (time: number): number | null => {
    let best: number | null = null;
    let bestDist = tolSec + 1;
    for (const pt of pool) {
      const d = Math.abs(pt - time);
      if (d <= tolSec && d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    return best;
  };

  let alignedCount = 0;
  const nextClips = params.clips.map((clip) => {
    if (!params.targetClipIds.has(clip.id)) return clip;
    let newStart = clip.start;
    let newSourceIn = clip.sourceIn;
    let newDuration = clip.duration;
    let changed = false;

    const snapStart = findNearest(clip.start);
    if (snapStart !== null && Math.abs(snapStart - clip.start) > 0.002) {
      const framed = snapToFrame(snapStart, params.fps);
      const delta = framed - clip.start;
      if (clip.duration - delta >= 2 / params.fps && clip.sourceIn + delta >= 0) {
        newStart = framed;
        newSourceIn = clip.sourceIn + delta;
        newDuration = clip.duration - delta;
        changed = true;
      }
    }

    const origEnd = newStart + newDuration;
    const snapEnd = findNearest(origEnd);
    if (snapEnd !== null && Math.abs(snapEnd - origEnd) > 0.002) {
      const framedEnd = snapToFrame(snapEnd, params.fps);
      const maxDur = clip.sourceDuration - newSourceIn;
      const candDur = framedEnd - newStart;
      if (candDur >= 2 / params.fps && candDur <= maxDur) {
        newDuration = candDur;
        changed = true;
      }
    }

    if (changed) {
      alignedCount++;
      return {
        ...clip,
        start: newStart,
        sourceIn: newSourceIn,
        duration: newDuration,
      };
    }
    return clip;
  });

  return { nextClips, alignedCount };
}
