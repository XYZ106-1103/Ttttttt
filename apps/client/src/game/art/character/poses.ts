/**
 * Animation pose tables. A pose positions the body parts; the composer rasterizes it.
 * All coordinates are in a 48×48 frame for a character facing RIGHT (facing left = flipX).
 *
 * Adding an animation (attack, hit, death, job-specific moves in PHASE 3) means adding a pose
 * list here — no new art files.
 */

export interface Vec {
  readonly x: number;
  readonly y: number;
}

export interface Pose {
  /** Torso + head + hips offset (body bob). */
  readonly bodyX: number;
  readonly bodyY: number;
  /** Torso top shear in px (positive leans forward). */
  readonly lean: number;
  /** Extra head offset relative to the torso. */
  readonly headY: number;
  /** Ankle positions in absolute frame coordinates. */
  readonly frontFoot: Vec;
  readonly backFoot: Vec;
  /** Hand positions relative to the respective shoulder. */
  readonly frontHand: Vec;
  readonly backHand: Vec;
  /** Back hair / scarf streaming backwards (px). */
  readonly sway: number;
  /** Scarf tail: 0 hangs down, 1 flies horizontally. */
  readonly scarfLift: number;
  /** Scarf wave phase (radians). */
  readonly wave: number;
  readonly blink: boolean;
}

export interface AnimationDef {
  readonly key: string;
  readonly frames: readonly Pose[];
  readonly frameRate: number;
  /** -1 loops forever. */
  readonly repeat: number;
}

export const FRAME_SIZE = 48;
export const RIG = {
  hipY: 34,
  frontHipX: 25,
  backHipX: 22,
  groundAnkleY: 44,
  shoulderY: 26,
  frontShoulderX: 27,
  backShoulderX: 20,
  headX: 16,
  headY: 8,
  torsoX: 19,
  torsoY: 23,
  thigh: 6,
  shin: 5,
  upperArm: 4,
  forearm: 4,
} as const;

const v = (x: number, y: number): Vec => ({ x, y });

const BASE: Pose = {
  bodyX: 0,
  bodyY: 0,
  lean: 0,
  headY: 0,
  frontFoot: v(26, RIG.groundAnkleY),
  backFoot: v(21, RIG.groundAnkleY),
  frontHand: v(1, 7),
  backHand: v(-1, 7),
  sway: 0,
  scarfLift: 0.1,
  wave: 0,
  blink: false,
};

function pose(p: Partial<Pose>): Pose {
  return { ...BASE, ...p };
}

function idle(): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < 8; i++) {
    const breathe = i >= 3 && i <= 6 ? 1 : 0;
    out.push(
      pose({
        bodyY: breathe,
        frontHand: v(1, 7 - breathe * 0),
        backHand: v(-1, 7),
        sway: breathe * 0.5,
        scarfLift: 0.12,
        wave: (i / 8) * Math.PI * 2,
        blink: i === 6,
      }),
    );
  }
  return out;
}

/** Foot offset along a run cycle (phase in [0,1)). Stance pushes back, swing arcs forward. */
function runFoot(phase: number): Vec {
  const p = ((phase % 1) + 1) % 1;
  const stride = 6;
  if (p < 0.42) {
    const t = p / 0.42;
    return v(stride - 2 * stride * t, 0);
  }
  const t = (p - 0.42) / 0.58;
  const ease = t * t * (3 - 2 * t);
  return v(-stride + 2 * stride * ease, -Math.sin(Math.PI * t) * 5);
}

function run(): Pose[] {
  const out: Pose[] = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const ph = i / n;
    const f = runFoot(ph);
    const b = runFoot(ph + 0.5);
    const bob = Math.cos(4 * Math.PI * (ph - 0.2));
    out.push(
      pose({
        bodyY: Math.round(bob),
        lean: 1,
        frontFoot: v(Math.round(RIG.frontHipX + f.x), Math.round(RIG.groundAnkleY + f.y)),
        backFoot: v(Math.round(RIG.backHipX + b.x), Math.round(RIG.groundAnkleY + b.y)),
        frontHand: v(Math.round(-f.x * 0.6) + 1, Math.round(6 - Math.abs(f.x) * 0.15)),
        backHand: v(Math.round(-b.x * 0.6) - 1, Math.round(6 - Math.abs(b.x) * 0.15)),
        sway: 2 + Math.max(0, bob),
        scarfLift: 0.95,
        wave: ph * Math.PI * 4,
      }),
    );
  }
  return out;
}

export const ANIMATIONS: readonly AnimationDef[] = [
  { key: 'idle', frames: idle(), frameRate: 5, repeat: -1 },
  { key: 'run', frames: run(), frameRate: 14, repeat: -1 },
  {
    key: 'jump',
    frames: [
      pose({
        bodyY: 2,
        frontFoot: v(27, 44),
        backFoot: v(20, 44),
        frontHand: v(2, 5),
        backHand: v(-3, 5),
        scarfLift: 0.4,
      }),
      pose({
        bodyY: -1,
        frontFoot: v(29, 40),
        backFoot: v(21, 44),
        frontHand: v(3, -4),
        backHand: v(-4, -2),
        sway: 1,
        scarfLift: 0.55,
        wave: 1,
      }),
    ],
    frameRate: 16,
    repeat: 0,
  },
  {
    key: 'apex',
    frames: [
      pose({
        bodyY: -1,
        frontFoot: v(28, 41),
        backFoot: v(22, 43),
        frontHand: v(4, 0),
        backHand: v(-4, 1),
        sway: 0,
        scarfLift: 0.35,
        wave: 2,
      }),
    ],
    frameRate: 1,
    repeat: 0,
  },
  {
    key: 'fall',
    frames: [
      pose({
        bodyY: 0,
        frontFoot: v(27, 43),
        backFoot: v(21, 42),
        frontHand: v(4, -4),
        backHand: v(-4, -5),
        sway: -1,
        scarfLift: 0.25,
        wave: 0,
      }),
      pose({
        bodyY: 0,
        frontFoot: v(27, 44),
        backFoot: v(22, 43),
        frontHand: v(5, -3),
        backHand: v(-3, -5),
        sway: -1,
        scarfLift: 0.3,
        wave: 1.5,
      }),
    ],
    frameRate: 10,
    repeat: -1,
  },
  {
    key: 'land',
    frames: [
      pose({
        bodyY: 3,
        frontFoot: v(28, 44),
        backFoot: v(20, 44),
        frontHand: v(3, 4),
        backHand: v(-3, 4),
        scarfLift: 0.2,
      }),
      pose({
        bodyY: 1,
        frontFoot: v(27, 44),
        backFoot: v(21, 44),
        frontHand: v(2, 6),
        backHand: v(-2, 6),
        scarfLift: 0.15,
      }),
    ],
    frameRate: 14,
    repeat: 0,
  },
  {
    key: 'skid',
    frames: [
      pose({
        bodyY: 1,
        lean: -1,
        frontFoot: v(31, 44),
        backFoot: v(22, 44),
        frontHand: v(-1, 5),
        backHand: v(-4, 4),
        sway: 3,
        scarfLift: 0.9,
        wave: 0.7,
      }),
    ],
    frameRate: 1,
    repeat: 0,
  },
];

export function frameName(anim: string, index: number): string {
  return `${anim}_${index}`;
}
