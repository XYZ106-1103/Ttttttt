/**
 * Owns all live monsters: spawning, brains, movement, contact damage, death and despawning.
 * Kill rewards (exp, loot) are handed to the caller through `deaths` so the simulation decides
 * who gets credit (PHASE 5: party sharing).
 */
import type { CombatWorld, Combatant } from '../combat/CombatWorld';
import { bodyAabb, aabbOverlap } from '../combat/shapes';
import { TILE_SIZE } from '../constants';
import { requireMonsterDef } from '../data/monsters';
import { Rng } from '../math/rng';
import { stepMotor } from '../physics/CharacterMotor';
import { TILE } from '../world/TileRegistry';
import type { World } from '../world/World';
import { type BrainContext, type MonsterEvent, stepBrain } from './brains';
import { createMonster, type Monster, setAnim } from './Monster';
import { pickSpawn, spawnCap, zoneAt } from './spawning';

export interface SpawnSettings {
  /** Tile columns where nothing spawns naturally. */
  readonly safeFrom: number;
  readonly safeTo: number;
  readonly night: boolean;
  readonly enabled: boolean;
  /** Extra characters around which monsters may spawn (active AI adventurers). */
  readonly anchors?: readonly Combatant[];
  /** Global cap on live monsters. */
  readonly maxMonsters?: number;
}

const CORPSE_TIME = 1.1;
const DESPAWN_DISTANCE = 80 * TILE_SIZE;
const DESPAWN_TIME = 6;
const SPAWN_INTERVAL = 1.4;
const NEAR_RADIUS = 60 * TILE_SIZE;

export class MonsterManager {
  readonly monsters: Monster[] = [];
  readonly events: MonsterEvent[] = [];
  /** Monsters that died since the caller last drained this list. */
  readonly deaths: Monster[] = [];
  private spawnTimer = SPAWN_INTERVAL;
  private readonly rng: Rng;

