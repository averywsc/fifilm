import type {
  AutoReframeMode,
  BlendMode,
  ClipColorGrade,
  ClipMaskState,
  ClipTransformState,
  LetterboxAspect,
  MaskMode,
  ParsedLut3D,
  StabilizationFrameTransform,
  StabilizationState,
  VideoTransitionType,
} from '../types/editor';
import { wheelToRgbOffset } from './cubeParser';

const MAX_STACKED_LUTS = 6;

export interface CompositeLayerInput {
  source: TexImageSource | null;
  stabilizedSource?: TexImageSource | null;
  isAdjustmentLayer?: boolean;
  isAlphaOverlay?: boolean;
  blendMode: BlendMode;
  grade: ClipColorGrade;
  transform: ClipTransformState;
  mask: ClipMaskState;
  exposureOverride?: number;
  blurOverride?: number;
  stabilization: StabilizationState;
  frameTransform?: StabilizationFrameTransform;
  transitionType: VideoTransitionType;
  /** 1.0 = fully visible, 0.0 -> 1.0 during In transition, 1.0 -> 0.0 during Out transition */
  transitionVisibility: number;
  /** 0.0..1.0 easy visual fade envelope from on-clip fade handles */
  videoFadeMultiplier?: number;
  timeSec: number;
}

const BLEND_ID: Record<BlendMode, number> = {
  normal: 0,
  screen: 1,
  difference: 2,
  overlay: 3,
  multiply: 4,
  add: 5,
  lighten: 6,
  darken: 7,
  softLight: 8,
  hardLight: 9,
  exclusion: 10,
};

const TRANS_ID: Record<VideoTransitionType, number> = {
  none: 0,
  crossDissolve: 1,
  additiveDissolve: 2,
  nonAdditiveDissolve: 3,
  dipToBlack: 4,
  bandWipe: 5,
  barnDoors: 6,
  centerSplit: 7,
  checkerWipe: 8,
  checkerBoard: 9,
  clockWipe: 10,
  inset: 11,
  blockDissolve: 12,
  paintSplatter: 13,
  dipToWhite: 14,
  dissolve: 15,
  crossZoom: 16,
  bandSlide: 17,
  radialWipe: 18,
  linearWipe: 19,
  wipe: 20,
  venetianBlinds: 21,
  irisBox: 22,
  irisCross: 23,
  irisDiamond: 24,
  irisRound: 25,
  irisSquare: 26,
  pagePeel: 27,
  pageRoll: 28,
  cubeSpin: 29,
  flipOver: 30,
  slide: 31,
  push: 32,
  split: 33,
};

const MASK_ID: Record<MaskMode, number> = {
  none: 0,
  rectangle: 1,
  ellipse: 2,
  pen: 3,
  hsl: 4,
  luminance: 5,
};

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

