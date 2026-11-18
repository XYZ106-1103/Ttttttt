import { type Color, hex, mix, shade } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import type { Appearance, HairStyle } from './appearance';
import { ANIMATIONS, frameName } from './poses';
import { FRAME_SIZE, type AnimationDef, type Pose, RIG } from './rig';
import {
  capsule,
  chain,
  disc,
  fillPolygon,
  MaskLayer,
  type Pt,
  pt,
  ribbon,
  solveJoint,
} from './shapes';

/**
 * Character sprite composer ("paper-doll" with an IK rig).
 *
 * Art direction: realistic ~5.5-head proportions, dark grounded palettes, a front key light with
 * a rim light catching the back silhouette, material-tinted selective outlines and long cloth
 * (coat tails, scarves, capes) with secondary motion — inspired by the rendering techniques of
 * cinematic pixel-art action games, with an original character design.
 *
 * Every frame is generated from an `Appearance` + pose, so players and AI adventurers share one
 * pipeline and need no hand-drawn assets.
 */

/* ---------------------------------------------------------------------------------------------
 * Materials & ramps
 * ------------------------------------------------------------------------------------------- */

const M = {
  skin: 0,
  hair: 1,
  garment: 2,
  fold: 3,
  inner: 4,
  accent: 5,
  pants: 6,
  boots: 7,
  scarf: 8,
  leather: 9,
  metal: 10,
  lens: 11,
  capelet: 12,
  glove: 13,
  hoodInner: 14,
  sleeve: 15,
} as const;
/** Back-side (far limb) variants live at index + BACK. */
const BACK = 16;

interface Ramp {
  readonly deep: Color;
  readonly shadow: Color;
  readonly base: Color;
  readonly light: Color;
  readonly rim: boolean;
}

const INK = hex('#120c18');

function rampOf(c: Color, rim = true, darken = 0): Ramp {
  const base = darken ? shade(c, -darken) : c;
  return {
    deep: shade(base, -0.55),
    shadow: shade(base, -0.28),
    base,
    light: shade(base, 0.2),
    rim,
  };
}

function buildRamps(a: Appearance): Ramp[] {
  const front: Ramp[] = [];
  // Skin: muted rosy shadows (hue-shifted shadows turn faces orange-red at this size).
  const sk = hex(a.skin);
  front[M.skin] = {
    deep: mix(sk, hex('#3a2430'), 0.68),
    shadow: mix(sk, hex('#9a6670'), 0.34),
    base: sk,
    light: mix(sk, hex('#fff4ea'), 0.3),
    rim: true,
  };
  const hair = rampOf(hex(a.hair));
  front[M.hair] = { ...hair, light: shade(hex(a.hair), 0.38) };
  front[M.garment] = rampOf(hex(a.garmentColor));
  front[M.fold] = rampOf(hex(a.garmentColor), true, 0.22);
  front[M.inner] = rampOf(hex(a.inner));
  front[M.accent] = rampOf(hex(a.accent));
  front[M.pants] = rampOf(hex(a.pants));
  front[M.boots] = rampOf(hex(a.boots));
  front[M.scarf] = rampOf(hex(a.scarfColor));
  front[M.leather] = rampOf(hex('#6a4528'));
  front[M.metal] = rampOf(hex('#c9a45a'));
  front[M.lens] = { ...rampOf(hex('#5fd0e6')), light: hex('#e6fbff') };
  front[M.capelet] = rampOf(hex(a.capelet ?? a.garmentColor));
  front[M.glove] = rampOf(hex('#3a2c26'));
  front[M.hoodInner] = rampOf(hex('#0d0a12'), false);
  // The near sleeve sits closest to the key light — a touch lighter so it separates from the torso.
  front[M.sleeve] = rampOf(shade(hex(a.garmentColor), 0.1));
  const all: Ramp[] = [...front];
  for (let i = 0; i < front.length; i++) {
    const r = front[i] as Ramp;
    all[i + BACK] = {
      deep: shade(r.deep, -0.15),
      shadow: shade(r.shadow, -0.22),
      base: shade(r.base, -0.22),
      light: shade(r.light, -0.2),
      rim: r.rim,
    };
  }
  return all;
}

