import type { Pt } from './shapes';

/**
 * Character rig: 64×64 frames, ~50 px tall character (≈5.5 heads) with realistic proportions.
 * All coordinates are for a character facing RIGHT; feet soles rest on row 63.
 */
export const FRAME_SIZE = 64;

export const RIG = {
  ankleY: 59,
  hipY: 38,
  frontHipX: 33,
  backHipX: 30,
  thigh: 11,
  shin: 10,
  shoulderY: 25,
  frontShoulderX: 34,
  backShoulderX: 30,
  upperArm: 8,
  forearm: 8,
  /** Head template top-left. */
  headX: 29,
  headY: 12,
  /** Hip center used as the torso pivot. */
  pivotX: 31.5,
} as const;

export interface Pose {
  readonly bodyX: number;
  readonly bodyY: number;
  /** Torso shear at shoulder height (px forward). */
  readonly lean: number;
  readonly headY: number;
  readonly frontFoot: Pt;
  readonly backFoot: Pt;
  /** Toe angle in degrees (+ points the toe down). */
  readonly frontToe: number;
  readonly backToe: number;
  /** Hands relative to the shoulders. */
  readonly frontHand: Pt;
  readonly backHand: Pt;
  /** Cloth state: 0 hangs, 1 streams fully behind. */
  readonly cloth: number;
  /** Cloth wave phase (radians). */
  readonly wave: number;
  /** Hair streaming backwards (px). */
  readonly sway: number;
  readonly blink: boolean;
}

export interface AnimationDef {
  readonly key: string;
  readonly frames: readonly Pose[];
  readonly frameRate: number;
  readonly repeat: number;
}
