/**
 * Biome beasts with their own body plans: the snow wolf, the shore crab and the fire imp.
 * Same conventions as creatures.ts — one painter per pose, sheets sample poses, faces RIGHT.
 */
import { hex, mix, shade, withAlpha } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import type { MonsterSheet } from './creatures';
import { flipY, selOut, shadedBlob, softDisc, stroke } from './paint';

type AnimTable = Map<string, { frames: PixelCanvas[]; rate: number; repeat: number }>;

function anim(t: AnimTable, key: string, frames: PixelCanvas[], rate: number, repeat = -1): void {
  t.set(key, { frames, rate, repeat });
}

const EYE = hex('#1a1424');
const WHITE = hex('#ffffff');

function speedLines(pc: PixelCanvas, ys: readonly number[]): void {
  for (const y of ys)
    for (let x = 0; x < 5; x++) pc.blend(x + 1, Math.round(y), withAlpha(WHITE, 120 - x * 20));
}

// --- Snow wolf ----------------------------------------------------------------------------------

interface WolfPose {
  /** Gait phase 0..1. */
  readonly leg: number;
  /** Stride length multiplier (0 = standing). */
  readonly stride?: number;
  readonly crouch?: number;
  readonly lean?: number;
  readonly head?: number;
  readonly eyes?: 'open' | 'x' | 'fierce';
  readonly lines?: boolean;
}

const WOLF_FUR = hex('#d9e4ee');
const WOLF_SHADE = hex('#8fa3ba');
const WOLF_DARK = hex('#4c5d74');

function paintWolf(p: WolfPose): PixelCanvas {
  const W = 46;
  const H = 30;
  const pc = new PixelCanvas(W, H);
  const base = H - 2;
  const crouch = p.crouch ?? 0;
  const lean = p.lean ?? 0;
  const stride = p.stride ?? 1;
  const cx = 21 + lean;
  const cy = base - 12 + crouch;
  // Legs: back pair behind the body (darker), front pair over it.
  const legs = (far: boolean) => {
    for (const [hipX, ph] of [
      [cx - 8, far ? 0.5 : 0],
      [cx + 8, far ? 0 : 0.5],
    ] as const) {
      const a = (p.leg + ph) * Math.PI * 2;
      const fx = hipX + Math.cos(a) * 3.5 * stride;
      const fy = base - Math.max(0, Math.sin(a)) * 2.5 * stride;
      const c = far ? WOLF_DARK : WOLF_SHADE;
      stroke(pc, hipX, cy + 2, (hipX + fx) / 2 + 1, (cy + fy) / 2 + 2, 1.1, c);
      stroke(pc, (hipX + fx) / 2 + 1, (cy + fy) / 2 + 2, fx, fy, 0.8, c);
      pc.set(Math.round(fx) + 1, Math.round(fy), shade(c, -0.3));
    }
  };
  legs(true);
  // Tail: a bushy plume swept back.
  const tailLift = p.lines ? -2 : 1;
  for (let i = 0; i < 7; i++) {
    const tx = cx - 12 - i * 1.3;
    const ty = cy - 2 + tailLift - Math.sin(i * 0.5) * 2;
    pc.fillEllipse(tx, ty, 2.4 - i * 0.2, 2 - i * 0.15, i > 4 ? WHITE : WOLF_SHADE);
  }
  // Body.
  shadedBlob(pc, cx, cy, 12.5, 6.5, {
    ramp: [WOLF_DARK, WOLF_SHADE, mix(WOLF_SHADE, WOLF_FUR, 0.6), WOLF_FUR, WHITE],
    spec: WHITE,
    power: 2.6,
    rim: hex('#e8f6ff'),
  });
  // Ruff of fur at the shoulders.
  for (let i = 0; i < 5; i++) pc.set(Math.round(cx + 7 + i * 0.6), Math.round(cy - 5 + i), WHITE);
  legs(false);
  // Head and snout.
  const hx = cx + 14 + lean * 0.4;
  const hy = cy - 4 + (p.head ?? 0);
  shadedBlob(pc, hx, hy, 5.5, 4.6, {
    ramp: [WOLF_SHADE, mix(WOLF_SHADE, WOLF_FUR, 0.5), WOLF_FUR, WHITE],
  });
  shadedBlob(pc, hx + 5, hy + 1.5, 3.4, 2.2, { ramp: [WOLF_SHADE, WOLF_FUR, WHITE] });
  pc.set(Math.round(hx + 8), Math.round(hy + 1), EYE); // nose
  // Ears.
  for (const ex of [-2, 1]) {
    pc.set(Math.round(hx + ex), Math.round(hy - 5), WOLF_SHADE);
    pc.set(Math.round(hx + ex), Math.round(hy - 6), WOLF_FUR);
    pc.set(Math.round(hx + ex + 1), Math.round(hy - 5), WOLF_DARK);
  }
  // Eye.
  const ex = Math.round(hx + 2);
  const ey = Math.round(hy - 1);
  if (p.eyes === 'x') {
    pc.set(ex, ey, EYE);
    pc.set(ex + 1, ey + 1, EYE);
    pc.set(ex + 1, ey - 1, EYE);
  } else {
    const c = p.eyes === 'fierce' ? hex('#7ff0ff') : hex('#59c8ff');
    pc.set(ex, ey, c);
    pc.set(ex + 1, ey, WHITE);
    if (p.eyes === 'fierce') softDisc(pc, ex + 1, ey, 3, c, 70);
  }
  // Fangs when snarling.
  if (p.eyes === 'fierce') {
    pc.set(Math.round(hx + 6), Math.round(hy + 4), WHITE);
    pc.set(Math.round(hx + 4), Math.round(hy + 4), WHITE);
  }
  selOut(pc, 0.55);
  if (p.lines) speedLines(pc, [cy - 3, cy + 1, cy + 4]);
  return pc;
}

