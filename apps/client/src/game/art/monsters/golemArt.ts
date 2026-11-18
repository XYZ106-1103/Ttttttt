/** Corestone Golem boss sprites: a rock body around a glowing ember core. Faces RIGHT. */
import { hex, mix, shade, withAlpha } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import type { MonsterSheet } from './creatures';
import { selOut, shadedBlob, softDisc, stroke } from './paint';

const W = 96;
const H = 96;
const FOOT = 92;
const ROCK = hex('#5d6374');
const ROCK_RAMP = [
  shade(ROCK, -0.62),
  shade(ROCK, -0.35),
  shade(ROCK, -0.1),
  ROCK,
  shade(ROCK, 0.25),
  shade(ROCK, 0.45),
];
const MOSS = hex('#7fae5a');
const EMBER = hex('#ff9a3c');
const EMBER_HOT = hex('#ffe08a');

interface GolemPose {
  bodyY?: number;
  lean?: number;
  front?: number;
  back?: number;
  headY?: number;
  leg?: number;
  glow?: number;
  eyes?: 'open' | 'closed' | 'rage';
  crumble?: number;
}

let rockSeed = 1;

function rock(
  pc: PixelCanvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fade = 0,
  power = 3.2,
): void {
  shadedBlob(pc, cx, cy, rx, ry, {
    ramp: ROCK_RAMP.map((c) => mix(c, hex('#2a2a36'), fade * 0.6)),
    rim: hex('#ffb070'),
    power,
    facet: 5,
    seed: rockSeed++,
  });
  // A crack or two across bigger stones.
  if (rx > 8) {
    const c = shade(ROCK, -0.65);
    pc.set(Math.round(cx - rx * 0.3), Math.round(cy - ry * 0.2), c);
    pc.set(Math.round(cx - rx * 0.3) + 1, Math.round(cy - ry * 0.2) + 1, c);
    pc.set(Math.round(cx - rx * 0.3) + 1, Math.round(cy - ry * 0.2) + 2, c);
  }
}

function arm(
  pc: PixelCanvas,
  sx: number,
  sy: number,
  angle: number,
  dim: number,
  fade: number,
): { fx: number; fy: number } {
  const dx = Math.sin(angle);
  const dy = Math.cos(angle);
  const ex = sx + dx * 13;
  const ey = sy + dy * 13;
  rock(pc, (sx + ex) / 2, (sy + ey) / 2, 6, 6.5, fade + dim, 3);
  const fx = sx + dx * 25;
  const fy = sy + dy * 25;
  rock(pc, fx, fy, 10.5, 9.5, fade + dim, 3.6);
  // Knuckle cracks with ember light.
  pc.set(Math.round(fx - 2), Math.round(fy + 1), withAlpha(EMBER, 200));
  pc.set(Math.round(fx + 2), Math.round(fy - 1), withAlpha(EMBER, 160));
  return { fx, fy };
}

function paintGolem(p: GolemPose): PixelCanvas {
  rockSeed = 1;
  const pc = new PixelCanvas(W, H);
  const by = p.bodyY ?? 0;
  const lean = p.lean ?? 0;
  const glow = p.glow ?? 0.6;
  const crumble = p.crumble ?? 0;
  const drop = crumble * 18;
  const leg = p.leg ?? 0;

  // Back arm and leg (darker: further from the light).
  arm(pc, 34 + lean, 42 + by + drop * 0.7, p.back ?? 0.15, 0.25, crumble);
  const lift0 = Math.max(0, Math.sin(leg * Math.PI * 2)) * 4;
  const lift1 = Math.max(0, Math.sin(leg * Math.PI * 2 + Math.PI)) * 4;
  rock(pc, 40 + lean * 0.4, FOOT - 9 - lift0 + drop * 0.2, 8, 9.5, 0.2 + crumble, 3.6);

  // Torso.
  const tx = 48 + lean;
  const ty = 54 + by + drop * 0.6;
  rock(pc, tx, ty + 2, 20, 18, crumble, 3.6);
  rock(pc, tx - 13, ty - 13, 10, 7, crumble, 4);
  rock(pc, tx + 13, ty - 13, 10, 7, crumble, 4);
  // Moss on the shoulders and head.
  for (const [mx, my] of [
    [-16, -20],
    [-13, -21],
    [-10, -20],
    [9, -20],
    [12, -21],
    [15, -20],
    [-4, -18],
  ] as const) {
    pc.set(Math.round(tx + mx), Math.round(ty + my), MOSS);
    pc.set(Math.round(tx + mx), Math.round(ty + my + 1), shade(MOSS, -0.3));
  }
  // Ember veins.
  const vein = withAlpha(mix(EMBER, EMBER_HOT, glow * 0.5), Math.round(140 + glow * 110));
  stroke(pc, tx + 4, ty - 2, tx + 12, ty + 6, 0.4, vein);
  stroke(pc, tx - 3, ty + 3, tx - 11, ty + 11, 0.4, vein);
  stroke(pc, tx + 1, ty + 5, tx + 3, ty + 15, 0.4, vein);

  // Front leg.
  rock(pc, 57 + lean * 0.4, FOOT - 9 - lift1 + drop * 0.2, 8.5, 10, crumble, 3.6);

  // Head.
  const hx = 52 + lean * 1.25;
  const hy = 29 + by + (p.headY ?? 0) + drop;
  rock(pc, hx, hy, 9.5, 8, crumble, 4);
  // Brow ridge.
  for (let x = -6; x <= 7; x++) pc.set(Math.round(hx + x), Math.round(hy - 3), shade(ROCK, -0.45));
  const eye = p.eyes ?? 'open';
  const eyeColor = eye === 'rage' ? hex('#ff5a3c') : EMBER_HOT;
  if (eye === 'closed' || crumble > 0.5) {
    for (let x = -3; x <= 5; x++) pc.set(Math.round(hx + x), Math.round(hy + 1), shade(ROCK, -0.7));
  } else {
    softDisc(pc, hx + 2, hy, 7, eyeColor, Math.round(70 + glow * 60));
    for (let x = -3; x <= 6; x++) pc.set(Math.round(hx + x), Math.round(hy), eyeColor);
    for (let x = -1; x <= 4; x++)
      pc.set(Math.round(hx + x), Math.round(hy + 1), withAlpha(EMBER, 200));
  }

  // Core crystal.
  const cx = tx + 3;
  const cy = ty - 1;
  softDisc(pc, cx, cy, 10 + glow * 6, EMBER, Math.round(60 + glow * 110 - crumble * 120));
  for (let dy = -5; dy <= 5; dy++) {
    const w = 3 - Math.floor(Math.abs(dy) * 0.6);
    for (let dx = -w; dx <= w; dx++) {
      const hot = dx < 0 && dy < 0;
      const c = hot ? EMBER_HOT : dy > 1 ? shade(EMBER, -0.25) : EMBER;
      pc.set(Math.round(cx + dx), Math.round(cy + dy), mix(c, hex('#3a2a2a'), crumble));
    }
  }

  // Front arm on top.
  arm(pc, 64 + lean, 42 + by + drop * 0.7, p.front ?? 0.15, 0, crumble);
  selOut(pc, 0.55);
  return pc;
}

