import type { ClipColorGrade, ParsedLut3D } from '../types/editor';

/**
 * Parses an industry-standard Adobe .cube 3D (or 1D promoted to 3D) LUT file.
 * Supports TITLE, LUT_3D_SIZE, LUT_1D_SIZE, DOMAIN_MIN, DOMAIN_MAX, and comments.
 */
export function parseCubeLut(text: string, id: string, fallbackTitle = 'Untitled LUT'): ParsedLut3D {
  const lines = text.split(/\r?\n/);
  let title = fallbackTitle;
  let size3D = 0;
  let size1D = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;

    if (raw.startsWith('TITLE')) {
      const m = raw.match(/^TITLE\s+"?([^"]*)"?/i);
      if (m && m[1]) title = m[1].trim();
      continue;
    }
    if (raw.startsWith('LUT_3D_SIZE')) {
      size3D = parseInt(raw.split(/\s+/)[1], 10);
      continue;
    }
    if (raw.startsWith('LUT_1D_SIZE')) {
      size1D = parseInt(raw.split(/\s+/)[1], 10);
      continue;
    }
    if (raw.startsWith('DOMAIN_MIN')) {
      const parts = raw.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        domainMin = [parts[0], parts[1], parts[2]];
      }
      continue;
    }
    if (raw.startsWith('DOMAIN_MAX')) {
      const parts = raw.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        domainMax = [parts[0], parts[1], parts[2]];
      }
      continue;
    }
    if (/^[A-Za-z_]/.test(raw)) {
      // Ignore optional metadata directives like LUT_3D_INPUT_RANGE
      continue;
    }

    const parts = raw.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        values.push(r, g, b);
      }
    }
  }

  if (size3D > 1) {
    const expected = size3D * size3D * size3D * 3;
    const data = new Float32Array(expected);
    const len = Math.min(expected, values.length);
    for (let i = 0; i < len; i++) {
      data[i] = values[i];
    }
    return { id, title, size: size3D, domainMin, domainMax, data };
  }

  if (size1D > 1 && values.length >= size1D * 3) {
    // Promote 1D LUT to a 33^3 3D LUT so it runs natively inside the WebGL2 3D LUT stack
    const targetSize = 33;
    const data = new Float32Array(targetSize * targetSize * targetSize * 3);
    const sample1D = (u: number, ch: number): number => {
      const pos = Math.max(0, Math.min(1, u)) * (size1D - 1);
      const i0 = Math.floor(pos);
      const i1 = Math.min(size1D - 1, i0 + 1);
      const t = pos - i0;
      const v0 = values[i0 * 3 + ch];
      const v1 = values[i1 * 3 + ch];
      return v0 + (v1 - v0) * t;
    };
    let offset = 0;
    for (let b = 0; b < targetSize; b++) {
      const bv = sample1D(b / (targetSize - 1), 2);
      for (let g = 0; g < targetSize; g++) {
        const gv = sample1D(g / (targetSize - 1), 1);
        for (let r = 0; r < targetSize; r++) {
          data[offset++] = sample1D(r / (targetSize - 1), 0);
          data[offset++] = gv;
          data[offset++] = bv;
        }
      }
    }
    return { id, title, size: targetSize, domainMin, domainMax, data };
  }

  // Fallback: infer cube dimension from entry count
  const inferred = Math.round(Math.cbrt(values.length / 3));
  if (inferred >= 2 && inferred * inferred * inferred * 3 === values.length) {
    return {
      id,
      title,
      size: inferred,
      domainMin,
      domainMax,
      data: new Float32Array(values),
    };
  }

  throw new Error(`Invalid .cube LUT "${fallbackTitle}": could not determine LUT_3D_SIZE.`);
}

/**
 * Decodes colorstudies' native gzip-compressed second-order delta-encoded Int32 .bin 3D LUTs.
 */
