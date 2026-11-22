/**
 * Client-side Scene Edit Detection:
 * Steps through an HTMLVideoElement at small intervals, compares downsampled RGB
 * histograms across consecutive frames, and returns timestamps of detected scene cuts.
 */
export async function detectSceneCuts(
  video: HTMLVideoElement,
  startSec: number,
  durationSec: number,
  sensitivity = 0.32
): Promise<number[]> {
  if (video.readyState < 2 || durationSec <= 0.5) return [];

  const wasPaused = video.paused;
  const origTime = video.currentTime;
  video.pause();

  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 27;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const step = Math.max(0.25, Math.min(0.6, durationSec / 45));
  const cuts: number[] = [];
  let prevFrame: Uint8ClampedArray | null = null;
  let lastCut = -1;

  for (let t = startSec; t < startSec + durationSec - 0.1; t += step) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.addEventListener('seeked', done, { once: true });
      try {
        video.currentTime = t;
      } catch {
        resolve();
      }
      setTimeout(done, 450);
    });

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (prevFrame) {
      let diffSum = 0;
      const total = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        diffSum +=
          (Math.abs(data[i] - prevFrame[i]) +
            Math.abs(data[i + 1] - prevFrame[i + 1]) +
            Math.abs(data[i + 2] - prevFrame[i + 2])) /
          765;
      }
      const meanDiff = diffSum / total;
      if (meanDiff >= sensitivity && t - lastCut > 0.75) {
        cuts.push(Number((t - startSec).toFixed(3)));
        lastCut = t;
      }
    }
    prevFrame = new Uint8ClampedArray(data);
  }

  try {
    video.currentTime = origTime;
  } catch {
    // ignore
  }
  if (!wasPaused) video.play().catch(() => {});
  return cuts;
}
