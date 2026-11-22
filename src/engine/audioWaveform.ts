/**
 * Extracts normalized audio waveform peaks (0..1) from a media Blob/ArrayBuffer
 * using the Web Audio API, or falls back to a clean synthetic ambient envelope
 * if the source has no audio track or cannot be decoded in browser.
 */
export async function extractAudioWaveformFromFile(
  file: Blob,
  bucketCount = 160
): Promise<{ peaks: number[]; hasAudio: boolean }> {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return { peaks: generateFallbackWaveform(bucketCount, 0.2), hasAudio: false };
    }
    const buf = await file.arrayBuffer();
    const ctx = new AudioCtx();
    try {
      const audioBuf = await ctx.decodeAudioData(buf.slice(0));
      const channel = audioBuf.getChannelData(0);
      const peaks = computePeaks(channel, bucketCount);
      await ctx.close();
      return { peaks, hasAudio: true };
    } catch {
      await ctx.close();
      return { peaks: generateFallbackWaveform(bucketCount, 0.08), hasAudio: false };
    }
  } catch {
    return { peaks: generateFallbackWaveform(bucketCount, 0.08), hasAudio: false };
  }
}

export function computePeaks(samples: Float32Array, bucketCount: number): number[] {
  const len = samples.length;
  if (len === 0) return new Array(bucketCount).fill(0.05);
  const step = Math.max(1, Math.floor(len / bucketCount));
  const peaks: number[] = new Array(bucketCount);
  let globalMax = 0.001;

  for (let i = 0; i < bucketCount; i++) {
    const start = i * step;
    const end = Math.min(len, start + step);
    let maxAbs = 0;
    for (let j = start; j < end; j += Math.max(1, Math.floor(step / 64))) {
      const a = Math.abs(samples[j]);
      if (a > maxAbs) maxAbs = a;
    }
    peaks[i] = maxAbs;
    if (maxAbs > globalMax) globalMax = maxAbs;
  }

  for (let i = 0; i < bucketCount; i++) {
    peaks[i] = Math.max(0.04, Math.min(1, peaks[i] / globalMax));
  }
  return peaks;
}

export function generateFallbackWaveform(bucketCount = 160, base = 0.4): number[] {
  const out: number[] = [];
  for (let i = 0; i < bucketCount; i++) {
    const t = i / bucketCount;
    const env = Math.sin(t * Math.PI) * 0.55 + 0.45;
    const wave =
      Math.abs(Math.sin(i * 0.43)) * 0.5 +
      Math.abs(Math.cos(i * 1.17)) * 0.35 +
      Math.abs(Math.sin(i * 2.71)) * 0.15;
    out.push(Math.max(0.05, Math.min(0.96, wave * env * base * 1.6)));
  }
  return out;
}
