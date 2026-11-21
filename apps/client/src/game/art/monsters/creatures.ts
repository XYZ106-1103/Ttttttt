/**
 * Procedural pixel art for regular monsters. Every painter draws one pose into a fixed-size
 * frame; the sheet builder samples poses into animations. All art faces RIGHT.
 */
import { type Color, hex, mix, shade, withAlpha } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import { beastSheets } from './beasts';
import { flipY, selOut, shadedBlob, softDisc, stroke } from './paint';

export interface MonsterSheet {
  readonly width: number;
  readonly height: number;
  /** Feet anchor inside the frame (px). */
  readonly footX: number;
  readonly footY: number;
  readonly anims: ReadonlyMap<string, { frames: PixelCanvas[]; rate: number; repeat: number }>;
  /** Emissive sprites render unlit (they glow in the dark). */
  readonly emissive?: boolean;
}

type AnimTable = Map<string, { frames: PixelCanvas[]; rate: number; repeat: number }>;

function anim(t: AnimTable, key: string, frames: PixelCanvas[], rate: number, repeat = -1): void {
  t.set(key, { frames, rate, repeat });
}

const EYE = hex('#1a1424');
const WHITE = hex('#ffffff');

// --- Slimes -------------------------------------------------------------------------------------

interface SlimePalette {
  readonly body: Color;
  readonly core: Color;
  readonly spots?: Color;
}

interface SlimePose {
  readonly sx: number;
  readonly sy: number;
  readonly lean?: number;
  readonly eyes?: 'open' | 'closed' | 'hurt';
  readonly fade?: number;
}

function paintSlime(pal: SlimePalette, p: SlimePose): PixelCanvas {
  const W = 32;
  const H = 26;
  const pc = new PixelCanvas(W, H);
  const base = H - 2;
  const rx = 9.5 * p.sx;
  const ry = 7.5 * p.sy;
  const cx = 16 + (p.lean ?? 0);
  const cy = base - ry + 1.5;
  const ramp = [shade(pal.body, -0.55), shade(pal.body, -0.25), pal.body, shade(pal.body, 0.3)];
  const a = Math.round(225 * (1 - (p.fade ?? 0)));
  shadedBlob(pc, cx, cy, rx, ry, {
    ramp,
    spec: mix(pal.core, WHITE, 0.6),
    clipBottom: base,
    alphaValue: a,
    rim: shade(pal.body, 0.5),
  });
  // Dew-drop tip.
  const tipH = Math.max(2, Math.round(4 * p.sy));
  const tx = cx - 1 - (p.lean ?? 0) * 0.6;
  for (let i = 0; i < tipH; i++) {
    const w = Math.max(0, 2 - Math.floor((i * 3) / tipH));
    for (let x = -w; x <= w; x++)
      pc.set(
        Math.round(tx + x - i * 0.25),
        Math.round(cy - ry - i + 1),
        withAlpha(ramp[2] ?? 0, a),
      );
  }
  // Translucent inner core and a bubble.
  shadedBlob(pc, cx - 1, cy + ry * 0.25, rx * 0.45, ry * 0.4, {
    ramp: [mix(pal.body, pal.core, 0.5), pal.core],
    alphaValue: Math.round(a * 0.8),
  });
  if (pal.spots) {
    for (const [ox, oy] of [
      [-5, -1],
      [4, 2],
      [-2, 3],
      [6, -2],
    ] as const) {
      pc.set(Math.round(cx + ox * p.sx), Math.round(cy + oy * p.sy), withAlpha(pal.spots, a));
    }
  }
  pc.set(
    Math.round(cx + rx * 0.35),
    Math.round(cy + ry * 0.3),
    withAlpha(hex('#ffffff'), Math.round(a * 0.7)),
  );
  // Face.
  const ey = Math.round(cy - ry * 0.1);
  const ex = Math.round(cx + 2);
  if ((p.fade ?? 0) < 0.6) {
    if (p.eyes === 'closed' || p.eyes === 'hurt') {
      for (const dx of [-3, 3]) {
        pc.set(ex + dx - 1, ey, EYE);
        pc.set(ex + dx, ey + (p.eyes === 'hurt' ? 1 : 0), EYE);
        pc.set(ex + dx + 1, ey, EYE);
      }
    } else {
      for (const dx of [-3, 3]) {
        pc.fillRect(ex + dx, ey - 1, 2, 3, EYE);
        pc.set(ex + dx, ey - 1, WHITE);
      }
      pc.set(ex, ey + 2, shade(pal.body, -0.6));
    }
  }
  selOut(pc, 0.62);
  return pc;
}

