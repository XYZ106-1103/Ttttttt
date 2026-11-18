/**
 * Authoritative combat resolution: hit windows, projectiles, lingering zones, damage, knockback,
 * statuses and deaths. Engine-free and deterministic for a given RNG seed, so the same code runs
 * in the browser now and on the server in PHASE 6. Renderers only read `events` and entity lists.
 */
import { TILE_SIZE } from '../constants';
import { getProjectileDef, type ProjectileDef } from '../data/projectiles';
import { Rng } from '../math/rng';
import { type CollisionGrid } from '../physics/TileCollider';
import { COLLISION_NONE, COLLISION_SOLID } from '../world/TileRegistry';
import type { HitSpec, ShapeDef, ZoneEventDef } from './actions';
import { rollDamage } from './damage';
import { type Aabb, bodyAabb, circleAabb, shapeHits } from './shapes';
import type { CombatStats } from './stats';
import type { StatusSet } from './status';

export type Team = 'player' | 'monster';

export interface CombatBody {
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
  vx: number;
  vy: number;
  grounded?: boolean;
}

export interface Combatant {
  readonly id: number;
  readonly team: Team;
  readonly kind: 'player' | 'adventurer' | 'monster';
  readonly body: CombatBody;
  hp: number;
  mp: number;
  alive: boolean;
  level: number;
  stats: CombatStats;
  readonly statuses: StatusSet;
  /** No damage is taken before this time. */
  invulnUntil: number;
  /** Perfect-dodge window end (a hit absorbed before it triggers a perfect dodge). */
  perfectUntil: number;
  /** AI/control interruption end time after being hit. */
  staggerUntil: number;
  knockbackResist: number;
  /** Invulnerability granted after taking a hit (s). */
  hurtIframes: number;
  immune: ReadonlySet<string>;
  /** Damage-taken multiplier while vulnerable (boss recovery windows). */
  vulnerable: number;
  lastHitAt: number;
  facing: 1 | -1;
}

export type DamageSource = 'hit' | 'projectile' | 'zone' | 'dot' | 'contact';

export type CombatEvent =
  | {
      readonly type: 'damage';
      readonly targetId: number;
      readonly attackerId: number;
      readonly amount: number;
      readonly crit: boolean;
      readonly x: number;
      readonly y: number;
      readonly dirX: number;
      readonly hitstop: number;
      readonly source: DamageSource;
      readonly tag: string;
    }
  | {
      readonly type: 'heal';
      readonly targetId: number;
      readonly amount: number;
      readonly mana: boolean;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'death';
      readonly targetId: number;
      readonly killerId: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly type: 'dodge';
      readonly targetId: number;
      readonly perfect: boolean;
      readonly x: number;
      readonly y: number;
    }
  | { readonly type: 'status'; readonly targetId: number; readonly status: string }
  | { readonly type: 'bounce'; readonly ownerId: number }
  | {
      readonly type: 'explode';
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly visual: string;
    }
  | {
      readonly type: 'projectileEnd';
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly visual: string;
      readonly hitTile: boolean;
    };

export interface AttackPower {
  readonly owner: Combatant;
  /** Attack or magic power used for this attack. */
  readonly power: number;
  /** Skill multiplier (1 = 100%). */
  readonly multiplier: number;
  /** Presentation tag (action id). */
  readonly tag: string;
}

export interface HitWindow {
  readonly id: number;
  readonly attack: AttackPower;
  readonly shape: ShapeDef;
  readonly spec: HitSpec;
  until: number;
  readonly interval: number;
  readonly maxTargets: number;
  readonly lastHit: Map<number, number>;
  aim: number;
  facing: number;
  readonly bounce: number;
  /** Set when the window landed at least one hit. */
  landed: boolean;
}

export interface Projectile {
  readonly id: number;
  readonly def: ProjectileDef;
  readonly attack: AttackPower;
  readonly team: Team;
  readonly spec: HitSpec;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  pierceLeft: number;
  readonly hit: Set<number>;
  alive: boolean;
}

export interface Zone {
  readonly id: number;
  readonly attack: AttackPower;
  readonly spec: HitSpec;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly start: number;
  readonly until: number;
  readonly interval: number;
  nextTick: number;
  readonly visual: string;
}

const PERFECT_DODGE_BUFF = 1.5;

export class CombatWorld {
  readonly combatants = new Map<number, Combatant>();
  readonly windows: HitWindow[] = [];
  readonly projectiles: Projectile[] = [];
  readonly zones: Zone[] = [];
  readonly events: CombatEvent[] = [];
  readonly rng: Rng;
  private nextId = 1;
  private now = 0;

