/**
 * Corestone Golem — the PHASE 3 boss. Telegraphed patterns with punish windows:
 * - slam:     arms raised (telegraph) → ground slam + shockwaves both ways → long recovery
 *             (takes extra damage).
 * - barrage:  lobs boulders on ballistic arcs at the player's position.
 * - charge:   stomps, then charges; hitting a wall stuns it (big punish window).
 * - quake:    (enraged only) marks the ground under the player, then rocks fall from above.
 * Below `enrageAt` HP it roars, enters phase 2 and everything speeds up.
 */
import { TILE_SIZE } from '../constants';
import { IDLE_INPUT, type MotorInput } from '../physics/CharacterMotor';
import { isRegionSolid } from '../physics/TileCollider';
import { COLLISION_NONE } from '../world/TileRegistry';
import type { BrainContext } from './brains';
import { type Monster, setAnim } from './Monster';

const BOULDER_GRAVITY = 900;

/** Launch speed that comfortably reaches a target `dx` away (rising `rise` px). */
function boulderSpeed(dx: number, rise: number): number {
  return Math.max(
    280,
    Math.min(600, Math.sqrt(BOULDER_GRAVITY * (Math.abs(dx) + Math.max(0, rise)) * 1.15)),
  );
}

function p(m: Monster, key: string, fallback: number): number {
  return m.def.params?.[key] ?? fallback;
}

function idle(): MotorInput {
  return { ...IDLE_INPUT };
}

/** Low-arc launch angle (screen space, y down) to hit (dx, dy) at speed v; null if out of range. */
export function ballisticAngle(dx: number, dy: number, v: number, g: number): number | null {
  const x = Math.abs(dx);
  const y = -dy; // y up
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0 || x < 1) return null;
  const theta = Math.atan((v2 - Math.sqrt(disc)) / (g * x));
  const vx = Math.cos(theta) * Math.sign(dx || 1);
  const vy = -Math.sin(theta);
  return Math.atan2(vy, vx);
}

function ceilingAbove(ctx: BrainContext, x: number, y: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  let ty = Math.floor(y / TILE_SIZE);
  for (let i = 0; i < 14; i++, ty--) {
    if (ctx.grid.collisionAt(tx, ty - 1) !== COLLISION_NONE) return ty * TILE_SIZE + 4;
  }
  return y - 14 * TILE_SIZE;
}

function groundUnder(ctx: BrainContext, x: number, y: number): number {
  const tx = Math.floor(x / TILE_SIZE);
  const ty0 = Math.floor(y / TILE_SIZE);
  for (let ty = ty0; ty < ty0 + 12; ty++) {
    if (ctx.grid.collisionAt(tx, ty) !== COLLISION_NONE) return ty * TILE_SIZE;
  }
  return y;
}

function choosePattern(m: Monster, ctx: BrainContext, dist: number): string {
  const enraged = m.brain.phase > 0;
  const options: [string, number][] =
    dist < 84
      ? [
          ['slam', 3],
          ['barrage', 1],
        ]
      : dist < 220
        ? [
            ['slam', 1],
            ['barrage', 2],
            ['charge', 2],
          ]
        : [
            ['charge', 3],
            ['barrage', 2],
          ];
  if (enraged && m.brain.count % 3 === 2) options.push(['quake', 4]);
  let total = 0;
  for (const [, w] of options) total += w;
  let r = ctx.rng.next() * total;
  for (const [id, w] of options) {
    r -= w;
    if (r <= 0) return id;
  }
  return options[0]?.[0] ?? 'slam';
}

