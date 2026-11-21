/**
 * Monster AI brains (finite state machines). Pure game logic — no external AI services.
 *
 * Params (MonsterDef.params):
 * - hopper:  hopMin/hopMax (idle hop interval s), chaseHop (hop interval while chasing)
 * - charger: chargeSpeed (px/s), windup (s), chargeTime (s), daze (s after hitting a wall),
 *            cooldown (s), chargeContact (contact multiplier while charging)
 * - flyer:   orbit (px), swoopSpeed (px/s), swoopEvery (s), swoopTime (s)
 * - caster:  keepMin/keepMax (preferred distance px), castEvery (s), windup (s), blink (px)
 */
import type { CombatWorld, Combatant } from '../combat/CombatWorld';
import { TILE_SIZE } from '../constants';
import type { Rng } from '../math/rng';
import { IDLE_INPUT, type MotorInput } from '../physics/CharacterMotor';
import { type CollisionGrid, isRegionSolid, sweepX, sweepY } from '../physics/TileCollider';
import { COLLISION_NONE } from '../world/TileRegistry';
import { stepGolem } from './golem';
import { type Monster, setAnim } from './Monster';

export type MonsterEvent =
  | { readonly type: 'telegraph'; readonly id: number; readonly kind: string }
  | {
      readonly type: 'blink';
      readonly id: number;
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
    }
  | {
      readonly type: 'impact';
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly power: number;
    }
  | { readonly type: 'phase'; readonly id: number; readonly phase: number }
  | { readonly type: 'marker'; readonly x: number; readonly y: number; readonly delay: number };

export interface BrainContext {
  readonly grid: CollisionGrid;
  readonly combat: CombatWorld;
  readonly target: Combatant | null;
  readonly now: number;
  readonly dt: number;
  readonly rng: Rng;
  readonly events: MonsterEvent[];
}

export interface TargetInfo {
  readonly dx: number;
  readonly dy: number;
  readonly dist: number;
}

export function targetInfo(m: Monster, t: Combatant | null): TargetInfo | null {
  if (!t || !t.alive) return null;
  const dx = t.body.x - m.motor.x;
  const dy = t.body.y - t.body.height / 2 - (m.motor.y - m.motor.height / 2);
  return { dx, dy, dist: Math.hypot(dx, dy) };
}

export function param(m: Monster, key: string, fallback: number): number {
  return m.def.params?.[key] ?? fallback;
}

/** True if a straight line between two points crosses no solid tile (8 px steps). */
export function lineClear(
  grid: CollisionGrid,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d / 8));
  for (let i = 1; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (isRegionSolid(grid, x - 0.5, y - 0.5, x + 0.5, y + 0.5)) return false;
  }
  return true;
}

function groundAhead(grid: CollisionGrid, m: Monster, dir: number): boolean {
  const x = m.motor.x + dir * (m.motor.width / 2 + 3);
  const ty = Math.floor((m.motor.y + 2) / TILE_SIZE);
  const tx = Math.floor(x / TILE_SIZE);
  return (
    grid.collisionAt(tx, ty) !== COLLISION_NONE || grid.collisionAt(tx, ty + 1) !== COLLISION_NONE
  );
}

function wallAhead(grid: CollisionGrid, m: Monster, dir: number): boolean {
  const b = m.motor;
  const x0 = dir > 0 ? b.x + b.width / 2 : b.x - b.width / 2 - 3;
  return isRegionSolid(grid, x0, b.y - b.height, x0 + 3, b.y - 17);
}

function input(moveX: number, extra: Partial<MotorInput> = {}): MotorInput {
  return { ...IDLE_INPUT, moveX, ...extra };
}

// --- Hopper (slimes) ---------------------------------------------------------------------------