  constructor(
    private readonly grid: CollisionGrid,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  newId(): number {
    return this.nextId++;
  }

  add(c: Combatant): void {
    if (this.combatants.has(c.id) && this.combatants.get(c.id) !== c)
      throw new Error(`Combatant id ${c.id} is already in use`);
    this.combatants.set(c.id, c);
    if (c.id >= this.nextId) this.nextId = c.id + 1;
  }

  remove(id: number): void {
    this.combatants.delete(id);
    for (let i = this.windows.length - 1; i >= 0; i--)
      if (this.windows[i]?.attack.owner.id === id) this.windows.splice(i, 1);
  }

  /** Open a melee hit window that follows its owner until `until`. */
  openWindow(
    attack: AttackPower,
    shape: ShapeDef,
    spec: HitSpec,
    opts: {
      until: number;
      interval?: number;
      maxTargets?: number;
      aim: number;
      facing: number;
      bounce?: number;
    },
  ): HitWindow {
    const w: HitWindow = {
      id: this.newId(),
      attack,
      shape,
      spec,
      until: opts.until,
      interval: opts.interval ?? 0,
      maxTargets: opts.maxTargets ?? 99,
      lastHit: new Map(),
      aim: opts.aim,
      facing: opts.facing,
      bounce: opts.bounce ?? 0,
      landed: false,
    };
    this.windows.push(w);
    return w;
  }

  closeWindow(w: HitWindow): void {
    const i = this.windows.indexOf(w);
    if (i >= 0) this.windows.splice(i, 1);
  }

  spawnProjectile(
    attack: AttackPower,
    defId: string,
    x: number,
    y: number,
    angle: number,
    spec: HitSpec,
    speed?: number,
  ): Projectile {
    const def = getProjectileDef(defId);
    const v = speed ?? def.speed;
    const p: Projectile = {
      id: this.newId(),
      def,
      attack,
      team: attack.owner.team,
      spec,
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      age: 0,
      pierceLeft: def.pierce,
      hit: new Set(),
      alive: true,
    };
    this.projectiles.push(p);
    return p;
  }

  spawnZone(attack: AttackPower, x: number, y: number, def: ZoneEventDef, now: number): Zone {
    const start = now + (def.delay ?? 0);
    const z: Zone = {
      id: this.newId(),
      attack,
      spec: def,
      x,
      y,
      radius: def.radius,
      start,
      until: start + def.duration,
      interval: def.interval,
      nextTick: start,
      visual: def.visual,
    };
    this.zones.push(z);
    return z;
  }

  private enemiesOf(team: Team): Combatant[] {
    const out: Combatant[] = [];
    for (const c of this.combatants.values()) if (c.alive && c.team !== team) out.push(c);
    return out;
  }

  /**
   * Resolve one hit. Returns true if damage was dealt (false when dodged, invulnerable or dead).
   */
  applyHit(
    attack: AttackPower,
    target: Combatant,
    spec: HitSpec,
    dirX: number,
    source: DamageSource,
    now = this.now,
  ): boolean {
    if (!target.alive) return false;
    const b = target.body;
    if (now < target.invulnUntil) {
      if (now < target.perfectUntil) {
        target.perfectUntil = 0;
        target.statuses.apply('perfect_focus', now, PERFECT_DODGE_BUFF);
        this.events.push({
          type: 'dodge',
          targetId: target.id,
          perfect: true,
          x: b.x,
          y: b.y - b.height / 2,
        });
      }
      return false;
    }
    const owner = attack.owner;
    const roll = rollDamage(
      {
        power: attack.power,
        multiplier: attack.multiplier * spec.damage,
        attackerLevel: owner.level,
        targetLevel: target.level,
        targetDefense: target.stats.defense,
        targetDamageTaken: target.stats.damageTaken,
        critRate: owner.stats.critRate + (spec.critBonus ?? 0),
        critDamage: owner.stats.critDamage,
        vulnerable: target.vulnerable,
      },
      () => this.rng.next(),
    );
    target.hp = Math.max(0, target.hp - roll.amount);
    target.lastHitAt = now;
    const k = 1 - Math.min(1, Math.max(0, target.knockbackResist));
    if (k > 0) {
      if (spec.knockback) b.vx = dirX * spec.knockback * k;
      if (spec.lift) {
        b.vy = Math.min(b.vy, -spec.lift * k);
        b.grounded = false;
      }
      target.staggerUntil = Math.max(target.staggerUntil, now + (spec.stun ?? 0.2) * k);
    }
    if (target.hurtIframes > 0) target.invulnUntil = now + target.hurtIframes;
    if (spec.status && this.rng.next() < spec.status.chance) {
      const ok = target.statuses.apply(spec.status.id, now, spec.status.duration, {
        power: attack.power,
        sourceId: owner.id,
        immune: target.immune,
      });
      if (ok) this.events.push({ type: 'status', targetId: target.id, status: spec.status.id });
    }
    this.events.push({
      type: 'damage',
      targetId: target.id,
      attackerId: owner.id,
      amount: roll.amount,
      crit: roll.crit,
      x: b.x,
      y: b.y - b.height,
      dirX,
      hitstop: spec.hitstop ?? 0,
      source,
      tag: attack.tag,
    });
    if (target.hp <= 0) this.kill(target, owner.id);
    return true;
  }

  heal(target: Combatant, amount: number, mana = false): void {
    if (!target.alive || amount <= 0) return;
    const b = target.body;
    if (mana) {
      const before = target.mp;
      target.mp = Math.min(target.stats.maxMp, target.mp + amount);
      const got = Math.round(target.mp - before);
      if (got > 0)
        this.events.push({
          type: 'heal',
          targetId: target.id,
          amount: got,
          mana,
          x: b.x,
          y: b.y - b.height,
        });
      return;
    }
    const before = target.hp;
    target.hp = Math.min(target.stats.maxHp, target.hp + amount);
    const got = Math.round(target.hp - before);
    if (got > 0)
      this.events.push({
        type: 'heal',
        targetId: target.id,
        amount: got,
        mana,
        x: b.x,
        y: b.y - b.height,
      });
  }

  kill(target: Combatant, killerId: number): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    target.statuses.clear();
    const b = target.body;
    this.events.push({
      type: 'death',
      targetId: target.id,
      killerId,
      x: b.x,
      y: b.y - b.height / 2,
    });
  }

