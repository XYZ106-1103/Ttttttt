import { hash1f, hash2f } from './rng';

/**
 * Deterministic coherent noise. Value/gradient noise is plenty for 2D terrain and much cheaper to
 * reason about than simplex. All functions return values roughly in [-1, 1].
 */

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 1D value noise. */
export function valueNoise1D(x: number, seed: number): number {
  const x0 = Math.floor(x);
  const t = fade(x - x0);
  const a = hash1f(x0, seed) * 2 - 1;
  const b = hash1f(x0 + 1, seed) * 2 - 1;
  return a + (b - a) * t;
}

/**
 * 1D value noise that repeats every `period` lattice units. Used for horizontally tileable
 * background art.
 */
export function periodicNoise1D(x: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const t = fade(x - x0);
  const p = Math.max(1, Math.round(period));
  const i0 = ((x0 % p) + p) % p;
  const i1 = (i0 + 1) % p;
  const a = hash1f(i0, seed) * 2 - 1;
  const b = hash1f(i1, seed) * 2 - 1;
  return a + (b - a) * t;
}

function grad2(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const angle = hash2f(ix, iy, seed) * Math.PI * 2;
  return Math.cos(angle) * dx + Math.sin(angle) * dy;
}

/** 2D gradient (Perlin-style) noise. */
export function gradientNoise2D(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fade(fx);
  const v = fade(fy);
  const n00 = grad2(x0, y0, seed, fx, fy);
  const n10 = grad2(x0 + 1, y0, seed, fx - 1, fy);
  const n01 = grad2(x0, y0 + 1, seed, fx, fy - 1);
  const n11 = grad2(x0 + 1, y0 + 1, seed, fx - 1, fy - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  // Gradient noise peaks around ±0.707; scale to roughly [-1, 1].
  return (nx0 + (nx1 - nx0) * v) * 1.41421356;
}

export interface FbmOptions {
  octaves?: number;
  lacunarity?: number;
  gain?: number;
}

/** Fractal Brownian motion over 1D value noise, normalized to roughly [-1, 1]. */
export function fbm1D(x: number, seed: number, options: FbmOptions = {}): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = options;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise1D(x * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Tileable fBm: repeats every `period` units of x (period must be an integer). */
export function periodicFbm1D(
  x: number,
  period: number,
  seed: number,
  options: FbmOptions = {},
): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = options;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += periodicNoise1D(x * freq, period * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Fractal Brownian motion over 2D gradient noise, normalized to roughly [-1, 1]. */
export function fbm2D(x: number, y: number, seed: number, options: FbmOptions = {}): number {
  const { octaves = 4, lacunarity = 2, gain = 0.5 } = options;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += gradientNoise2D(x * freq, y * freq, seed + i * 7919) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