export function stepGolem(m: Monster, ctx: BrainContext): MotorInput {
  const b = m.brain;
  const body = m.motor;
  const t = ctx.target && ctx.target.alive ? ctx.target : null;
  const enraged = b.phase > 0;
  const tempo = enraged ? 0.78 : 1;
  b.timer -= ctx.dt;
  m.contact = m.def.contact;
  if (b.mode !== 'slam_recover' && b.mode !== 'stunned') m.vulnerable = 1;

  if (b.phase === 0 && m.hp / m.stats.maxHp < p(m, 'enrageAt', 0.5)) {
    b.phase = 1;
    b.mode = 'roar';
    b.timer = 1.3;
    ctx.events.push({ type: 'phase', id: m.id, phase: 1 });
  }

  const dx = t ? t.body.x - body.x : 0;
  const dist = Math.abs(dx);
  const attack = { owner: m, power: m.stats.attack, multiplier: 1, tag: 'golem' };
  const shots = m.def.projectiles;
  const status = m.def.hitStatus;

  switch (b.mode) {
    case 'intro':
    case 'roar':
      setAnim(m, 'roar');
      if (b.timer <= 0) {
        b.mode = 'walk';
        b.timer = 0.6;
      }
      return idle();

    case 'slam_windup':
      setAnim(m, 'slam_windup');
      if (b.timer <= 0) {
        const fx = body.x + m.facing * 26;
        ctx.combat.openWindow(
          attack,
          { type: 'box', w: 112, h: 48, forward: 30, up: -14 },
          {
            damage: p(m, 'slamDamage', 1.6),
            knockback: 320,
            lift: 280,
            stun: 0.4,
            hitstop: 0.1,
            status,
          },
          {
            until: ctx.now + 0.05,
            aim: m.facing > 0 ? 0 : Math.PI,
            facing: m.facing,
            maxTargets: 4,
          },
        );
        for (const dir of [-1, 1]) {
          ctx.combat.spawnProjectile(
            attack,
            shots?.wave ?? 'shockwave',
            fx + dir * 20,
            body.y,
            dir > 0 ? 0 : Math.PI,
            {
              damage: p(m, 'waveDamage', 1),
              knockback: 220,
              lift: 240,
              stun: 0.35,
              hitstop: 0.05,
              status,
            },
            enraged ? 300 : 250,
          );
        }
        ctx.events.push({ type: 'impact', id: m.id, x: fx, y: body.y, power: 1 });
        b.mode = 'slam_recover';
        b.timer = 1.15 * tempo;
        setAnim(m, 'slam');
      }
      return idle();

    case 'slam_recover':
      m.vulnerable = 1.35;
      if (m.animTime > 0.35) setAnim(m, 'recover');
      if (b.timer <= 0) {
        b.mode = 'walk';
        b.timer = 0.8 * tempo;
      }
      return idle();

    case 'barrage': {
      setAnim(m, 'throw');
      if (b.timer <= 0 && t) {
        const hx = body.x + m.facing * 18;
        const hy = body.y - body.height - 6;
        const lead = t.body.vx * 0.35;
        const tx = t.body.x + lead + ctx.rng.range(-18, 18);
        const ty = t.body.y - t.body.height / 2;
        const speed = boulderSpeed(tx - hx, hy - ty);
        const ang =
          ballisticAngle(tx - hx, ty - hy, speed, BOULDER_GRAVITY) ??
          (tx > hx ? -Math.PI / 4 : (-3 * Math.PI) / 4);
        ctx.combat.spawnProjectile(
          attack,
          shots?.boulder ?? 'boulder',
          hx,
          hy,
          ang,
          {
            damage: p(m, 'boulderDamage', 1.1),
            knockback: 200,
            lift: 160,
            stun: 0.3,
            hitstop: 0.05,
            status,
          },
          speed,
        );
        b.ax += 1;
        setAnim(m, 'throw');
        m.animTime = 0;
        const total = enraged ? 5 : 3;
        if (b.ax >= total) {
          b.mode = 'walk';
          b.timer = 1.1 * tempo;
        } else b.timer = 0.4 * tempo;
      }
      return idle();
    }

    case 'charge_windup':
      setAnim(m, 'charge_windup');
      if (b.timer <= 0) {
        b.mode = 'charge';
        b.timer = 1.6;
      }
      return idle();

    case 'charge': {
      setAnim(m, 'charge');
      m.contact = p(m, 'chargeDamage', 1.4);
      const half = body.width / 2;
      const x0 = b.dir > 0 ? body.x + half : body.x - half - 4;
      const blocked =
        body.events.hitWall ||
        isRegionSolid(ctx.grid, x0, body.y - body.height, x0 + 4, body.y - 18);
      if (blocked) {
        b.mode = 'stunned';
        b.timer = 1.7;
        ctx.events.push({
          type: 'impact',
          id: m.id,
          x: body.x + b.dir * half,
          y: body.y - 30,
          power: 1.2,
        });
        body.vx = -b.dir * 90;
        return idle();
      }
      if (b.timer <= 0) {
        b.mode = 'walk';
        b.timer = 0.7 * tempo;
        return idle();
      }
      return { ...IDLE_INPUT, moveX: b.dir, speedMul: p(m, 'chargeSpeed', 270) / m.def.speed };
    }

    case 'stunned':
      setAnim(m, 'stunned');
      m.vulnerable = 1.5;
      if (b.timer <= 0) {
        b.mode = 'walk';
        b.timer = 0.6;
      }
      return idle();

    case 'quake_windup':
      setAnim(m, 'roar');
      if (b.timer <= 0) {
        for (let k = -2; k <= 2; k++) {
          const x = b.ax + k * 42;
          const top = ceilingAbove(ctx, x, b.ay - 40);
          ctx.combat.spawnProjectile(
            attack,
            shots?.rain ?? 'stalactite',
            x,
            top,
            Math.PI / 2,
            {
              damage: p(m, 'quakeDamage', 1.2),
              knockback: 120,
              lift: 120,
              stun: 0.3,
              hitstop: 0.05,
              status,
            },
            30 + Math.abs(k) * 25,
          );
        }
        ctx.events.push({ type: 'impact', id: m.id, x: body.x, y: body.y, power: 0.8 });
        b.mode = 'walk';
        b.timer = 1.2 * tempo;
      }
      return idle();

    default: {
      b.mode = 'walk';
      if (!t) {
        setAnim(m, 'idle');
        return idle();
      }
      m.facing = dx >= 0 ? 1 : -1;
      if (b.timer <= 0) {
        const pattern = choosePattern(m, ctx, dist);
        b.count++;
        b.ax = 0;
        switch (pattern) {
          case 'slam':
            b.mode = 'slam_windup';
            b.timer = 0.9 * tempo;
            ctx.events.push({ type: 'telegraph', id: m.id, kind: 'slam' });
            break;
          case 'barrage':
            b.mode = 'barrage';
            b.timer = 0.5 * tempo;
            ctx.events.push({ type: 'telegraph', id: m.id, kind: 'barrage' });
            break;
          case 'charge':
            b.mode = 'charge_windup';
            b.dir = m.facing;
            b.timer = 0.75 * tempo;
            ctx.events.push({ type: 'telegraph', id: m.id, kind: 'charge' });
            break;
          case 'quake': {
            b.mode = 'quake_windup';
            b.timer = 1;
            b.ax = t.body.x;
            b.ay = t.body.y;
            const gy = groundUnder(ctx, t.body.x, t.body.y - 8);
            for (let k = -2; k <= 2; k++)
              ctx.events.push({ type: 'marker', x: t.body.x + k * 42, y: gy, delay: 1 });
            ctx.events.push({ type: 'telegraph', id: m.id, kind: 'quake' });
            break;
          }
        }
        return idle();
      }
      setAnim(m, dist > 60 ? 'walk' : 'idle');
      return { ...IDLE_INPUT, moveX: dist > 60 ? m.facing : 0, speedMul: enraged ? 1.3 : 1 };
    }
  }
}