/* ---------------------------------------------------------------------------------------------
 * Templates
 * ------------------------------------------------------------------------------------------- */

/** 11×10 head in profile-leaning 3/4 view, facing right (nose at x=10, row 5). */
const HEAD = [
  '...sssss...',
  '.ssssssss..',
  'ssssssssss.',
  'ssssssssss.',
  'ssssssssss.',
  'sssssssssss',
  'ssssssssss.',
  '.sssssssss.',
  '..ssssssss.',
  '...ssssss..',
];

interface HairDef {
  readonly cap: readonly [number, number][];
  /** [x, y, angle°, length, radius] — 180° points straight back. */
  readonly strands: readonly (readonly [number, number, number, number, number])[];
}

const HAIR: Record<HairStyle, HairDef> = {
  messy: {
    cap: [
      [-1, 6.5],
      [-1.3, 3],
      [0.3, 0.4],
      [2.5, -1.5],
      [5.5, -1.9],
      [8.3, -0.7],
      [10.2, 1.5],
      [10.4, 3.1],
      [8.9, 2.2],
      [7.9, 3],
      [6.3, 2.1],
      [5, 3],
      [4.3, 5.6],
      [3.4, 8],
      [1, 8.3],
    ],
    strands: [
      [0.5, 0.6, 200, 6, 1.8],
      [2.2, -1.1, 186, 6.5, 1.7],
      [4.4, -1.8, 168, 5, 1.5],
      [-0.6, 4, 206, 5, 1.5],
      [6.8, -1.4, 128, 3, 1.1],
    ],
  },
  swept: {
    cap: [
      [-1, 6],
      [-1.2, 2.5],
      [1, -0.1],
      [4, -2.1],
      [7, -2.1],
      [9.6, -0.5],
      [10.5, 2],
      [9.1, 1.8],
      [8, 2.7],
      [6.5, 2.3],
      [5, 3.4],
      [4.3, 6],
      [3.4, 8],
      [1, 8.1],
    ],
    strands: [
      [1, 0, 190, 8, 1.9],
      [3, -1.7, 178, 8.5, 1.8],
      [5.6, -2.1, 170, 6, 1.5],
      [0, 3.5, 200, 6, 1.6],
    ],
  },
  long: {
    cap: [
      [-1.2, 7],
      [-1.3, 2.5],
      [0.8, -0.2],
      [3.5, -1.8],
      [6.8, -1.9],
      [9.4, -0.4],
      [10.4, 2.2],
      [9.2, 2.6],
      [7.8, 2.2],
      [6, 3],
      [4.6, 3.2],
      [4.2, 7],
      [3.2, 9],
      [0.8, 9],
    ],
    strands: [[1, 1, 196, 4, 1.6]],
  },
  tied: {
    cap: [
      [-0.9, 6],
      [-1, 2.6],
      [0.8, 0],
      [3.6, -1.6],
      [6.6, -1.6],
      [9.2, -0.3],
      [10.2, 2],
      [8.8, 2.3],
      [7.2, 2],
      [5.6, 2.8],
      [4.4, 3.2],
      [4, 6.4],
      [3.2, 7.8],
      [0.8, 7.9],
    ],
    strands: [[6, -1.4, 140, 2.5, 1]],
  },
  short: {
    cap: [
      [-0.8, 6],
      [-1, 2.5],
      [0.5, 0.3],
      [3, -1.2],
      [6, -1.4],
      [8.6, -0.2],
      [9.8, 1.8],
      [8.4, 2.2],
      [6, 2],
      [4.6, 3],
      [4, 6],
      [3.2, 7.6],
      [0.8, 7.8],
    ],
    strands: [],
  },
};

/* ---------------------------------------------------------------------------------------------
 * Frame composition
 * ------------------------------------------------------------------------------------------- */

