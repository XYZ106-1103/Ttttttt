import { type AnimationDef, type Pose, RIG } from './rig';
import { pt } from './shapes';

const BASE: Pose = {
  bodyX: 0,
  bodyY: 0,
  lean: 0,
  headY: 0,
  frontFoot: pt(35, RIG.ankleY),
  backFoot: pt(29, RIG.ankleY),
  frontToe: 0,
  backToe: 0,
  frontHand: pt(3, 13.5),
  backHand: pt(-2, 13.5),
  cloth: 0.12,
  wave: 0,
  sway: 0,
  blink: false,
};

const pose = (p: Partial<Pose>): Pose => ({ ...BASE, ...p });

function idle(): Pose[] {
  const out: Pose[] = [];
  for (let i = 0; i < 8; i++) {
    const breathe = i >= 3 && i <= 6 ? 1 : 0;
    out.push(
      pose({
        bodyY: breathe,
        frontHand: pt(3, 13.5 - breathe * 0.5),
        backHand: pt(-2, 13.5 - breathe * 0.5),
        cloth: 0.34 + 0.06 * Math.sin((i / 8) * Math.PI * 2),
        wave: (i / 8) * Math.PI * 2,
        sway: 0.5 + breathe * 0.5,
        blink: i === 6,
      }),
    );
  }
  return out;
}

/** Ankle offset along a run cycle: short ground contact, long swing (flight phase). */
function runFoot(phase: number): { x: number; y: number; toe: number } {
  const p = ((phase % 1) + 1) % 1;
  const stride = 8;
  if (p < 0.38) {
    const t = p / 0.38;
    return { x: stride - 2 * stride * t, y: 0, toe: t > 0.7 ? (t - 0.7) * 90 : 0 };
  }
  const t = (p - 0.38) / 0.62;
  const ease = t * t * (3 - 2 * t);
  const lift = Math.sin(Math.PI * t) * 7 + (t < 0.4 ? t * 6 : 0);
  return { x: -stride + 2 * stride * ease, y: -lift, toe: t < 0.5 ? 50 - t * 60 : -12 };
}

function run(): Pose[] {
  const out: Pose[] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const ph = i / n;
    const f = runFoot(ph);
    const b = runFoot(ph + 0.5);
    const bob = Math.cos(4 * Math.PI * (ph - 0.19));
    const swing = Math.cos(2 * Math.PI * ph);
    out.push(
      pose({
        bodyY: Math.round(bob * 1.2),
        lean: 3,
        headY: 0,
        frontFoot: pt(Math.round(RIG.frontHipX + 1 + f.x), Math.round(RIG.ankleY + f.y)),
        backFoot: pt(Math.round(RIG.backHipX + 1 + b.x), Math.round(RIG.ankleY + b.y)),
        frontToe: f.toe,
        backToe: b.toe,
        // Arms pump with bent elbows, opposite to the legs.
        frontHand: pt(-swing * 6 + 2, 10 - Math.abs(swing) * 1.5),
        backHand: pt(swing * 6 - 1, 10 - Math.abs(swing) * 1.5),
        cloth: 0.95,
        wave: ph * Math.PI * 4,
        sway: 3 + Math.max(0, bob),
      }),
    );
  }
  return out;
}