  constructor(
    private readonly world: World,
    private readonly combat: CombatWorld,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  spawn(defId: string, x: number, y: number): Monster {
    const def = requireMonsterDef(defId);
    const m = createMonster(this.combat.newId(), def, x, y, this.rng.int(0, 1 << 20));
    if (def.boss) {
      m.brain.mode = 'intro';
      m.brain.timer = 1.6;
    }
    this.monsters.push(m);
    this.combat.add(m);
    return m;
  }

  get bossActive(): Monster | null {
    return this.monsters.find((m) => m.def.boss && m.alive) ?? null;
  }

  aliveCount(): number {
    let n = 0;
    for (const m of this.monsters) if (m.alive) n++;
    return n;
  }

  /** Remove every monster (world reset, respawn cleanup). */
  clear(): void {
    for (const m of this.monsters) this.combat.remove(m.id);
    this.monsters.length = 0;
  }

  /** Who the monster goes after: whoever claimed it (attacked it first), else the nearest. */
  private nearestTarget(m: Monster, players: readonly Combatant[], now: number): Combatant | null {
    let best: Combatant | null = null;
    let bd = (m.def.boss ? 60 : m.def.aggroRange * 2) * TILE_SIZE;
    if (m.ownerId !== null && now <= m.ownerUntil && !m.def.boss) {
      const owner = players.find((p) => p.id === m.ownerId && p.alive);
      if (owner && Math.hypot(owner.body.x - m.motor.x, owner.body.y - m.motor.y) < bd)
        return owner;
    }
    for (const p of players) {
      if (!p.alive) continue;
      const d = Math.hypot(p.body.x - m.motor.x, p.body.y - m.motor.y);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  step(dt: number, now: number, players: readonly Combatant[], spawn: SpawnSettings): void {
    const ctxBase = {
      grid: this.world,
      combat: this.combat,
      now,
      dt,
      rng: this.rng,
      events: this.events,
    };
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i] as Monster;
      m.prevX = m.motor.x;
      m.prevY = m.motor.y;
      m.animTime += dt;
      if (!m.alive) {
        if (m.deadTime < 0) {
          m.deadTime = 0;
          setAnim(m, 'dead');
          this.deaths.push(m);
        }
        m.deadTime += dt;
        // Corpses still fall.
        if (!m.def.flying)
          stepMotor(
            m.motor,
            { moveX: 0, jumpHeld: false, jumpPressed: false, down: false },
            this.world,
            m.movement,
            dt,
          );
        else m.motor.vy = Math.min(m.motor.vy + 900 * dt, 400);
        if (m.def.flying) m.motor.y += m.motor.vy * dt;
        if (m.deadTime > CORPSE_TIME) {
          this.combat.remove(m.id);
          this.monsters.splice(i, 1);
        }
        continue;
      }

      const target = this.nearestTarget(m, players, now);
      m.targetId = target?.id ?? null;
      const ctx: BrainContext = { ...ctxBase, target };
      const input = stepBrain(m, ctx);
      if (input) {
        const slow = m.statuses.mods(now).moveSpeedPct ?? 0;
        if (slow) input.speedMul = (input.speedMul ?? 1) * Math.max(0.2, 1 + slow);
        stepMotor(m.motor, input, this.world, m.movement, dt);
      }
      if (m.def.ai !== 'hopper' && m.def.ai !== 'charger' && m.def.ai !== 'golem') {
        // flyers keep their own facing from velocity
        if (Math.abs(m.motor.vx) > 8) m.facing = m.motor.vx > 0 ? 1 : -1;
      }

      // Contact damage.
      if (m.contact > 0 && target && now >= m.staggerUntil) {
        if (aabbOverlap(bodyAabb(m.motor), bodyAabb(target.body))) {
          this.combat.applyHit(
            { owner: m, power: m.stats.attack, multiplier: 1, tag: 'contact' },
            target,
            {
              damage: m.contact,
              knockback: 210,
              lift: 180,
              stun: 0.3,
              hitstop: 0.04,
              status: m.def.hitStatus,
            },
            Math.sign(target.body.x - m.motor.x) || m.facing,
            'contact',
            now,
          );
        }
      }

      // Fell out of the world.
      if (m.motor.y > this.world.heightPixels + 64) this.combat.kill(m, -1);

      // Despawn when every player is far away.
      let near = false;
      for (const p of players) {
        if (Math.hypot(p.body.x - m.motor.x, p.body.y - m.motor.y) < DESPAWN_DISTANCE) near = true;
      }
      const lostBoss = m.def.boss && !players.some((p) => p.alive);
      m.farTime = near && !lostBoss ? 0 : m.farTime + dt;
      if (m.farTime > (m.def.boss ? 10 : DESPAWN_TIME)) {
        this.combat.remove(m.id);
        this.monsters.splice(i, 1);
      }
    }
    this.spawnStep(dt, players, spawn);
  }

  private spawnStep(dt: number, players: readonly Combatant[], s: SpawnSettings): void {
    if (!s.enabled) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = SPAWN_INTERVAL;
    if (this.aliveCount() >= (s.maxMonsters ?? 40)) return;
    for (const p of [...players, ...(s.anchors ?? [])]) {
      if (!p.alive) continue;
      let near = 0;
      for (const m of this.monsters) {
        if (m.alive && Math.hypot(m.motor.x - p.body.x, m.motor.y - p.body.y) < NEAR_RADIUS) near++;
      }
      const ptx = Math.floor(p.body.x / TILE_SIZE);
      const pty = Math.floor((p.body.y - 1) / TILE_SIZE);
      const zone =
        zoneAt(this.world, ptx, pty) ??
        (pty - this.world.surfaceY(ptx) > 10 ? 'underground' : 'surface');
      if (near >= spawnCap(zone, s.night)) continue;
      const pick = pickSpawn({
        world: this.world,
        night: s.night,
        x: p.body.x,
        y: p.body.y,
        safeFrom: s.safeFrom,
        safeTo: s.safeTo,
        rng: this.rng,
        torchTile: TILE.torch,
      });
      if (pick) this.spawn(pick.def.id, pick.x, pick.y);
    }
  }
}