function wolfSheet(): MonsterSheet {
  const t: AnimTable = new Map();
  anim(t, 'idle', [paintWolf({ leg: 0, stride: 0 }), paintWolf({ leg: 0, stride: 0, head: 1 })], 2);
  anim(
    t,
    'move',
    [0, 0.25, 0.5, 0.75].map((leg) => paintWolf({ leg })),
    9,
  );
  anim(
    t,
    'windup',
    [
      paintWolf({ leg: 0, stride: 0, crouch: 2, lean: -2, head: 2, eyes: 'fierce' }),
      paintWolf({ leg: 0, stride: 0, crouch: 3, lean: -3, head: 2, eyes: 'fierce' }),
    ],
    10,
  );
  anim(
    t,
    'charge',
    [0, 0.25, 0.5, 0.75].map((leg) =>
      paintWolf({ leg, stride: 1.5, lean: 2, head: 1, eyes: 'fierce', lines: true }),
    ),
    16,
  );
  anim(
    t,
    'daze',
    [
      paintWolf({ leg: 0, stride: 0, eyes: 'x', head: 2 }),
      paintWolf({ leg: 0.5, stride: 0.3, eyes: 'x', head: 1 }),
    ],
    4,
  );
  anim(t, 'hurt', [paintWolf({ leg: 0.3, stride: 0.5, lean: -2, eyes: 'x', head: -1 })], 1, 0);
  anim(t, 'stunned', [paintWolf({ leg: 0, stride: 0, crouch: 2, eyes: 'x', head: 3 })], 1, 0);
  const down = paintWolf({ leg: 0.25, stride: 0.6, eyes: 'x' });
  anim(t, 'dead', [flipY(down, new PixelCanvas(down.width, down.height))], 1, 0);
  return { width: 46, height: 30, footX: 21, footY: 28, anims: t };
}

// --- Shore crab ---------------------------------------------------------------------------------

interface CrabPose {
  readonly leg: number;
  /** Claws raised 0..1. */
  readonly claws?: number;
  readonly lift?: number;
  readonly shake?: number;
  readonly eyes?: 'open' | 'x';
  readonly lines?: boolean;
}

const CRAB = hex('#e0603c');
const CRAB_DARK = hex('#8a2a1e');
const CRAB_LIGHT = hex('#ffb08a');