const PRESENT_FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uFinal;
uniform sampler2D uRaw;
uniform int uCompareOriginal;
uniform int uSplitEnabled;
uniform float uSplitPos;
uniform int uHasRaw;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  bool showOrig = (uHasRaw == 1) && ((uCompareOriginal == 1) || (uSplitEnabled == 1 && vUv.x < uSplitPos));
  if (showOrig) {
    fragColor = vec4(texture(uRaw, vUv).rgb, 1.0);
  } else {
    fragColor = vec4(texture(uFinal, uv).rgb, 1.0);
  }
}
`;

const LAYER_FRAG_SRC = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBase;
uniform sampler2D uVideo;
uniform sampler2D uVideoStab;
uniform int uHasStabVideo;
uniform int uIsAdjustment;
uniform int uIsAlphaOverlay;
uniform int uBlendMode;
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

// Primary Color Correction + Color Balance + HLS
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
uniform vec3 uBalanceRgb;
uniform float uHueShift;
uniform float uLightness;

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

// GPU Video Effects
uniform int uEffectsEnabled;
uniform float uHalation;
uniform float uHalationThresh;
uniform float uBloom;
uniform float uBloomRadius;
uniform float uSharpen;
uniform float uBlur;
uniform float uCameraBlur;
uniform float uDirBlur;
uniform float uDirAngle;
uniform float uChromaticAb;
uniform float uVignette;
uniform float uVignetteFeather;
uniform float uGrainSize;
uniform float uLetterboxRatio;
uniform float uFrameAspect;
uniform int uInvert;
uniform int uUltraKeyOn;
uniform vec3 uUltraKeyColor;
uniform float uUltraKeyTol;
uniform float uUltraKeySpill;
uniform float uAlphaGlow;
uniform vec3 uAlphaGlowColor;
uniform float uLensFlare;
uniform vec2 uLensFlarePos;
uniform float uLightning;
uniform float uBlockDissolve;
uniform vec4 uCrop; // left, right, top, bottom (0..0.45)
uniform float uReframeAspect; // 0 = off

// Stabilization & Motion Transform + Basic 3D + VR
uniform vec4 uStabTransform;
uniform float uEdgeFeather;
uniform vec2 uMotionPos;
uniform float uMotionScale;
uniform float uMotionRot;
uniform vec2 uMotionFlip;
uniform float uMotionOpacity;
uniform vec2 uBasic3D; // swivelRad, tiltRad
uniform int uVrEnabled;
uniform vec2 uVrAngles; // yaw, pitch

// Masking (Shape / HSL / Luminance)
uniform int uMaskMode;
uniform int uMaskInvert;
uniform vec4 uMaskRect; // cx, cy, w, h (0..1)
uniform float uMaskFeather;
uniform vec4 uMaskHsl;  // hueDeg, rangeDeg, satMin, lumMin
uniform vec2 uMaskLuma; // min, max

// Video Transitions
uniform int uTransType;
uniform float uTransVis; // 0..1

// Extended Pro GPU Video Effects (packed vec4s for zero overhead)
// uDistortA: mirrorMode, kaleidoscope, twirl, pinchSpherize
uniform vec4 uDistortA;
// uDistortB: waveWarp, ripple, turbulentDisplace, zigZag
uniform vec4 uDistortB;
// uDistortC: lensDistortion, mosaic, replicate, cornerPinSkew
uniform vec4 uDistortC;
// uDistortD: offsetX, offsetY, rollingShutterRepair, writeOnProgress
uniform vec4 uDistortD;
// uStylizeA: blackAndWhite, tintAmount, posterizeLevels, threshold
uniform vec4 uStylizeA;
// uStylizeB: emboss, colorEmboss, bevelEdges, edgeFeather
uniform vec4 uStylizeB;
// uStylizeC: radialShadow, noiseAmount, rampAmount, broadcastSafe
uniform vec4 uStylizeC;
// uStylizeD: strobeInterval, unsharpMask, equalize, temporalSmooth
uniform vec4 uStylizeD;
// uColorKeyFX: colorPassOn, colorPassTol, changeColorOn, videoFadeMul
uniform vec4 uColorKeyFX;
uniform vec3 uTintCol;
uniform vec3 uColorPassCol;
uniform vec3 uChangeToCol;
uniform vec3 uRampStart;
uniform vec3 uRampEnd;
// uLevelsA: gamma, levelsBlack, levelsWhite, 0
uniform vec4 uLevelsA;
// uCurves: curveLow, curveMid, curveHigh
uniform vec3 uCurves;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 rgb2hsl(vec3 c) {
  float cMax = max(c.r, max(c.g, c.b));
  float cMin = min(c.r, min(c.g, c.b));
  float d = cMax - cMin;
  float l = 0.5 * (cMax + cMin);
  float s = d < 1e-5 ? 0.0 : d / (1.0 - abs(2.0 * l - 1.0) + 1e-5);
  float h = 0.0;
  if (d >= 1e-5) {
    if (cMax == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (cMax == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h *= 60.0;
    if (h < 0.0) h += 360.0;
  }
  return vec3(h, s, l);
}

vec3 hsl2rgb(vec3 hsl) {
  float h = mod(hsl.x, 360.0) / 60.0;
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
  vec3 rgb = vec3(0.0);
  if (h < 1.0) rgb = vec3(c, x, 0.0);
  else if (h < 2.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  return rgb + (l - 0.5 * c);
}

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

vec2 applyVrEquirectUv(vec2 uv) {
  vec2 ndc = (uv - 0.5) * vec2(2.0 * uFrameAspect, -2.0);
  vec3 dir = normalize(vec3(ndc.x, ndc.y, 1.35));
  float cp = cos(uVrAngles.y); float sp = sin(uVrAngles.y);
  dir = vec3(dir.x, dir.y * cp - dir.z * sp, dir.y * sp + dir.z * cp);
  float cy = cos(uVrAngles.x); float sy = sin(uVrAngles.x);
  dir = vec3(dir.x * cy + dir.z * sy, dir.y, -dir.x * sy + dir.z * cy);
  float lon = atan(dir.x, dir.z);
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  return vec2(lon / 6.2831853 + 0.5, 0.5 - lat / 3.1415926);
}

vec2 applyMotionAnd3DUv(vec2 uv) {
  vec2 p = uv - 0.5 - uMotionPos;
  // Basic 3D Swivel & Tilt perspective warp
  if (abs(uBasic3D.x) > 0.001 || abs(uBasic3D.y) > 0.001) {
    float z = 1.0 + p.x * sin(uBasic3D.x) * 0.85 + p.y * sin(uBasic3D.y) * 0.85;
    p.x = p.x / max(0.25, cos(uBasic3D.x)) / max(0.35, z);
    p.y = p.y / max(0.25, cos(uBasic3D.y)) / max(0.35, z);
  }
  p.x *= uFrameAspect;
  float c = cos(-uMotionRot);
  float s = sin(-uMotionRot);
  p = mat2(c, -s, s, c) * p;
  p.x /= max(0.01, uFrameAspect);
  p /= max(0.05, uMotionScale);
  p *= uMotionFlip;
  return p + 0.5;
}

vec2 applyStabilizationUv(vec2 uv) {
  vec2 centered = uv - 0.5;
  float c = cos(uStabTransform.z);
  float s = sin(uStabTransform.z);
  mat2 rot = mat2(c, -s, s, c);
  float invScale = 1.0 / max(1.0, uStabTransform.w);
  return rot * (centered * invScale) + 0.5 + uStabTransform.xy;
}

vec4 sampleRawLayer(vec2 uv) {
  vec2 cu = clamp(uv, 0.0005, 0.9995);
  if (uIsAdjustment == 1) {
    return texture(uBase, vec2(cu.x, 1.0 - cu.y));
  }
  return (uHasStabVideo == 1) ? texture(uVideoStab, cu) : texture(uVideo, cu);
}

vec4 sampleOptical(vec2 uv) {
  vec2 cu = clamp(uv, 0.0005, 0.9995);
  vec4 smp = sampleRawLayer(cu);
  vec3 base = smp.rgb;
  float alpha = (uIsAlphaOverlay == 1) ? smp.a : 1.0;

  if (uEffectsEnabled == 0) return vec4(base, alpha);

  if (uChromaticAb > 0.001) {
    vec2 dir = cu - 0.5;
    float shift = uChromaticAb * 0.014;
    base = vec3(
      sampleRawLayer(cu + dir * shift).r,
      base.g,
      sampleRawLayer(cu - dir * shift).b
    );
  }

  // Gaussian Blur, Camera Blur & Sharpen
  float totalBlur = max(uBlur, uCameraBlur);
  if (totalBlur > 0.001 || uSharpen > 0.001) {
    float rPx = (totalBlur > 0.001) ? (1.2 + totalBlur * 8.0) : 1.35;
    vec2 off = uTexelSize * rPx;
    vec3 acc = base * 0.25;
    acc += sampleRawLayer(cu + vec2( off.x,  0.0)).rgb * 0.125;
    acc += sampleRawLayer(cu + vec2(-off.x,  0.0)).rgb * 0.125;
    acc += sampleRawLayer(cu + vec2( 0.0,    off.y)).rgb * 0.125;
    acc += sampleRawLayer(cu + vec2( 0.0,   -off.y)).rgb * 0.125;
    acc += sampleRawLayer(cu + vec2( off.x,  off.y)).rgb * 0.0625;
    acc += sampleRawLayer(cu + vec2(-off.x,  off.y)).rgb * 0.0625;
    acc += sampleRawLayer(cu + vec2( off.x, -off.y)).rgb * 0.0625;
    acc += sampleRawLayer(cu + vec2(-off.x, -off.y)).rgb * 0.0625;
    if (uCameraBlur > 0.001) {
      // Extra bokeh outer ring for Camera Blur
      vec3 ring = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float a = float(i) * 1.0472;
        ring += sampleRawLayer(cu + vec2(cos(a), sin(a)) * off * 1.9).rgb;
      }
      acc = mix(acc, ring / 6.0, 0.55);
    }
    if (totalBlur > 0.001) base = mix(base, acc, min(1.0, totalBlur));
    if (uSharpen > 0.001) base = clamp(base + (base - acc) * (uSharpen * 2.2), 0.0, 1.0);
  }

  // Directional Blur
  if (uDirBlur > 0.001) {
    vec2 d = vec2(cos(uDirAngle), sin(uDirAngle)) * uTexelSize * (uDirBlur * 24.0);
    vec3 acc = base;
    for (int i = 1; i <= 4; i++) {
      float f = float(i) * 0.25;
      acc += sampleRawLayer(cu + d * f).rgb;
      acc += sampleRawLayer(cu - d * f).rgb;
    }
    base = acc / 9.0;
  }

  // Pro-Mist Bloom & 35mm Halation
  if (uBloom > 0.001 || uHalation > 0.001) {
    vec3 glowAcc = vec3(0.0);
    vec3 haloAcc = vec3(0.0);
    float rad = max(1.0, uBloomRadius) * 2.8;
    const vec2 DIRS[8] = vec2[8](
      vec2( 1.0,  0.0), vec2(-1.0,  0.0), vec2( 0.0,  1.0), vec2( 0.0, -1.0),
      vec2( 0.707,  0.707), vec2(-0.707,  0.707), vec2( 0.707, -0.707), vec2(-0.707, -0.707)
    );
    for (int i = 0; i < 8; i++) {
      vec3 s1 = sampleRawLayer(cu + DIRS[i] * uTexelSize * rad).rgb;
      vec3 s2 = sampleRawLayer(cu + DIRS[i] * uTexelSize * (rad * 2.2)).rgb;
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

  return vec4(base, alpha);
}

float computeMaskFactor(vec2 uv, vec3 col) {
  if (uMaskMode == 0) return 1.0;
  float m = 1.0;
  float f = max(0.002, uMaskFeather);
  if (uMaskMode == 1) {
    vec2 d = abs(uv - uMaskRect.xy) - uMaskRect.zw * 0.5;
    float sd = max(d.x, d.y);
    m = 1.0 - smoothstep(0.0, f, sd);
  } else if (uMaskMode == 2) {
    vec2 p = (uv - uMaskRect.xy) / max(vec2(0.01), uMaskRect.zw * 0.5);
    m = 1.0 - smoothstep(1.0 - f, 1.0 + f, length(p));
  } else if (uMaskMode == 3) {
    // Pen diamond/polygon mask
    vec2 p = abs((uv - uMaskRect.xy) / max(vec2(0.01), uMaskRect.zw * 0.5));
    m = 1.0 - smoothstep(1.0 - f, 1.0 + f, p.x + p.y);
  } else if (uMaskMode == 4) {
    // HSL Key Mask
    vec3 hsl = rgb2hsl(col);
    float dh = abs(hsl.x - uMaskHsl.x);
    dh = min(dh, 360.0 - dh);
    float hMatch = 1.0 - smoothstep(uMaskHsl.y * 0.65, uMaskHsl.y, dh);
    float sMatch = smoothstep(uMaskHsl.z - 0.08, uMaskHsl.z + 0.08, hsl.y);
    float lMatch = smoothstep(uMaskHsl.w - 0.08, uMaskHsl.w + 0.08, hsl.z);
    m = hMatch * sMatch * lMatch;
  } else if (uMaskMode == 5) {
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float lo = smoothstep(uMaskLuma.x - f, uMaskLuma.x + f, luma);
    float hi = 1.0 - smoothstep(uMaskLuma.y - f, uMaskLuma.y + f, luma);
    m = lo * hi;
  }
  return (uMaskInvert == 1) ? (1.0 - m) : m;
}

float computeTransitionMask(vec2 uv) {
  float p = clamp(uTransVis, 0.0, 1.0);
  if (uTransType == 0 || p >= 0.999) return 1.0;
  if (p <= 0.001) return 0.0;

  if (uTransType == 1 || uTransType == 2 || uTransType == 3 || uTransType == 4 || uTransType == 14) {
    return p;
  } else if (uTransType == 5) {
    // Band Wipe
    float band = fract(uv.x * 8.0);
    return step(band, p);
  } else if (uTransType == 6) {
    // Barn Doors
    return step(abs(uv.x - 0.5) * 2.0, p);
  } else if (uTransType == 7 || uTransType == 33) {
    // Center Split / Split
    float dx = abs(uv.x - 0.5) * 2.0;
    float dy = abs(uv.y - 0.5) * 2.0;
    return step(uTransType == 33 ? dy : max(dx, dy), p);
  } else if (uTransType == 8) {
    // Checker Wipe
    vec2 cell = floor(uv * vec2(12.0, 7.0));
    float parity = mod(cell.x + cell.y, 2.0);
    float prog = clamp((p - parity * 0.25) / 0.75, 0.0, 1.0);
    return step(fract(uv.x * 12.0), prog);
  } else if (uTransType == 9) {
    // CheckerBoard
    vec2 cell = floor(uv * vec2(10.0, 6.0));
    float h = hash12(cell);
    return smoothstep(h - 0.08, h + 0.08, p);
  } else if (uTransType == 10 || uTransType == 18) {
    // Clock Wipe / Radial Wipe
    vec2 d = uv - 0.5;
    float ang = mod(atan(d.x, -d.y), 6.2831853) / 6.2831853;
    return smoothstep(ang - 0.01, ang + 0.01, p);
  } else if (uTransType == 11) {
    // Inset
    return (uv.x <= p && uv.y <= p) ? 1.0 : 0.0;
  } else if (uTransType == 12) {
    // Block Dissolve
    vec2 cell = floor(uv * vec2(32.0, 18.0));
    return step(hash12(cell), p);
  } else if (uTransType == 13) {
    // Paint Splatter
    vec2 c = uv * 9.0;
    float n = hash12(floor(c)) * 0.55 + hash12(floor(c * 2.3)) * 0.3 + length(fract(c) - 0.5) * 0.45;
    return smoothstep(n - 0.12, n + 0.05, p * 1.15);
  } else if (uTransType == 15) {
    // Dithered Dissolve
    return step(hash12(floor(gl_FragCoord.xy)), p);
  } else if (uTransType == 16) {
    // Cross Zoom
    return smoothstep(0.0, 1.0, p);
  } else if (uTransType == 17) {
    // Band Slide
    float row = floor(uv.y * 8.0);
    float dir = mod(row, 2.0) < 0.5 ? uv.x : (1.0 - uv.x);
    return step(dir, p);
  } else if (uTransType == 19 || uTransType == 20) {
    // Linear Wipe / Wipe
    return smoothstep(uv.x - 0.02, uv.x + 0.02, p);
  } else if (uTransType == 21) {
    // Venetian Blinds
    return step(fract(uv.y * 10.0), p);
  } else if (uTransType == 22 || uTransType == 26) {
    // Iris Box / Iris Square
    vec2 d = abs(uv - 0.5) * 2.0;
    return step(max(d.x, d.y), p);
  } else if (uTransType == 23) {
    // Iris Cross
    vec2 d = abs(uv - 0.5) * 2.0;
    return step(min(d.x, d.y), p * 0.85);
  } else if (uTransType == 24) {
    // Iris Diamond
    vec2 d = abs(uv - 0.5) * 2.0;
    return step((d.x + d.y) * 0.5, p);
  } else if (uTransType == 25) {
    // Iris Round
    vec2 d = (uv - 0.5) * vec2(uFrameAspect, 1.0);
    return 1.0 - smoothstep(p * 0.88 - 0.02, p * 0.88 + 0.02, length(d));
  } else if (uTransType == 27 || uTransType == 28) {
    // Page Peel / Page Roll
    float diag = (uv.x + (1.0 - uv.y)) * 0.5;
    return smoothstep(diag - 0.03, diag + 0.03, p);
  } else if (uTransType == 29 || uTransType == 30) {
    // Cube Spin / Flip Over
    float halfW = max(0.01, p) * 0.5;
    return step(abs(uv.x - 0.5), halfW);
  } else if (uTransType == 31 || uTransType == 32) {
    // Slide / Push
    return step(1.0 - p, uv.x);
  }
  return p;
}

vec2 applyTransitionUv(vec2 uv) {
  float p = clamp(uTransVis, 0.0, 1.0);
  if (uTransType == 0 || p >= 0.999) return uv;
  if (uTransType == 16) {
    // Cross Zoom punch
    float z = mix(2.2, 1.0, p);
    return (uv - 0.5) / z + 0.5;
  } else if (uTransType == 31 || uTransType == 32) {
    // Slide / Push horizontal shift
    return vec2(uv.x - (1.0 - p), uv.y);
  } else if (uTransType == 29 || uTransType == 30) {
    // Cube Spin / Flip Over horizontal perspective foreshortening
    float sc = max(0.05, p);
    return vec2((uv.x - 0.5) / sc + 0.5, uv.y);
  }
  return uv;
}

vec2 applyDistortEffectsUv(vec2 uv) {
  if (uEffectsEnabled == 0 || uIsAdjustment == 1) return uv;
  vec2 p = uv;

  // Offset / Horizontal & Vertical Hold
  if (abs(uDistortD.x) > 0.001 || abs(uDistortD.y) > 0.001) {
    p = fract(p + uDistortD.xy);
  }

  // Corner Pin perspective skew & Rolling Shutter slant repair
  if (abs(uDistortC.w) > 0.001 || uDistortD.z > 0.001) {
    p.x += (p.y - 0.5) * (uDistortC.w * 0.45 + uDistortD.z * 0.12);
  }

  // Replicate NxN tile
  if (uDistortC.z > 1.01) {
    p = fract(p * floor(uDistortC.z));
  }

  // Mirror (1=H, 2=V, 3=Quad)
  int mir = int(uDistortA.x + 0.5);
  if (mir == 1 || mir == 3) p.x = abs(p.x - 0.5) + 0.5;
  if (mir == 2 || mir == 3) p.y = abs(p.y - 0.5) + 0.5;

  // Kaleidoscope
  if (uDistortA.y >= 3.0) {
    vec2 c = p - 0.5;
    float r = length(c);
    float a = atan(c.y, c.x);
    float seg = 6.2831853 / uDistortA.y;
    a = abs(mod(a, seg) - seg * 0.5);
    p = vec2(cos(a), sin(a)) * r + 0.5;
  }

  // Twirl
  if (abs(uDistortA.z) > 0.001) {
    vec2 c = p - 0.5;
    float r = length(c);
    float ang = uDistortA.z * 4.5 * max(0.0, 0.55 - r);
    float cs = cos(ang), sn = sin(ang);
    p = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  }

  // Pinch / Spherize
  if (abs(uDistortA.w) > 0.001) {
    vec2 c = p - 0.5;
    float r = length(c);
    float power = uDistortA.w > 0.0 ? mix(1.0, 0.45, uDistortA.w) : mix(1.0, 2.2, -uDistortA.w);
    if (r < 0.5) {
      float rn = pow(r * 2.0, power) * 0.5;
      p = normalize(c + vec2(1e-5)) * rn + 0.5;
    }
  }

  // Lens Distortion (barrel / pincushion)
  if (abs(uDistortC.x) > 0.001) {
    vec2 c = p - 0.5;
    float r2 = dot(c, c);
    p = c * (1.0 + uDistortC.x * 1.4 * r2) + 0.5;
  }

  // Wave Warp
  if (uDistortB.x > 0.001) {
    p.x += sin(p.y * 18.0 + uTime * 4.0) * uDistortB.x * 0.045;
  }

  // Ripple
  if (uDistortB.y > 0.001) {
    vec2 c = p - 0.5;
    float d = length(c);
    p += normalize(c + vec2(1e-5)) * sin(d * 42.0 - uTime * 6.0) * uDistortB.y * 0.025;
  }

  // Turbulent Displace
  if (uDistortB.z > 0.001) {
    float nx = sin(p.x * 14.0 + uTime * 2.3) * cos(p.y * 11.0 - uTime * 1.7);
    float ny = cos(p.x * 13.0 - uTime * 1.9) * sin(p.y * 15.0 + uTime * 2.1);
    p += vec2(nx, ny) * uDistortB.z * 0.04;
  }

  // ZigZag
  if (uDistortB.w > 0.001) {
    vec2 c = p - 0.5;
    float d = length(c);
    float ang = sin(d * 34.0) * uDistortB.w * 0.45;
    float cs = cos(ang), sn = sin(ang);
    p = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  }

  // Mosaic / Pixelate
  if (uDistortC.y > 0.001) {
    float blocks = mix(220.0, 14.0, uDistortC.y);
    vec2 grid = vec2(blocks, max(8.0, blocks / max(0.5, uFrameAspect)));
    p = (floor(p * grid) + 0.5) / grid;
  }

  return clamp(p, 0.001, 0.999);
}

vec3 applyBlend(vec3 b, vec3 a, int mode) {
  if (mode == 1) return 1.0 - (1.0 - b) * (1.0 - a); // Screen
  if (mode == 2) return abs(b - a);                   // Difference
  if (mode == 3) {                                    // Overlay
    return mix(2.0 * b * a, 1.0 - 2.0 * (1.0 - b) * (1.0 - a), step(0.5, b));
  }
  if (mode == 4) return b * a;                        // Multiply
  if (mode == 5) return min(vec3(1.0), b + a);        // Add
  if (mode == 6) return max(b, a);                    // Lighten
  if (mode == 7) return min(b, a);                    // Darken
  if (mode == 8) return (1.0 - 2.0 * a) * b * b + 2.0 * a * b; // Soft Light
  if (mode == 9) {                                    // Hard Light
    return mix(2.0 * b * a, 1.0 - 2.0 * (1.0 - b) * (1.0 - a), step(0.5, a));
  }
  if (mode == 10) return b + a - 2.0 * b * a;         // Exclusion
  return a;
}

void main() {
  vec2 baseTexUv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 baseCol = texture(uBase, baseTexUv).rgb;

  vec2 uv = (uVrEnabled == 1 && uIsAdjustment == 0) ? applyVrEquirectUv(vUv) : vUv;
  vec2 movedUv = (uIsAdjustment == 1) ? uv : applyMotionAnd3DUv(uv);

  if (uIsAdjustment == 0 && (movedUv.x < 0.0 || movedUv.x > 1.0 || movedUv.y < 0.0 || movedUv.y > 1.0)) {
    fragColor = vec4(baseCol, 1.0);
    return;
  }

  // Crop & Auto Reframe bounds
  if (uEffectsEnabled == 1 && uIsAdjustment == 0) {
    if (movedUv.x < uCrop.x || movedUv.x > (1.0 - uCrop.y) || movedUv.y < uCrop.z || movedUv.y > (1.0 - uCrop.w)) {
      fragColor = vec4(baseCol, 1.0);
      return;
    }
    if (uReframeAspect > 0.05) {
      if (uReframeAspect < uFrameAspect - 0.01) {
        float wNorm = uReframeAspect / uFrameAspect;
        float margin = (1.0 - wNorm) * 0.5;
        if (movedUv.x < margin || movedUv.x > 1.0 - margin) {
          fragColor = vec4(0.01, 0.015, 0.035, 1.0);
          return;
        }
      }
    }
  }

  vec2 sampleUv = (uHasStabVideo == 1 || uIsAdjustment == 1) ? movedUv : applyStabilizationUv(movedUv);
  sampleUv = applyTransitionUv(sampleUv);
  sampleUv = applyDistortEffectsUv(sampleUv);
  vec4 sampled = sampleOptical(sampleUv);
  vec3 col = sampled.rgb;
  float alpha = sampled.a;

  // Write-on animated reveal wipe
  if (uEffectsEnabled == 1 && uDistortD.w < 0.999) {
    float prog = uDistortD.w;
    alpha *= 1.0 - smoothstep(prog - 0.02, prog + 0.02, vUv.x);
  }

  // Edge Feather & Radial Shadow & Bevel Edges
  if (uEffectsEnabled == 1 && uIsAdjustment == 0) {
    if (uStylizeB.w > 0.001) {
      float ef = uStylizeB.w * 0.22;
      float fx = smoothstep(0.0, ef, movedUv.x) * smoothstep(0.0, ef, 1.0 - movedUv.x);
      float fy = smoothstep(0.0, ef, movedUv.y) * smoothstep(0.0, ef, 1.0 - movedUv.y);
      alpha *= fx * fy;
    }
    if (uStylizeB.z > 0.001) {
      float bW = 0.035;
      float topL = (1.0 - smoothstep(0.0, bW, movedUv.y)) + (1.0 - smoothstep(0.0, bW, movedUv.x));
      float botR = (1.0 - smoothstep(0.0, bW, 1.0 - movedUv.y)) + (1.0 - smoothstep(0.0, bW, 1.0 - movedUv.x));
      col = clamp(col + (topL - botR) * 0.25 * uStylizeB.z, 0.0, 1.0);
    }
    if (uStylizeC.x > 0.001) {
      float sh = smoothstep(0.32, 0.72, length(movedUv - vec2(0.52, 0.53)));
      col *= 1.0 - sh * uStylizeC.x * 0.55;
    }
  }

  // Ultra Key (Chroma Key + Spill Suppression)
  if (uEffectsEnabled == 1 && uUltraKeyOn == 1 && uIsAdjustment == 0) {
    float dist = distance(col, uUltraKeyColor);
    float keyAlpha = smoothstep(uUltraKeyTol * 0.55, uUltraKeyTol + 0.08, dist);
    alpha *= keyAlpha;
    if (uUltraKeySpill > 0.001) {
      float avgRB = 0.5 * (col.r + col.b);
      if (col.g > avgRB && uUltraKeyColor.g > uUltraKeyColor.r) {
        col.g = mix(col.g, avgRB, uUltraKeySpill);
      } else if (col.b > 0.5 * (col.r + col.g) && uUltraKeyColor.b > uUltraKeyColor.r) {
        col.b = mix(col.b, 0.5 * (col.r + col.g), uUltraKeySpill);
      }
    }
  }

  // 1. Primary Exposure, White Balance & Color Balance RGB
  float expMul = exp2(uExposure);
  col *= vec3(
    expMul * (1.0 + uTemperature * 0.24 + uTint * 0.06 + uBalanceRgb.r * 0.35),
    expMul * (1.0 - uTint * 0.18 + uBalanceRgb.g * 0.35),
    expMul * (1.0 - uTemperature * 0.24 + uTint * 0.06 + uBalanceRgb.b * 0.35)
  );
  col = (col - 0.5) * (1.0 + uContrast) + 0.5;

  // Tone regions
  float luma0 = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  float hiW = smoothstep(0.42, 0.95, luma0);
  float shW = 1.0 - smoothstep(0.05, 0.58, luma0);
  float whW = smoothstep(0.72, 1.0, luma0);
  float blW = 1.0 - smoothstep(0.0, 0.28, luma0);
  col += (uHighlights * 0.35 * hiW + uShadows * 0.35 * shW + uWhites * 0.28 * whW + uBlacks * 0.28 * blW);
  col = clamp(col, 0.0, 1.0);

  // Color Balance HLS (Hue Shift & Lightness)
  if (abs(uHueShift) > 0.1 || abs(uLightness) > 0.001) {
    vec3 hsl = rgb2hsl(col);
    hsl.x = mod(hsl.x + uHueShift + 360.0, 360.0);
    hsl.z = clamp(hsl.z + uLightness * 0.35, 0.0, 1.0);
    col = clamp(hsl2rgb(hsl), 0.0, 1.0);
  }

  // Saturation & Vibrance
  float luma1 = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float cMax = max(col.r, max(col.g, col.b));
  float cMin = min(col.r, min(col.g, col.b));
  float satFactor = max(0.0, (1.0 + uSaturation) * (1.0 + uVibrance * (1.0 - (cMax - cMin)) * 0.85));
  col = clamp(mix(vec3(luma1), col, satFactor), 0.0, 1.0);

  // Creative Grading
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

  // Multi-LUT Stack
  if (uLutCount > 0) col = applyLut(uLut0, col, 0);
  if (uLutCount > 1) col = applyLut(uLut1, col, 1);
  if (uLutCount > 2) col = applyLut(uLut2, col, 2);
  if (uLutCount > 3) col = applyLut(uLut3, col, 3);
  if (uLutCount > 4) col = applyLut(uLut4, col, 4);
  if (uLutCount > 5) col = applyLut(uLut5, col, 5);

  // Levels (Black/White), Gamma Correction & Luma/RGB Curves
  float lvSpan = max(0.05, uLevelsA.z - uLevelsA.y);
  col = clamp((col - vec3(uLevelsA.y)) / lvSpan, 0.0, 1.0);
  if (abs(uLevelsA.x - 1.0) > 0.005) {
    col = pow(max(col, vec3(1e-5)), vec3(1.0 / max(0.2, uLevelsA.x)));
  }
  if (abs(uCurves.x) > 0.001 || abs(uCurves.y) > 0.001 || abs(uCurves.z) > 0.001) {
    float cLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float wLo = (1.0 - smoothstep(0.0, 0.5, cLuma));
    float wMi = exp(-pow((cLuma - 0.5) * 3.2, 2.0));
    float wHi = smoothstep(0.5, 1.0, cLuma);
    col = clamp(col + uCurves.x * wLo * 0.4 + uCurves.y * wMi * 0.4 + uCurves.z * wHi * 0.4, 0.0, 1.0);
  }

  // Invert
  if (uEffectsEnabled == 1 && uInvert == 1) {
    col = 1.0 - col;
  }

  // Extended Color & Stylize GPU Video Effects
  if (uEffectsEnabled == 1) {
    // Emboss / Color Emboss
    if (uStylizeB.x > 0.001) {
      vec3 cNW = sampleRawLayer(sampleUv - uTexelSize * 2.0).rgb;
      vec3 cSE = sampleRawLayer(sampleUv + uTexelSize * 2.0).rgb;
      vec3 diff = (cSE - cNW) * 2.2;
      vec3 emb = (uStylizeB.y > 0.5) ? clamp(col + diff, 0.0, 1.0) : clamp(vec3(0.5) + vec3(dot(diff, vec3(0.333))), 0.0, 1.0);
      col = mix(col, emb, uStylizeB.x);
    }
    // Unsharp Mask
    if (uStylizeD.y > 0.001) {
      vec3 blurS = (sampleRawLayer(sampleUv + vec2(uTexelSize.x * 2.0, 0.0)).rgb +
                    sampleRawLayer(sampleUv - vec2(uTexelSize.x * 2.0, 0.0)).rgb +
                    sampleRawLayer(sampleUv + vec2(0.0, uTexelSize.y * 2.0)).rgb +
                    sampleRawLayer(sampleUv - vec2(0.0, uTexelSize.y * 2.0)).rgb) * 0.25;
      col = clamp(col + (col - blurS) * uStylizeD.y * 2.2, 0.0, 1.0);
    }
    // Temporal Smooth / Median softening
    if (uStylizeD.w > 0.001) {
      vec3 m1 = sampleRawLayer(sampleUv + vec2(uTexelSize.x, 0.0)).rgb;
      vec3 m2 = sampleRawLayer(sampleUv - vec2(uTexelSize.x, 0.0)).rgb;
      vec3 med = max(min(col, m1), min(max(col, m1), m2));
      col = mix(col, med, uStylizeD.w);
    }
    // Equalize contrast boost
    if (uStylizeD.z > 0.001) {
      vec3 eq = smoothstep(0.08, 0.92, col);
      col = mix(col, eq, uStylizeD.z);
    }
    // Color Pass / Leave Color & Change to Color
    if (uColorKeyFX.x > 0.5 || uColorKeyFX.z > 0.5) {
      vec3 hsl = rgb2hsl(col);
      vec3 targetHsl = rgb2hsl(uColorPassCol);
      float dh = abs(hsl.x - targetHsl.x);
      dh = min(dh, 360.0 - dh);
      float matchW = 1.0 - smoothstep(uColorKeyFX.y * 0.65, uColorKeyFX.y, dh);
      if (uColorKeyFX.z > 0.5) {
        vec3 toHsl = rgb2hsl(uChangeToCol);
        vec3 shifted = hsl2rgb(vec3(toHsl.x, mix(hsl.y, toHsl.y, 0.55), hsl.z));
        col = mix(col, shifted, matchW);
      } else {
        float gLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(gLuma), col, matchW);
      }
    }
    // Black & White
    if (uStylizeA.x > 0.001) {
      float bw = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(bw), uStylizeA.x);
    }
    // Tint
    if (uStylizeA.y > 0.001) {
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, uTintCol * lum, uStylizeA.y);
    }
    // Posterize
    if (uStylizeA.z >= 2.0) {
      col = floor(col * uStylizeA.z + 0.5) / uStylizeA.z;
    }
    // Threshold
    if (uStylizeA.w > 0.001) {
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = vec3(step(uStylizeA.w, lum));
    }
    // Gradient Ramp
    if (uStylizeC.z > 0.001) {
      vec3 ramp = mix(uRampStart, uRampEnd, vUv.y);
      col = mix(col, ramp, uStylizeC.z);
    }
    // Digital Noise
    if (uStylizeC.y > 0.001) {
      float dn = hash12(floor(gl_FragCoord.xy) + fract(uTime) * 419.0) - 0.5;
      col = clamp(col + dn * uStylizeC.y * 0.35, 0.0, 1.0);
    }
    // Strobe Light
    if (uStylizeD.x > 0.001) {
      float strobePhase = fract(uTime * (2.0 + uStylizeD.x * 16.0));
      if (strobePhase < 0.25) col = clamp(col + vec3(0.55) * uStylizeD.x, 0.0, 1.0);
    }
    // Broadcast Colors (Rec.709 16-235 legalizer)
    if (uStylizeC.w > 0.5) {
      col = mix(vec3(0.0627), vec3(0.9216), clamp(col, 0.0, 1.0));
    }
  }

  // Lens Flare (Starburst + Anamorphic Streak + Ghost Ring)
  if (uEffectsEnabled == 1 && uLensFlare > 0.001) {
    vec2 d = (vUv - uLensFlarePos) * vec2(uFrameAspect, 1.0);
    float dist = length(d);
    float core = exp(-dist * 10.0) * 1.2 + exp(-dist * 3.0) * 0.35;
    float streak = exp(-abs(d.y) * 48.0) * exp(-abs(d.x) * 2.8) * 0.65;
    vec2 ghostPos = vec2(1.0) - uLensFlarePos;
    float gDist = length((vUv - mix(uLensFlarePos, ghostPos, 0.7)) * vec2(uFrameAspect, 1.0));
    float ring = exp(-abs(gDist - 0.14) * 38.0) * 0.35;
    vec3 flareCol = vec3(1.0, 0.92, 0.78) * core + vec3(0.45, 0.76, 1.0) * streak + vec3(0.95, 0.45, 0.75) * ring;
    col = clamp(col + flareCol * uLensFlare, 0.0, 1.0);
  }

  // Advanced Lightning (Animated Procedural Arc)
  if (uEffectsEnabled == 1 && uLightning > 0.001) {
    float seg = floor(vUv.x * 26.0);
    float jitter = (hash12(vec2(seg, floor(uTime * 18.0))) - 0.5) * 0.16;
    float boltY = 0.5 + sin(vUv.x * 6.0 + uTime * 7.0) * 0.12 + jitter;
    float dBolt = abs(vUv.y - boltY);
    float core = exp(-dBolt * 95.0);
    float glow = exp(-dBolt * 16.0) * 0.55;
    col = clamp(col + (vec3(0.9, 0.96, 1.0) * core + vec3(0.32, 0.62, 1.0) * glow) * uLightning, 0.0, 1.0);
  }

  // Alpha Glow
  if (uEffectsEnabled == 1 && uAlphaGlow > 0.001) {
    float edgeGlow = smoothstep(0.0, 0.5, alpha) * (1.0 - smoothstep(0.5, 1.0, alpha));
    col = clamp(col + uAlphaGlowColor * (edgeGlow * 2.5 + 0.15) * uAlphaGlow, 0.0, 1.0);
  }

  // Block Dissolve Effect
  if (uEffectsEnabled == 1 && uBlockDissolve > 0.001) {
    vec2 cell = floor(vUv * vec2(36.0, 20.0));
    if (hash12(cell) < uBlockDissolve) alpha = 0.0;
  }

  // Optical Vignette
  if (uEffectsEnabled == 1 && uVignette > 0.001) {
    vec2 d = (vUv - 0.5) * vec2(1.15, 1.0);
    float inner = mix(0.22, 0.52, uVignetteFeather);
    col *= 1.0 - smoothstep(inner, inner + 0.42, length(d)) * uVignette * 0.85;
  }

  // Organic Film Grain
  if (uGradingEnabled == 1 && uGrain > 0.001) {
    vec2 cell = floor(gl_FragCoord.xy / max(1.0, uGrainSize));
    float n = hash12(cell + fract(uTime) * 317.0) - 0.5;
    float midWeight = 1.0 - abs(dot(col, vec3(0.333)) * 2.0 - 1.0);
    col = clamp(col + n * uGrain * 0.13 * (0.4 + 0.6 * midWeight), 0.0, 1.0);
  }

  // Cinema Letterbox
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

  // Apply Shape / HSL / Luminance Mask
  float maskFactor = computeMaskFactor(vUv, col);
  float transFactor = computeTransitionMask(vUv);

  // Special transitions: Additive, Non-Additive, Dip to Black, Dip to White
  vec3 blended = applyBlend(baseCol, col, uBlendMode);
  if (uTransType == 2 && uTransVis < 0.999) {
    blended = clamp(baseCol + col * uTransVis, 0.0, 1.0);
  } else if (uTransType == 3 && uTransVis < 0.999) {
    blended = max(baseCol, col * uTransVis);
  } else if (uTransType == 4 && uTransVis < 0.999) {
    col *= uTransVis;
    blended = mix(vec3(0.0), col, uTransVis);
  } else if (uTransType == 14 && uTransVis < 0.999) {
    blended = mix(vec3(1.0), col, uTransVis);
  }

  float finalAlpha = clamp(alpha * maskFactor * transFactor * uMotionOpacity * uColorKeyFX.w, 0.0, 1.0);
  vec3 outRgb = mix(baseCol, blended, finalAlpha);
  fragColor = vec4(outRgb, 1.0);
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

function reframeToFloat(r: AutoReframeMode): number {
  if (r === '16:9') return 16 / 9;
  if (r === '9:16') return 9 / 16;
  if (r === '1:1') return 1.0;
  if (r === '4:5') return 0.8;
  return 0;
}

export class WebGL2ColorPipeline {
  private gl: WebGL2RenderingContext;
  private layerProgram: WebGLProgram;
  private presentProgram: WebGLProgram;
  private vao: WebGLVertexArrayObject | null;
  private videoTexture: WebGLTexture;
  private stabVideoTexture: WebGLTexture;
  private rawCompareTexture: WebGLTexture;
  private fboA: WebGLFramebuffer;
  private fboB: WebGLFramebuffer;
  private texA: WebGLTexture;
  private texB: WebGLTexture;
  private fboW = 0;
  private fboH = 0;
  private lutTextures: Map<string, { tex: WebGLTexture; lut: ParsedLut3D }> = new Map();
  private layerUniforms: Record<string, WebGLUniformLocation | null> = {};
  private presentUniforms: Record<string, WebGLUniformLocation | null> = {};
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
    if (!gl) throw new Error('WebGL2 is required for Fifilm.');
    this.gl = gl;
    this.supportsFloat3D = !!gl.getExtension('OES_texture_float_linear');

    this.layerProgram = this.createProgram(VERT_SRC, LAYER_FRAG_SRC);
    this.presentProgram = this.createProgram(VERT_SRC, PRESENT_FRAG_SRC);
    this.vao = gl.createVertexArray();
    this.videoTexture = this.create2DTexture();
    this.stabVideoTexture = this.create2DTexture();
    this.rawCompareTexture = this.create2DTexture();
    this.texA = this.create2DTexture();
    this.texB = this.create2DTexture();
    this.fboA = gl.createFramebuffer()!;
    this.fboB = gl.createFramebuffer()!;
    this.fallbackLutTex = this.createIdentityLutTexture();
    this.cacheUniforms();
  }

  private compileShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || 'Shader compile error';
      gl.deleteShader(sh);
      throw new Error(`WebGL2 shader error: ${log}`);
    }
    return sh;
  }

  private createProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const v = this.compileShader(gl.VERTEX_SHADER, vs);
    const f = this.compileShader(gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) || 'Program link error';
      throw new Error(`WebGL2 link error: ${log}`);
    }
    gl.deleteShader(v);
    gl.deleteShader(f);
    return prog;
  }

  private create2DTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([5, 8, 17, 255]));
    return tex;
  }

  private ensureFboSize(w: number, h: number): void {
    if (this.fboW === w && this.fboH === h) return;
    const gl = this.gl;
    this.fboW = w;
    this.fboH = h;
    for (const [fbo, tex] of [
      [this.fboA, this.texA],
      [this.fboB, this.texB],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

  private cacheUniforms(): void {
    const gl = this.gl;
    const lNames = [
      'uBase', 'uVideo', 'uVideoStab', 'uHasStabVideo', 'uIsAdjustment', 'uIsAlphaOverlay',
      'uBlendMode', 'uTexelSize',
      'uLut0', 'uLut1', 'uLut2', 'uLut3', 'uLut4', 'uLut5',
      'uLutCount', 'uUseTetrahedral', 'uLutIntensity', 'uLutSize', 'uLutMin', 'uLutMax',
      'uExposure', 'uContrast', 'uHighlights', 'uShadows', 'uWhites', 'uBlacks',
      'uTemperature', 'uTint', 'uSaturation', 'uVibrance', 'uBalanceRgb', 'uHueShift', 'uLightness',
      'uGradingEnabled', 'uLiftTint', 'uLiftLuma', 'uGammaTint', 'uGammaLuma',
      'uGainTint', 'uGainLuma', 'uSplitAmount', 'uSplitBalance', 'uSplitShadow', 'uSplitHighlight',
      'uFilmicShoulder', 'uMatteLift', 'uGrain', 'uTime',
      'uEffectsEnabled', 'uHalation', 'uHalationThresh', 'uBloom', 'uBloomRadius',
      'uSharpen', 'uBlur', 'uCameraBlur', 'uDirBlur', 'uDirAngle', 'uChromaticAb',
      'uVignette', 'uVignetteFeather', 'uGrainSize', 'uLetterboxRatio', 'uFrameAspect',
      'uInvert', 'uUltraKeyOn', 'uUltraKeyColor', 'uUltraKeyTol', 'uUltraKeySpill',
      'uAlphaGlow', 'uAlphaGlowColor', 'uLensFlare', 'uLensFlarePos', 'uLightning',
      'uBlockDissolve', 'uCrop', 'uReframeAspect',
      'uStabTransform', 'uEdgeFeather',
      'uMotionPos', 'uMotionScale', 'uMotionRot', 'uMotionFlip', 'uMotionOpacity', 'uBasic3D',
      'uVrEnabled', 'uVrAngles',
      'uMaskMode', 'uMaskInvert', 'uMaskRect', 'uMaskFeather', 'uMaskHsl', 'uMaskLuma',
      'uTransType', 'uTransVis',
      'uDistortA', 'uDistortB', 'uDistortC', 'uDistortD',
      'uStylizeA', 'uStylizeB', 'uStylizeC', 'uStylizeD',
      'uColorKeyFX', 'uTintCol', 'uColorPassCol', 'uChangeToCol', 'uRampStart', 'uRampEnd',
      'uLevelsA', 'uCurves',
    ];
    for (const n of lNames) this.layerUniforms[n] = gl.getUniformLocation(this.layerProgram, n);

    for (const n of ['uFinal', 'uRaw', 'uCompareOriginal', 'uSplitEnabled', 'uSplitPos', 'uHasRaw']) {
      this.presentUniforms[n] = gl.getUniformLocation(this.presentProgram, n);
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(r, g, b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * Renders a full multi-track layer stack (bottom to top) with Blend Modes,
   * Adjustment Layers, Masks, Transitions, Video Effects, Keyframed Motion/3D,
   * Multi-LUT stacks, VR 360 projection, and Before/After Split Wipe.
   */
  public renderComposite(params: {
    layers: CompositeLayerInput[];
    width: number;
    height: number;
    qualityScale: number; // 1.0 = Full, 0.5 = Half, 0.25 = Quarter
    compareOriginal: boolean;
    splitEnabled: boolean;
    splitPos: number;
    vrEnabled: boolean;
    vrYawRad: number;
    vrPitchRad: number;
  }): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;

    const maxDim = Math.round(1920 * params.qualityScale);
    let targetW = Math.max(2, Math.round(params.width * params.qualityScale));
    let targetH = Math.max(2, Math.round(params.height * params.qualityScale));
    if (targetW > maxDim || targetH > maxDim) {
      const sc = maxDim / Math.max(targetW, targetH);
      targetW = Math.max(2, Math.round(targetW * sc));
      targetH = Math.max(2, Math.round(targetH * sc));
    }

    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    this.ensureFboSize(targetW, targetH);
    gl.bindVertexArray(this.vao);

    // Clear ping-pong base FBO A to midnight slate
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.viewport(0, 0, targetW, targetH);
    gl.clearColor(0.012, 0.02, 0.047, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let readTex = this.texA;
    let writeFbo = this.fboB;
    let writeTex = this.texB;
    let hasRawCompare = false;

    const u = this.layerUniforms;
    gl.useProgram(this.layerProgram);
    gl.uniform2f(u.uTexelSize, 1 / Math.max(1, targetW), 1 / Math.max(1, targetH));
    gl.uniform1f(u.uFrameAspect, targetW / Math.max(1, targetH));
    gl.uniform1i(u.uVrEnabled, params.vrEnabled ? 1 : 0);
    gl.uniform2f(u.uVrAngles, params.vrYawRad, params.vrPitchRad);

    for (const layer of params.layers) {
      if (!layer.isAdjustmentLayer && !layer.source) continue;

      // Capture first real video layer into uRaw for Hold-to-Compare / Split Wipe
      if (!hasRawCompare && layer.source && !layer.isAdjustmentLayer) {
        gl.activeTexture(gl.TEXTURE9);
        gl.bindTexture(gl.TEXTURE_2D, this.rawCompareTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
        hasRawCompare = true;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
      gl.viewport(0, 0, targetW, targetH);

      // Bind Base accumulated texture
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(u.uBase, 8);

      // Bind Layer source texture
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
      if (layer.source && !layer.isAdjustmentLayer) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.source);
      }
      gl.uniform1i(u.uVideo, 0);

      const hasStab = !!layer.stabilizedSource && layer.stabilization.enabled && !layer.isAdjustmentLayer;
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, this.stabVideoTexture);
      if (hasStab && layer.stabilizedSource) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.stabilizedSource);
      }
      gl.uniform1i(u.uVideoStab, 7);
      gl.uniform1i(u.uHasStabVideo, hasStab ? 1 : 0);
      gl.uniform1i(u.uIsAdjustment, layer.isAdjustmentLayer ? 1 : 0);
      gl.uniform1i(u.uIsAlphaOverlay, layer.isAlphaOverlay ? 1 : 0);
      gl.uniform1i(u.uBlendMode, BLEND_ID[layer.blendMode] ?? 0);

      // Multi-LUT stack
      const activeLuts = layer.grade.lutStack
        .filter((l) => l.enabled && l.intensity > 0 && this.lutTextures.has(l.lutId))
        .slice(0, MAX_STACKED_LUTS);
      const intensities = new Float32Array(MAX_STACKED_LUTS);
      const sizes = new Float32Array(MAX_STACKED_LUTS);
      const mins = new Float32Array(MAX_STACKED_LUTS * 3);
      const maxs = new Float32Array(MAX_STACKED_LUTS * 3);

      for (let i = 0; i < MAX_STACKED_LUTS; i++) {
        gl.activeTexture(gl.TEXTURE1 + i);
        const lyr = activeLuts[i];
        if (lyr) {
          const e = this.lutTextures.get(lyr.lutId)!;
          gl.bindTexture(gl.TEXTURE_3D, e.tex);
          intensities[i] = lyr.intensity / 100;
          sizes[i] = e.lut.size;
          mins.set(e.lut.domainMin, i * 3);
          maxs.set(e.lut.domainMax, i * 3);
        } else {
          gl.bindTexture(gl.TEXTURE_3D, this.fallbackLutTex);
          sizes[i] = 2;
          maxs.set([1, 1, 1], i * 3);
        }
        gl.uniform1i(u[`uLut${i}`], 1 + i);
      }
      gl.uniform1i(u.uLutCount, activeLuts.length);
      gl.uniform1i(u.uUseTetrahedral, layer.grade.lutInterpolation === 'tetrahedral' ? 1 : 0);
      gl.uniform1fv(u.uLutIntensity, intensities);
      gl.uniform1fv(u.uLutSize, sizes);
      gl.uniform3fv(u.uLutMin, mins);
      gl.uniform3fv(u.uLutMax, maxs);

      // Correction
      const c = layer.grade.correction;
      gl.uniform1f(u.uExposure, layer.exposureOverride ?? c.exposure);
      gl.uniform1f(u.uContrast, c.contrast / 100);
      gl.uniform1f(u.uHighlights, c.highlights / 100);
      gl.uniform1f(u.uShadows, c.shadows / 100);
      gl.uniform1f(u.uWhites, c.whites / 100);
      gl.uniform1f(u.uBlacks, c.blacks / 100);
      gl.uniform1f(u.uTemperature, c.temperature / 100);
      gl.uniform1f(u.uTint, c.tint / 100);
      gl.uniform1f(u.uSaturation, c.saturation / 100);
      gl.uniform1f(u.uVibrance, c.vibrance / 100);
      gl.uniform3f(u.uBalanceRgb, (c.balanceR ?? 0) / 100, (c.balanceG ?? 0) / 100, (c.balanceB ?? 0) / 100);
      gl.uniform1f(u.uHueShift, c.hueShift ?? 0);
      gl.uniform1f(u.uLightness, (c.lightness ?? 0) / 100);

      // Grading
      const g = layer.grade.grading;
      const liftT = wheelToRgbOffset(g.lift.x, g.lift.y, 0.25);
      const gammaT = wheelToRgbOffset(g.gamma.x, g.gamma.y, 0.3);
      const gainT = wheelToRgbOffset(g.gain.x, g.gain.y, 0.35);
      const splitS = hexToVec3(g.splitShadowHex);
      const splitH = hexToVec3(g.splitHighlightHex);
      gl.uniform1i(u.uGradingEnabled, g.enabled ? 1 : 0);
      gl.uniform3f(u.uLiftTint, liftT[0], liftT[1], liftT[2]);
      gl.uniform1f(u.uLiftLuma, g.lift.luma);
      gl.uniform3f(u.uGammaTint, gammaT[0], gammaT[1], gammaT[2]);
      gl.uniform1f(u.uGammaLuma, g.gamma.luma);
      gl.uniform3f(u.uGainTint, gainT[0], gainT[1], gainT[2]);
      gl.uniform1f(u.uGainLuma, g.gain.luma);
      gl.uniform1f(u.uSplitAmount, g.splitAmount / 100);
      gl.uniform1f(u.uSplitBalance, g.splitBalance / 100);
      gl.uniform3f(u.uSplitShadow, splitS[0], splitS[1], splitS[2]);
      gl.uniform3f(u.uSplitHighlight, splitH[0], splitH[1], splitH[2]);
      gl.uniform1f(u.uFilmicShoulder, g.filmicShoulder / 100);
      gl.uniform1f(u.uMatteLift, g.matteLift / 100);
      gl.uniform1f(u.uGrain, g.grain / 100);
      gl.uniform1f(u.uTime, layer.timeSec);

      // Effects
      const fx = layer.grade.effects;
      const ukCol = hexToVec3(fx.ultraKeyHex || '#00b140');
      const agCol = hexToVec3(fx.alphaGlowHex || '#60a5fa');
      gl.uniform1i(u.uEffectsEnabled, fx.enabled ? 1 : 0);
      gl.uniform1f(u.uHalation, fx.halation / 100);
      gl.uniform1f(u.uHalationThresh, fx.halationThreshold / 100);
      gl.uniform1f(u.uBloom, fx.bloom / 100);
      gl.uniform1f(u.uBloomRadius, fx.bloomRadius);
      gl.uniform1f(u.uSharpen, fx.sharpen / 100);
      gl.uniform1f(u.uBlur, (layer.blurOverride ?? fx.blur) / 100);
      gl.uniform1f(u.uCameraBlur, (fx.cameraBlur ?? 0) / 100);
      gl.uniform1f(u.uDirBlur, (fx.directionalBlur ?? 0) / 100);
      gl.uniform1f(u.uDirAngle, ((fx.directionalAngle ?? 0) * Math.PI) / 180);
      gl.uniform1f(u.uChromaticAb, fx.chromaticAberration / 100);
      gl.uniform1f(u.uVignette, fx.vignette / 100);
      gl.uniform1f(u.uVignetteFeather, fx.vignetteFeather / 100);
      gl.uniform1f(u.uGrainSize, fx.grainSize);
      gl.uniform1f(u.uLetterboxRatio, letterboxToFloat(fx.letterbox));
      gl.uniform1i(u.uInvert, fx.invert ? 1 : 0);
      gl.uniform1i(u.uUltraKeyOn, fx.ultraKeyEnabled ? 1 : 0);
      gl.uniform3f(u.uUltraKeyColor, ukCol[0], ukCol[1], ukCol[2]);
      gl.uniform1f(u.uUltraKeyTol, (fx.ultraKeyTolerance ?? 32) / 100);
      gl.uniform1f(u.uUltraKeySpill, (fx.ultraKeySpill ?? 45) / 100);
      gl.uniform1f(u.uAlphaGlow, (fx.alphaGlow ?? 0) / 100);
      gl.uniform3f(u.uAlphaGlowColor, agCol[0], agCol[1], agCol[2]);
      gl.uniform1f(u.uLensFlare, (fx.lensFlare ?? 0) / 100);
      gl.uniform2f(u.uLensFlarePos, (fx.lensFlareX ?? 30) / 100, (fx.lensFlareY ?? 32) / 100);
      gl.uniform1f(u.uLightning, (fx.lightning ?? 0) / 100);
      gl.uniform1f(u.uBlockDissolve, (fx.blockDissolve ?? 0) / 100);
      gl.uniform4f(
        u.uCrop,
        (fx.cropLeft ?? 0) / 100,
        (fx.cropRight ?? 0) / 100,
        (fx.cropTop ?? 0) / 100,
        (fx.cropBottom ?? 0) / 100
      );
      gl.uniform1f(u.uReframeAspect, reframeToFloat(fx.autoReframe ?? 'off'));

      // Motion + Basic 3D
      const tr = layer.transform;
      gl.uniform2f(u.uMotionPos, tr.positionX / 100, tr.positionY / 100);
      gl.uniform1f(u.uMotionScale, Math.max(0.05, tr.scale / 100));
      gl.uniform1f(u.uMotionRot, (tr.rotation * Math.PI) / 180);
      gl.uniform2f(u.uMotionFlip, tr.flipX ? -1 : 1, tr.flipY ? -1 : 1);
      gl.uniform1f(u.uMotionOpacity, tr.opacity / 100);
      gl.uniform2f(u.uBasic3D, ((tr.swivel3d ?? 0) * Math.PI) / 180, ((tr.tilt3d ?? 0) * Math.PI) / 180);

      // Stabilization
      const st = layer.stabilization;
      if (st.enabled && !layer.isAdjustmentLayer) {
        const str = st.mode === 'lock' ? 1.0 : st.strength / 100;
        const baseScale = 1 + st.autoCropZoom / 100;
        gl.uniform4f(
          u.uStabTransform,
          (layer.frameTransform?.dx ?? 0) * str,
          (layer.frameTransform?.dy ?? 0) * str,
          (layer.frameTransform?.da ?? 0) * str,
          Math.max(baseScale, layer.frameTransform?.scale ?? baseScale)
        );
        gl.uniform1f(u.uEdgeFeather, st.edgeFeather / 100);
      } else {
        gl.uniform4f(u.uStabTransform, 0, 0, 0, 1);
        gl.uniform1f(u.uEdgeFeather, 0);
      }

      // Masks
      const m = layer.mask;
      gl.uniform1i(u.uMaskMode, MASK_ID[m.mode] ?? 0);
      gl.uniform1i(u.uMaskInvert, m.invert ? 1 : 0);
      gl.uniform4f(u.uMaskRect, m.centerX / 100, m.centerY / 100, m.width / 100, m.height / 100);
      gl.uniform1f(u.uMaskFeather, m.feather / 100);
      gl.uniform4f(u.uMaskHsl, m.hslHue, m.hslHueRange, m.hslSatMin / 100, m.hslLumMin / 100);
      gl.uniform2f(u.uMaskLuma, m.lumaMin / 100, m.lumaMax / 100);

      // Video Transition
      gl.uniform1i(u.uTransType, TRANS_ID[layer.transitionType] ?? 0);
      gl.uniform1f(u.uTransVis, layer.transitionVisibility);

      // Extended Pro GPU Video Effects + Levels/Curves + Video Fade Multiplier
      gl.uniform4f(
        u.uDistortA,
        fx.mirrorMode ?? 0,
        fx.kaleidoscope ?? 0,
        (fx.twirl ?? 0) / 100,
        (fx.pinchSpherize ?? 0) / 100
      );
      gl.uniform4f(
        u.uDistortB,
        (fx.waveWarp ?? 0) / 100,
        (fx.ripple ?? 0) / 100,
        (fx.turbulentDisplace ?? 0) / 100,
        (fx.zigZag ?? 0) / 100
      );
      gl.uniform4f(
        u.uDistortC,
        (fx.lensDistortion ?? 0) / 100,
        (fx.mosaic ?? 0) / 100,
        fx.replicate ?? 1,
        (fx.cornerPinSkew ?? 0) / 100
      );
      gl.uniform4f(
        u.uDistortD,
        (fx.offsetX ?? 0) / 100,
        (fx.offsetY ?? 0) / 100,
        (fx.rollingShutterRepair ?? 0) / 100,
        (fx.writeOnProgress ?? 100) / 100
      );
      gl.uniform4f(
        u.uStylizeA,
        (fx.blackAndWhite ?? 0) / 100,
        (fx.tintAmount ?? 0) / 100,
        fx.posterizeLevels ?? 0,
        (fx.threshold ?? 0) / 100
      );
      gl.uniform4f(
        u.uStylizeB,
        (fx.emboss ?? 0) / 100,
        fx.colorEmboss ? 1 : 0,
        (fx.bevelEdges ?? 0) / 100,
        (fx.edgeFeather ?? 0) / 100
      );
      gl.uniform4f(
        u.uStylizeC,
        (fx.radialShadow ?? 0) / 100,
        (fx.noiseAmount ?? 0) / 100,
        (fx.rampAmount ?? 0) / 100,
        fx.broadcastSafe ? 1 : 0
      );
      gl.uniform4f(
        u.uStylizeD,
        (fx.strobeInterval ?? 0) / 100,
        (fx.unsharpMask ?? 0) / 100,
        (fx.equalize ?? 0) / 100,
        (fx.temporalSmooth ?? 0) / 100
      );
      gl.uniform4f(
        u.uColorKeyFX,
        fx.colorPassEnabled ? 1 : 0,
        fx.colorPassTolerance ?? 28,
        fx.changeColorEnabled ? 1 : 0,
        layer.videoFadeMultiplier ?? 1.0
      );
      const tintV = hexToVec3(fx.tintHex || '#f5c28b');
      const passV = hexToVec3(fx.colorPassHex || '#e11d48');
      const chgV = hexToVec3(fx.changeColorToHex || '#38bdf8');
      const rStartV = hexToVec3(fx.rampStartHex || '#080c18');
      const rEndV = hexToVec3(fx.rampEndHex || '#3b82f6');
      gl.uniform3f(u.uTintCol, tintV[0], tintV[1], tintV[2]);
      gl.uniform3f(u.uColorPassCol, passV[0], passV[1], passV[2]);
      gl.uniform3f(u.uChangeToCol, chgV[0], chgV[1], chgV[2]);
      gl.uniform3f(u.uRampStart, rStartV[0], rStartV[1], rStartV[2]);
      gl.uniform3f(u.uRampEnd, rEndV[0], rEndV[1], rEndV[2]);
      gl.uniform4f(
        u.uLevelsA,
        c.gamma ?? 1.0,
        (c.levelsBlack ?? 0) / 100,
        (c.levelsWhite ?? 100) / 100,
        0
      );
      gl.uniform3f(u.uCurves, (c.curveLow ?? 0) / 100, (c.curveMid ?? 0) / 100, (c.curveHigh ?? 0) / 100);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Swap ping-pong buffers
      const tmpTex = readTex;
      readTex = writeTex;
      writeTex = tmpTex;
      writeFbo = writeFbo === this.fboB ? this.fboA : this.fboB;
    }

    // Final Present Pass to Screen (with Hold-to-Compare / Split Wipe)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, targetW, targetH);
    gl.useProgram(this.presentProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTex);
    gl.uniform1i(this.presentUniforms.uFinal, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rawCompareTexture);
    gl.uniform1i(this.presentUniforms.uRaw, 1);
    gl.uniform1i(this.presentUniforms.uHasRaw, hasRawCompare ? 1 : 0);
    gl.uniform1i(this.presentUniforms.uCompareOriginal, params.compareOriginal ? 1 : 0);
    gl.uniform1i(this.presentUniforms.uSplitEnabled, params.splitEnabled ? 1 : 0);
    gl.uniform1f(this.presentUniforms.uSplitPos, params.splitPos);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  public dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.videoTexture);
    gl.deleteTexture(this.stabVideoTexture);
    gl.deleteTexture(this.rawCompareTexture);
    gl.deleteTexture(this.texA);
    gl.deleteTexture(this.texB);
    gl.deleteFramebuffer(this.fboA);
    gl.deleteFramebuffer(this.fboB);
    gl.deleteTexture(this.fallbackLutTex);
    for (const e of this.lutTextures.values()) gl.deleteTexture(e.tex);
    this.lutTextures.clear();
    gl.deleteProgram(this.layerProgram);
    gl.deleteProgram(this.presentProgram);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
