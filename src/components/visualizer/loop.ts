import type { AudioEngine } from "@/components/visualizer/audio-engine";
import {
  BARS_MAX,
  WAVE_N,
  barCountFor,
  paint,
  type Pulse,
} from "@/components/visualizer/draw";
import type { Mode, Theme } from "@/components/visualizer/themes";

export type VizSettings = {
  mode: Mode;
  theme: Theme;
  sensitivity: number;
  reduced: boolean;
};

const coeff = (dt: number, tau: number) => 1 - Math.pow(0.001, dt / tau);

export function startVisualizer(
  canvas: HTMLCanvasElement,
  engine: AudioEngine,
  getSettings: () => VizSettings,
): () => void {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return () => {};

  const bars = new Float32Array(BARS_MAX);
  const peaks = new Float32Array(BARS_MAX);
  const targets = new Float32Array(BARS_MAX);
  const wave = new Float32Array(WAVE_N);
  const waveTargets = new Float32Array(WAVE_N);
  const pulses: Pulse[] = [];
  let bass = 0;
  let prevBass = 0;
  let last = performance.now();
  let raf = 0;

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    const settings = getSettings();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = barCountFor(settings.mode, w, h);
    const active = engine.read(targets, count, waveTargets, settings.sensitivity);
    if (!active) fillIdle(targets, count, waveTargets, time);

    const attack = coeff(dt, 0.04);
    const release = coeff(dt, 0.26);
    let energy = 0;
    let bassTarget = 0;
    const bassN = Math.max(2, Math.round(count * 0.07));
    for (let i = 0; i < count; i++) {
      const target = targets[i] ?? 0;
      const k = target > bars[i] ? attack : release;
      bars[i] = bars[i] + (target - bars[i]) * k;
      if (bars[i] >= peaks[i]) peaks[i] = bars[i];
      else peaks[i] = Math.max(bars[i], peaks[i] - dt * 0.35);
      energy += bars[i];
      if (i < bassN) bassTarget += target;
    }
    energy /= count;
    bassTarget /= bassN;
    const bassK = bassTarget > bass ? coeff(dt, 0.05) : coeff(dt, 0.22);
    bass = bass + (bassTarget - bass) * bassK;

    const waveAtk = coeff(dt, 0.03);
    const waveRel = coeff(dt, 0.09);
    for (let i = 0; i < WAVE_N; i++) {
      const target = waveTargets[i] ?? 0;
      const k = Math.abs(target) > Math.abs(wave[i]) ? waveAtk : waveRel;
      wave[i] = wave[i] + (target - wave[i]) * k;
    }

    if (active && bass > 0.58 && prevBass < 0.4 && pulses.length < 4) {
      pulses.push({ life: 1 });
    }
    prevBass = bass;
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].life -= dt * 0.7;
      if (pulses[i].life <= 0) pulses.splice(i, 1);
    }

    paint(ctx, w, h, {
      mode: settings.mode,
      theme: settings.theme,
      bars,
      barCount: count,
      peaks,
      wave,
      bass,
      energy,
      pulses,
      time,
      reduced: settings.reduced,
    });
  };

  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

function fillIdle(bars: Float32Array, count: number, wave: Float32Array, time: number): void {
  for (let i = 0; i < count; i++) {
    const n = count <= 1 ? 0 : i / (count - 1);
    const center = n - 0.5 + Math.sin(time * 0.22) * 0.12;
    const bell = Math.exp(-center * center * 10);
    bars[i] =
      0.06 +
      Math.sin(time * 0.85 + n * 9.2) * 0.035 +
      Math.sin(time * 0.37 + n * 4.1) * 0.03 +
      bell * 0.14;
  }
  for (let i = 0; i < wave.length; i++) {
    const n = i / wave.length;
    wave[i] =
      Math.sin(time * 1.15 + n * Math.PI * 6) * 0.16 + Math.sin(time * 0.55 + n * Math.PI * 2) * 0.08;
  }
}
