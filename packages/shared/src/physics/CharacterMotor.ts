import type { MovementConfig } from '../data/movement';
import { approach, clamp } from '../math/scalar';
import { TILE_SIZE } from '../constants';
import { COLLISION_PLATFORM, type CollisionCode } from '../world/TileRegistry';
import {
  type Body,
  type CollisionGrid,
  groundBelow,
  isRegionSolid,
  sweepX,
  sweepY,
} from './TileCollider';

/** Movement intent for one simulation tick. Produced by player input or by AI controllers. */
export interface MotorInput {
  /** Horizontal intent in [-1, 1]. */
  moveX: number;
  /** Jump button is currently held. */
  jumpHeld: boolean;
  /** Jump button was pressed since the previous tick (edge). */
  jumpPressed: boolean;
  /** Down is held (drop through platforms, fast fall). */
  down: boolean;
}

export const IDLE_INPUT: Readonly<MotorInput> = {
  moveX: 0,
  jumpHeld: false,
  jumpPressed: false,
  down: false,
};

/** Things that happened during the last tick — consumed by animation, audio and FX. */
export interface MotorEvents {
  jumped: boolean;
  landed: boolean;
  /** Downward speed at the moment of landing (px/s). */
  landingSpeed: number;
  /** Vertical snap applied by auto-step this tick (px; positive = moved up). */
  stepped: number;
  droppedThrough: boolean;
  hitCeiling: boolean;
  hitWall: boolean;
}

export interface MotorState extends Body {
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  groundType: CollisionCode;
  coyoteTimer: number;
  jumpBufferTimer: number;
  /** True while rising from a jump and still eligible for a jump cut. */
  jumping: boolean;
  /** One-way platforms are ignored while > 0. */
  dropTimer: number;
  /** Seconds since last grounded. */
  airTime: number;
  readonly events: MotorEvents;
}

export function createMotorState(x: number, y: number, config: MovementConfig): MotorState {
  return {
    x,
    y,
    width: config.bodyWidth,
    height: config.bodyHeight,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    groundType: 0,
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    jumping: false,
    dropTimer: 0,
    airTime: 0,
    events: {
      jumped: false,
      landed: false,
      landingSpeed: 0,
      stepped: 0,
      droppedThrough: false,
      hitCeiling: false,
      hitWall: false,
    },
  };
}

function resetEvents(e: MotorEvents): void {
  e.jumped = false;
  e.landed = false;
  e.landingSpeed = 0;
  e.stepped = 0;
  e.droppedThrough = false;
  e.hitCeiling = false;
  e.hitWall = false;
}

/**
 * Try to climb a low obstacle after horizontal movement was blocked.
 * Returns the height climbed (0 if not possible). Mutates `s` only on success.
 */
function tryStepUp(
  grid: CollisionGrid,
  s: MotorState,
  remainingDx: number,
  maxStep: number,
): number {
  const feetRowTop = Math.floor((s.y - 1e-4) / TILE_SIZE) * TILE_SIZE;
  const lift = s.y - feetRowTop;
  if (lift <= 0 || lift > maxStep) return 0;
  const half = s.width / 2;
  const nx = s.x + Math.sign(remainingDx) * 0.5;
  // Space above must be free at the lifted position.
  if (isRegionSolid(grid, nx - half, s.y - lift - s.height, nx + half, s.y - lift)) return 0;
  const savedX = s.x;
  const savedY = s.y;
  s.y -= lift;
  const moved = sweepX(grid, s, remainingDx);
  if (Math.abs(moved) < 0.01) {
    s.x = savedX;
    s.y = savedY;
    return 0;
  }
  return lift;
}

/**
 * Advance a character body by one fixed tick. Deterministic: same state + input + grid → same
 * result. Used for the local player now, for AI adventurers in PHASE 4, and for server-side
 * movement validation in PHASE 6.
 */