function paintCrab(p: CrabPose): PixelCanvas {
  const W = 38;
  const H = 24;
  const pc = new PixelCanvas(W, H);
  const base = H - 2;
  const ox = Math.round(p.shake ?? 0);
  const lift = p.lift ?? 0;
  const cx = 18 + ox;
  const cy = base - 7 - lift;
  // Legs: three a side, scuttling.
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const ph = p.leg * Math.PI * 2 + i * 2.1 + (side > 0 ? Math.PI : 0);
      const hip = cx + side * (5 + i * 2);
      const knee = hip + side * 4;
      const fx = knee + side * 1.5 + Math.cos(ph) * 1.5;
      const fy = base - Math.max(0, Math.sin(ph)) * 2;
      stroke(pc, hip, cy + 2, knee, cy - 1 + i, 0.5, CRAB_DARK);
      stroke(pc, knee, cy - 1 + i, fx, fy, 0.5, CRAB_DARK);
    }
  }
  // Shell.
  shadedBlob(pc, cx, cy, 10, 5.5, {
    ramp: [CRAB_DARK, shade(CRAB, -0.25), CRAB, CRAB_LIGHT],
    spec: hex('#fff0e0'),
    power: 2.2,
    clipBottom: cy + 4,
    rim: CRAB_LIGHT,
  });
  for (const [dx, dy] of [
    [-5, -2],
    [-1, -3],
    [4, -2],
  ] as const)
    pc.set(cx + dx, Math.round(cy + dy), CRAB_LIGHT);
  // Claws (front = right), raised by `claws`.
  const raise = p.claws ?? 0;
  for (const [ax, big] of [
    [cx + 6, 1],
    [cx + 9, 0.8],
  ] as const) {
    const px = ax + 4;
    const py = cy - 2 - raise * 6;
    stroke(pc, ax, cy, px, py + 2, 0.7, shade(CRAB, -0.2));
    shadedBlob(pc, px + 1, py, 3 * big, 2.4 * big, {
      ramp: [CRAB_DARK, CRAB, CRAB_LIGHT],
    });
    pc.set(Math.round(px + 3 * big), Math.round(py - 1), CRAB_LIGHT);
    pc.set(Math.round(px + 3 * big), Math.round(py + 1), CRAB_DARK);
  }
  // Eye stalks.
  for (const dx of [-2, 2]) {
    stroke(pc, cx + dx + 2, cy - 4, cx + dx + 2, cy - 7, 0.3, CRAB_DARK);
    if (p.eyes === 'x') {
      pc.set(cx + dx + 2, cy - 8, EYE);
    } else {
      pc.set(cx + dx + 2, cy - 8, WHITE);
      pc.set(cx + dx + 3, cy - 8, EYE);
    }
  }
  selOut(pc, 0.55);
  if (p.lines) speedLines(pc, [cy - 2, cy + 2]);
  return pc;
}

function crabSheet(): MonsterSheet {
  const t: AnimTable = new Map();
  anim(t, 'idle', [paintCrab({ leg: 0 }), paintCrab({ leg: 0, claws: 0.2 })], 3);
  anim(
    t,
    'move',
    [0, 0.25, 0.5, 0.75].map((leg) => paintCrab({ leg })),
    10,
  );
  anim(
    t,
    'windup',
    [
      paintCrab({ leg: 0.1, claws: 1, lift: 1, shake: -1 }),
      paintCrab({ leg: 0.1, claws: 1, lift: 1, shake: 1 }),
    ],
    18,
  );
  anim(
    t,
    'charge',
    [0, 0.25, 0.5, 0.75].map((leg) => paintCrab({ leg, claws: 0.6, lines: true })),
    20,
  );
  anim(t, 'daze', [paintCrab({ leg: 0, eyes: 'x' }), paintCrab({ leg: 0.5, eyes: 'x' })], 4);
  anim(t, 'hurt', [paintCrab({ leg: 0.3, lift: 1, claws: 0.4, eyes: 'x' })], 1, 0);
  anim(t, 'stunned', [paintCrab({ leg: 0, eyes: 'x' })], 1, 0);
  const up = paintCrab({ leg: 0.4, eyes: 'x' });
  anim(t, 'dead', [flipY(up, new PixelCanvas(up.width, up.height))], 1, 0);
  return { width: 38, height: 24, footX: 18, footY: 22, anims: t };
}

// --- Fire imp -----------------------------------------------------------------------------------

const IMP = hex('#c7362a');
const IMP_DARK = hex('#5e1414');
const IMP_WING = hex('#3b1820');
const FLAME = hex('#ff9a3c');
const FLAME_HOT = hex('#ffe08a');