function slimeSheet(pal: SlimePalette, emissive = false): MonsterSheet {
  const t: AnimTable = new Map();
  const P = (p: SlimePose) => paintSlime(pal, p);
  anim(
    t,
    'idle',
    [
      P({ sx: 1, sy: 1 }),
      P({ sx: 1.04, sy: 0.96 }),
      P({ sx: 1.07, sy: 0.93 }),
      P({ sx: 1.03, sy: 0.97 }),
    ],
    6,
  );
  anim(t, 'windup', [P({ sx: 1.15, sy: 0.82 }), P({ sx: 1.24, sy: 0.74 })], 10, 0);
  anim(t, 'jump', [P({ sx: 0.84, sy: 1.22, lean: 1 })], 1, 0);
  anim(t, 'fall', [P({ sx: 0.93, sy: 1.08 })], 1, 0);
  anim(
    t,
    'land',
    [P({ sx: 1.28, sy: 0.7 }), P({ sx: 1.12, sy: 0.86 }), P({ sx: 0.97, sy: 1.03 })],
    14,
    0,
  );
  anim(t, 'hurt', [P({ sx: 1.18, sy: 0.84, eyes: 'hurt' })], 1, 0);
  anim(
    t,
    'stunned',
    [P({ sx: 1.08, sy: 0.9, eyes: 'closed' }), P({ sx: 1.02, sy: 0.96, eyes: 'closed' })],
    4,
  );
  anim(
    t,
    'dead',
    [
      P({ sx: 1.35, sy: 0.6, eyes: 'closed' }),
      P({ sx: 1.6, sy: 0.4, eyes: 'closed' }),
      P({ sx: 1.8, sy: 0.28, eyes: 'closed' }),
      P({ sx: 1.9, sy: 0.2, eyes: 'closed' }),
    ],
    9,
    0,
  );
  return { width: 32, height: 26, footX: 16, footY: 24, anims: t, emissive };
}

// --- Thornback beetle ---------------------------------------------------------------------------

interface BeetlePose {
  readonly leg: number;
  readonly lift?: number;
  readonly lean?: number;
  readonly shake?: number;
  readonly eyes?: 'open' | 'x';
  readonly speedLines?: boolean;
}

interface BeetlePalette {
  readonly shell: Color;
  readonly thorn: Color;
  readonly belly: Color;
  readonly speck: Color;
  readonly rim: Color;
}

const THORNBACK: BeetlePalette = {
  shell: hex('#3f6b4f'),
  thorn: hex('#e47a48'),
  belly: hex('#2b2a36'),
  speck: hex('#9ccc6c'),
  rim: hex('#8fd0a0'),
};

let SHELL = THORNBACK.shell;
let THORN = THORNBACK.thorn;
let BELLY = THORNBACK.belly;
let SPECK = THORNBACK.speck;
let SHELL_RIM = THORNBACK.rim;