export async function parseColorstudiesBinLut(
  compressedBytes: ArrayBuffer,
  id: string,
  title: string
): Promise<ParsedLut3D> {
  let rawBuffer: ArrayBuffer;
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    rawBuffer = await new Response(stream).arrayBuffer();
  } else {
    throw new Error('DecompressionStream(gzip) is required to decode colorstudies .bin LUTs.');
  }

  const view = new DataView(rawBuffer);
  const count = view.byteLength / 12;
  const size = Math.round(Math.cbrt(count));
  if (size < 2 || size * size * size * 12 !== view.byteLength) {
    throw new Error(`Invalid colorstudies .bin LUT "${title}" (byteLength=${view.byteLength}).`);
  }

  const data = new Float32Array(count * 3);
  const delta = [0, 0, 0];
  const rgb = [0, 0, 0];
  let out = 0;
  for (let offset = 0; offset < view.byteLength; offset += 12) {
    for (let ch = 0; ch < 3; ch++) {
      delta[ch] += view.getInt32(offset + ch * 4, true);
      rgb[ch] += delta[ch];
      data[out++] = rgb[ch] / 1e7;
    }
  }

  return {
    id,
    title,
    size,
    domainMin: [0, 0, 0],
    domainMax: [1, 1, 1],
    data,
  };
}

/**
 * Exact tetrahedral interpolation of a ParsedLut3D on CPU (used for baking
 * combined multi-LUT + primary/grading looks into a single exportable .cube LUT).
 */
