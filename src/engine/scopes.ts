import type { ScopeMode } from '../types/editor';

export interface ScopeMetrics {
  avgIre: number;
  peakIre: number;
  minIre: number;
  clipHighPct: number;
  clipLowPct: number;
}

const SAMPLE_W = 192;
const SAMPLE_H = 108;

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function ensureScratch(): CanvasRenderingContext2D {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = SAMPLE_W;
    scratchCanvas.height = SAMPLE_H;
    scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
  }
  return scratchCtx!;
}

/**
 * Computes and draws real-time post-grade RGB Parade, Luma Waveform, or RGB Histogram
 * directly from the rendered WebGL2 preview canvas.
 */
export function renderVideoScope(
  sourceCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  mode: ScopeMode
): ScopeMetrics {
  const sCtx = ensureScratch();
  sCtx.drawImage(sourceCanvas, 0, 0, SAMPLE_W, SAMPLE_H);
  const pixels = sCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;

  const tCtx = targetCanvas.getContext('2d');
  if (!tCtx) {
    return { avgIre: 0, peakIre: 0, minIre: 0, clipHighPct: 0, clipLowPct: 0 };
  }

  const W = targetCanvas.width;
  const H = targetCanvas.height;
  tCtx.fillStyle = '#050811';
  tCtx.fillRect(0, 0, W, H);

  // Subtle Rec.709 IRE graticule (0, 25, 50, 75, 100)
  const padT = 10;
  const padB = 10;
  const plotH = H - padT - padB;
  tCtx.strokeStyle = 'rgba(140, 156, 192, 0.14)';
  tCtx.lineWidth = 1;
  tCtx.font = '10px "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace';
  tCtx.fillStyle = 'rgba(140, 156, 192, 0.65)';

  for (const ire of [0, 25, 50, 75, 100]) {
    const y = Math.round(padT + plotH * (1 - ire / 100)) + 0.5;
    tCtx.beginPath();
    tCtx.moveTo(0, y);
    tCtx.lineTo(W, y);
    tCtx.stroke();
    tCtx.fillText(String(ire), 4, y - 2);
  }

  // Compute summary IRE stats
  let sumLuma = 0;
  let peakLuma = 0;
  let minLuma = 255;
  let clipHigh = 0;
  let clipLow = 0;
  const totalPx = SAMPLE_W * SAMPLE_H;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sumLuma += y;
    if (y > peakLuma) peakLuma = y;
    if (y < minLuma) minLuma = y;
    if (r >= 252 || g >= 252 || b >= 252) clipHigh++;
    if (r <= 3 && g <= 3 && b <= 3) clipLow++;
  }

  const img = tCtx.getImageData(0, 0, W, H);
  const out = img.data;

  const plotDot = (x: number, y: number, r: number, g: number, b: number, boost: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const idx = (y * W + x) * 4;
    out[idx] = Math.min(255, out[idx] + r * boost);
    out[idx + 1] = Math.min(255, out[idx + 1] + g * boost);
    out[idx + 2] = Math.min(255, out[idx + 2] + b * boost);
    out[idx + 3] = 255;
  };

  if (mode === 'parade') {
    const segW = Math.floor((W - 24) / 3);
    const offsetX = 20;
    for (let sx = 0; sx < SAMPLE_W; sx++) {
      const rx = offsetX + Math.floor((sx / SAMPLE_W) * segW);
      const gx = offsetX + segW + Math.floor((sx / SAMPLE_W) * segW);
      const bx = offsetX + segW * 2 + Math.floor((sx / SAMPLE_W) * segW);
      for (let sy = 0; sy < SAMPLE_H; sy++) {
        const idx = (sy * SAMPLE_W + sx) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const ry = Math.round(padT + plotH * (1 - r / 255));
        const gy = Math.round(padT + plotH * (1 - g / 255));
        const by = Math.round(padT + plotH * (1 - b / 255));
        plotDot(rx, ry, 255, 68, 78, 0.24);
        plotDot(gx, gy, 72, 245, 130, 0.24);
        plotDot(bx, by, 82, 162, 255, 0.26);
      }
    }
    tCtx.putImageData(img, 0, 0);
    // Subtle channel dividers
    tCtx.strokeStyle = 'rgba(140, 156, 192, 0.14)';
    tCtx.beginPath();
    tCtx.moveTo(offsetX + segW + 0.5, 0);
    tCtx.lineTo(offsetX + segW + 0.5, H);
    tCtx.moveTo(offsetX + segW * 2 + 0.5, 0);
    tCtx.lineTo(offsetX + segW * 2 + 0.5, H);
    tCtx.stroke();
  } else if (mode === 'waveform') {
    const offsetX = 20;
    const drawW = W - offsetX - 4;
    for (let sx = 0; sx < SAMPLE_W; sx++) {
      const tx = offsetX + Math.floor((sx / SAMPLE_W) * drawW);
      for (let sy = 0; sy < SAMPLE_H; sy++) {
        const idx = (sy * SAMPLE_W + sx) * 4;
        const y = 0.2126 * pixels[idx] + 0.7152 * pixels[idx + 1] + 0.0722 * pixels[idx + 2];
        const ty = Math.round(padT + plotH * (1 - y / 255));
        plotDot(tx, ty, 224, 242, 255, 0.22);
      }
    }
    tCtx.putImageData(img, 0, 0);
  } else {
    // RGB + Luma Histogram
    const binsR = new Uint32Array(256);
    const binsG = new Uint32Array(256);
    const binsB = new Uint32Array(256);
    const binsY = new Uint32Array(256);
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const y = Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
      binsR[r]++;
      binsG[g]++;
      binsB[b]++;
      binsY[y]++;
    }
    let maxBin = 1;
    for (let i = 2; i < 254; i++) {
      maxBin = Math.max(maxBin, binsR[i], binsG[i], binsB[i], binsY[i]);
    }
    const drawCurve = (bins: Uint32Array, stroke: string, fill: string) => {
      tCtx.beginPath();
      tCtx.moveTo(0, H - padB);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * W;
        const norm = Math.min(1, bins[i] / maxBin);
        const y = H - padB - Math.pow(norm, 0.65) * plotH;
        tCtx.lineTo(x, y);
      }
      tCtx.lineTo(W, H - padB);
      tCtx.closePath();
      tCtx.fillStyle = fill;
      tCtx.fill();
      tCtx.strokeStyle = stroke;
      tCtx.lineWidth = 1.2;
      tCtx.stroke();
    };
    drawCurve(binsR, 'rgba(255,95,105,0.9)', 'rgba(255,95,105,0.18)');
    drawCurve(binsG, 'rgba(92,235,142,0.9)', 'rgba(92,235,142,0.18)');
    drawCurve(binsB, 'rgba(98,168,255,0.95)', 'rgba(98,168,255,0.18)');
    drawCurve(binsY, 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.06)');
  }

  return {
    avgIre: Math.round((sumLuma / totalPx / 255) * 100),
    peakIre: Math.round((peakLuma / 255) * 100),
    minIre: Math.round((minLuma / 255) * 100),
    clipHighPct: Number(((clipHigh / totalPx) * 100).toFixed(1)),
    clipLowPct: Number(((clipLow / totalPx) * 100).toFixed(1)),
  };
}