interface Ctx {
  readonly a: Appearance;
  readonly p: Pose;
  /** Torso space → frame space (origin at the hip pivot, +x forward, -y up, sheared by lean). */
  readonly T: (x: number, y: number) => Pt;
  /** Head template origin. */
  readonly hx: number;
  readonly hy: number;
}

const L = (): MaskLayer => new MaskLayer(FRAME_SIZE, FRAME_SIZE);
const deg = (d: number): number => (d * Math.PI) / 180;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function poly(ctx: Ctx, layer: MaskLayer, pts: readonly [number, number][], m: number): void {
  fillPolygon(
    layer,
    pts.map(([x, y]) => ctx.T(x, y)),
    m,
  );
}

function headPoly(ctx: Ctx, layer: MaskLayer, pts: readonly [number, number][], m: number): void {
  fillPolygon(
    layer,
    pts.map(([x, y]) => pt(ctx.hx + x, ctx.hy + y)),
    m,
  );
}

function rotate(p: Pt, a: number): Pt {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pt(p.x * c - p.y * s, p.x * s + p.y * c);
}

function drawLeg(layer: MaskLayer, hip: Pt, ankle: Pt, toeDeg: number, back: boolean): void {
  const o = back ? BACK : 0;
  const knee = solveJoint(hip, ankle, RIG.thigh, RIG.shin, 1);
  capsule(layer, hip, knee, 2.8, 2.2, M.pants + o);
  capsule(layer, knee, ankle, 2.2, 1.8, M.pants + o);
  // Boot shaft along the shin, then the foot rotated by the toe angle.
  const dir = Math.atan2(knee.y - ankle.y, knee.x - ankle.x);
  const top = pt(ankle.x + Math.cos(dir) * 5, ankle.y + Math.sin(dir) * 5);
  capsule(layer, ankle, top, 2.0, 2.1, M.boots + o);
  const foot: Pt[] = [pt(-2.2, -1.2), pt(2.4, -1.1), pt(4.6, 1.3), pt(4.6, 4), pt(-2.3, 4)];
  fillPolygon(
    layer,
    foot.map((f) => {
      const r = rotate(f, deg(toeDeg));
      return pt(ankle.x + r.x, ankle.y + r.y);
    }),
    M.boots + o,
  );
}

function drawArm(
  ctx: Ctx,
  layer: MaskLayer,
  shoulder: Pt,
  handRel: Pt,
  back: boolean,
  forearmOnly = false,
): void {
  const o = back ? BACK : 0;
  const hand = pt(shoulder.x + handRel.x, shoulder.y + handRel.y);
  const elbow = solveJoint(shoulder, hand, RIG.upperArm, RIG.forearm, -1);
  const sleeve = back ? M.garment + o : M.sleeve;
  if (!forearmOnly)
    capsule(layer, shoulder, elbow, 2.3, 2.0, ctx.a.garment === 'cloak' ? M.inner + o : sleeve);
  if (ctx.a.garment === 'jacket') {
    // Rolled sleeves: cloth to mid-forearm, then bare skin.
    const mid = pt(lerp(elbow.x, hand.x, 0.45), lerp(elbow.y, hand.y, 0.45));
    capsule(layer, elbow, mid, 2.1, 2.0, sleeve);
    capsule(layer, mid, hand, 1.5, 1.4, M.skin + o);
    disc(layer, hand, 1.7, M.skin + o);
    return;
  }
  const fore = ctx.a.garment === 'cloak' ? M.inner + o : sleeve;
  capsule(layer, elbow, hand, 2.0, 1.7, fore);
  const cuff = pt(lerp(elbow.x, hand.x, 0.78), lerp(elbow.y, hand.y, 0.78));
  capsule(
    layer,
    cuff,
    pt(lerp(elbow.x, hand.x, 0.9), lerp(elbow.y, hand.y, 0.9)),
    2.1,
    2.0,
    M.accent + o,
  );
  disc(layer, hand, 1.8, M.glove + o);
}

