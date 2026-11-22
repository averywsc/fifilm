import type { TextOverlayProps } from '../types/editor';

const overlayCanvasCache = new Map<string, { sig: string; canvas: HTMLCanvasElement }>();

/**
 * Renders a crisp Text, Vertical Type, or Vector Shape (Rectangle, Ellipse, Pen)
 * onto a transparent 2D canvas so WebGL2 can composite it with full blend modes,
 * Basic 3D, masks, transitions, keyframes, and effects.
 */
export function getOverlayTextureCanvas(
  clipId: string,
  props: TextOverlayProps,
  width = 1280,
  height = 720
): HTMLCanvasElement {
  const sig = JSON.stringify([props, width, height]);
  const cached = overlayCanvasCache.get(clipId);
  if (cached && cached.sig === sig) return cached.canvas;

  const canvas = cached?.canvas || document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);

  if (props.shapeKind) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const rw = width * 0.36;
    const rh = height * 0.36;
    ctx.save();
    ctx.fillStyle = props.color || '#ffffff';
    ctx.strokeStyle = props.color || '#ffffff';
    ctx.lineWidth = Math.max(4, width * 0.004);
    if (props.shapeKind === 'rectangle') {
      ctx.fillRect(cx - rw * 0.5, cy - rh * 0.5, rw, rh);
    } else if (props.shapeKind === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw * 0.5, rh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Pen vector polygon / custom path
      ctx.beginPath();
      const pts = 6;
      for (let i = 0; i < pts; i++) {
        const a = (i / pts) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? Math.min(rw, rh) * 0.55 : Math.min(rw, rh) * 0.32;
        const px = cx + Math.cos(a) * rad;
        const py = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else {
    const text = props.text || 'Title';
    const fontSize = Math.max(14, Math.round(props.fontSize * (height / 720)));
    ctx.font = `700 ${fontSize}px "Inter", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (props.vertical) {
      const chars = Array.from(text);
      const stepY = fontSize * 1.08;
      const totalH = chars.length * stepY;
      const startY = height * 0.5 - totalH * 0.5 + stepY * 0.5;
      if (props.bgOpacity > 0.01) {
        ctx.save();
        ctx.globalAlpha = props.bgOpacity / 100;
        ctx.fillStyle = props.bgColor || '#080c18';
        const bw = fontSize * 1.6;
        ctx.fillRect(width * 0.5 - bw * 0.5, startY - stepY * 0.65, bw, totalH + stepY * 0.3);
        ctx.restore();
      }
      ctx.fillStyle = props.color || '#ffffff';
      chars.forEach((ch, idx) => {
        ctx.fillText(ch, width * 0.5, startY + idx * stepY);
      });
    } else {
      const lines = text.split('\n');
      const lineH = fontSize * 1.2;
      const totalH = lines.length * lineH;
      const startY = height * 0.5 - totalH * 0.5 + lineH * 0.5;
      if (props.bgOpacity > 0.01) {
        const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width), 40);
        ctx.save();
        ctx.globalAlpha = props.bgOpacity / 100;
        ctx.fillStyle = props.bgColor || '#080c18';
        ctx.fillRect(
          width * 0.5 - maxW * 0.5 - 24,
          startY - lineH * 0.62,
          maxW + 48,
          totalH + lineH * 0.24
        );
        ctx.restore();
      }
      ctx.fillStyle = props.color || '#ffffff';
      lines.forEach((line, idx) => {
        ctx.fillText(line, width * 0.5, startY + idx * lineH);
      });
    }
  }

  overlayCanvasCache.set(clipId, { sig, canvas });
  return canvas;
}