export const ANIMATIONS: readonly AnimationDef[] = [
  { key: 'idle', frames: idle(), frameRate: 6, repeat: -1 },
  { key: 'run', frames: run(), frameRate: 16, repeat: -1 },
  {
    key: 'jump',
    frames: [
      pose({
        bodyY: 3,
        lean: 2,
        frontFoot: pt(37, 59),
        backFoot: pt(28, 59),
        backToe: 30,
        frontHand: pt(4, 9),
        backHand: pt(-5, 10),
        cloth: 0.4,
      }),
      pose({
        bodyY: -2,
        lean: 1,
        frontFoot: pt(38, 51),
        backFoot: pt(29, 59),
        frontToe: -10,
        backToe: 45,
        frontHand: pt(5, -6),
        backHand: pt(-6, 4),
        cloth: 0.2,
        wave: 1,
        sway: -1,
      }),
    ],
    frameRate: 16,
    repeat: 0,
  },
  {
    key: 'apex',
    frames: [
      pose({
        bodyY: -2,
        frontFoot: pt(37, 53),
        backFoot: pt(30, 57),
        frontToe: 10,
        backToe: 30,
        frontHand: pt(7, 2),
        backHand: pt(-7, 4),
        cloth: 0.05,
        wave: 2,
        sway: -2,
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
        frontFoot: pt(36, 57),
        backFoot: pt(29, 55),
        frontToe: 20,
        backToe: 35,
        frontHand: pt(7, -4),
        backHand: pt(-6, -6),
        cloth: 0,
        wave: 0,
        sway: -3,
      }),
      pose({
        bodyY: 0,
        frontFoot: pt(36, 58),
        backFoot: pt(30, 56),
        frontToe: 15,
        backToe: 30,
        frontHand: pt(8, -2),
        backHand: pt(-5, -7),
        cloth: 0,
        wave: 1.6,
        sway: -3,
      }),
    ],
    frameRate: 10,
    repeat: -1,
  },
  {
    key: 'land',
    frames: [
      pose({
        bodyY: 5,
        lean: 3,
        frontFoot: pt(38, 59),
        backFoot: pt(27, 59),
        backToe: 25,
        frontHand: pt(5, 8),
        backHand: pt(-4, 9),
        cloth: 0.3,
      }),
      pose({
        bodyY: 2,
        lean: 1,
        frontFoot: pt(36, 59),
        backFoot: pt(28, 59),
        frontHand: pt(3, 11),
        backHand: pt(-2, 12),
        cloth: 0.2,
      }),
    ],
    frameRate: 14,
    repeat: 0,
  },
  {
    key: 'skid',
    frames: [
      pose({
        bodyY: 2,
        lean: -2,
        frontFoot: pt(41, 59),
        backFoot: pt(30, 59),
        frontToe: -15,
        frontHand: pt(-2, 9),
        backHand: pt(-6, 8),
        cloth: 0.9,
        wave: 0.7,
        sway: 4,
      }),
    ],
    frameRate: 1,
    repeat: 0,
  },
];

// --- Combat poses (PHASE 3) -----------------------------------------------------------------

export const COMBAT_ANIMATIONS: readonly AnimationDef[] = [
  {
    key: 'hurt',
    frames: [
      pose({
        bodyY: 2,
        lean: -3,
        headY: 1,
        frontFoot: pt(38, 59),
        backFoot: pt(27, 59),
        backToe: 20,
        frontHand: pt(6, 1),
        backHand: pt(-7, 2),
        cloth: 0.7,
        wave: 2.2,
        sway: -3,
        blink: true,
      }),
    ],
    frameRate: 1,
    repeat: 0,
  },
  {
    key: 'dodge',
    frames: [
      pose({
        bodyY: 6,
        lean: 6,
        headY: 1,
        frontFoot: pt(41, 58),
        backFoot: pt(23, 58),
        frontToe: -10,
        backToe: 45,
        frontHand: pt(-5, 9),
        backHand: pt(-9, 7),
        cloth: 1,
        wave: 1,
        sway: 5,
      }),
      pose({
        bodyY: 7,
        lean: 7,
        headY: 1,
        frontFoot: pt(39, 58),
        backFoot: pt(25, 57),
        frontToe: -5,
        backToe: 50,
        frontHand: pt(-6, 10),
        backHand: pt(-10, 8),
        cloth: 1,
        wave: 2.5,
        sway: 6,
      }),
    ],
    frameRate: 12,
    repeat: -1,
  },
  {
    key: 'dead',
    frames: [
      pose({
        bodyY: 6,
        lean: 3,
        headY: 2,
        frontFoot: pt(39, 59),
        backFoot: pt(27, 59),
        frontHand: pt(3, 15),
        backHand: pt(-1, 15),
        cloth: 0.2,
        blink: true,
      }),
      pose({
        bodyY: 10,
        lean: 5,
        headY: 3,
        frontFoot: pt(41, 59),
        backFoot: pt(25, 58),
        backToe: 60,
        frontHand: pt(5, 17),
        backHand: pt(1, 17),
        cloth: 0.1,
        blink: true,
      }),
    ],
    frameRate: 8,
    repeat: 0,
  },
];

export function frameName(anim: string, index: number): string {
  return `${anim}_${index}`;
}
