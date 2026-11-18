import { hash1f, hash2f, periodicFbm1D, periodicNoise1D, Rng } from '@world/shared';
import { type Color, hex, mix, shade, withAlpha } from '../color';
import { PixelCanvas } from '../PixelCanvas';

/**
 * Parallax background layers, generated in a neutral "daylight" palette. Time-of-day color is
 * applied at runtime via tinting, so one set of textures serves every hour.
 * All layers tile horizontally (periodic noise with period = texture width).
 */
export interface ParallaxLayerArt {
  readonly key: string;
  readonly canvas: PixelCanvas;
  /** Horizontal scroll factor relative to the world camera. */
  readonly scrollX: number;
  /** Vertical scroll factor (how strongly the layer follows camera height). */
  readonly scrollY: number;
  /** Screen-space offset of the layer's bottom edge from the horizon (internal px). */
  readonly baseOffset: number;
  /** Color that fills everything below the layer. */
  readonly fill: Color;
  /** How strongly this layer takes on the sky's color at dusk/night (0 = none, 1 = full). */
  readonly atmosphere: number;
}

const W = 1024;

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Ordered (Bayer 4×4) dithering — the clean, deliberate pattern pixel artists use. */
function dither(x: number, y: number, t: number, _seed: number): boolean {
  return ((BAYER4[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16 < t;
}

/** Vertical haze: blend toward `haze` near the bottom of the layer, ordered-dither style. */
function applyHaze(
  pc: PixelCanvas,
  haze: Color,
  from: number,
  strength: number,
  seed: number,
): void {
  for (let y = 0; y < pc.height; y++) {
    const t = Math.max(0, (y - from) / Math.max(1, pc.height - from)) * strength;
    if (t <= 0) continue;
    for (let x = 0; x < pc.width; x++) {
      const c = pc.get(x, y);
      if (!c) continue;
      const k = Math.floor(t * 4) / 4 + (dither(x, y, (t * 4) % 1, seed) ? 0.25 : 0);
      pc.set(x, y, mix(c, haze, Math.min(1, k)));
    }
  }
}

function mountains(
  key: string,
  height: number,
  peakAmp: number,
  baseColor: string,
  litColor: string,
  shadowColor: string,
  snow: boolean,
  seed: number,
  scrollX: number,
  scrollY: number,
  baseOffset: number,
  atmosphere: number,
): ParallaxLayerArt {
  const pc = new PixelCanvas(W, height);
  const base = hex(baseColor);
  const lit = hex(litColor);
  const dark = hex(shadowColor);
  const tops = new Int16Array(W);
  for (let x = 0; x < W; x++) {
    // Ridged noise: sharp peaks.
    const r = 1 - Math.abs(periodicFbm1D(x / 128, W / 128, seed, { octaves: 4, gain: 0.5 }));
    const broad = periodicFbm1D(x / 256, W / 256, seed + 5, { octaves: 2 }) * 0.5 + 0.5;
    const ridge = Math.pow(r, 2.2) * 0.55 + broad * 0.6;
    tops[x] = Math.round(height - 20 - ridge * peakAmp);
  }
  for (let x = 0; x < W; x++) {
    const top = tops[x] ?? 0;
    const prev = tops[(x - 3 + W) % W] ?? 0;
    const next = tops[(x + 3) % W] ?? 0;
    const rising = prev - next; // >0: surface faces the light (left)
    for (let y = top; y < height; y++) {
      const depth = y - top;
      // Facets: strata noise makes rocky light/shadow patches.
      const facet = periodicNoise1D(x / 7 + depth * 0.15, W / 7, seed + 9) + rising * 0.12;
      let c = facet > 0.35 ? lit : facet < -0.35 ? dark : base;
      if (
        snow &&
        depth < 10 &&
        top < height - peakAmp * 0.9 &&
        dither(x, y, 1 - depth / 10, seed)
      ) {
        c = facet > 0 ? hex('#f4f7ff') : hex('#c9d6ee');
      }
      pc.set(x, y, c);
    }
  }
  applyHaze(pc, mix(base, hex('#ffffff'), 0.45), Math.round(height * 0.45), 0.9, seed + 2);
  return { key, canvas: pc, scrollX, scrollY, baseOffset, fill: pc.get(0, height - 1), atmosphere };
}

function treeLine(
  key: string,
  height: number,
  crownMin: number,
  crownMax: number,
  colors: readonly string[],
  seed: number,
  scrollX: number,
  scrollY: number,
  baseOffset: number,
  pines: number,
  atmosphere: number,
  haze: number,
): ParallaxLayerArt {
  const pc = new PixelCanvas(W, height);
  const ramp = colors.map((c) => hex(c));
  const rng = new Rng(seed);
  const groundY = height - 18;
  // Fill ground band.
  pc.fillRect(0, groundY, W, height - groundY, ramp[1] ?? 0);
  let x = 0;
  while (x < W) {
    const r = rng.range(crownMin, crownMax);
    const isPine = rng.chance(pines);
    const cx = x;
    const trunkH = rng.range(r * 0.6, r * 1.3);
    const cy = groundY - trunkH - r * 0.6;
    for (let k = -1; k <= 1; k++) {
      const ox = cx + k * W; // wrap
      if (isPine) {
        const h = r * 3.2;
        for (let yy = 0; yy < h; yy++) {
          const half = (yy / h) * r * 1.05;
          const y = Math.round(cy - h * 0.55 + yy);
          for (let xx = Math.round(ox - half); xx <= Math.round(ox + half); xx++) {
            if (xx < 0 || xx >= W) continue;
            const lit = (ox - xx) / Math.max(1, half);
            pc.set(xx, y, (lit > 0.45 ? ramp[3] : lit < -0.5 ? ramp[1] : ramp[2]) ?? 0);
          }
        }
        for (let yy = Math.round(cy + h * 0.45); yy < groundY; yy++) {
          if (ox >= 0 && ox < W) pc.set(Math.round(ox), yy, ramp[0] ?? 0);
        }
      } else {
        for (let yy = Math.floor(cy - r); yy <= Math.ceil(cy + r); yy++) {
          for (let xx = Math.floor(ox - r); xx <= Math.ceil(ox + r); xx++) {
            if (xx < 0 || xx >= W) continue;
            const dx = xx - ox;
            const dy = yy - cy;
            const ang = Math.atan2(dy, dx);
            const bump = 1 + 0.1 * Math.sin(ang * 6 + cx);
            const d = Math.hypot(dx, dy) / (r * bump);
            if (d > 1) continue;
            const lit = (-dx * 0.6 - dy * 0.8) / r;
            const n = (hash2f(xx, yy, seed) - 0.5) * 0.3;
            const c = lit + n > 0.35 ? ramp[3] : lit + n < -0.35 ? ramp[1] : ramp[2];
            pc.set(xx, yy, c ?? 0);
          }
        }
        for (let yy = Math.round(cy + r * 0.7); yy < groundY; yy++) {
          if (ox >= 0 && ox < W) {
            pc.set(Math.round(ox), yy, ramp[0] ?? 0);
            pc.set(Math.round(ox) + 1, yy, ramp[0] ?? 0);
          }
        }
      }
    }
    x += Math.round(r * rng.range(0.9, 1.5));
  }
  // Rim light on the very top edge of every crown.
  for (let xx = 0; xx < W; xx++) {
    for (let yy = 1; yy < height; yy++) {
      if (pc.isOpaque(xx, yy) && !pc.isOpaque(xx, yy - 1)) {
        pc.set(xx, yy, ramp[4] ?? ramp[3] ?? 0);
        break;
      }
    }
  }
  applyHaze(pc, hex('#cfe3ea'), Math.round(height * 0.35), haze, seed + 1);
  return { key, canvas: pc, scrollX, scrollY, baseOffset, fill: pc.get(0, height - 1), atmosphere };
}

export function generateParallaxLayers(): ParallaxLayerArt[] {
  return [
    mountains(
      'bg_mtn_far',
      210,
      130,
      '#a7bbd6',
      '#c4d4ea',
      '#8fa3c4',
      true,
      101,
      0.04,
      0.03,
      -70,
      1,
    ),
    mountains(
      'bg_mtn_mid',
      170,
      80,
      '#7d9fb4',
      '#98b8c8',
      '#66889f',
      false,
      202,
      0.1,
      0.07,
      -30,
      0.85,
    ),
    treeLine(
      'bg_forest_far',
      150,
      7,
      13,
      ['#2c4a48', '#3f6a61', '#4f7f6e', '#629580', '#86b597'],
      303,
      0.22,
      0.14,
      10,
      0.35,
      0.7,
      0.6,
    ),
    treeLine(
      'bg_forest_near',
      190,
      11,
      20,
      ['#1c3430', '#28483e', '#35604c', '#467a5a', '#6a9e6e'],
      404,
      0.4,
      0.28,
      52,
      0.3,
      0.5,
      0.35,
    ),
  ];
}

/** Puffy pixel clouds: lit tops, lavender undersides, flat-ish bottoms. */
export function generateCloud(variant: number): PixelCanvas {
  const rng = new Rng(600 + variant * 41);
  const w = rng.int(70, 120);
  const h = Math.round(w * 0.38);
  const pc = new PixelCanvas(w, h);
  const puffs: { x: number; y: number; r: number }[] = [];
  const n = rng.int(5, 8);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const r = h * (0.22 + 0.42 * Math.sin(Math.PI * t)) * rng.range(0.7, 1.15);
    puffs.push({ x: w * (0.08 + 0.84 * t) + rng.range(-3, 3), y: h - r * 0.75 - 3, r });
  }
  // A couple of crown puffs on top for a cumulus silhouette.
  for (let i = 0; i < 2; i++) {
    puffs.push({
      x: w * rng.range(0.3, 0.7),
      y: h * rng.range(0.35, 0.5),
      r: h * rng.range(0.25, 0.33),
    });
  }
  const light = hex('#ffffff');
  const mid = hex('#eef1fb');
  const under = hex('#c9cde8');
  const deep = hex('#a9aed6');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let inside = false;
      let lit = -1;
      for (const p of puffs) {
        const dx = x - p.x;
        const dy = y - p.y;
        if (dx * dx + dy * dy <= p.r * p.r) {
          inside = true;
          lit = Math.max(lit, (-dx * 0.3 - dy) / p.r);
        }
      }
      if (!inside || y > h - 3) continue;
      const k = lit + (hash2f(x, y, variant) - 0.5) * 0.2;
      pc.set(x, y, k > 0.55 ? light : k > 0 ? mid : y > h - 7 ? deep : under);
    }
  }
  return pc;
}

