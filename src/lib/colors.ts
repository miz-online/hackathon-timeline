// Derives a full display palette + animation values from a single base color.

export const DEFAULT_ACCENT = "#C0322B";

export type Rgb = { r: number; g: number; b: number };

export function normalizeHex(input: string): string {
  let h = (input || "").trim();
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : DEFAULT_ACCENT;
}

export function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex);
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

function clamp(n: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, n));
}

function rgbToHex({ r, g, b }: Rgb): string {
  const p = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, "0");
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

export function mix(hex: string, target: Rgb, amount: number): string {
  const c = hexToRgb(hex);
  return rgbToHex({
    r: c.r + (target.r - c.r) * amount,
    g: c.g + (target.g - c.g) * amount,
    b: c.b + (target.b - c.b) * amount,
  });
}

export function lighten(hex: string, amount: number) {
  return mix(hex, { r: 255, g: 255, b: 255 }, amount);
}

export function darken(hex: string, amount: number) {
  return mix(hex, { r: 0, g: 0, b: 0 }, amount);
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance 0..1 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export type Palette = {
  /** the configured base color */
  base: string;
  /** slightly deeper shade, used for the resting state of the time block */
  deep: string;
  /** brighter peak of the glow pulse */
  peak: string;
  /** highlight used inside the rotating border sweep */
  highlight: string;
  /** readable text color on top of the base color */
  onBase: string;
  /** rgba strings for the animated shadows / gradient stops */
  glowStrong: string;
  glowSoft: string;
  glowNone: string;
  /** derived animation values */
  borderDuration: string;
  pulseDuration: string;
  glowBlur: string;
  glowSpread: string;
};

export function derivePalette(input: string): Palette {
  const base = normalizeHex(input);
  const l = luminance(base);
  // dark colors need a stronger, blurrier halo to read as "glowing";
  // light colors need a tighter one so they don't wash out.
  const glowBlur = Math.round(14 + (1 - l) * 12);
  const glowSpread = Math.round(4 + (1 - l) * 4);
  const peakAmount = 0.1 + (1 - l) * 0.12;

  return {
    base,
    deep: darken(base, 0.06),
    peak: lighten(base, peakAmount),
    highlight: lighten(base, 0.75),
    onBase: l > 0.55 ? "#1F2937" : "#FFFFFF",
    glowStrong: rgba(lighten(base, 0.3), 0.8),
    glowSoft: rgba(lighten(base, 0.25), 0.3),
    glowNone: rgba(base, 0),
    borderDuration: `${(4 + l * 2).toFixed(1)}s`,
    pulseDuration: `${(10 - l * 2).toFixed(1)}s`,
    glowBlur: `${glowBlur}px`,
    glowSpread: `${glowSpread}px`,
  };
}
