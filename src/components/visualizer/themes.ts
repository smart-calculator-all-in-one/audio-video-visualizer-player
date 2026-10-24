export type RGB = readonly [number, number, number];

export type Theme = {
  id: string;
  label: string;
  bg: string;
  low: RGB;
  mid: RGB;
  high: RGB;
};

export const THEMES: readonly Theme[] = [
  {
    id: "tide",
    label: "Tide",
    bg: "#071114",
    low: [12, 92, 112],
    mid: [34, 211, 238],
    high: [224, 254, 255],
  },
  {
    id: "ember",
    label: "Ember",
    bg: "#110c0a",
    low: [154, 52, 18],
    mid: [251, 146, 60],
    high: [255, 237, 213],
  },
  {
    id: "grove",
    label: "Grove",
    bg: "#08110c",
    low: [20, 92, 52],
    mid: [74, 222, 128],
    high: [236, 253, 245],
  },
  {
    id: "rose",
    label: "Rose",
    bg: "#11090c",
    low: [147, 30, 72],
    mid: [251, 113, 133],
    high: [255, 228, 230],
  },
  {
    id: "mono",
    label: "Mono",
    bg: "#09090b",
    low: [63, 63, 70],
    mid: [212, 212, 216],
    high: [250, 250, 250],
  },
];

export type Mode = "bars" | "halo" | "wave";

export const MODES: readonly { id: Mode; label: string }[] = [
  { id: "bars", label: "Bars" },
  { id: "halo", label: "Halo" },
  { id: "wave", label: "Wave" },
];

export function themeById(id: string): Theme {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function rgb(c: RGB, a = 1): string {
  const r = Math.round(c[0]);
  const g = Math.round(c[1]);
  const b = Math.round(c[2]);
  if (a >= 1) return `rgb(${r} ${g} ${b})`;
  return `rgba(${r},${g},${b},${a})`;
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

export function ramp(theme: Theme, t: number): RGB {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  if (u < 0.55) return mix(theme.low, theme.mid, u / 0.55);
  return mix(theme.mid, theme.high, (u - 0.55) / 0.45);
}