export function golemSheet(): MonsterSheet {
  const t = new Map<string, { frames: PixelCanvas[]; rate: number; repeat: number }>();
  const a = (key: string, frames: GolemPose[], rate: number, repeat = -1) =>
    t.set(key, { frames: frames.map(paintGolem), rate, repeat });
  a(
    'idle',
    [
      { bodyY: 0, front: 0.12, back: 0.18 },
      { bodyY: 1, front: 0.16, back: 0.14, glow: 0.75 },
    ],
    3,
  );
  a(
    'walk',
    [0, 0.25, 0.5, 0.75].map((leg) => ({
      leg,
      bodyY: Math.round(Math.abs(Math.sin(leg * Math.PI * 2)) * 2),
      front: 0.15 + Math.sin(leg * Math.PI * 2) * 0.35,
      back: 0.15 - Math.sin(leg * Math.PI * 2) * 0.35,
      lean: 1,
    })),
    6,
  );
  a(
    'roar',
    [
      { front: 1.7, back: 1.9, headY: -3, eyes: 'rage', glow: 1, lean: -2 },
      { front: 1.9, back: 2.1, headY: -4, eyes: 'rage', glow: 1, lean: -3 },
    ],
    6,
  );
  a(
    'slam_windup',
    [
      { front: 2.7, back: 2.9, lean: -3, bodyY: -1, glow: 0.9 },
      { front: 2.95, back: 3.05, lean: -4, bodyY: -2, glow: 1 },
    ],
    5,
    0,
  );
  a('slam', [{ front: 0.55, back: 0.7, lean: 5, bodyY: 4, glow: 1, eyes: 'rage' }], 1, 0);
  a(
    'recover',
    [
      { front: 0.1, back: 0.1, bodyY: 5, glow: 0.25, eyes: 'closed' },
      { front: 0.12, back: 0.08, bodyY: 4, glow: 0.3, eyes: 'closed' },
    ],
    3,
  );
  a(
    'throw',
    [
      { front: 2.5, back: 0.3, lean: -2, glow: 0.8 },
      { front: 1.3, back: 0.2, lean: 3, glow: 0.8 },
    ],
    8,
    0,
  );
  a(
    'charge_windup',
    [
      { leg: 0.25, lean: -3, front: -0.3, back: -0.2, glow: 0.9 },
      { leg: 0, lean: -2, front: -0.35, back: -0.25, bodyY: 1, glow: 1 },
    ],
    8,
  );
  a(
    'charge',
    [0, 0.25, 0.5, 0.75].map((leg) => ({
      leg,
      lean: 6,
      front: -0.55,
      back: -0.45,
      glow: 1,
      eyes: 'rage' as const,
      bodyY: leg % 0.5 === 0 ? 0 : 1,
    })),
    12,
  );
  a(
    'stunned',
    [
      { front: 0.05, back: 0.05, bodyY: 6, lean: -2, glow: 0.2, eyes: 'closed' },
      { front: 0.08, back: 0.05, bodyY: 5, lean: -1, glow: 0.25, eyes: 'closed' },
    ],
    3,
  );
  a(
    'dead',
    [0.15, 0.4, 0.7, 1].map((crumble) => ({
      crumble,
      glow: 0.3 - crumble * 0.3,
      eyes: 'closed' as const,
      front: 0.1 + crumble * 0.4,
      back: 0.1,
    })),
    5,
    0,
  );
  return { width: W, height: H, footX: 48, footY: FOOT, anims: t };
}
