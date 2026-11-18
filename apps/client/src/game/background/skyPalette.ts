import { clamp01 } from '@world/shared';

/**
 * Time-of-day color keyframes. Background layers are tinted from these; `ambient` is the light
 * color of open sky that the world lightmap starts from.
 */
export interface SkyKey {
  readonly hour: number;
  readonly top: string;
  readonly horizon: string;
  /** Tint for landscape layers (near). */
  readonly land: string;
  /** Tint for distant layers (blends toward the sky). */
  readonly far: string;
  readonly ambient: readonly [number, number, number];
  readonly stars: number;
}

export const SKY_KEYS: readonly SkyKey[] = [
  {
    hour: 0,
    top: '#070b24',
    horizon: '#18234a',
    land: '#3a4775',
    far: '#2a3664',
    ambient: [0.3, 0.36, 0.6],
    stars: 1,
  },
  {
    hour: 4.3,
    top: '#0c1430',
    horizon: '#232c58',
    land: '#3f4b7a',
    far: '#313d6c',
    ambient: [0.32, 0.37, 0.6],
    stars: 1,
  },
  {
    hour: 5.4,
    top: '#2a3d78',
    horizon: '#d98a74',
    land: '#8a7aa2',
    far: '#9a88b0',
    ambient: [0.58, 0.54, 0.7],
    stars: 0.35,
  },
  {
    hour: 6.5,
    top: '#5a8dd0',
    horizon: '#ffc591',
    land: '#ecc8b2',
    far: '#e8c6c8',
    ambient: [0.95, 0.83, 0.76],
    stars: 0,
  },
  {
    hour: 8,
    top: '#4d97e6',
    horizon: '#c4e5f6',
    land: '#ffffff',
    far: '#ffffff',
    ambient: [1, 1, 1],
    stars: 0,
  },
  {
    hour: 12,
    top: '#3c8ce4',
    horizon: '#bde2f8',
    land: '#ffffff',
    far: '#ffffff',
    ambient: [1, 1, 1],
    stars: 0,
  },
  {
    hour: 16.4,
    top: '#4a8ade',
    horizon: '#dbe7e6',
    land: '#fff4e4',
    far: '#fff0e0',
    ambient: [1, 0.97, 0.92],
    stars: 0,
  },
  {
    hour: 17.9,
    top: '#3b5ea8',
    horizon: '#ffad6c',
    land: '#f2c29a',
    far: '#efae96',
    ambient: [0.98, 0.78, 0.62],
    stars: 0,
  },
  {
    hour: 19.1,
    top: '#23306a',
    horizon: '#c86c70',
    land: '#9a7c9c',
    far: '#8c6c92',
    ambient: [0.62, 0.52, 0.66],
    stars: 0.3,
  },
  {
    hour: 20.4,
    top: '#0b1132',
    horizon: '#1f2a55',
    land: '#3c4978',
    far: '#2c3866',
    ambient: [0.31, 0.36, 0.6],
    stars: 0.95,
  },
];

export interface SkyState {
  readonly top: number;
  readonly horizon: number;
  readonly land: number;
  readonly far: number;
  readonly ambient: readonly [number, number, number];
  readonly stars: number;
}

function parse(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

function lerpRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) |
    (Math.round(ag + (bg - ag) * t) << 8) |
    Math.round(ab + (bb - ab) * t)
  );
}

/** Interpolated sky state for an hour in [0, 24). Colors are 0xRRGGBB. */
export function skyAt(hour: number): SkyState {
  const keys = SKY_KEYS;
  const h = ((hour % 24) + 24) % 24;
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if ((keys[k]?.hour ?? 0) <= h) i = k;
  const a = keys[i] as SkyKey;
  const b = keys[(i + 1) % keys.length] as SkyKey;
  const span = (b.hour - a.hour + 24) % 24 || 24;
  const t = clamp01(((h - a.hour + 24) % 24) / span);
  const s = t * t * (3 - 2 * t);
  return {
    top: lerpRgb(parse(a.top), parse(b.top), s),
    horizon: lerpRgb(parse(a.horizon), parse(b.horizon), s),
    land: lerpRgb(parse(a.land), parse(b.land), s),
    far: lerpRgb(parse(a.far), parse(b.far), s),
    ambient: [
      a.ambient[0] + (b.ambient[0] - a.ambient[0]) * s,
      a.ambient[1] + (b.ambient[1] - a.ambient[1]) * s,
      a.ambient[2] + (b.ambient[2] - a.ambient[2]) * s,
    ],
    stars: a.stars + (b.stars - a.stars) * s,
  };
}

export { lerpRgb };