export function sampleLutTetrahedral(
  lut: ParsedLut3D,
  rIn: number,
  gIn: number,
  bIn: number
): [number, number, number] {
  const s = lut.size;
  const maxIdx = s - 1;
  const dMin = lut.domainMin;
  const dMax = lut.domainMax;

  const rn = Math.max(0, Math.min(1, (rIn - dMin[0]) / Math.max(1e-6, dMax[0] - dMin[0]))) * maxIdx;
  const gn = Math.max(0, Math.min(1, (gIn - dMin[1]) / Math.max(1e-6, dMax[1] - dMin[1]))) * maxIdx;
  const bn = Math.max(0, Math.min(1, (bIn - dMin[2]) / Math.max(1e-6, dMax[2] - dMin[2]))) * maxIdx;

  const r0 = Math.floor(rn);
  const g0 = Math.floor(gn);
  const b0 = Math.floor(bn);
  const r1 = Math.min(maxIdx, r0 + 1);
  const g1 = Math.min(maxIdx, g0 + 1);
  const b1 = Math.min(maxIdx, b0 + 1);

  const fx = rn - r0;
  const fy = gn - g0;
  const fz = bn - b0;

  const at = (ri: number, gi: number, bi: number, ch: number) =>
    lut.data[((bi * s + gi) * s + ri) * 3 + ch];

  const out: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const c000 = at(r0, g0, b0, ch);
    const c111 = at(r1, g1, b1, ch);
    let val: number;
    if (fx > fy) {
      if (fy > fz) {
        const c100 = at(r1, g0, b0, ch);
        const c110 = at(r1, g1, b0, ch);
        val = (1 - fx) * c000 + (fx - fy) * c100 + (fy - fz) * c110 + fz * c111;
      } else if (fx > fz) {
        const c100 = at(r1, g0, b0, ch);
        const c101 = at(r1, g0, b1, ch);
        val = (1 - fx) * c000 + (fx - fz) * c100 + (fz - fy) * c101 + fy * c111;
      } else {
        const c001 = at(r0, g0, b1, ch);
        const c101 = at(r1, g0, b1, ch);
        val = (1 - fz) * c000 + (fz - fx) * c001 + (fx - fy) * c101 + fy * c111;
      }
    } else {
      if (fz > fy) {
        const c001 = at(r0, g0, b1, ch);
        const c011 = at(r0, g1, b1, ch);
        val = (1 - fz) * c000 + (fz - fy) * c001 + (fy - fx) * c011 + fx * c111;
      } else if (fz > fx) {
        const c010 = at(r0, g1, b0, ch);
        const c011 = at(r0, g1, b1, ch);
        val = (1 - fy) * c000 + (fy - fz) * c010 + (fz - fx) * c011 + fx * c111;
      } else {
        const c010 = at(r0, g1, b0, ch);
        const c110 = at(r1, g1, b0, ch);
        val = (1 - fy) * c000 + (fy - fx) * c010 + (fx - fz) * c110 + fz * c111;
      }
    }
    out[ch] = val;
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function wheelToRgbOffset(x: number, y: number, strength = 0.35): [number, number, number] {
  // Maps color wheel (x, y) to balanced zero-sum RGB tint shift
  const angle = Math.atan2(y, x);
  const mag = Math.min(1, Math.hypot(x, y)) * strength;
  const r = Math.cos(angle) * mag;
  const g = Math.cos(angle - (2 * Math.PI) / 3) * mag;
  const b = Math.cos(angle + (2 * Math.PI) / 3) * mag;
  return [r, g, b];
}

/**
 * Mirrors the WebGL2 color correction + grading + multi-LUT stack on CPU
 * to bake any clip's complete look into a clean 33x33x33 .cube LUT file
 * (used both for FFmpeg `lut3d` hardware export and saving new looks to colorstudies).
 */
export function bakeGradeToCube(
  title: string,
  grade: ClipColorGrade,
  loadedLuts: Map<string, ParsedLut3D>,
  size = 33
): string {
  const corr = grade.correction;
  const gr = grade.grading;
  const expMul = Math.pow(2, corr.exposure);
  const contrastSlope = 1 + corr.contrast / 100;
  const temp = corr.temperature / 100;
  const tint = corr.tint / 100;
  const sat = 1 + corr.saturation / 100;
  const vib = corr.vibrance / 100;

  const liftTint = wheelToRgbOffset(gr.lift.x, gr.lift.y, 0.25);
  const gammaTint = wheelToRgbOffset(gr.gamma.x, gr.gamma.y, 0.30);
  const gainTint = wheelToRgbOffset(gr.gain.x, gr.gain.y, 0.35);
  const splitShadow = hexToRgb01(gr.splitShadowHex);
  const splitHigh = hexToRgb01(gr.splitHighlightHex);
  const splitAmt = gr.splitAmount / 100;
  const splitBal = gr.splitBalance / 100;
  const shoulder = gr.filmicShoulder / 100;
  const matte = (gr.matteLift / 100) * 0.14;

  const activeLuts = grade.lutStack
    .filter((l) => l.enabled && l.intensity > 0 && loadedLuts.has(l.lutId))
    .map((l) => ({ lut: loadedLuts.get(l.lutId)!, mix: l.intensity / 100 }));

  const lines: string[] = [
    '# Baked by Fifilm Multi-LUT Color Pipeline',
    `TITLE "${title.replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${size}`,
    'DOMAIN_MIN 0.000000 0.000000 0.000000',
    'DOMAIN_MAX 1.000000 1.000000 1.000000',
  ];

  for (let bi = 0; bi < size; bi++) {
    const bBase = bi / (size - 1);
    for (let gi = 0; gi < size; gi++) {
      const gBase = gi / (size - 1);
      for (let ri = 0; ri < size; ri++) {
        let r = ri / (size - 1);
        let g = gBase;
        let b = bBase;

        // 1. Primary exposure & white balance
        r *= expMul * (1 + temp * 0.24 + tint * 0.06);
        g *= expMul * (1 - tint * 0.18);
        b *= expMul * (1 - temp * 0.24 + tint * 0.06);

        // 2. Contrast around 0.5 pivot
        r = (r - 0.5) * contrastSlope + 0.5;
        g = (g - 0.5) * contrastSlope + 0.5;
        b = (b - 0.5) * contrastSlope + 0.5;

        // 3. Highlights / Shadows / Whites / Blacks
        const luma0 = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const hiW = smoothstep(0.42, 0.95, luma0);
        const shW = 1 - smoothstep(0.05, 0.58, luma0);
        const whW = smoothstep(0.72, 1.0, luma0);
        const blW = 1 - smoothstep(0.0, 0.28, luma0);
        const toneDelta =
          (corr.highlights / 100) * 0.35 * hiW +
          (corr.shadows / 100) * 0.35 * shW +
          (corr.whites / 100) * 0.28 * whW +
          (corr.blacks / 100) * 0.28 * blW;
        r = clamp01(r + toneDelta);
        g = clamp01(g + toneDelta);
        b = clamp01(b + toneDelta);

        // 4. Saturation & perceptual vibrance
        const luma1 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const curSat = maxC - minC;
        const vibGain = 1 + vib * (1 - curSat) * 0.85;
        const totalSat = Math.max(0, sat * vibGain);
        r = clamp01(luma1 + (r - luma1) * totalSat);
        g = clamp01(luma1 + (g - luma1) * totalSat);
        b = clamp01(luma1 + (b - luma1) * totalSat);

        // 5. Creative Grading (Lift / Gamma / Gain + Split Toning + Filmic)
        if (gr.enabled) {
          const lOff = gr.lift.luma * 0.22;
          const gPowR = Math.pow(2, -(gr.gamma.luma * 0.65 + gammaTint[0] * 1.4));
          const gPowG = Math.pow(2, -(gr.gamma.luma * 0.65 + gammaTint[1] * 1.4));
          const gPowB = Math.pow(2, -(gr.gamma.luma * 0.65 + gammaTint[2] * 1.4));
          const gainM = 1 + gr.gain.luma * 0.5;

          r = Math.pow(clamp01(r * (gainM + gainTint[0]) + (lOff + liftTint[0]) * (1 - r)), gPowR);
          g = Math.pow(clamp01(g * (gainM + gainTint[1]) + (lOff + liftTint[1]) * (1 - g)), gPowG);
          b = Math.pow(clamp01(b * (gainM + gainTint[2]) + (lOff + liftTint[2]) * (1 - b)), gPowB);

          if (splitAmt > 0.001) {
            const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const pivot = clamp01(0.5 + splitBal * 0.35);
            const sW = 1 - smoothstep(0, pivot + 0.25, l2);
            const hW = smoothstep(pivot - 0.25, 1, l2);
            r = clamp01(r + splitAmt * 0.35 * (sW * (splitShadow[0] - 0.5) + hW * (splitHigh[0] - 0.5)));
            g = clamp01(g + splitAmt * 0.35 * (sW * (splitShadow[1] - 0.5) + hW * (splitHigh[1] - 0.5)));
            b = clamp01(b + splitAmt * 0.35 * (sW * (splitShadow[2] - 0.5) + hW * (splitHigh[2] - 0.5)));
          }

          if (shoulder > 0.001) {
            const roll = (v: number) => v / (1 + shoulder * 0.45 * v) * (1 + shoulder * 0.45);
            r = clamp01(roll(r));
            g = clamp01(roll(g));
            b = clamp01(roll(b));
          }

          if (matte > 0.0001) {
            r = clamp01(matte + r * (1 - matte));
            g = clamp01(matte + g * (1 - matte));
            b = clamp01(matte + b * (1 - matte));
          }
        }

        // 6. Sequential Multi-LUT Stack
        for (let k = 0; k < activeLuts.length; k++) {
          const { lut, mix } = activeLuts[k];
          const [lr, lg, lb] = sampleLutTetrahedral(lut, r, g, b);
          r = r + (lr - r) * mix;
          g = g + (lg - g) * mix;
          b = b + (lb - b) * mix;
        }

        lines.push(`${clamp01(r).toFixed(6)} ${clamp01(g).toFixed(6)} ${clamp01(b).toFixed(6)}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}