function hopper(m: Monster, ctx: BrainContext): MotorInput {
  const b = m.brain;
  const t = targetInfo(m, ctx.target);
  const aggro = m.def.aggroRange * TILE_SIZE;
  const chasing = t !== null && t.dist < aggro && Math.abs(t.dy) < 10 * TILE_SIZE;
  b.timer -= ctx.dt;
  if (!m.motor.grounded) {
    setAnim(m, m.motor.vy < 0 ? 'jump' : 'fall');
    return input(b.dir, { jumpHeld: true });
  }
  if (m.motor.events.landed) setAnim(m, 'land');
  else if (m.anim !== 'land' || m.animTime > 0.18) setAnim(m, b.timer < 0.2 ? 'windup' : 'idle');
  if (b.timer > 0) return input(0);
  if (!chasing && ctx.rng.chance(0.3)) {
    b.timer = ctx.rng.range(param(m, 'hopMin', 0.8), param(m, 'hopMax', 1.6));
    return input(0);
  }
  b.dir = chasing && t ? Math.sign(t.dx) || 1 : ctx.rng.sign();
  if (!chasing && wallAhead(ctx.grid, m, b.dir) && ctx.rng.chance(0.5)) b.dir = -b.dir;
  b.timer = chasing
    ? param(m, 'chaseHop', 0.55) + ctx.rng.range(0, 0.35)
    : ctx.rng.range(param(m, 'hopMin', 0.8), param(m, 'hopMax', 1.6));
  const jumpMul = chasing && t && t.dy < -2 * TILE_SIZE ? 1.3 : chasing ? 1 : 0.8;
  m.facing = b.dir > 0 ? 1 : -1;
  return input(b.dir, { jumpHeld: true, jumpPressed: true, jumpMul });
}

// --- Charger (beetles) -------------------------------------------------------------------------

function charger(m: Monster, ctx: BrainContext): MotorInput {
  const b = m.brain;
  const t = targetInfo(m, ctx.target);
  const aggro = m.def.aggroRange * TILE_SIZE;
  const speed = m.def.speed;
  b.timer -= ctx.dt;
  m.contact = m.def.contact;
  m.vulnerable = 1;
  switch (b.mode) {
    case 'windup': {
      setAnim(m, 'windup');
      if (b.timer <= 0) {
        b.mode = 'charge';
        b.timer = param(m, 'chargeTime', 1.3);
        setAnim(m, 'charge');
      }
      return input(0);
    }
    case 'charge': {
      m.contact = param(m, 'chargeContact', 1.6);
      setAnim(m, 'charge');
      if (m.motor.events.hitWall || wallAhead(ctx.grid, m, b.dir)) {
        b.mode = 'daze';
        b.timer = param(m, 'daze', 1.1);
        ctx.events.push({
          type: 'impact',
          id: m.id,
          x: m.motor.x + b.dir * m.motor.width * 0.5,
          y: m.motor.y - 8,
          power: 0.6,
        });
        m.motor.vx = -b.dir * 60;
        return input(0);
      }
      if (b.timer <= 0 || !groundAhead(ctx.grid, m, b.dir)) {
        b.mode = 'rest';
        b.timer = param(m, 'cooldown', 1.6);
        return input(0);
      }
      return input(b.dir, { speedMul: param(m, 'chargeSpeed', 240) / speed });
    }
    case 'daze':
      setAnim(m, 'daze');
      m.vulnerable = 1.3;
      if (b.timer <= 0) {
        b.mode = 'patrol';
        b.timer = 1;
      }
      return input(0);
    case 'rest':
      setAnim(m, 'idle');
      if (b.timer <= 0) b.mode = 'patrol';
      return input(0);
    default: {
      b.mode = 'patrol';
      if (t && t.dist < aggro) {
        const aligned = Math.abs(t.dy) < 26 && Math.abs(t.dx) > 20;
        const eye = m.motor.y - m.motor.height / 2;
        if (
          aligned &&
          b.timer <= 0 &&
          lineClear(ctx.grid, m.motor.x, eye, m.motor.x + t.dx, eye + t.dy)
        ) {
          b.dir = Math.sign(t.dx) || 1;
          m.facing = b.dir > 0 ? 1 : -1;
          b.mode = 'windup';
          b.timer = param(m, 'windup', 0.6);
          ctx.events.push({ type: 'telegraph', id: m.id, kind: 'charge' });
          return input(0);
        }
        b.dir = Math.sign(t.dx) || b.dir;
      } else if (b.timer <= 0) {
        b.timer = ctx.rng.range(1.5, 4);
        if (ctx.rng.chance(0.35)) b.dir = -b.dir;
      }
      if (wallAhead(ctx.grid, m, b.dir) || !groundAhead(ctx.grid, m, b.dir)) b.dir = -b.dir;
      m.facing = b.dir > 0 ? 1 : -1;
      setAnim(m, 'move');
      return input(b.dir);
    }
  }
}

// --- Free movement for flyers ------------------------------------------------------------------