export function stepMotor(
  s: MotorState,
  input: MotorInput,
  grid: CollisionGrid,
  cfg: MovementConfig,
  dt: number,
): MotorState {
  const ev = s.events;
  resetEvents(ev);
  const moveX = clamp(input.moveX, -1, 1);

  // --- Timers ---------------------------------------------------------------------------------
  s.coyoteTimer = s.grounded ? cfg.coyoteTime : Math.max(0, s.coyoteTimer - dt);
  s.jumpBufferTimer = input.jumpPressed ? cfg.jumpBuffer : Math.max(0, s.jumpBufferTimer - dt);
  s.dropTimer = Math.max(0, s.dropTimer - dt);

  // --- Drop through one-way platforms ---------------------------------------------------------
  if (s.grounded && s.groundType === COLLISION_PLATFORM && input.down && s.jumpBufferTimer > 0) {
    s.dropTimer = cfg.dropThroughTime;
    s.jumpBufferTimer = 0;
    s.coyoteTimer = 0;
    s.grounded = false;
    s.groundType = 0;
    ev.droppedThrough = true;
  }

  // --- Horizontal acceleration ----------------------------------------------------------------
  const target = moveX * cfg.runSpeed;
  const opposing = moveX !== 0 && s.vx !== 0 && Math.sign(moveX) !== Math.sign(s.vx);
  let accel: number;
  if (s.grounded)
    accel = moveX === 0 ? cfg.groundDecel : opposing ? cfg.turnAccel : cfg.groundAccel;
  else accel = moveX === 0 ? cfg.airDecel : opposing ? cfg.airAccel * 1.25 : cfg.airAccel;
  s.vx = approach(s.vx, target, accel * dt);
  if (moveX !== 0) s.facing = moveX > 0 ? 1 : -1;

  // --- Jump -----------------------------------------------------------------------------------
  if (s.jumpBufferTimer > 0 && (s.grounded || s.coyoteTimer > 0)) {
    s.vy = -cfg.jumpVelocity;
    s.grounded = false;
    s.groundType = 0;
    s.coyoteTimer = 0;
    s.jumpBufferTimer = 0;
    s.jumping = true;
    ev.jumped = true;
  }
  if (s.jumping && (!input.jumpHeld || s.vy >= 0)) {
    if (s.vy < 0 && !input.jumpHeld) s.vy *= cfg.jumpCutMul;
    s.jumping = false;
  }

  // --- Gravity --------------------------------------------------------------------------------
  if (!s.grounded) {
    let g = cfg.gravity;
    if (s.vy > 0) g *= cfg.fallGravityMul;
    else if (Math.abs(s.vy) < cfg.apexThreshold && input.jumpHeld) g *= cfg.apexGravityMul;
    s.vy = Math.min(s.vy + g * dt, input.down ? cfg.fastFallSpeed : cfg.maxFallSpeed);
    s.airTime += dt;
  } else {
    s.vy = 0;
    s.airTime = 0;
  }

  // --- Horizontal move with auto-step ---------------------------------------------------------
  const dx = s.vx * dt;
  if (dx !== 0) {
    const moved = sweepX(grid, s, dx);
    if (Math.abs(moved - dx) > 1e-6) {
      const climbed = s.grounded ? tryStepUp(grid, s, dx - moved, cfg.stepHeight) : 0;
      if (climbed > 0) {
        ev.stepped = climbed;
      } else {
        s.vx = 0;
        ev.hitWall = true;
      }
    }
  }

  // --- Vertical move --------------------------------------------------------------------------
  const ignorePlatforms = s.dropTimer > 0;
  if (s.grounded) {
    const g = groundBelow(grid, s, ignorePlatforms);
    if (g !== 0) {
      s.groundType = g;
    } else {
      // Walked off an edge: snap down small drops so stairs-like terrain doesn't flicker into
      // the fall animation; otherwise start falling (coyote time is already armed).
      const probe = sweepY(grid, s, cfg.stepHeight, { ignorePlatforms });
      if (probe.hitFloor) {
        s.groundType = probe.floorType;
        ev.stepped = -probe.moved;
      } else {
        s.y -= probe.moved;
        s.grounded = false;
        s.groundType = 0;
      }
    }
  } else {
    const fallSpeed = s.vy;
    const res = sweepY(grid, s, s.vy * dt, { ignorePlatforms });
    if (res.hitFloor && fallSpeed >= 0) {
      s.grounded = true;
      s.groundType = res.floorType;
      s.vy = 0;
      s.jumping = false;
      ev.landed = true;
      ev.landingSpeed = fallSpeed;
    } else if (res.hitCeiling) {
      s.vy = 0;
      s.jumping = false;
      ev.hitCeiling = true;
    }
  }
  return s;
}
