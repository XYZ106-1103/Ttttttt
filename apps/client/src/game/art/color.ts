/**
 * Color utilities for procedural pixel art.
 * Colors are packed as 0xAABBGGRR so they can be written straight into a Uint32Array view of
 * ImageData (all supported browsers are little-endian).
 */

export type Color = number;

export const TRANSPARENT: Color = 0;

export function rgba(r: number, g: number, b: number, a = 255): Color {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}

export function hex(value: string, alpha = 255): Color {
  const v = value.replace('#', '');
  const n = parseInt(v.length === 3 ? v.replace(/(.)/g, '$1$1') : v, 16);
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, alpha);
}

export function red(c: Color): number {
  return c & 255;
}
export function green(c: Color): number {
  return (c >>> 8) & 255;
}
export function blue(c: Color): number {
  return (c >>> 16) & 255;
}
export function alpha(c: Color): number {
  return (c >>> 24) & 255;
}

export function withAlpha(c: Color, a: number): Color {
  return rgba(red(c), green(c), blue(c), a);
}

export function toCss(c: Color): string {
  return `rgba(${red(c)},${green(c)},${blue(c)},${(alpha(c) / 255).toFixed(3)})`;
}

export function toHex(c: Color): string {
  return `#${[red(c), green(c), blue(c)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function mix(a: Color, b: Color, t: number): Color {
  const u = Math.max(0, Math.min(1, t));
  return rgba(
    Math.round(red(a) + (red(b) - red(a)) * u),
    Math.round(green(a) + (green(b) - green(a)) * u),
    Math.round(blue(a) + (blue(b) - blue(a)) * u),
    Math.round(alpha(a) + (alpha(b) - alpha(a)) * u),
  );
}

/** Multiply RGB channels (tinting). */
export function multiply(c: Color, r: number, g: number, b: number): Color {
  return rgba(
    Math.min(255, Math.round(red(c) * r)),
    Math.min(255, Math.round(green(c) * g)),
    Math.min(255, Math.round(blue(c) * b)),
    alpha(c),
  );
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl(c: Color): Hsl {
  const r = red(c) / 255;
  const g = green(c) / 255;
  const b = blue(c) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function fromHsl({ h, s, l }: Hsl, a: number): Color {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return rgba(v, v, v, a);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return rgba(
    Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hh) * 255),
    Math.round(hue2rgb(p, q, hh - 1 / 3) * 255),
    a,
  );
}

function shiftHueToward(h: number, target: number, amount: number): number {
  let d = target - h;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return h + d * amount;
}

/**
 * Hue-shifted shading, the way pixel artists ramp colors: shadows drift toward cool purple-blue,
 * highlights toward warm yellow, rather than simply mixing with black/white.
 * `amount` in [-1, 1]: negative darkens, positive lightens.
 */
export function shade(c: Color, amount: number): Color {
  const hsl = toHsl(c);
  if (amount < 0) {
    const k = -amount;
    hsl.h = shiftHueToward(hsl.h, 250, k * 0.35);
    hsl.l = Math.max(0, hsl.l * (1 - k));
    hsl.s = Math.min(1, hsl.s * (1 + k * 0.15));
  } else {
    const k = amount;
    hsl.h = shiftHueToward(hsl.h, 55, k * 0.25);
    hsl.l = Math.min(1, hsl.l + (1 - hsl.l) * k);
    hsl.s = Math.max(0, hsl.s * (1 - k * 0.2));
  }
  return fromHsl(hsl, alpha(c));
}

/** Adjust saturation (factor 0 = gray, 1 = unchanged). */
export function saturate(c: Color, factor: number): Color {
  const hsl = toHsl(c);
  hsl.s = Math.max(0, Math.min(1, hsl.s * factor));
  return fromHsl(hsl, alpha(c));
}

/** A ramp of `n` colors from dark to light around a base color. */
export function ramp(base: Color, n: number, spread = 0.55): Color[] {
  const out: Color[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    out.push(t === 0 ? base : shade(base, t * spread));
  }
  return out;
}