function paintBeetle(p: BeetlePose): PixelCanvas {
  const W = 40;
  const H = 26;
  const pc = new PixelCanvas(W, H);
  const base = H - 2;
  const ox = Math.round(p.shake ?? 0);
  const lift = p.lift ?? 0;
  const lean = p.lean ?? 0;
  // Legs (behind the body): three pairs, phased.
  const legColor = shade(BELLY, -0.2);
  for (let i = 0; i < 3; i++) {
    const hip = 13 + i * 6 + ox;
    const ph = p.leg * Math.PI * 2 + i * 2.1;
    const fx = hip + Math.cos(ph) * 3 + 1;
    const fy = base - Math.max(0, Math.sin(ph)) * 2;
    const kneeX = hip + 2 + Math.cos(ph) * 1.5;
    const kneeY = base - 6 - lift * 0.5;
    stroke(pc, hip, base - 8 - lift, kneeX, kneeY, 0.6, legColor);
    stroke(pc, kneeX, kneeY, fx, fy, 0.5, legColor);
    pc.set(Math.round(fx), Math.round(fy), shade(legColor, 0.4));
  }
  // Belly and shell.
  const cx = 19 + ox + lean;
  const cy = base - 11 - lift;
  shadedBlob(pc, cx, cy + 3, 11.5, 3.5, { ramp: [shade(BELLY, -0.4), BELLY, shade(BELLY, 0.2)] });
  shadedBlob(pc, cx, cy, 12.5, 7.5, {
    ramp: [shade(SHELL, -0.6), shade(SHELL, -0.3), SHELL, shade(SHELL, 0.25), shade(SHELL, 0.5)],
    spec: mix(SPECK, WHITE, 0.6),
    power: 2.4,
    clipBottom: cy + 3,
    rim: SHELL_RIM,
  });
  // Shell seam and moss specks.
  for (let x = Math.round(cx - 9); x <= cx + 9; x++)
    pc.set(x, Math.round(cy + 1 + Math.abs(x - cx) * 0.05), shade(SHELL, -0.55));
  for (const [dx, dy] of [
    [-6, -3],
    [-2, -5],
    [3, -4],
    [7, -2],
  ] as const) {
    pc.set(Math.round(cx + dx), Math.round(cy + dy), SPECK);
  }
  // Thorns along the ridge.
  for (let i = 0; i < 5; i++) {
    const tx = Math.round(cx - 8 + i * 4);
    const ty = Math.round(cy - 6.5 + Math.abs(i - 2) * 0.8);
    pc.set(tx, ty, shade(THORN, -0.2));
    pc.set(tx, ty - 1, THORN);
    pc.set(tx + 1, ty - 2, shade(THORN, 0.35));
  }
  // Head with mandibles (right side).
  const hx = Math.round(cx + 12 + lean * 0.5);
  const hy = Math.round(cy + 2);
  shadedBlob(pc, hx, hy, 4.5, 3.8, { ramp: [shade(BELLY, -0.3), BELLY, shade(BELLY, 0.35)] });
  pc.set(hx + 4, hy + 2, hex('#c9b38a'));
  pc.set(hx + 5, hy + 1, hex('#e6d2a8'));
  pc.set(hx + 4, hy + 3, hex('#c9b38a'));
  if (p.eyes === 'x') {
    pc.set(hx + 1, hy - 2, hex('#ffd36b'));
    pc.set(hx + 2, hy - 1, hex('#ffd36b'));
    pc.set(hx + 1, hy - 1, EYE);
    pc.set(hx + 2, hy - 2, EYE);
  } else {
    pc.set(hx + 1, hy - 1, hex('#ffcf4a'));
    pc.set(hx + 2, hy - 1, hex('#fff2b0'));
  }
  // Antenna.
  stroke(pc, hx + 1, hy - 3, hx + 5, hy - 7 + (p.shake ? 1 : 0), 0.4, BELLY);
  selOut(pc, 0.55);
  if (p.speedLines) {
    for (const y of [cy - 3, cy + 1, cy + 4])
      for (let x = 0; x < 5; x++)
        pc.blend(x + 1, Math.round(y), withAlpha(hex('#ffffff'), 120 - x * 20));
  }
  return pc;
}