function scarfTail(
  ctx: Ctx,
  layer: MaskLayer,
  origin: Pt,
  segs: number,
  phase: number,
  width: number,
): void {
  const { cloth, wave } = ctx.p;
  // Hanging: drifts down-back; flying: streams back with a gravity sag and a travelling ripple.
  const hang = deg(118);
  const fly = deg(172);
  const pts = chain(origin, segs, 2.4, (i) => {
    const t = i / segs;
    const base = lerp(hang, fly, cloth);
    const ripple = Math.sin(wave * 1.6 + phase - i * 0.95) * (0.18 + 0.42 * cloth) * (0.3 + t);
    const sag = (1 - cloth) * t * 0.35 + cloth * t * 0.12;
    return base + ripple - sag * (cloth > 0.5 ? -1 : 1);
  });
  ribbon(layer, pts, width, width * 0.5, M.scarf);
}

function composeLayers(a: Appearance, p: Pose): { canvas: PixelCanvas; mat: Int16Array } {
  const px = RIG.pivotX + p.bodyX;
  const py = RIG.hipY + p.bodyY;
  const T = (x: number, y: number): Pt => pt(px + x + p.lean * (-y / 13), py + y);
  const ctx: Ctx = {
    a,
    p,
    T,
    hx: Math.round(RIG.headX + p.bodyX + p.lean),
    hy: Math.round(RIG.headY + p.bodyY + p.headY),
  };
  const ramps = buildRamps(a);
  const hairDef = HAIR[a.hairStyle];
  const hooded = a.headwear === 'hood';

  // --- Back cloth: scarf tails, capelet, long hair, ponytail, hood tail ---
  const backCloth = L();
  const neckBack = T(-2.6, -15);
  if (a.scarf === 'long') {
    scarfTail(ctx, backCloth, neckBack, 10, 0, 1.7);
    scarfTail(ctx, backCloth, T(-2.2, -14.2), 7, 1.3, 1.4);
  } else if (a.scarf === 'short' || a.scarf === 'mask') {
    scarfTail(ctx, backCloth, neckBack, 5, 0.5, 1.5);
  }
  if (a.capelet) {
    const c = p.cloth;
    const pts: [number, number][] = [
      [-3.6, -16],
      [1.4, -16.2],
      [0, -11],
    ];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push([
        lerp(-1, -8.5 - c * 8, t),
        lerp(-6, -5 - c * 4, t) + Math.sin(p.wave + t * 5) * c * 1.2 + (k % 2) * 1.2,
      ]);
    }
    pts.push([-5.6, -11]);
    poly(ctx, backCloth, pts, M.capelet);
  }
  if (!hooded && a.hairStyle === 'long') {
    const pts = chain(pt(ctx.hx + 1.2, ctx.hy + 3), 6, 2.4, (i) =>
      deg(95 + p.sway * 4 + i * (2 + p.cloth * 6)),
    );
    ribbon(backCloth, pts, 3, 1.6, M.hair);
  }
  if (!hooded && a.hairStyle === 'tied') {
    const pts = chain(pt(ctx.hx - 0.5, ctx.hy + 2.5), 6, 2.2, (i) =>
      deg(200 - i * (16 - p.cloth * 10) - p.sway * 2),
    );
    ribbon(backCloth, pts, 1.9, 1, M.hair);
  }
  if (hooded) {
    const pts = chain(pt(ctx.hx - 2, ctx.hy + 3.5), 3, 2.2, (i) => deg(192 - i * 10 + p.sway * 2));
    ribbon(backCloth, pts, 2, 0.8, M.garment);
  }

  // --- Back limbs ---
  const backArm = L();
  drawArm(ctx, backArm, T(-1.5, -12.5), p.backHand, true);
  const backLeg = L();
  drawLeg(backLeg, T(-1.5, 0), p.backFoot, p.backToe, true);
  const frontLeg = L();
  drawLeg(frontLeg, T(1.5, 0), p.frontFoot, p.frontToe, false);

  // --- Torso & garment body ---
  const torso = L();
  if (a.garment === 'cloak') {
    // Short tunic under the poncho.
    poly(
      ctx,
      torso,
      [
        [-4, -10],
        [3.6, -10],
        [4.2, 6.5],
        [-4.6, 6.5],
      ],
      M.inner,
    );
  }
  poly(
    ctx,
    torso,
    [
      [-2, -15],
      [-4.5, -13],
      [-4.6, -9],
      [-3.6, -3],
      [-4, 0.5],
      [3.2, 0.5],
      [3.2, -3],
      [4.6, -9],
      [3.6, -13],
      [1.6, -15],
    ],
    M.inner,
  );
  if (a.garment === 'longcoat' || a.garment === 'jacket') {
    const hem = a.garment === 'jacket' ? 1.2 : -2;
    poly(
      ctx,
      torso,
      [
        [-2.6, -17],
        [-5.2, -13.4],
        [-5.3, -9],
        [-4.4, -3],
        [-4.6, hem],
        [3.8, hem],
        [3.8, -3],
        [5.1, -9],
        [4.2, -13.4],
        [1.6, -16.2],
      ],
      M.garment,
    );
    // Open front shows the shirt.
    poly(
      ctx,
      torso,
      [
        [1.5, -15.4],
        [3.3, -14],
        [4.3, -9],
        [3.3, -3.4],
        [2.3, -3.4],
        [2.4, -9],
        [1.7, -13],
      ],
      M.inner,
    );
    const beltY = a.garment === 'jacket' ? -0.6 : -3.3;
    poly(
      ctx,
      torso,
      [
        [-4.7, beltY],
        [4, beltY],
        [4, beltY + 1.5],
        [-4.7, beltY + 1.5],
      ],
      M.accent,
    );
    disc(torso, T(2.8, beltY + 0.7), 0.9, M.metal);
  }
  if (a.garment === 'jacket') {
    capsule(torso, T(3, -12.6), T(-4.2, -1.2), 0.75, 0.75, M.leather);
    poly(
      ctx,
      torso,
      [
        [-7, -3.4],
        [-3.6, -3.4],
        [-3.3, 2.6],
        [-7.2, 2.6],
      ],
      M.leather,
    );
    poly(
      ctx,
      torso,
      [
        [-7, -3.4],
        [-3.6, -3.4],
        [-3.7, -1.6],
        [-7, -1.6],
      ],
      M.accent,
    );
  }

  // --- Skirt / poncho (covers the thighs) ---
  const skirt = L();
  const c = p.cloth;
  if (a.garment === 'longcoat') {
    const hemFront: [number, number] = [4.2 + c * 1.5, 12 - c * 2];
    const hemBack: [number, number] = [-5.5 - c * 8, 11 - c * 6];
    const pts: [number, number][] = [[-4.6, -2.2], [3.9, -2.2], hemFront];
    for (let k = 1; k <= 5; k++) {
      const t = k / 6;
      const notch = k === 4 ? -3 : 0;
      pts.push([
        lerp(hemFront[0], hemBack[0], t),
        lerp(hemFront[1], hemBack[1], t) + Math.sin(p.wave + t * 4) * c * 1.3 + notch,
      ]);
    }
    pts.push(hemBack, [-5 - c * 4, 4 - c * 3]);
    poly(ctx, skirt, pts, M.garment);
    capsule(
      skirt,
      T(0.2, -1.4),
      T(lerp(hemFront[0], hemBack[0], 0.3), lerp(hemFront[1], hemBack[1], 0.3) - 1),
      0.45,
      0.45,
      M.fold,
    );
    capsule(
      skirt,
      T(-2.6, -1.4),
      T(lerp(hemFront[0], hemBack[0], 0.72), lerp(hemFront[1], hemBack[1], 0.72) - 1.5),
      0.45,
      0.45,
      M.fold,
    );
  } else if (a.garment === 'cloak') {
    const front: [number, number] = [6.8 + c * 0.6, 4.5 - c];
    const backHem: [number, number] = [-6.8 - c * 8, 4 - c * 5];
    const pts: [number, number][] = [[-2.8, -16.2], [2.3, -16.2], [5.8, -12.4], front];
    for (let k = 1; k <= 6; k++) {
      const t = k / 7;
      const tatter = k % 2 === 0 ? 1.6 : -0.6;
      pts.push([
        lerp(front[0], backHem[0], t),
        lerp(front[1], backHem[1], t) + tatter + Math.sin(p.wave + t * 5) * c * 1.2,
      ]);
    }
    pts.push(backHem, [-6, -12.4]);
    poly(ctx, skirt, pts, M.garment);
    capsule(skirt, T(1, -13), T(2.4, 3), 0.45, 0.45, M.fold);
    capsule(skirt, T(-2.5, -13), T(-4.5 - c * 4, 3 - c * 3), 0.45, 0.45, M.fold);
  }

  // --- Head ---
  const head = L();
  capsule(head, T(0.6, -13.6), T(1.1, -16), 1.7, 1.7, M.skin);
  for (let y = 0; y < HEAD.length; y++) {
    const row = HEAD[y] ?? '';
    for (let x = 0; x < row.length; x++)
      if (row[x] === 's') head.set(ctx.hx + x, ctx.hy + y, M.skin);
  }

  // --- Hair / headwear ---
  const hair = L();
  if (hooded) {
    headPoly(
      ctx,
      hair,
      [
        [-2.6, 8.4],
        [-3, 3],
        [-1.5, -0.6],
        [2, -2.7],
        [6, -2.9],
        [9.5, -1],
        [11.3, 2.4],
        [11.6, 6],
        [10.6, 9.2],
        [8, 10.8],
        [4, 10.8],
        [0, 10.2],
      ],
      M.garment,
    );
    // Face opening with a dark inner rim.
    const fx = ctx.hx + 8.4;
    const fy = ctx.hy + 6;
    for (let y = ctx.hy - 3; y < ctx.hy + 12; y++) {
      for (let x = ctx.hx - 3; x < ctx.hx + 13; x++) {
        const d = ((x + 0.5 - fx) / 2.9) ** 2 + ((y + 0.5 - fy) / 3.9) ** 2;
        if (d <= 1) hair.clear(x, y);
        else if (d <= 1.55 && hair.has(x, y)) hair.set(x, y, M.hoodInner);
      }
    }
  } else {
    headPoly(ctx, hair, hairDef.cap, M.hair);
    for (const [sx, sy, ang, len, r] of hairDef.strands) {
      const segs = 3;
      const pts = chain(pt(ctx.hx + sx, ctx.hy + sy), segs, len / segs, (i) =>
        deg(ang + i * (7 - p.sway * 2) - p.sway * 2),
      );
      ribbon(hair, pts, r, 0.5, M.hair);
    }
    if (a.headwear === 'goggles') {
      headPoly(
        ctx,
        hair,
        [
          [-1.3, 1.5],
          [9.9, 0.4],
          [9.9, 1.8],
          [-1.3, 2.9],
        ],
        M.leather,
      );
      disc(hair, pt(ctx.hx + 6.9, ctx.hy + 1.1), 2, M.metal);
      disc(hair, pt(ctx.hx + 6.9, ctx.hy + 1.1), 1.15, M.lens);
      disc(hair, pt(ctx.hx + 4.2, ctx.hy + 1.4), 1.7, M.metal);
      disc(hair, pt(ctx.hx + 4.2, ctx.hy + 1.4), 0.9, M.lens);
    }
  }

  // --- Scarf wrap / mask ---
  const wrap = L();
  if (a.scarf !== 'none') {
    poly(
      ctx,
      wrap,
      [
        [-3.2, -15.8],
        [2.9, -16],
        [3.7, -13.2],
        [-3.6, -13],
      ],
      M.scarf,
    );
    if (a.scarf === 'long' || a.scarf === 'short') {
      disc(wrap, T(3.3, -13.4), 1.6, M.scarf);
      const endPts = chain(T(3.3, -12.6), 3, 1.8, (i) =>
        deg(lerp(96, 150, p.cloth) + Math.sin(p.wave + i) * 10),
      );
      ribbon(wrap, endPts, 1.3, 0.8, M.scarf);
    }
    if (a.scarf === 'mask') {
      headPoly(
        ctx,
        wrap,
        [
          [4, 6.2],
          [11.3, 5.7],
          [11.5, 8.5],
          [9.6, 10.6],
          [4.5, 10.6],
        ],
        M.scarf,
      );
    }
  }

  // --- Front arm ---
  const frontArm = L();
  drawArm(ctx, frontArm, T(2.5, -12.5), p.frontHand, false);
  const cloaked = a.garment === 'cloak';

  // --- Composite ---
  const layers: { layer: MaskLayer; separate: boolean; post?: (pc: PixelCanvas) => void }[] = [
    { layer: backCloth, separate: false },
    { layer: backArm, separate: false },
    { layer: backLeg, separate: false },
    { layer: frontLeg, separate: true },
    { layer: torso, separate: true },
    ...(cloaked ? [{ layer: frontArm, separate: true }] : []),
    { layer: skirt, separate: true },
    {
      layer: head,
      separate: true,
      post: (pc) => {
        const eyeDark = hex('#1a1220');
        if (!p.blink) {
          pc.set(ctx.hx + 7, ctx.hy + 4, eyeDark);
          pc.set(ctx.hx + 7, ctx.hy + 5, hex(a.eyes));
          pc.set(ctx.hx + 8, ctx.hy + 4, shade(hex(a.skin), -0.25));
        } else {
          pc.set(ctx.hx + 7, ctx.hy + 5, eyeDark);
          pc.set(ctx.hx + 8, ctx.hy + 5, eyeDark);
        }
        pc.set(ctx.hx + 9, ctx.hy + 7, shade(hex(a.skin), -0.3));
        pc.set(ctx.hx + 3, ctx.hy + 5, shade(hex(a.skin), -0.3));
        pc.set(ctx.hx + 3, ctx.hy + 6, shade(hex(a.skin), -0.2));
      },
    },
    {
      layer: hair,
      separate: !hooded,
      post: (pc) => {
        if (!hooded) return;
        // The hood shadows the upper face; only the eyes catch light.
        for (let y = ctx.hy + 2; y < ctx.hy + 6; y++) {
          for (let x = ctx.hx + 5; x < ctx.hx + 12; x++) {
            if (!hair.has(x, y) && head.has(x, y))
              pc.set(x, y, mix(pc.get(x, y), hex('#1a1424'), 0.55));
          }
        }
        pc.set(ctx.hx + 7, ctx.hy + 5, hex(a.eyes));
        pc.set(ctx.hx + 8, ctx.hy + 5, mix(hex(a.eyes), hex('#ffffff'), 0.5));
      },
    },
    { layer: wrap, separate: true },
    ...(cloaked ? [] : [{ layer: frontArm, separate: true }]),
  ];

  const canvas = new PixelCanvas(FRAME_SIZE, FRAME_SIZE);
  const mat = new Int16Array(FRAME_SIZE * FRAME_SIZE).fill(-1);
  for (const { layer, separate, post } of layers) {
    if (separate) {
      for (let y = 0; y < FRAME_SIZE; y++) {
        for (let x = 0; x < FRAME_SIZE; x++) {
          if (layer.has(x, y) || !canvas.isOpaque(x, y)) continue;
          let over = -1;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ] as const) {
            if (layer.has(x + dx, y + dy)) over = layer.get(x + dx, y + dy);
          }
          if (over < 0) continue;
          const under = ramps[mat[y * FRAME_SIZE + x] ?? 0];
          const sameMaterial =
            under && ramps[over] && Math.abs(under.base - (ramps[over] as Ramp).base) < 1;
          canvas.set(x, y, mix(canvas.get(x, y), under?.deep ?? INK, sameMaterial ? 0.45 : 0.75));
        }
      }
    }
    shadeLayerInto(layer, ramps, canvas, mat);
    post?.(canvas);
  }
  return { canvas, mat };
}

