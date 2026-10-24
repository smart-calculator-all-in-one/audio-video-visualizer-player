import { rgb, ramp, type Mode, type Theme } from "@/components/visualizer/themes";

export const BARS_MAX = 128;
export const WAVE_N = 192;

export type Pulse = { life: number };

export type PaintFrame = {
  mode: Mode;
  theme: Theme;
  bars: Float32Array;
  barCount: number;
  peaks: Float32Array;
  wave: Float32Array;
  bass: number;
  energy: number;
  pulses: Pulse[];
  time: number;
  reduced: boolean;
};

export function barCountFor(mode: Mode, w: number, h: number): number {
  if (mode === "bars") return clamp(Math.round(w / 16), 28, 84);
  if (mode === "halo") return clamp(Math.round(Math.min(w, h) / 6.5), 56, 120);
  return clamp(Math.round(Math.min(w, h) / 10), 36, 72);
}

export function paint(ctx: CanvasRenderingContext2D, w: number, h: number, frame: PaintFrame): void {
  const { theme, energy, bass } = frame;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.46;
  const glowR = Math.max(w, h) * 0.62;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  glow.addColorStop(0, rgb(theme.mid, 0.05 + energy * 0.16 + bass * 0.05));
  glow.addColorStop(0.45, rgb(theme.low, 0.05));
  glow.addColorStop(1, rgb(theme.low, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  if (frame.mode === "bars") drawBars(ctx, w, h, frame);
  else if (frame.mode === "halo") drawHalo(ctx, w, h, frame, cx, cy);
  else drawWave(ctx, w, h, frame, cx, cy);

  const vignette = ctx.createLinearGradient(0, 0, 0, h);
  vignette.addColorStop(0, "rgba(0,0,0,0.38)");
  vignette.addColorStop(0.2, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, frame: PaintFrame): void {
  const { bars, barCount, peaks, theme } = frame;
  const margin = Math.max(20, w * 0.05);
  const midY = h * 0.46;
  const maxH = Math.min(h * 0.3, Math.max(80, (h - 200) * 0.46));
  const avail = w - margin * 2;
  const gap = Math.max(2, Math.min(6, avail * 0.003));
  const bw = Math.max(1, (avail - gap * (barCount - 1)) / barCount);
  const radius = Math.min(bw / 2, 5);

  ctx.beginPath();
  ctx.moveTo(margin, midY);
  ctx.lineTo(w - margin, midY);
  ctx.strokeStyle = rgb(theme.mid, 0.22);
  ctx.lineWidth = 1;
  ctx.stroke();

  for (let i = 0; i < barCount; i++) {
    const amp = bars[i] ?? 0;
    const bh = Math.max(1.5, amp * maxH);
    const x = margin + i * (bw + gap);
    const t = barCount === 1 ? 0 : i / (barCount - 1);
    const col = ramp(theme, t);
    ctx.fillStyle = rgb(col, 0.16);
    round(ctx, x - 1.5, midY - bh * 1.08, bw + 3, bh * 2.16, radius);
    ctx.fill();
  }

  for (let i = 0; i < barCount; i++) {
    const amp = bars[i] ?? 0;
    const bh = Math.max(1.5, amp * maxH);
    const x = margin + i * (bw + gap);
    const t = barCount === 1 ? 0 : i / (barCount - 1);
    const col = ramp(theme, 0.15 + t * 0.85);
    ctx.fillStyle = rgb(col, 0.42 + amp * 0.58);
    round(ctx, x, midY - bh, bw, bh * 2, radius);
    ctx.fill();

    const peak = peaks[i] ?? 0;
    if (peak > 0.04) {
      const py = midY - peak * maxH;
      ctx.fillStyle = rgb(theme.high, 0.85);
      ctx.fillRect(x, py - 1, bw, 2);
      ctx.fillRect(x, midY + peak * maxH - 1, bw, 2);
    }
  }
}

function drawHalo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: PaintFrame,
  cx: number,
  cy: number,
): void {
  const { bars, barCount, theme, bass, pulses, reduced, time } = frame;
  const minSide = Math.min(w, h);
  const radius = minSide * 0.23;
  const maxLen = minSide * 0.17;
  const rot = reduced ? -Math.PI / 2 : time * 0.07 - Math.PI / 2;

  for (const pulse of pulses) {
    const rr = radius * (0.9 + (1 - pulse.life) * 1.15);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = rgb(theme.mid, pulse.life * 0.4);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  const step = (Math.PI * 2) / barCount;
  const gap = step * 0.28;
  for (let i = 0; i < barCount; i++) {
    const amp = bars[i] ?? 0;
    const a0 = rot + i * step + gap * 0.5;
    const a1 = rot + (i + 1) * step - gap * 0.5;
    const inner = radius * (0.9 - bass * 0.04);
    const outer = inner + 4 + amp * maxLen;
    ctx.beginPath();
    ctx.arc(cx, cy, inner, a0, a1);
    ctx.arc(cx, cy, outer, a1, a0, true);
    ctx.closePath();
    const col = ramp(theme, i / barCount);
    ctx.fillStyle = rgb(col, 0.3 + amp * 0.7);
    ctx.fill();
  }

  const coreR = radius * 0.62 * (1 + bass * 0.1);
  const core = ctx.createRadialGradient(cx, cy, coreR * 0.1, cx, cy, coreR);
  core.addColorStop(0, rgb(theme.high, 0.95));
  core.addColorStop(0.42, rgb(theme.mid, 0.55));
  core.addColorStop(1, rgb(theme.low, 0));
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = core;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.78, 0, Math.PI * 2);
  ctx.strokeStyle = rgb(theme.high, 0.22 + bass * 0.4);
  ctx.lineWidth = 1.25;
  ctx.stroke();
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: PaintFrame,
  cx: number,
  cy: number,
): void {
  const { bars, barCount, wave, theme, bass, energy, pulses } = frame;
  const minSide = Math.min(w, h);
  const radius = minSide * 0.24;
  const rot = -Math.PI / 2;

  for (const pulse of pulses) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * (1.05 + (1 - pulse.life) * 0.7), 0, Math.PI * 2);
    ctx.strokeStyle = rgb(theme.low, pulse.life * 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  const step = (Math.PI * 2) / barCount;
  for (let i = 0; i < barCount; i++) {
    const amp = bars[i] ?? 0;
    const ang = rot + (i + 0.5) * step;
    const inner = radius * 1.08;
    const outer = inner + 8 + amp * minSide * 0.12;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
    ctx.lineTo(cx + Math.cos(ang) * outer, cy + Math.sin(ang) * outer);
    ctx.strokeStyle = rgb(ramp(theme, i / barCount), 0.2 + amp * 0.55);
    ctx.lineWidth = Math.max(2, minSide * 0.006);
    ctx.lineCap = "round";
    ctx.stroke();
  }

  const trace = (scale: number, width: number, colorAlpha: number, color: Theme["mid"], phase: number) => {
    ctx.beginPath();
    const n = wave.length;
    for (let i = 0; i <= n; i++) {
      const sample = wave[i % n] ?? 0;
      const ang = rot + (i / n) * Math.PI * 2 + phase;
      const r = radius + sample * radius * scale;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    if (scale > 0.4) {
      ctx.fillStyle = rgb(theme.mid, 0.05 + energy * 0.08);
      ctx.fill();
    }
    ctx.strokeStyle = rgb(color, colorAlpha);
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.stroke();
  };

  trace(0.34, 1.25, 0.4, theme.low, 0.4);
  trace(0.62, 2.25, 0.92, theme.high, 0);

  const coreR = radius * 0.28 * (1 + bass * 0.18);
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fillStyle = rgb(theme.high, 0.75);
  ctx.fill();
}

function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