function beetleSheet(pal: BeetlePalette = THORNBACK): MonsterSheet {
  SHELL = pal.shell;
  THORN = pal.thorn;
  BELLY = pal.belly;
  SPECK = pal.speck;
  SHELL_RIM = pal.rim;
  const t: AnimTable = new Map();
  anim(t, 'idle', [paintBeetle({ leg: 0 }), paintBeetle({ leg: 0, lift: 0.6 })], 3);
  anim(
    t,
    'move',
    [0, 0.25, 0.5, 0.75].map((leg) => paintBeetle({ leg })),
    8,
  );
  anim(
    t,
    'windup',
    [
      paintBeetle({ leg: 0.1, lift: 1.5, lean: -2, shake: -1 }),
      paintBeetle({ leg: 0.1, lift: 1.5, lean: -2, shake: 1 }),
    ],
    18,
  );
  anim(
    t,
    'charge',
    [0, 0.25, 0.5, 0.75].map((leg) => paintBeetle({ leg, lean: 2, lift: -0.5, speedLines: true })),
    18,
  );
  anim(
    t,
    'daze',
    [paintBeetle({ leg: 0, eyes: 'x', lean: -1 }), paintBeetle({ leg: 0.5, eyes: 'x', lean: 1 })],
    4,
  );
  anim(t, 'hurt', [paintBeetle({ leg: 0.3, lift: 1, lean: -2, eyes: 'x' })], 1, 0);
  anim(t, 'stunned', [paintBeetle({ leg: 0, eyes: 'x' })], 1, 0);
  const up = paintBeetle({ leg: 0.4, eyes: 'x' });
  anim(t, 'dead', [flipY(up, new PixelCanvas(up.width, up.height))], 1, 0);
  return { width: 40, height: 26, footX: 20, footY: 24, anims: t };
}

// --- Cave bat -----------------------------------------------------------------------------------

interface BatPalette {
  readonly fur: Color;
  readonly membrane: Color;
  readonly eye: Color;
  /** Crystal spikes on the back. */
  readonly crystals?: Color;
  /** Bird-like: a beak and feathered wing tips (harpies). */
  readonly beak?: Color;
  /** Wing length multiplier. */
  readonly span?: number;
}

const CAVE_BAT: BatPalette = { fur: hex('#5d4b72'), membrane: hex('#3a2c4c'), eye: hex('#ffb347') };
let BAT = CAVE_BAT;
let FUR = CAVE_BAT.fur;
let MEMBRANE = CAVE_BAT.membrane;

function paintBat(wing: number, folded = false, eyes: 'open' | 'closed' = 'open'): PixelCanvas {
  const W = 34;
  const H = 26;
  const pc = new PixelCanvas(W, H);
  const cx = 17;
  const cy = 12;
  // Wings: three finger bones per wing, membrane filled between.
  for (const side of [-1, 1]) {
    const spread = folded ? 0.35 : 1;
    const ang = -0.9 + wing * 1.5; // radians above/below horizontal
    const tips: [number, number][] = [];
    for (let f = 0; f < 3; f++) {
      const a = ang + f * 0.45;
      const len = (12 - f * 2) * spread * (BAT.span ?? 1);
      tips.push([cx + side * (3 + Math.cos(a) * len), cy + Math.sin(a) * len * 0.9]);
    }
    const sx = cx + side * 3;
    const sy = cy - 1;
    // Membrane (triangle fan).
    for (let i = 0; i < tips.length; i++) {
      const [tx, ty] = tips[i] ?? [0, 0];
      const [nx, ny] = tips[i + 1] ?? [cx + side * 4, cy + 4];
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const ex = tx + (nx - tx) * u;
        const ey = ty + (ny - ty) * u;
        stroke(pc, sx, sy, ex, ey, 0.5, shade(MEMBRANE, u * 0.15 - 0.05));
      }
    }
    for (const [tx, ty] of tips) stroke(pc, sx, sy, tx, ty, 0.4, shade(FUR, -0.25));
    if (BAT.beak) {
      // Feathered tips.
      for (const [tx, ty] of tips) {
        pc.set(Math.round(tx + side), Math.round(ty), shade(MEMBRANE, 0.35));
        pc.set(Math.round(tx + side), Math.round(ty + 1), shade(MEMBRANE, 0.2));
      }
    }
  }
  // Body, ears, face.
  shadedBlob(pc, cx, cy + 1, 4.5, 5, {
    ramp: [shade(FUR, -0.5), shade(FUR, -0.2), FUR, shade(FUR, 0.3)],
    spec: shade(FUR, 0.6),
  });
  pc.set(cx - 3, cy - 5, FUR);
  pc.set(cx - 3, cy - 6, shade(FUR, 0.2));
  pc.set(cx + 2, cy - 5, FUR);
  pc.set(cx + 3, cy - 6, shade(FUR, 0.2));
  if (eyes === 'open') {
    pc.set(cx - 1, cy - 1, BAT.eye);
    pc.set(cx + 2, cy - 1, BAT.eye);
  } else {
    pc.set(cx - 1, cy - 1, EYE);
    pc.set(cx + 2, cy - 1, EYE);
  }
  if (BAT.beak) {
    pc.set(cx + 3, cy + 1, BAT.beak);
    pc.set(cx + 4, cy + 1, BAT.beak);
    pc.set(cx + 3, cy + 2, shade(BAT.beak, -0.3));
  } else {
    pc.set(cx, cy + 2, WHITE);
    pc.set(cx + 1, cy + 2, WHITE);
  }
  if (BAT.crystals) {
    for (const [dx, h] of [
      [-2, 3],
      [0, 4],
      [2, 3],
    ] as const) {
      for (let i = 0; i < h; i++)
        pc.set(cx + dx, cy - 4 - i, i === h - 1 ? WHITE : shade(BAT.crystals, i * 0.12));
    }
  }
  // Feet.
  pc.set(cx - 1, cy + 6, shade(FUR, -0.3));
  pc.set(cx + 1, cy + 6, shade(FUR, -0.3));
  selOut(pc, 0.5);
  return pc;
}

