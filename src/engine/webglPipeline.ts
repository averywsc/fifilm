import type {
  ClipColorGrade,
  LetterboxAspect,
  ParsedLut3D,
  StabilizationFrameTransform,
  StabilizationState,
} from '../types/editor';
import { wheelToRgbOffset } from './cubeParser';

const MAX_STACKED_LUTS = 6;

const VERT_SRC = `#version 300 es
precision highp float;
const vec2 POS[4] = vec2[4](
  vec2(-1.0, -1.0),
  vec2( 1.0, -1.0),
  vec2(-1.0,  1.0),
  vec2( 1.0,  1.0)
);
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uVideo;
uniform sampler2D uVideoStab;
uniform int uHasStabVideo;
uniform vec2 uTexelSize;
uniform sampler3D uLut0;
uniform sampler3D uLut1;
uniform sampler3D uLut2;
uniform sampler3D uLut3;
uniform sampler3D uLut4;
uniform sampler3D uLut5;

uniform int uLutCount;
uniform int uUseTetrahedral;
uniform float uLutIntensity[6];
uniform float uLutSize[6];
uniform vec3 uLutMin[6];
uniform vec3 uLutMax[6];

// Primary Color Correction
uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemperature;
uniform float uTint;
uniform float uSaturation;
uniform float uVibrance;

// Creative Color Grading
uniform int uGradingEnabled;
uniform vec3 uLiftTint;
uniform float uLiftLuma;
uniform vec3 uGammaTint;
uniform float uGammaLuma;
uniform vec3 uGainTint;
uniform float uGainLuma;
uniform float uSplitAmount;
uniform float uSplitBalance;
uniform vec3 uSplitShadow;
uniform vec3 uSplitHighlight;
uniform float uFilmicShoulder;
uniform float uMatteLift;
uniform float uGrain;
uniform float uTime;

// GPU Optical & Cinema Effects
uniform int uEffectsEnabled;
uniform float uHalation;
uniform float uHalationThresh;
uniform float uBloom;
uniform float uBloomRadius;
uniform float uSharpen;
uniform float uBlur;
uniform float uChromaticAb;
uniform float uVignette;
uniform float uVignetteFeather;
uniform float uGrainSize;
uniform float uLetterboxRatio; // 0 = off, else target aspect (e.g. 2.39)
uniform float uFrameAspect;

// Stabilization preview transform (dx, dy, angleRad, scale)
uniform vec4 uStabTransform;
uniform float uEdgeFeather;

// Split / Hold to Compare
uniform int uCompareOriginal;
uniform int uSplitEnabled;
uniform float uSplitPos;

vec3 sampleLutTrilinear(sampler3D tex, vec3 rgb, float size, vec3 dMin, vec3 dMax) {
  vec3 norm = clamp((rgb - dMin) / max(vec3(1e-5), dMax - dMin), 0.0, 1.0);
  vec3 coord = (norm * (size - 1.0) + 0.5) / size;
  return texture(tex, coord).rgb;
}

vec3 sampleLutTetra(sampler3D tex, vec3 rgb, float size, vec3 dMin, vec3 dMax) {
  vec3 norm = clamp((rgb - dMin) / max(vec3(1e-5), dMax - dMin), 0.0, 1.0);
  float maxIdx = size - 1.0;
  vec3 scaled = norm * maxIdx;
  ivec3 p0 = ivec3(floor(scaled));
  ivec3 p1 = min(ivec3(int(maxIdx)), p0 + ivec3(1));
  vec3 f = scaled - vec3(p0);

  vec3 c000 = texelFetch(tex, p0, 0).rgb;
  vec3 c111 = texelFetch(tex, p1, 0).rgb;

  if (f.x > f.y) {
    if (f.y > f.z) {
      vec3 c100 = texelFetch(tex, ivec3(p1.x, p0.y, p0.z), 0).rgb;
      vec3 c110 = texelFetch(tex, ivec3(p1.x, p1.y, p0.z), 0).rgb;
      return (1.0 - f.x) * c000 + (f.x - f.y) * c100 + (f.y - f.z) * c110 + f.z * c111;
    } else if (f.x > f.z) {
      vec3 c100 = texelFetch(tex, ivec3(p1.x, p0.y, p0.z), 0).rgb;
      vec3 c101 = texelFetch(tex, ivec3(p1.x, p0.y, p1.z), 0).rgb;
      return (1.0 - f.x) * c000 + (f.x - f.z) * c100 + (f.z - f.y) * c101 + f.y * c111;
    } else {
      vec3 c001 = texelFetch(tex, ivec3(p0.x, p0.y, p1.z), 0).rgb;
      vec3 c101 = texelFetch(tex, ivec3(p1.x, p0.y, p1.z), 0).rgb;
      return (1.0 - f.z) * c000 + (f.z - f.x) * c001 + (f.x - f.y) * c101 + f.y * c111;
    }
  } else {
    if (f.z > f.y) {
      vec3 c001 = texelFetch(tex, ivec3(p0.x, p0.y, p1.z), 0).rgb;
      vec3 c011 = texelFetch(tex, ivec3(p0.x, p1.y, p1.z), 0).rgb;
      return (1.0 - f.z) * c000 + (f.z - f.y) * c001 + (f.y - f.x) * c011 + f.x * c111;
    } else if (f.z > f.x) {
      vec3 c010 = texelFetch(tex, ivec3(p0.x, p1.y, p0.z), 0).rgb;
      vec3 c011 = texelFetch(tex, ivec3(p0.x, p1.y, p1.z), 0).rgb;
      return (1.0 - f.y) * c000 + (f.y - f.z) * c010 + (f.z - f.x) * c011 + f.x * c111;
    } else {
      vec3 c010 = texelFetch(tex, ivec3(p0.x, p1.y, p0.z), 0).rgb;
      vec3 c110 = texelFetch(tex, ivec3(p1.x, p1.y, p0.z), 0).rgb;
      return (1.0 - f.y) * c000 + (f.y - f.x) * c010 + (f.x - f.z) * c110 + f.z * c111;
    }
  }
}

vec3 applyLut(sampler3D tex, vec3 rgb, int idx) {
  float mixVal = uLutIntensity[idx];
  if (mixVal <= 0.0001) return rgb;
  vec3 graded = (uUseTetrahedral == 1)
    ? sampleLutTetra(tex, rgb, uLutSize[idx], uLutMin[idx], uLutMax[idx])
    : sampleLutTrilinear(tex, rgb, uLutSize[idx], uLutMin[idx], uLutMax[idx]);
  return mix(rgb, graded, mixVal);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 applyStabilizationUv(vec2 uv) {
  vec2 centered = uv - 0.5;
  float c = cos(uStabTransform.z);
  float s = sin(uStabTransform.z);
  mat2 rot = mat2(c, -s, s, c);
  float invScale = 1.0 / max(1.0, uStabTransform.w);
  return rot * (centered * invScale) + 0.5 + uStabTransform.xy;
}

vec3 sampleActiveVideo(vec2 uv) {
  return (uHasStabVideo == 1) ? texture(uVideoStab, uv).rgb : texture(uVideo, uv).rgb;
}

vec3 sampleSourceOptical(vec2 uv) {
  vec2 clampedUv = clamp(uv, 0.0005, 0.9995);
  vec3 base = sampleActiveVideo(clampedUv);

  if (uEffectsEnabled == 0) return base;

  // Radial Chromatic Aberration
  if (uChromaticAb > 0.001) {
    vec2 dir = clampedUv - 0.5;
    float shift = uChromaticAb * 0.014;
    float r = sampleActiveVideo(clamp(clampedUv + dir * shift, 0.0005, 0.9995)).r;
    float b = sampleActiveVideo(clamp(clampedUv - dir * shift, 0.0005, 0.9995)).b;
    base = vec3(r, base.g, b);
  }

  // Blur & Unsharp Mask (9-tap spatial kernel)
  if (uBlur > 0.001 || uSharpen > 0.001) {
    float rPx = (uBlur > 0.001) ? (1.0 + uBlur * 6.5) : 1.35;
    vec2 off = uTexelSize * rPx;
    vec3 acc = base * 0.25;
    acc += sampleActiveVideo(clamp(clampedUv + vec2( off.x,  0.0),   0.0005, 0.9995)) * 0.125;
    acc += sampleActiveVideo(clamp(clampedUv + vec2(-off.x,  0.0),   0.0005, 0.9995)) * 0.125;
    acc += sampleActiveVideo(clamp(clampedUv + vec2( 0.0,    off.y), 0.0005, 0.9995)) * 0.125;
    acc += sampleActiveVideo(clamp(clampedUv + vec2( 0.0,   -off.y), 0.0005, 0.9995)) * 0.125;
    acc += sampleActiveVideo(clamp(clampedUv + vec2( off.x,  off.y), 0.0005, 0.9995)) * 0.0625;
    acc += sampleActiveVideo(clamp(clampedUv + vec2(-off.x,  off.y), 0.0005, 0.9995)) * 0.0625;
    acc += sampleActiveVideo(clamp(clampedUv + vec2( off.x, -off.y), 0.0005, 0.9995)) * 0.0625;
    acc += sampleActiveVideo(clamp(clampedUv + vec2(-off.x, -off.y), 0.0005, 0.9995)) * 0.0625;
    if (uBlur > 0.001) {
      base = mix(base, acc, min(1.0, uBlur));
    }
    if (uSharpen > 0.001) {
      base = clamp(base + (base - acc) * (uSharpen * 2.2), 0.0, 1.0);
    }
  }

  // Pro-Mist Bloom & 35mm Film Halation (8-direction dual-ring optical gather)
  if (uBloom > 0.001 || uHalation > 0.001) {
    vec3 glowAcc = vec3(0.0);
    vec3 haloAcc = vec3(0.0);
    float rad = max(1.0, uBloomRadius) * 2.8;
    const vec2 DIRS[8] = vec2[8](
      vec2( 1.0,  0.0), vec2(-1.0,  0.0), vec2( 0.0,  1.0), vec2( 0.0, -1.0),
      vec2( 0.707,  0.707), vec2(-0.707,  0.707), vec2( 0.707, -0.707), vec2(-0.707, -0.707)
    );
    for (int i = 0; i < 8; i++) {
      vec3 s1 = sampleActiveVideo(clamp(clampedUv + DIRS[i] * uTexelSize * rad, 0.0005, 0.9995));
      vec3 s2 = sampleActiveVideo(clamp(clampedUv + DIRS[i] * uTexelSize * (rad * 2.2), 0.0005, 0.9995));
      float l1 = dot(s1, vec3(0.2126, 0.7152, 0.0722));
      float l2 = dot(s2, vec3(0.2126, 0.7152, 0.0722));
      glowAcc += s1 * smoothstep(0.50, 0.98, l1) * 0.08 + s2 * smoothstep(0.55, 0.98, l2) * 0.045;
      float h1 = smoothstep(uHalationThresh, 1.0, l1);
      float h2 = smoothstep(uHalationThresh, 1.0, l2);
      haloAcc += vec3(1.0, 0.24, 0.05) * (h1 * 0.09 + h2 * 0.06);
    }
    if (uBloom > 0.001) {
      base = 1.0 - (1.0 - base) * (1.0 - clamp(glowAcc * uBloom * 1.4, 0.0, 0.85));
    }
    if (uHalation > 0.001) {
      base = clamp(base + haloAcc * uHalation * 1.25, 0.0, 1.0);
    }
  }

  return base;
}

void main() {
  bool showOriginal = (uCompareOriginal == 1) || (uSplitEnabled == 1 && vUv.x < uSplitPos);
  vec2 sampleUv = (showOriginal || uHasStabVideo == 1) ? vUv : applyStabilizationUv(vUv);

  float edgeMask = 1.0;
  if (!showOriginal && uEdgeFeather > 0.001) {
    float margin = uEdgeFeather * 0.04;
    vec2 dist = min(sampleUv, 1.0 - sampleUv);
    edgeMask = smoothstep(0.0, margin, min(dist.x, dist.y));
  }

  if (showOriginal) {
    fragColor = vec4(texture(uVideo, clamp(sampleUv, 0.0005, 0.9995)).rgb, 1.0);
    return;
  }

  vec3 col = sampleSourceOptical(sampleUv);

  // 1. Primary Exposure & White Balance
  float expMul = exp2(uExposure);
  col *= vec3(
    expMul * (1.0 + uTemperature * 0.24 + uTint * 0.06),
    expMul * (1.0 - uTint * 0.18),
    expMul * (1.0 - uTemperature * 0.24 + uTint * 0.06)
  );

  // 2. Contrast around mid-gray pivot
  col = (col - 0.5) * (1.0 + uContrast) + 0.5;

  // 3. Tone regions
  float luma0 = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  float hiW = smoothstep(0.42, 0.95, luma0);
  float shW = 1.0 - smoothstep(0.05, 0.58, luma0);
  float whW = smoothstep(0.72, 1.0, luma0);
  float blW = 1.0 - smoothstep(0.0, 0.28, luma0);
  col += (uHighlights * 0.35 * hiW + uShadows * 0.35 * shW + uWhites * 0.28 * whW + uBlacks * 0.28 * blW);
  col = clamp(col, 0.0, 1.0);

  // 4. Saturation & Perceptual Vibrance
  float luma1 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float cMax = max(col.r, max(col.g, col.b));
  float cMin = min(col.r, min(col.g, col.b));
  float satFactor = max(0.0, (1.0 + uSaturation) * (1.0 + uVibrance * (1.0 - (cMax - cMin)) * 0.85));
  col = clamp(mix(vec3(luma1), col, satFactor), 0.0, 1.0);

  // 5. Creative Grading
  if (uGradingEnabled == 1) {
    vec3 gainM = vec3(1.0 + uGainLuma * 0.5) + uGainTint;
    vec3 liftA = vec3(uLiftLuma * 0.22) + uLiftTint;
    vec3 gammaPow = exp2(-(vec3(uGammaLuma * 0.65) + uGammaTint * 1.4));

    col = clamp(col * gainM + liftA * (1.0 - col), 0.0, 1.0);
    col = pow(max(col, vec3(1e-5)), gammaPow);

    if (uSplitAmount > 0.001) {
      float l2 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float pivot = clamp(0.5 + uSplitBalance * 0.35, 0.05, 0.95);
      float sW = 1.0 - smoothstep(0.0, pivot + 0.25, l2);
      float hW = smoothstep(pivot - 0.25, 1.0, l2);
      col = clamp(col + uSplitAmount * 0.35 * (sW * (uSplitShadow - 0.5) + hW * (uSplitHighlight - 0.5)), 0.0, 1.0);
    }

    if (uFilmicShoulder > 0.001) {
      float k = uFilmicShoulder * 0.45;
      col = clamp((col / (1.0 + k * col)) * (1.0 + k), 0.0, 1.0);
    }

    if (uMatteLift > 0.0001) {
      float m = uMatteLift * 0.14;
      col = clamp(vec3(m) + col * (1.0 - m), 0.0, 1.0);
    }
  }

  // 6. Sequential Stacked 3D LUT Passes
  if (uLutCount > 0) col = applyLut(uLut0, col, 0);
  if (uLutCount > 1) col = applyLut(uLut1, col, 1);
  if (uLutCount > 2) col = applyLut(uLut2, col, 2);
  if (uLutCount > 3) col = applyLut(uLut3, col, 3);
  if (uLutCount > 4) col = applyLut(uLut4, col, 4);
  if (uLutCount > 5) col = applyLut(uLut5, col, 5);

  // 7. Optical Vignette
  if (uEffectsEnabled == 1 && uVignette > 0.001) {
    vec2 d = (vUv - 0.5) * vec2(1.15, 1.0);
    float dist = length(d);
    float inner = mix(0.22, 0.52, uVignetteFeather);
    float vig = 1.0 - smoothstep(inner, inner + 0.42, dist) * uVignette * 0.85;
    col *= vig;
  }

  // 8. Organic Film Grain with Size Control
  if (uGradingEnabled == 1 && uGrain > 0.001) {
    vec2 cell = floor(gl_FragCoord.xy / max(1.0, uGrainSize));
    float n = hash12(cell + fract(uTime) * 317.0) - 0.5;
    float midWeight = 1.0 - abs(dot(col, vec3(0.333)) * 2.0 - 1.0);
    col = clamp(col + n * uGrain * 0.13 * (0.4 + 0.6 * midWeight), 0.0, 1.0);
  }

  // 9. Cinema Letterbox / Pillar Matte
  if (uEffectsEnabled == 1 && uLetterboxRatio > 0.01) {
    if (uLetterboxRatio > uFrameAspect + 0.01) {
      float visibleH = uFrameAspect / uLetterboxRatio;
      float bar = (1.0 - visibleH) * 0.5;
      if (vUv.y < bar || vUv.y > 1.0 - bar) col = vec3(0.0);
    } else if (uLetterboxRatio < uFrameAspect - 0.01) {
      float visibleW = uLetterboxRatio / uFrameAspect;
      float bar = (1.0 - visibleW) * 0.5;
      if (vUv.x < bar || vUv.x > 1.0 - bar) col = vec3(0.0);
    }
  }

  col *= mix(1.0, edgeMask, step(0.001, uEdgeFeather));
  fragColor = vec4(col, 1.0);
}
`;