function steer(
  m: Monster,
  ctx: BrainContext,
  tx: number,
  ty: number,
  speed: number,
  accel: number,
): void {
  const b = m.motor;
  const cx = b.x;
  const cy = b.y - b.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  const d = Math.hypot(dx, dy);
  const s = d < 12 ? (speed * d) / 12 : speed;
  const wantX = d > 0.01 ? (dx / d) * s : 0;
  const wantY = d > 0.01 ? (dy / d) * s : 0;
  const k = Math.min(1, ctx.dt * accel);
  b.vx += (wantX - b.vx) * k;
  b.vy += (wantY - b.vy) * k;
}

export function moveFlyer(m: Monster, ctx: BrainContext): void {
  const b = m.motor;
  const dt = ctx.dt;
  if (m.def.ghost) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    return;
  }
  const mx = sweepX(ctx.grid, b, b.vx * dt);
  if (Math.abs(mx - b.vx * dt) > 1e-4) b.vx = -b.vx * 0.5;
  const res = sweepY(ctx.grid, b, b.vy * dt, { ignorePlatforms: true });
  if (res.hitFloor || res.hitCeiling) b.vy = -b.vy * 0.5;
  b.grounded = false;
}

// --- Flyer (bats) ------------------------------------------------------------------------------

function flyer(m: Monster, ctx: BrainContext): void {
  const b = m.brain;
  const body = m.motor;
  const t = targetInfo(m, ctx.target);
  const aggro = m.def.aggroRange * TILE_SIZE;
  const speed = m.def.speed;
  const now = ctx.now;
  b.timer -= ctx.dt;
  if (now < m.staggerUntil) {
    body.vx *= 0.92;
    body.vy *= 0.92;
    setAnim(m, 'hurt');
    return;
  }
  const cx = body.x;
  const cy = body.y - body.height / 2;
  const sees = t !== null && t.dist < aggro && lineClear(ctx.grid, cx, cy, cx + t.dx, cy + t.dy);
  switch (b.mode) {
    case 'swoop': {
      setAnim(m, 'swoop');
      steer(m, ctx, b.ax, b.ay, param(m, 'swoopSpeed', 300), 9);
      if (b.timer <= 0 || Math.hypot(b.ax - cx, b.ay - cy) < 6) {
        b.mode = 'retreat';
        b.timer = 0.6;
      }
      return;
    }
    case 'retreat':
      setAnim(m, 'fly');
      steer(m, ctx, cx - Math.sign(body.vx || 1) * 30, cy - 60, speed, 4);
      if (b.timer <= 0) {
        b.mode = sees ? 'orbit' : 'wander';
        b.timer = param(m, 'swoopEvery', 2.2) * ctx.rng.range(0.7, 1.3);
      }
      return;
    case 'orbit': {
      setAnim(m, 'fly');
      if (!t || t.dist > aggro * 1.6) {
        b.mode = 'wander';
        b.homeX = cx;
        b.homeY = cy;
        return;
      }
      b.dir += ctx.dt * 1.6;
      const r = param(m, 'orbit', 54);
      const px = cx + t.dx;
      const py = cy + t.dy;
      steer(
        m,
        ctx,
        px + Math.cos(b.dir) * r,
        py - 26 - Math.abs(Math.sin(b.dir)) * r * 0.5,
        speed,
        3.5,
      );
      if (b.timer <= 0 && sees) {
        b.mode = 'swoop';
        b.timer = param(m, 'swoopTime', 0.55);
        b.ax = px;
        b.ay = py;
        ctx.events.push({ type: 'telegraph', id: m.id, kind: 'swoop' });
      }
      return;
    }
    default: {
      b.mode = 'wander';
      setAnim(m, 'fly');
      const k = now + m.seed * 0.001;
      steer(
        m,
        ctx,
        b.homeX + Math.sin(k * 0.7) * 48,
        b.homeY + Math.sin(k * 1.9) * 14,
        speed * 0.5,
        2,
      );
      if (sees) {
        b.mode = 'orbit';
        b.timer = param(m, 'swoopEvery', 2.2) * ctx.rng.range(0.5, 1);
      }
    }
  }
}

// --- Caster (wisps) ----------------------------------------------------------------------------