function batSheet(pal: BatPalette = CAVE_BAT): MonsterSheet {
  BAT = pal;
  FUR = pal.fur;
  MEMBRANE = pal.membrane;
  const t: AnimTable = new Map();
  anim(t, 'fly', [paintBat(0), paintBat(0.45), paintBat(1), paintBat(0.45)], 14);
  anim(t, 'idle', [paintBat(0), paintBat(0.45), paintBat(1), paintBat(0.45)], 10);
  anim(t, 'swoop', [paintBat(0.1, true), paintBat(0.2, true)], 10);
  anim(t, 'hurt', [paintBat(0.8, false, 'closed')], 1, 0);
  anim(t, 'stunned', [paintBat(1, true, 'closed')], 1, 0);
  const limp = paintBat(1.2, true, 'closed');
  anim(t, 'dead', [flipY(limp, new PixelCanvas(limp.width, limp.height))], 1, 0);
  return { width: 34, height: 26, footX: 17, footY: 19, anims: t, emissive: !!pal.crystals };
}

// --- Wisp (dokkaebi-bul) ------------------------------------------------------------------------

interface WispPalette {
  readonly outer: Color;
  readonly mid: Color;
  readonly inner: Color;
  readonly glow: Color;
  readonly eye: Color;
}

const BLUE_WISP: WispPalette = {
  outer: hex('#2f58ff'),
  mid: hex('#5fa8ff'),
  inner: hex('#c8ecff'),
  glow: hex('#4a7dff'),
  eye: hex('#0b1240'),
};
let WISP = BLUE_WISP;

function paintWisp(
  phase: number,
  power = 0,
  fade = 0,
  eyes: 'open' | 'closed' = 'open',
): PixelCanvas {
  const W = 28;
  const H = 34;
  const pc = new PixelCanvas(W, H);
  const cx = 14;
  const cy = 22;
  const k = 1 - fade;
  const { outer, mid, inner } = WISP;
  softDisc(pc, cx, cy - 2, 13 * k + power * 2, WISP.glow, Math.round(90 * k));
  // Flame: stacked ellipses rising, swaying with the phase.
  const layers = 7;
  for (let i = 0; i < layers; i++) {
    const u = i / (layers - 1);
    const r = (6.5 - u * 5) * k * (1 + power * 0.25);
    const x = cx + Math.sin(phase * Math.PI * 2 + u * 3) * u * 2.4;
    const y = cy - u * 13 * k;
    const c = mix(outer, mid, u * 0.4);
    pc.fillEllipse(x, y, r, r * 1.1, withAlpha(c, Math.round(235 * k)));
  }
  for (let i = 0; i < layers - 2; i++) {
    const u = i / (layers - 1);
    const r = (4.2 - u * 3.6) * k * (1 + power * 0.3);
    const x = cx + Math.sin(phase * Math.PI * 2 + u * 3 + 0.5) * u * 1.8;
    pc.fillEllipse(
      x,
      cy - u * 11 * k + 1,
      r,
      r * 1.05,
      withAlpha(mix(mid, inner, 0.3 + power * 0.4), Math.round(240 * k)),
    );
  }
  pc.fillEllipse(cx, cy + 1, 2.4 * k, 2.2 * k, withAlpha(inner, Math.round(250 * k)));
  // Hollow eyes.
  if (k > 0.5) {
    const ey = cy - 2;
    if (eyes === 'open') {
      pc.fillRect(cx - 3, ey - 1, 2, 3, withAlpha(WISP.eye, 230));
      pc.fillRect(cx + 2, ey - 1, 2, 3, withAlpha(WISP.eye, 230));
    } else {
      pc.fillRect(cx - 3, ey, 2, 1, withAlpha(WISP.eye, 230));
      pc.fillRect(cx + 2, ey, 2, 1, withAlpha(WISP.eye, 230));
    }
  }
  return pc;
}