function hexToVec3(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, '$1$1') : clean, 16);
  if (!Number.isFinite(n)) return [0.5, 0.5, 0.5];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function letterboxToFloat(lb: LetterboxAspect): number {
  if (lb === '2.39') return 2.39;
  if (lb === '1.85') return 1.85;
  if (lb === '1.66') return 1.66;
  if (lb === '1.33') return 1.3333;
  return 0;
}

export class WebGL2ColorPipeline {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject | null;
  private videoTexture: WebGLTexture;
  private stabVideoTexture: WebGLTexture;
  private lutTextures: Map<string, { tex: WebGLTexture; lut: ParsedLut3D }> = new Map();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private fallbackLutTex: WebGLTexture;
  private supportsFloat3D = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('WebGL2 is required for Fifilm real-time video grading.');
    }
    this.gl = gl;
    this.supportsFloat3D = !!gl.getExtension('OES_texture_float_linear');

    this.program = this.createProgram(VERT_SRC, FRAG_SRC);
    this.vao = gl.createVertexArray();
    this.videoTexture = this.createVideoTexture();
    this.stabVideoTexture = this.createVideoTexture();
    this.fallbackLutTex = this.createIdentityLutTexture();
    this.cacheUniformLocations();
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type);
    if (!sh) throw new Error('Failed to create shader');
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'Unknown shader compile error';
      gl.deleteShader(sh);
      throw new Error(`WebGL2 shader error: ${log}`);
    }
    return sh;
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const v = this.compileShader(gl.VERTEX_SHADER, vs);
    const f = this.compileShader(gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram();
    if (!prog) throw new Error('Failed to create WebGL2 program');
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'Unknown link error';
      throw new Error(`WebGL2 link error: ${log}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    return prog;
  }

  private createVideoTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([8, 12, 24, 255])
    );
    return tex;
  }

  private createIdentityLutTexture(): WebGLTexture {
    const data = new Uint8Array([
      0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 0, 255,
      0, 0, 255, 255, 255, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255, 255,
    ]);
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 2, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  private cacheUniformLocations(): void {
    const names = [
      'uVideo', 'uVideoStab', 'uHasStabVideo', 'uTexelSize',
      'uLut0', 'uLut1', 'uLut2', 'uLut3', 'uLut4', 'uLut5',
      'uLutCount', 'uUseTetrahedral',
      'uLutIntensity', 'uLutSize', 'uLutMin', 'uLutMax',
      'uExposure', 'uContrast', 'uHighlights', 'uShadows', 'uWhites', 'uBlacks',
      'uTemperature', 'uTint', 'uSaturation', 'uVibrance',
      'uGradingEnabled', 'uLiftTint', 'uLiftLuma', 'uGammaTint', 'uGammaLuma',
      'uGainTint', 'uGainLuma', 'uSplitAmount', 'uSplitBalance',
      'uSplitShadow', 'uSplitHighlight', 'uFilmicShoulder', 'uMatteLift',
      'uGrain', 'uTime',
      'uEffectsEnabled', 'uHalation', 'uHalationThresh', 'uBloom', 'uBloomRadius',
      'uSharpen', 'uBlur', 'uChromaticAb', 'uVignette', 'uVignetteFeather',
      'uGrainSize', 'uLetterboxRatio', 'uFrameAspect',
      'uStabTransform', 'uEdgeFeather',
      'uCompareOriginal', 'uSplitEnabled', 'uSplitPos',
    ];
    for (const name of names) {
      this.uniforms[name] = this.gl.getUniformLocation(this.program, name);
    }
  }

  public uploadLut(lut: ParsedLut3D): void {
    if (this.lutTextures.has(lut.id)) return;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const s = lut.size;
    if (this.supportsFloat3D) {
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB32F, s, s, s, 0, gl.RGB, gl.FLOAT, lut.data);
    } else {
      const count = s * s * s;
      const rgba = new Uint8Array(count * 4);
      for (let i = 0; i < count; i++) {
        rgba[i * 4 + 0] = Math.round(Math.max(0, Math.min(1, lut.data[i * 3 + 0])) * 255);
        rgba[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, lut.data[i * 3 + 1])) * 255);
        rgba[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, lut.data[i * 3 + 2])) * 255);
        rgba[i * 4 + 3] = 255;
      }
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, s, s, s, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    }
    this.lutTextures.set(lut.id, { tex, lut });
  }

  public clear(r = 0.02, g = 0.031, b = 0.067): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  public renderFrame(params: {
    source: TexImageSource;
    stabilizedSource?: TexImageSource | null;
    width: number;
    height: number;
    grade: ClipColorGrade;
    stabilization: StabilizationState;
    frameTransform?: StabilizationFrameTransform;
    compareOriginal: boolean;
    splitEnabled: boolean;
    splitPos: number;
    timeSec: number;
  }): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    // Cap live preview render resolution at 1920px max dimension (preserving exact aspect ratio)
    // so 4K/8K and vertical 9:16 footage stay buttery 60fps in real-time shaders
    const MAX_PREVIEW_DIM = 1920;
    let targetW = Math.max(2, Math.round(params.width));
    let targetH = Math.max(2, Math.round(params.height));
    if (targetW > MAX_PREVIEW_DIM || targetH > MAX_PREVIEW_DIM) {
      const scale = MAX_PREVIEW_DIM / Math.max(targetW, targetH);
      targetW = Math.max(2, Math.round(targetW * scale));
      targetH = Math.max(2, Math.round(targetH * scale));
    }

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }

    gl.viewport(0, 0, targetW, targetH);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, params.source);
    gl.uniform1i(this.uniforms.uVideo, 0);

    const hasStabVideo = !!params.stabilizedSource && params.stabilization.enabled;
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.stabVideoTexture);
    if (hasStabVideo && params.stabilizedSource) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, params.stabilizedSource);
    }
    gl.uniform1i(this.uniforms.uVideoStab, 7);
    gl.uniform1i(this.uniforms.uHasStabVideo, hasStabVideo ? 1 : 0);
    gl.uniform2f(this.uniforms.uTexelSize, 1 / Math.max(1, targetW), 1 / Math.max(1, targetH));

    const activeLayers = params.grade.lutStack
      .filter((l) => l.enabled && l.intensity > 0 && this.lutTextures.has(l.lutId))
      .slice(0, MAX_STACKED_LUTS);

    const intensities = new Float32Array(MAX_STACKED_LUTS);
    const sizes = new Float32Array(MAX_STACKED_LUTS);
    const mins = new Float32Array(MAX_STACKED_LUTS * 3);
    const maxs = new Float32Array(MAX_STACKED_LUTS * 3);

    for (let i = 0; i < MAX_STACKED_LUTS; i++) {
      gl.activeTexture(gl.TEXTURE1 + i);
      const layer = activeLayers[i];
      if (layer) {
        const entry = this.lutTextures.get(layer.lutId)!;
        gl.bindTexture(gl.TEXTURE_3D, entry.tex);
        intensities[i] = layer.intensity / 100;
        sizes[i] = entry.lut.size;
        mins[i * 3 + 0] = entry.lut.domainMin[0];
        mins[i * 3 + 1] = entry.lut.domainMin[1];
        mins[i * 3 + 2] = entry.lut.domainMin[2];
        maxs[i * 3 + 0] = entry.lut.domainMax[0];
        maxs[i * 3 + 1] = entry.lut.domainMax[1];
        maxs[i * 3 + 2] = entry.lut.domainMax[2];
      } else {
        gl.bindTexture(gl.TEXTURE_3D, this.fallbackLutTex);
        intensities[i] = 0;
        sizes[i] = 2;
        maxs[i * 3 + 0] = 1;
        maxs[i * 3 + 1] = 1;
        maxs[i * 3 + 2] = 1;
      }
      gl.uniform1i(this.uniforms[`uLut${i}`], 1 + i);
    }

    gl.uniform1i(this.uniforms.uLutCount, activeLayers.length);
    gl.uniform1i(this.uniforms.uUseTetrahedral, params.grade.lutInterpolation === 'tetrahedral' ? 1 : 0);
    gl.uniform1fv(this.uniforms.uLutIntensity, intensities);
    gl.uniform1fv(this.uniforms.uLutSize, sizes);
    gl.uniform3fv(this.uniforms.uLutMin, mins);
    gl.uniform3fv(this.uniforms.uLutMax, maxs);

    const c = params.grade.correction;
    gl.uniform1f(this.uniforms.uExposure, c.exposure);
    gl.uniform1f(this.uniforms.uContrast, c.contrast / 100);
    gl.uniform1f(this.uniforms.uHighlights, c.highlights / 100);
    gl.uniform1f(this.uniforms.uShadows, c.shadows / 100);
    gl.uniform1f(this.uniforms.uWhites, c.whites / 100);
    gl.uniform1f(this.uniforms.uBlacks, c.blacks / 100);
    gl.uniform1f(this.uniforms.uTemperature, c.temperature / 100);
    gl.uniform1f(this.uniforms.uTint, c.tint / 100);
    gl.uniform1f(this.uniforms.uSaturation, c.saturation / 100);
    gl.uniform1f(this.uniforms.uVibrance, c.vibrance / 100);

    const g = params.grade.grading;
    const liftT = wheelToRgbOffset(g.lift.x, g.lift.y, 0.25);
    const gammaT = wheelToRgbOffset(g.gamma.x, g.gamma.y, 0.30);
    const gainT = wheelToRgbOffset(g.gain.x, g.gain.y, 0.35);
    const splitS = hexToVec3(g.splitShadowHex);
    const splitH = hexToVec3(g.splitHighlightHex);

    gl.uniform1i(this.uniforms.uGradingEnabled, g.enabled ? 1 : 0);
    gl.uniform3f(this.uniforms.uLiftTint, liftT[0], liftT[1], liftT[2]);
    gl.uniform1f(this.uniforms.uLiftLuma, g.lift.luma);
    gl.uniform3f(this.uniforms.uGammaTint, gammaT[0], gammaT[1], gammaT[2]);
    gl.uniform1f(this.uniforms.uGammaLuma, g.gamma.luma);
    gl.uniform3f(this.uniforms.uGainTint, gainT[0], gainT[1], gainT[2]);
    gl.uniform1f(this.uniforms.uGainLuma, g.gain.luma);
    gl.uniform1f(this.uniforms.uSplitAmount, g.splitAmount / 100);
    gl.uniform1f(this.uniforms.uSplitBalance, g.splitBalance / 100);
    gl.uniform3f(this.uniforms.uSplitShadow, splitS[0], splitS[1], splitS[2]);
    gl.uniform3f(this.uniforms.uSplitHighlight, splitH[0], splitH[1], splitH[2]);
    gl.uniform1f(this.uniforms.uFilmicShoulder, g.filmicShoulder / 100);
    gl.uniform1f(this.uniforms.uMatteLift, g.matteLift / 100);
    gl.uniform1f(this.uniforms.uGrain, g.grain / 100);
    gl.uniform1f(this.uniforms.uTime, params.timeSec);

    // GPU Effects uniforms
    const fx = params.grade.effects;
    gl.uniform1i(this.uniforms.uEffectsEnabled, fx.enabled ? 1 : 0);
    gl.uniform1f(this.uniforms.uHalation, fx.halation / 100);
    gl.uniform1f(this.uniforms.uHalationThresh, fx.halationThreshold / 100);
    gl.uniform1f(this.uniforms.uBloom, fx.bloom / 100);
    gl.uniform1f(this.uniforms.uBloomRadius, fx.bloomRadius);
    gl.uniform1f(this.uniforms.uSharpen, fx.sharpen / 100);
    gl.uniform1f(this.uniforms.uBlur, fx.blur / 100);
    gl.uniform1f(this.uniforms.uChromaticAb, fx.chromaticAberration / 100);
    gl.uniform1f(this.uniforms.uVignette, fx.vignette / 100);
    gl.uniform1f(this.uniforms.uVignetteFeather, fx.vignetteFeather / 100);
    gl.uniform1f(this.uniforms.uGrainSize, fx.grainSize);
    gl.uniform1f(this.uniforms.uLetterboxRatio, letterboxToFloat(fx.letterbox));
    gl.uniform1f(this.uniforms.uFrameAspect, params.width / Math.max(1, params.height));

    // Stabilization transform preview
    const stab = params.stabilization;
    if (stab.enabled) {
      const strength = stab.mode === 'lock' ? 1.0 : stab.strength / 100;
      const baseScale = 1 + stab.autoCropZoom / 100;
      const dx = (params.frameTransform?.dx ?? 0) * strength;
      const dy = (params.frameTransform?.dy ?? 0) * strength;
      const da = (params.frameTransform?.da ?? 0) * strength;
      const scale = Math.max(baseScale, params.frameTransform?.scale ?? baseScale);
      gl.uniform4f(this.uniforms.uStabTransform, dx, dy, da, scale);
      gl.uniform1f(this.uniforms.uEdgeFeather, stab.edgeFeather / 100);
    } else {
      gl.uniform4f(this.uniforms.uStabTransform, 0, 0, 0, 1);
      gl.uniform1f(this.uniforms.uEdgeFeather, 0);
    }

    gl.uniform1i(this.uniforms.uCompareOriginal, params.compareOriginal ? 1 : 0);
    gl.uniform1i(this.uniforms.uSplitEnabled, params.splitEnabled ? 1 : 0);
    gl.uniform1f(this.uniforms.uSplitPos, params.splitPos);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  public dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.videoTexture);
    gl.deleteTexture(this.stabVideoTexture);
    gl.deleteTexture(this.fallbackLutTex);
    for (const entry of this.lutTextures.values()) {
      gl.deleteTexture(entry.tex);
    }
    this.lutTextures.clear();
    gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