export function generateSun(): PixelCanvas {
  const pc = new PixelCanvas(28, 28);
  pc.fillCircle(13.5, 13.5, 12, hex('#ffe9a8'));
  pc.fillCircle(13.5, 13.5, 10, hex('#fff4cf'));
  pc.fillCircle(13.5, 13.5, 7, hex('#fffbea'));
  return pc;
}

export function generateMoon(): PixelCanvas {
  const pc = new PixelCanvas(22, 22);
  const base = hex('#e6ebf7');
  pc.fillCircle(10.5, 10.5, 9.5, base);
  // Terminator shadow on the right
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 22; x++) {
      if (!pc.isOpaque(x, y)) continue;
      if ((x - 14.5) ** 2 + (y - 9) ** 2 < 70) pc.set(x, y, shade(base, -0.25));
    }
  }
  for (const [x, y, r] of [
    [6, 7, 1.6],
    [9, 13, 2.2],
    [5, 13, 1],
  ] as const) {
    pc.fillCircle(x, y, r, hex('#c3cbe0'));
  }
  return pc;
}

/** Tileable star field (white; alpha is driven by night factor at runtime). */
export function generateStars(w = 512, h = 300): PixelCanvas {
  const pc = new PixelCanvas(w, h);
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(hash1f(i, 11) * w);
    const y = Math.floor(Math.pow(hash1f(i, 12), 1.4) * h);
    const b = hash1f(i, 13);
    const c = b > 0.92 ? hex('#ffffff') : b > 0.6 ? hex('#dfe6ff', 220) : hex('#b8c4f0', 150);
    pc.set(x, y, c);
    if (b > 0.97) {
      pc.set(x - 1, y, withAlpha(c, 110));
      pc.set(x + 1, y, withAlpha(c, 110));
      pc.set(x, y - 1, withAlpha(c, 110));
      pc.set(x, y + 1, withAlpha(c, 110));
    }
  }
  return pc;
}