function wispSheet(pal: WispPalette = BLUE_WISP): MonsterSheet {
  WISP = pal;
  const t: AnimTable = new Map();
  anim(
    t,
    'idle',
    [0, 1, 2, 3, 4, 5].map((i) => paintWisp(i / 6)),
    10,
  );
  anim(
    t,
    'fly',
    [0, 1, 2, 3, 4, 5].map((i) => paintWisp(i / 6)),
    10,
  );
  anim(
    t,
    'windup',
    [0, 1, 2, 3].map((i) => paintWisp(i / 4, 0.6 + i * 0.12)),
    12,
  );
  anim(t, 'attack', [paintWisp(0.2, 1), paintWisp(0.4, 0.5)], 10, 0);
  anim(t, 'hurt', [paintWisp(0.5, 0, 0.1, 'closed')], 1, 0);
  anim(t, 'stunned', [paintWisp(0.5, 0, 0.15, 'closed'), paintWisp(0.7, 0, 0.2, 'closed')], 4);
  anim(
    t,
    'dead',
    [0.2, 0.45, 0.7, 0.9].map((f) => paintWisp(f, 0, f, 'closed')),
    10,
    0,
  );
  return { width: 28, height: 34, footX: 14, footY: 32, anims: t, emissive: true };
}

export function creatureSheets(): Map<string, MonsterSheet> {
  return new Map<string, MonsterSheet>([
    ['dew_slime', slimeSheet({ body: hex('#6fd890'), core: hex('#c8ffd8') })],
    [
      'cave_slime',
      slimeSheet({ body: hex('#6c74e8'), core: hex('#c6d0ff'), spots: hex('#8ff0ff') }),
    ],
    ['thornback', beetleSheet()],
    ['cave_bat', batSheet()],
    ['wisp', wispSheet()],
    [
      'frost_slime',
      slimeSheet({ body: hex('#9fdcff'), core: hex('#f2fbff'), spots: hex('#ffffff') }),
    ],
    [
      'magma_slime',
      slimeSheet({ body: hex('#ff6a28'), core: hex('#ffe08a'), spots: hex('#5a1a10') }, true),
    ],
    [
      'ash_crawler',
      beetleSheet({
        shell: hex('#3d3a40'),
        thorn: hex('#ff7a2c'),
        belly: hex('#1f1a1e'),
        speck: hex('#ffb05a'),
        rim: hex('#ff8a4c'),
      }),
    ],
    [
      'crag_harpy',
      batSheet({
        fur: hex('#a07850'),
        membrane: hex('#6e5238'),
        eye: hex('#ffe066'),
        beak: hex('#f0c060'),
        span: 1.12,
      }),
    ],
    [
      'crystal_bat',
      batSheet({
        fur: hex('#5a4a8a'),
        membrane: hex('#3c3070'),
        eye: hex('#9ff8ff'),
        crystals: hex('#b48cff'),
      }),
    ],
    [
      'ice_wisp',
      wispSheet({
        outer: hex('#7fc8ff'),
        mid: hex('#c4ecff'),
        inner: hex('#ffffff'),
        glow: hex('#9fdcff'),
        eye: hex('#1a3a6a'),
      }),
    ],
    ...beastSheets(),
  ]);
}