function caster(m: Monster, ctx: BrainContext): void {
  const b = m.brain;
  const body = m.motor;
  const t = targetInfo(m, ctx.target);
  const aggro = m.def.aggroRange * TILE_SIZE;
  const now = ctx.now;
  const cx = body.x;
  const cy = body.y - body.height / 2;
  b.timer -= ctx.dt;

  // Blink away when struck (sometimes).
  if (m.lastHitAt === now && ctx.rng.chance(0.35)) {
    const ang = ctx.rng.range(0, Math.PI * 2);
    const d = param(m, 'blink', 70);
    const toX = body.x + Math.cos(ang) * d;
    const toY = body.y + Math.sin(ang) * d * 0.6;
    ctx.events.push({ type: 'blink', id: m.id, fromX: body.x, fromY: body.y, toX, toY });
    body.x = toX;
    body.y = toY;
    body.vx = 0;
    body.vy = 0;
    m.prevX = toX;
    m.prevY = toY;
    if (b.mode === 'windup') b.mode = 'drift';
    return;
  }
  if (now < m.staggerUntil) {
    body.vx *= 0.9;
    body.vy *= 0.9;
    setAnim(m, 'hurt');
    return;
  }
  const bob = Math.sin(now * 2.3 + m.seed) * 10;
  if (!t || t.dist > aggro) {
    setAnim(m, 'idle');
    steer(
      m,
      ctx,
      b.homeX + Math.sin(now * 0.4 + m.seed) * 40,
      b.homeY + bob,
      m.def.speed * 0.4,
      1.5,
    );
    b.mode = 'drift';
    b.timer = Math.max(b.timer, 1);
    return;
  }
  // Hold a comfortable distance on the same side, a little above the target.
  const keepMin = param(m, 'keepMin', 90);
  const keepMax = param(m, 'keepMax', 150);
  const px = cx + t.dx;
  const py = cy + t.dy;
  const side = t.dx > 0 ? -1 : 1;
  const want = Math.max(keepMin, Math.min(keepMax, Math.abs(t.dx)));
  steer(m, ctx, px + side * want, py - 34 + bob, m.def.speed, 1.8);
  m.facing = t.dx >= 0 ? 1 : -1;
  if (b.mode === 'windup') {
    setAnim(m, 'windup');
    body.vx *= 0.9;
    body.vy *= 0.9;
    if (b.timer <= 0) {
      b.mode = 'drift';
      b.timer = param(m, 'castEvery', 2.6) * ctx.rng.range(0.8, 1.2);
      const ang = Math.atan2(t.dy, t.dx);
      ctx.combat.spawnProjectile(
        { owner: m, power: m.stats.attack, multiplier: 1, tag: m.def.shot ?? 'wisp_fire' },
        m.def.shot ?? 'wisp_fire',
        cx + Math.cos(ang) * 8,
        cy + Math.sin(ang) * 8,
        ang,
        { damage: 1, knockback: 160, lift: 130, stun: 0.3, hitstop: 0.03, status: m.def.hitStatus },
      );
      setAnim(m, 'attack');
    }
    return;
  }
  if (m.anim !== 'attack' || m.animTime > 0.3) setAnim(m, 'idle');
  if (b.timer <= 0 && t.dist < aggro * 0.9) {
    b.mode = 'windup';
    b.timer = param(m, 'windup', 0.6);
    ctx.events.push({ type: 'telegraph', id: m.id, kind: 'cast' });
  }
}

/**
 * Run one tick of a monster's brain. Ground monsters return motor input; flyers and the boss's
 * special moves set velocities directly and return null for "already moved".
 */
export function stepBrain(m: Monster, ctx: BrainContext): MotorInput | null {
  if (m.statuses.stunned(ctx.now)) {
    setAnim(m, 'stunned');
    if (m.def.flying) {
      m.motor.vx *= 0.9;
      m.motor.vy *= 0.9;
      moveFlyer(m, ctx);
      return null;
    }
    return input(0);
  }
  switch (m.def.ai) {
    case 'hopper':
      if (ctx.now < m.staggerUntil) {
        setAnim(m, 'hurt');
        return input(0);
      }
      return hopper(m, ctx);
    case 'charger':
      if (ctx.now < m.staggerUntil && m.brain.mode !== 'charge') {
        setAnim(m, 'hurt');
        if (m.brain.mode === 'windup') m.brain.mode = 'patrol';
        return input(0);
      }
      return charger(m, ctx);
    case 'flyer':
      flyer(m, ctx);
      moveFlyer(m, ctx);
      return null;
    case 'caster':
      caster(m, ctx);
      moveFlyer(m, ctx);
      return null;
    case 'golem':
      return stepGolem(m, ctx);
  }
}