/** Key light from the front-top, soft dithered falloff, deep tone in back-bottom corners. */
function shadeLayerInto(layer: MaskLayer, ramps: Ramp[], out: PixelCanvas, mat: Int16Array): void {
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      const m = layer.get(x, y);
      if (m < 0) continue;
      const r = ramps[m];
      if (!r) continue;
      const o = (dx: number, dy: number): boolean => !layer.has(x + dx, y + dy);
      const top = o(0, -1);
      const front = o(1, 0);
      const back = o(-1, 0);
      const bottom = o(0, 1);
      let c = r.base;
      if (top || (front && !bottom)) c = r.light;
      if (bottom || (back && !top)) c = r.shadow;
      if (bottom && back) c = r.deep;
      out.set(x, y, c);
      mat[y * FRAME_SIZE + x] = m;
    }
  }
}

/** Rim light on the back silhouette edge, then a material-tinted (sel-out) outline. */
function finish(canvas: PixelCanvas, mat: Int16Array, a: Appearance): PixelCanvas {
  const ramps = buildRamps(a);
  const rim = hex(a.rim);
  const out = canvas.clone();
  for (let y = 0; y < FRAME_SIZE - 3; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (!canvas.isOpaque(x, y) || canvas.isOpaque(x - 1, y)) continue;
      const r = ramps[mat[y * FRAME_SIZE + x] ?? -1];
      if (r?.rim) out.set(x, y, mix(r.light, rim, 0.6));
    }
  }
  const final = out.clone();
  for (let y = 0; y < FRAME_SIZE; y++) {
    for (let x = 0; x < FRAME_SIZE; x++) {
      if (out.isOpaque(x, y)) continue;
      let m = -1;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        if (out.isOpaque(x + dx, y + dy)) {
          m = mat[(y + dy) * FRAME_SIZE + x + dx] ?? -1;
          break;
        }
      }
      if (
        m < 0 &&
        !(
          out.isOpaque(x + 1, y) ||
          out.isOpaque(x - 1, y) ||
          out.isOpaque(x, y + 1) ||
          out.isOpaque(x, y - 1)
        )
      )
        continue;
      const r = ramps[m];
      final.set(x, y, mix(r?.deep ?? INK, INK, 0.5));
    }
  }
  return final;
}

