/**
 * Character movement tuning. All values are in world pixels and seconds.
 * These numbers define the "feel" of the game — tune them here, never inline in the motor.
 */
export interface MovementConfig {
  /** Collision box size (px). Feet are at the bottom-center of the box. */
  readonly bodyWidth: number;
  readonly bodyHeight: number;

  readonly runSpeed: number;
  readonly groundAccel: number;
  readonly groundDecel: number;
  /** Acceleration used when input opposes current velocity on the ground (snappy turnarounds). */
  readonly turnAccel: number;
  readonly airAccel: number;
  readonly airDecel: number;

  readonly gravity: number;
  /** Gravity multiplier while falling — makes jumps feel weighty rather than floaty. */
  readonly fallGravityMul: number;
  /** Gravity multiplier near the apex while jump is held — gives a brief, readable hang time. */
  readonly apexGravityMul: number;
  /** |vy| below which the apex multiplier applies. */
  readonly apexThreshold: number;
  readonly jumpVelocity: number;
  /** Upward velocity multiplier applied when jump is released early (variable jump height). */
  readonly jumpCutMul: number;
  readonly maxFallSpeed: number;
  /** Terminal velocity while holding down. */
  readonly fastFallSpeed: number;

  /** Grace period after walking off a ledge during which a jump is still accepted. */
  readonly coyoteTime: number;
  /** A jump pressed this long before landing is executed on landing. */
  readonly jumpBuffer: number;
  /** Max obstacle height climbed automatically while walking (Terraria-style auto step). */
  readonly stepHeight: number;
  /** How long one-way platforms are ignored after a drop-through. */
  readonly dropThroughTime: number;
}

export const DEFAULT_MOVEMENT: MovementConfig = {
  bodyWidth: 14,
  bodyHeight: 38,

  runSpeed: 168,
  groundAccel: 1750,
  groundDecel: 2300,
  turnAccel: 3200,
  airAccel: 1250,
  airDecel: 520,

  gravity: 1500,
  fallGravityMul: 1.4,
  apexGravityMul: 0.55,
  apexThreshold: 60,
  jumpVelocity: 520,
  jumpCutMul: 0.45,
  maxFallSpeed: 600,
  fastFallSpeed: 760,

  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  stepHeight: 16,
  dropThroughTime: 0.22,
};