  step(dt: number, now: number): void {
    this.now = now;
    this.stepWindows(now);
    this.stepProjectiles(dt, now);
    this.stepZones(now);
    this.stepStatuses(now);
  }

  private stepWindows(now: number): void {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const w = this.windows[i] as HitWindow;
      const owner = w.attack.owner;
      if (!owner.alive || now > w.until) {
        this.windows.splice(i, 1);
        continue;
      }
      for (const target of this.enemiesOf(owner.team)) {
        const last = w.lastHit.get(target.id);
        if (last !== undefined && (w.interval <= 0 || now - last < w.interval - 1e-6)) continue;
        if (last === undefined && w.lastHit.size >= w.maxTargets) continue;
        if (!shapeHits(w.shape, owner.body, w.facing, w.aim, bodyAabb(target.body))) continue;
        w.lastHit.set(target.id, now);
        const dirX = Math.sign(target.body.x - owner.body.x) || w.facing;
        if (this.applyHit(w.attack, target, w.spec, dirX, 'hit', now)) {
          w.landed = true;
          if (w.bounce > 0) {
            owner.body.vy = -w.bounce;
            owner.body.grounded = false;
            this.events.push({ type: 'bounce', ownerId: owner.id });
          }
        }
      }
    }
  }

  private solidAt(x: number, y: number): boolean {
    return (
      this.grid.collisionAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)) ===
      COLLISION_SOLID
    );
  }

  private endProjectile(p: Projectile, hitTile: boolean, now: number): void {
    if (!p.alive) return;
    p.alive = false;
    if (p.def.explode) this.explode(p, now);
    this.events.push({
      type: 'projectileEnd',
      id: p.id,
      x: p.x,
      y: p.y,
      visual: p.def.visual,
      hitTile,
    });
  }

  private explode(p: Projectile, now: number): void {
    const ex = p.def.explode;
    if (!ex) return;
    this.events.push({ type: 'explode', x: p.x, y: p.y, radius: ex.radius, visual: p.def.visual });
    const spec: HitSpec = { ...p.spec, damage: p.spec.damage * ex.damage };
    for (const t of this.enemiesOf(p.team)) {
      if (p.hit.has(t.id)) continue;
      if (!circleAabb(p.x, p.y, ex.radius, bodyAabb(t.body))) continue;
      p.hit.add(t.id);
      this.applyHit(p.attack, t, spec, Math.sign(t.body.x - p.x) || 1, 'projectile', now);
    }
  }

  private nearestEnemy(p: Projectile, range: number): Combatant | null {
    let best: Combatant | null = null;
    let bd = range * range;
    for (const t of this.enemiesOf(p.team)) {
      const dx = t.body.x - p.x;
      const dy = t.body.y - t.body.height / 2 - p.y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  private stepProjectiles(dt: number, now: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i] as Projectile;
      if (!p.alive) {
        this.projectiles.splice(i, 1);
        continue;
      }
      p.age += dt;
      if (p.age > p.def.lifetime) {
        this.endProjectile(p, false, now);
        this.projectiles.splice(i, 1);
        continue;
      }
      const def = p.def;
      if (def.homing) {
        const t = this.nearestEnemy(p, 320);
        if (t) {
          const want = Math.atan2(t.body.y - t.body.height / 2 - p.y, t.body.x - p.x);
          const cur = Math.atan2(p.vy, p.vx);
          let d = want - cur;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const turn = Math.max(-def.homing * dt, Math.min(def.homing * dt, d));
          const sp = Math.hypot(p.vx, p.vy);
          p.vx = Math.cos(cur + turn) * sp;
          p.vy = Math.sin(cur + turn) * sp;
        }
      }
      p.vy += def.gravity * dt;
      const dist = Math.hypot(p.vx, p.vy) * dt;
      const steps = Math.max(1, Math.ceil(dist / 4));
      const sx = (p.vx * dt) / steps;
      const sy = (p.vy * dt) / steps;
      for (let s = 0; s < steps && p.alive; s++) {
        p.x += sx;
        p.y += sy;
        if (def.groundHug) {
          // Ride the ground surface; stop at walls or drops deeper than two tiles.
          if (this.solidAt(p.x + Math.sign(p.vx) * def.radius, p.y - 4)) {
            this.endProjectile(p, true, now);
            break;
          }
          let gy = p.y;
          let found = false;
          for (let k = -1; k <= 2; k++) {
            const ty = Math.floor(p.y / TILE_SIZE) + k;
            if (this.grid.collisionAt(Math.floor(p.x / TILE_SIZE), ty) !== COLLISION_NONE) {
              gy = ty * TILE_SIZE;
              found = true;
              break;
            }
          }
          if (!found) {
            this.endProjectile(p, false, now);
            break;
          }
          p.y = gy;
        } else if (def.tileCollide && this.solidAt(p.x, p.y)) {
          this.endProjectile(p, true, now);
          break;
        }
        this.projectileHits(p, now);
      }
      if (!p.alive) this.projectiles.splice(i, 1);
    }
  }

  private projectileHits(p: Projectile, now: number): void {
    const r = p.def.radius;
    const cy = p.def.groundHug ? p.y - r : p.y;
    for (const t of this.enemiesOf(p.team)) {
      if (p.hit.has(t.id)) continue;
      const box: Aabb = bodyAabb(t.body);
      if (!circleAabb(p.x, cy, r, box)) continue;
      if (now < t.invulnUntil && now >= t.perfectUntil) continue; // passes through i-frames
      p.hit.add(t.id);
      const dirX = Math.sign(p.vx) || 1;
      const landed = this.applyHit(p.attack, t, p.spec, dirX, 'projectile', now);
      if (!landed) continue;
      if (p.pierceLeft > 0) p.pierceLeft--;
      else {
        this.endProjectile(p, false, now);
        return;
      }
    }
  }

  private stepZones(now: number): void {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i] as Zone;
      if (now > z.until) {
        this.zones.splice(i, 1);
        continue;
      }
      if (now < z.start || now < z.nextTick) continue;
      z.nextTick += z.interval;
      for (const t of this.enemiesOf(z.attack.owner.team)) {
        if (!circleAabb(z.x, z.y, z.radius, bodyAabb(t.body))) continue;
        this.applyHit(z.attack, t, z.spec, Math.sign(t.body.x - z.x) || 1, 'zone', now);
      }
    }
  }

  private stepStatuses(now: number): void {
    for (const c of this.combatants.values()) {
      if (!c.alive) continue;
      const ticks = c.statuses.step(now, c.stats.maxHp);
      for (const t of ticks) {
        if (t.amount < 0) {
          this.heal(c, -t.amount);
          continue;
        }
        c.hp = Math.max(0, c.hp - t.amount);
        this.events.push({
          type: 'damage',
          targetId: c.id,
          attackerId: t.sourceId,
          amount: t.amount,
          crit: false,
          x: c.body.x,
          y: c.body.y - c.body.height,
          dirX: 0,
          hitstop: 0,
          source: 'dot',
          tag: t.statusId,
        });
        if (c.hp <= 0) {
          this.kill(c, t.sourceId);
          break;
        }
      }
    }
  }
}