function paintImp(
  wing: number,
  power = 0,
  eyes: 'open' | 'closed' = 'open',
  fade = 0,
): PixelCanvas {
  const W = 30;
  const H = 32;
  const pc = new PixelCanvas(W, H);
  const k = 1 - fade;
  const cx = 14;
  const cy = 17;
  // Wings.
  for (const side of [-1, 1]) {
    const a = -0.6 + wing * 1.2;
    const tx = cx + side * (4 + Math.cos(a) * 8 * k);
    const ty = cy - 4 + Math.sin(a) * 6;
    for (let s = 0; s <= 16; s++) {
      const u = s / 16;
      stroke(pc, cx + side * 2, cy - 3, tx, ty + u * 6, 0.5, shade(IMP_WING, u * 0.2));
    }
    stroke(pc, cx + side * 2, cy - 3, tx, ty, 0.4, IMP_DARK);
  }
  // Tail with a barb.
  for (let i = 0; i < 8; i++)
    pc.set(
      Math.round(cx - 3 - i),
      Math.round(cy + 6 + Math.sin(i * 0.8 + wing * 3) * 1.5),
      IMP_DARK,
    );
  pc.set(cx - 11, cy + 5, IMP);
  pc.set(cx - 12, cy + 6, IMP);
  // Body and head.
  shadedBlob(pc, cx, cy + 3, 4.5, 5, {
    ramp: [IMP_DARK, shade(IMP, -0.2), IMP, shade(IMP, 0.3)],
    alphaValue: Math.round(255 * k),
  });
  shadedBlob(pc, cx + 1, cy - 4, 5, 4.5, {
    ramp: [IMP_DARK, shade(IMP, -0.15), IMP, shade(IMP, 0.35)],
    spec: hex('#ffc0a0'),
    alphaValue: Math.round(255 * k),
  });
  // Horns.
  for (const dx of [-3, 4]) {
    pc.set(cx + dx, cy - 8, hex('#e8d8b0'));
    pc.set(cx + dx + (dx < 0 ? -1 : 1), cy - 9, hex('#f8f0d8'));
  }
  // Eyes and grin.
  if (eyes === 'open') {
    pc.set(cx + 1, cy - 4, FLAME_HOT);
    pc.set(cx + 4, cy - 4, FLAME_HOT);
  } else {
    pc.set(cx + 1, cy - 4, EYE);
    pc.set(cx + 4, cy - 4, EYE);
  }
  for (let x = 1; x <= 4; x++) pc.set(cx + x, cy - 2, IMP_DARK);
  // Fire in the hand, growing as the cast charges.
  const fx = cx + 7;
  const fy = cy + 1;
  const r = 1.5 + power * 2.5;
  softDisc(pc, fx, fy, r + 4, FLAME, Math.round((60 + power * 90) * k));
  pc.fillEllipse(fx, fy, r, r * 1.2, withAlpha(FLAME, Math.round(230 * k)));
  pc.fillEllipse(fx, fy + 0.5, r * 0.5, r * 0.6, withAlpha(FLAME_HOT, Math.round(240 * k)));
  selOut(pc, 0.5);
  return pc;
}

function impSheet(): MonsterSheet {
  const t: AnimTable = new Map();
  const flap = (power = 0) => [0, 0.5, 1, 0.5].map((w) => paintImp(w, power));
  anim(t, 'idle', flap(), 10);
  anim(t, 'fly', flap(), 12);
  anim(
    t,
    'windup',
    [0, 1, 2, 3].map((i) => paintImp(i % 2 ? 0.8 : 0.2, 0.4 + i * 0.2)),
    12,
  );
  anim(t, 'attack', [paintImp(0.3, 1.2), paintImp(0.6, 0.2)], 10, 0);
  anim(t, 'hurt', [paintImp(0.8, 0, 'closed')], 1, 0);
  anim(t, 'stunned', [paintImp(1, 0, 'closed'), paintImp(0.9, 0, 'closed')], 4);
  anim(
    t,
    'dead',
    [0.2, 0.45, 0.7, 0.9].map((f) => paintImp(1, 0, 'closed', f)),
    10,
    0,
  );
  return { width: 30, height: 32, footX: 14, footY: 28, anims: t };
}

export function beastSheets(): [string, MonsterSheet][] {
  return [
    ['snow_wolf', wolfSheet()],
    ['shore_crab', crabSheet()],
    ['fire_imp', impSheet()],
  ];
}
