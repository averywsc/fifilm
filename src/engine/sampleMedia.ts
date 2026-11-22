import type { StabilizationFrameTransform } from '../types/editor';

/**
 * Renders a rich, cinematic procedural video frame onto a 2D canvas for instant
 * zero-friction grading, LUT stacking, scopes, and handheld stabilization testing
 * even before the user drops their own MP4/MOV clips.
 */
export function drawProceduralCinemaFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeSec: number,
  variant: 'twilight' | 'portrait' | 'coast',
  includeHandheldShake = true
): void {
  ctx.save();

  // Optional deterministic handheld micro-shake so Stabilization Before/After is visibly obvious
  if (includeHandheldShake) {
    const jx = (Math.sin(timeSec * 5.7) * 14 + Math.cos(timeSec * 11.3) * 7) * (width / 1280);
    const jy = (Math.cos(timeSec * 4.9) * 10 + Math.sin(timeSec * 9.8) * 5) * (height / 720);
    const rot = Math.sin(timeSec * 3.8) * 0.018 + Math.cos(timeSec * 8.1) * 0.007;
    ctx.translate(width / 2 + jx, height / 2 + jy);
    ctx.rotate(rot);
    ctx.scale(1.06, 1.06);
    ctx.translate(-width / 2, -height / 2);
  }

  // Sky / backdrop gradient with dynamic motion
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  if (variant === 'twilight') {
    sky.addColorStop(0, '#0a1633');
    sky.addColorStop(0.42, '#243c6b');
    sky.addColorStop(0.68, '#d97248');
    sky.addColorStop(0.84, '#f5c07a');
    sky.addColorStop(1, '#121826');
  } else if (variant === 'portrait') {
    sky.addColorStop(0, '#182436');
    sky.addColorStop(0.55, '#3b4a5e');
    sky.addColorStop(1, '#151922');
  } else {
    sky.addColorStop(0, '#1e4268');
    sky.addColorStop(0.5, '#6899b8');
    sky.addColorStop(0.75, '#dfd4be');
    sky.addColorStop(1, '#203b46');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  // Moving sun / practical key light orb for highlight roll-off & scope response
  const sunX = width * (0.28 + 0.08 * Math.sin(timeSec * 0.35));
  const sunY = height * (variant === 'portrait' ? 0.34 : 0.56);
  const sunGrad = ctx.createRadialGradient(sunX, sunY, 8, sunX, sunY, width * 0.32);
  sunGrad.addColorStop(0, 'rgba(255, 250, 232, 0.98)');
  sunGrad.addColorStop(0.18, 'rgba(255, 198, 128, 0.72)');
  sunGrad.addColorStop(0.55, 'rgba(220, 110, 74, 0.22)');
  sunGrad.addColorStop(1, 'rgba(10, 18, 36, 0)');
  ctx.fillStyle = sunGrad;
  ctx.fillRect(0, 0, width, height);

  // Architectural / mountain parallax silhouettes
  const pan = (timeSec * 28) % width;
  ctx.fillStyle = variant === 'coast' ? '#1c333f' : '#0f1829';
  ctx.beginPath();
  ctx.moveTo(0, height * 0.72);
  for (let x = 0; x <= width + 60; x += 60) {
    const ridge =
      Math.sin((x + pan * 0.35) * 0.008) * height * 0.09 +
      Math.cos((x + pan * 0.6) * 0.019) * height * 0.04;
    ctx.lineTo(x, height * 0.66 - ridge);
  }
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  // Foreground street/harbor reflection & practical tungsten/cyan lights
  const roadY = height * 0.73;
  const roadGrad = ctx.createLinearGradient(0, roadY, 0, height);
  roadGrad.addColorStop(0, '#131d32');
  roadGrad.addColorStop(1, '#070b15');
  ctx.fillStyle = roadGrad;
  ctx.fillRect(0, roadY, width, height - roadY);

  // Practical cinema light poles & wet-asphalt reflections
  const colors = ['#ffb866', '#67d4ff', '#ff6e7f', '#ffe1a8', '#52e3b6'];
  for (let i = 0; i < 9; i++) {
    const lx = ((i * 175 - pan * 0.9) % (width + 160) + (width + 160)) % (width + 160) - 80;
    const ly = roadY - 26 - (i % 3) * 16;
    const col = colors[i % colors.length];
    const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 46);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.22, col);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, 46, 0, Math.PI * 2);
    ctx.fill();

    // Wet reflection streak
    const refl = ctx.createLinearGradient(lx, roadY, lx, height);
    refl.addColorStop(0, col + '88');
    refl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = refl;
    ctx.fillRect(lx - 7, roadY, 14, height - roadY);
  }

  // Skin-tone & calibrated ColorChecker reference strip (subtle bottom-right cinema slate)
  const swatches = [
    '#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa',
    '#d67e2c', '#505ba6', '#c15a63', '#5e3c6c', '#9dbc40', '#e0a32e',
    '#f4f4f4', '#a0a0a0', '#545454', '#161616',
  ];
  const swW = Math.round(width * 0.017);
  const swH = Math.round(height * 0.028);
  const startX = width - swatches.length * (swW + 2) - 18;
  const startY = height - swH - 18;
  ctx.fillStyle = 'rgba(5, 10, 22, 0.72)';
  ctx.fillRect(startX - 6, startY - 6, swatches.length * (swW + 2) + 10, swH + 12);
  swatches.forEach((hex, idx) => {
    ctx.fillStyle = hex;
    ctx.fillRect(startX + idx * (swW + 2), startY, swW, swH);
  });

  ctx.restore();
}

/**
 * Generates exact counter-shake trajectory for the built-in procedural handheld sample clip,
 * supporting both 'smooth' (Smooth Motion gimbal) and 'lock' (No Motion tripod lock).
 */
export function computeSampleStabilizationTrajectory(
  durationSec: number,
  fps: number,
  smoothness: number,
  mode: 'smooth' | 'lock' = 'smooth'
): StabilizationFrameTransform[] {
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
  const damping = mode === 'lock' ? 1.0 : Math.min(0.95, 0.4 + (smoothness / 60) * 0.55);
  const out: StabilizationFrameTransform[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    const jx = (Math.sin(t * 5.7) * 14 + Math.cos(t * 11.3) * 7) / 1280;
    const jy = (Math.cos(t * 4.9) * 10 + Math.sin(t * 9.8) * 5) / 720;
    const rot = Math.sin(t * 3.8) * 0.018 + Math.cos(t * 8.1) * 0.007;
    out.push({
      frame: f,
      dx: -jx * damping,
      dy: -jy * damping,
      da: -rot * damping,
      scale: 1.0 + (mode === 'lock' ? 0.075 : 0.055 * damping),
    });
  }
  return out;
}
