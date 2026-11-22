import React, { useEffect, useRef } from 'react';
import type { WheelOffset } from '../types/editor';

interface ColorWheelProps {
  label: string;
  value: WheelOffset;
  onChange: (next: WheelOffset) => void;
}

const WHEEL_SIZE = 148;

export const ColorWheel: React.FC<ColorWheelProps> = ({ label, value, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const r = WHEEL_SIZE / 2;
    const img = ctx.createImageData(WHEEL_SIZE, WHEEL_SIZE);
    const data = img.data;

    for (let y = 0; y < WHEEL_SIZE; y++) {
      for (let x = 0; x < WHEEL_SIZE; x++) {
        const dx = (x - r) / (r - 2);
        const dy = (y - r) / (r - 2);
        const dist = Math.hypot(dx, dy);
        const idx = (y * WHEEL_SIZE + x) * 4;
        if (dist > 1) {
          data[idx] = 8;
          data[idx + 1] = 12;
          data[idx + 2] = 24;
          data[idx + 3] = 255;
          continue;
        }
        const angle = Math.atan2(dy, dx);
        const hue = ((angle * 180) / Math.PI + 360) % 360;
        const sat = Math.min(1, dist);
        // Subtle desaturated dark-studio wheel feel matching Totone
        const [cr, cg, cb] = hsvToRgb(hue, sat * 0.78, 0.28 + sat * 0.52);
        data[idx] = Math.round(cr * 255);
        data[idx + 1] = Math.round(cg * 255);
        data[idx + 2] = Math.round(cb * 255);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Crosshairs
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r, 4);
    ctx.lineTo(r, WHEEL_SIZE - 4);
    ctx.moveTo(4, r);
    ctx.lineTo(WHEEL_SIZE - 4, r);
    ctx.stroke();

    // Inner guide ring
    ctx.beginPath();
    ctx.arc(r, r, (r - 2) * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // Active indicator puck
    const px = r + value.x * (r - 8);
    const py = r + value.y * (r - 8);
    ctx.strokeStyle = '#080C18';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.stroke();
  }, [value.x, value.y]);

  const updateFromClient = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const r = rect.width / 2;
    let nx = (clientX - rect.left - r) / (r - 8);
    let ny = (clientY - rect.top - r) / (r - 8);
    const dist = Math.hypot(nx, ny);
    if (dist > 1) {
      nx /= dist;
      ny /= dist;
    }
    onChange({ ...value, x: Number(nx.toFixed(3)), y: Number(ny.toFixed(3)) });
  };

  return (
    <div className="wheel-panel">
      <canvas
        ref={canvasRef}
        width={WHEEL_SIZE}
        height={WHEEL_SIZE}
        className="wheel-canvas"
        aria-label={`${label} color wheel`}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateFromClient(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          updateFromClient(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onDoubleClick={() => onChange({ x: 0, y: 0, luma: 0 })}
      />
      <div className="slider-row" style={{ width: '100%' }}>
        <span className="slider-label">{label} Luma</span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={value.luma}
          onChange={(e) => onChange({ ...value, luma: parseFloat(e.target.value) })}
        />
        <span
          className="slider-val"
          title="Double-click to reset"
          onDoubleClick={() => onChange({ ...value, luma: 0 })}
        >
          {value.luma >= 0 ? `+${value.luma.toFixed(2)}` : value.luma.toFixed(2)}
        </span>
      </div>
    </div>
  );
};

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}