export function composeCharacterFrame(a: Appearance, p: Pose): PixelCanvas {
  const { canvas, mat } = composeLayers(a, p);
  return finish(canvas, mat, a);
}

export interface SheetFrame {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface CharacterSheet {
  readonly canvas: PixelCanvas;
  readonly frames: readonly SheetFrame[];
  readonly animations: readonly AnimationDef[];
  readonly frameSize: number;
}

/** Full animated sheet: one row per animation, frames named `${anim}_${i}`. */
export function composeCharacterSheet(
  a: Appearance,
  animations: readonly AnimationDef[] = ANIMATIONS,
): CharacterSheet {
  const cols = Math.max(...animations.map((x) => x.frames.length));
  const canvas = new PixelCanvas(cols * FRAME_SIZE, animations.length * FRAME_SIZE);
  const frames: SheetFrame[] = [];
  animations.forEach((anim, row) => {
    anim.frames.forEach((pose, col) => {
      canvas.blit(composeCharacterFrame(a, pose), col * FRAME_SIZE, row * FRAME_SIZE);
      frames.push({
        name: frameName(anim.key, col),
        x: col * FRAME_SIZE,
        y: row * FRAME_SIZE,
        w: FRAME_SIZE,
        h: FRAME_SIZE,
      });
    });
  });
  return { canvas, frames, animations, frameSize: FRAME_SIZE };
}

/** Head-and-shoulders crop of the idle pose for HUD portraits (24×24). */
export function composePortrait(a: Appearance): PixelCanvas {
  const idle = ANIMATIONS[0]?.frames[0];
  if (!idle) throw new Error('No idle pose');
  const frame = composeCharacterFrame(a, idle);
  const out = new PixelCanvas(24, 24);
  out.blitRegion(frame, RIG.headX - 5, RIG.headY - 4, 24, 24, 0, 0);
  return out;
}
