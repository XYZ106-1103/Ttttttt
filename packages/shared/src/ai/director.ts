/**
 * Runs the adventurer population at different levels of detail (design §10):
 * - active:   near a player — full Characters in the CombatWorld, brains every tick;
 * - abstract: everyone else — no physics; a coarse activity model grants the same rewards on
 *             average (exp, loot, ore) through the same progression and crafting rules;
 * - offline:  on load, the abstract model catches up on the time that passed (capped).
 * Promotion/demotion keeps positions, inventories, goals and memories continuous.
 */
import type { Character } from '../actors/Character';
import {
  type CharacterEnv,
  newStepOut,
  regenCharacter,
  stepCharacter,
  type CharacterStepOut,
} from '../actors/stepCharacter';
import type { DropEntity } from '../actors/DropSystem';
import type { CombatWorld } from '../combat/CombatWorld';
import { expForKill, mitigation } from '../combat/damage';
import { TILE_SIZE } from '../constants';
import { MONSTER_DEFS, type MonsterDef } from '../data/monsters';
import type { MovementConfig } from '../data/movement';
import { expToNextLevel } from '../entities/stats';
import { deriveSeed, Rng } from '../math/rng';
import type { Monster } from '../monsters/Monster';
import { rollLoot } from '../monsters/spawning';
import type { InteractionContext } from '../sandbox/interaction';
import { itemRegistry } from '../sandbox/ItemRegistry';
import type { World } from '../world/World';
import {
  type AbstractActivity,
  Adventurer,
  type AdventurerSave,
  generateProfile,
} from './Adventurer';
import {
  type BrainEvent,
  housekeeping,
  huntingGround,
  needsMining,
  thinkAdventurer,
} from './brain';
import { NavGrid } from './nav/NavGrid';

export interface DirectorConfig {
  readonly count: number;
  readonly seed: number;
  /** Tile column of the village center (spawn). */
  readonly homeCenter: number;
  readonly safeFrom: number;
  readonly safeTo: number;
  readonly maxActive?: number;
  /** Tiles from a player within which adventurers become active. */
  readonly activeRadius?: number;
  readonly demoteRadius?: number;
}

export interface ActiveStep {
  readonly adventurer: Adventurer;
  readonly out: CharacterStepOut;
}

export interface DirectorTickEnv {
  readonly interaction: InteractionContext;
  readonly monsters: readonly Monster[];
  readonly drops: readonly DropEntity[];
  readonly player: Character | null;
  readonly now: number;
  readonly dt: number;
  readonly night: boolean;
}

const RESPAWN = 8;
/** Tiles around the player that are always rendered (wider than any screen at the min zoom). */
const VISIBLE_RADIUS = 36;
const ABSTRACT_STEP = 1;
const OFFLINE_CAP = 2 * 60 * 60;
export const ADVENTURER_DEATH_PENALTY = 0.05;

export class AdventurerDirector {
  readonly all: Adventurer[] = [];
  readonly nav: NavGrid;
  readonly events: BrainEvent[] = [];
  private readonly byId = new Map<number, Adventurer>();
  private readonly rng: Rng;
  private tierTimer = 0;
  private abstractAcc = 0;
  private readonly maxActive: number;
  private readonly activeRadius: number;
  private readonly demoteRadius: number;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly world: World,
    private readonly combat: CombatWorld,
    movement: MovementConfig,
    readonly config: DirectorConfig,
  ) {
    this.nav = new NavGrid(world, movement);
    this.unsubscribe = world.onTileChange((ch) => this.nav.invalidate(ch.tx, ch.ty));
    this.rng = new Rng(deriveSeed(config.seed, 'director'));
    this.maxActive = config.maxActive ?? 14;
    this.activeRadius = config.activeRadius ?? 56;
    this.demoteRadius = config.demoteRadius ?? 76;
    const taken = new Set<string>();
    for (let i = 0; i < config.count; i++) {
      const profile = generateProfile(config.seed, i, config.homeCenter, taken);
      const home = this.surfaceAt(profile.homeX);
      const a = new Adventurer(profile, combat.newId(), home.x, home.y, movement);
      this.all.push(a);
      this.byId.set(a.character.id, a);
    }
  }

  dispose(): void {
    this.unsubscribe();
  }

  get active(): Adventurer[] {
    return this.all.filter((a) => a.tier === 'active');
  }

  byCharacter(id: number): Adventurer | undefined {
    return this.byId.get(id);
  }

  byKey(key: string): Adventurer | undefined {
    return this.all.find((a) => a.key === key);
  }

  private surfaceAt(tx: number): { x: number; y: number } {
    const x = Math.max(2, Math.min(this.world.widthTiles - 3, tx));
    let ty = this.world.surfaceY(x) - 1;
    const node = this.nav.groundBelow(x, ty - 6, 16);
    if (node !== null) ty = this.nav.ty(node);
    return { x: x * TILE_SIZE + TILE_SIZE / 2, y: (ty + 1) * TILE_SIZE };
  }

  // --- Level of detail ----------------------------------------------------------------------

  private promote(a: Adventurer, now: number): void {
    const c = a.character;
    const tx = Math.floor(c.motor.x / TILE_SIZE);
    const ty = Math.round(c.motor.y / TILE_SIZE) - 1;
    let spot: { x: number; y: number } | null = null;
    for (let r = 0; r <= 8 && !spot; r++) {
      for (const dx of r === 0 ? [0] : [-r, r]) {
        const node = this.nav.groundBelow(tx + dx, ty - 4, 14);
        if (node !== null) {
          spot = {
            x: this.nav.tx(node) * TILE_SIZE + TILE_SIZE / 2,
            y: (this.nav.ty(node) + 1) * TILE_SIZE,
          };
          break;
        }
      }
    }
    spot ??= this.surfaceAt(tx);
    c.motor.x = spot.x;
    c.motor.y = spot.y;
    c.motor.vx = 0;
    c.motor.vy = 0;
    c.motor.grounded = false;
    c.prevX = spot.x;
    c.prevY = spot.y;
    c.combat.reset(this.combat);
    a.tier = 'active';
    a.follower = null;
    a.thinkAt = now;
    a.houseAt = now;
    if (c.alive) this.combat.add(c);
  }

  private demote(a: Adventurer): void {
    this.combat.remove(a.character.id);
    a.tier = 'abstract';
    a.follower = null;
    a.activityUntil = 0;
    a.activity =
      a.action === 'fight' || a.action === 'seek'
        ? 'hunt'
        : a.action === 'mine'
          ? 'mine'
          : a.action === 'gather'
            ? 'gather'
            : a.action === 'rest'
              ? 'rest'
              : a.action === 'explore'
                ? 'travel'
                : 'town';
  }

  /** Re-evaluate which adventurers run in full detail around the anchor (the player). */
  updateTiers(anchorX: number, anchorY: number, now: number, force = false): void {
    if (!force && now < this.tierTimer) return;
    this.tierTimer = now + 0.5;
    const dist = (a: Adventurer) => ({
      dx: Math.abs(a.character.motor.x - anchorX) / TILE_SIZE,
      dy: Math.abs(a.character.motor.y - anchorY) / TILE_SIZE,
    });
    for (const a of this.all) {
      if (a.tier !== 'active') continue;
      const d = dist(a);
      if (d.dx > this.demoteRadius || d.dy > 60) this.demote(a);
    }
    const candidates = this.all
      .filter((a) => a.tier === 'abstract' && a.character.alive)
      .map((a) => ({ a, d: dist(a) }))
      .filter(({ d }) => d.dx < this.activeRadius && d.dy < 40)
      .sort((x, y) => x.d.dx - y.d.dx);
    let active = this.active.length;
    for (const { a } of candidates) {
      if (active >= this.maxActive) break;
      this.promote(a, now);
      active++;
    }
    if (active > this.maxActive) {
      const far = this.active.sort((x, y) => dist(y).dx - dist(x).dx);
      for (let i = 0; i < active - this.maxActive; i++) {
        const a = far[i];
        if (a) this.demote(a);
      }
    }
    // Nobody may be simulated abstractly where the player can see them: if the active cap is
    // full, the rest walk on past the edge of view.
    for (const a of this.all) {
      if (a.tier !== 'abstract') continue;
      const d = dist(a);
      if (d.dx >= VISIBLE_RADIUS || d.dy >= 24) continue;
      const side = a.character.motor.x >= anchorX ? 1 : -1;
      const tx = Math.floor(anchorX / TILE_SIZE) + side * (VISIBLE_RADIUS + 2);
      a.character.motor.x = tx * TILE_SIZE + TILE_SIZE / 2;
      a.character.motor.y = this.world.surfaceY(tx) * TILE_SIZE;
    }
  }

  // --- Active tier --------------------------------------------------------------------------

  stepActive(
    env: DirectorTickEnv,
    charEnv: CharacterEnv,
    safe: { safeFrom: number; safeTo: number },
  ): ActiveStep[] {
    const out: ActiveStep[] = [];
    const brainEnv = {
      world: this.world,
      nav: this.nav,
      combat: this.combat,
      monsters: env.monsters,
      drops: env.drops,
      player: env.player,
      now: env.now,
      dt: env.dt,
      safeFrom: safe.safeFrom,
      safeTo: safe.safeTo,
      night: env.night,
      pathBudget: 1,
      events: this.events,
    };
    for (const a of this.all) {
      if (a.tier !== 'active') continue;
      const c = a.character;
      if (!c.alive) {
        c.prevX = c.motor.x;
        c.prevY = c.motor.y;
        if (env.now >= a.respawnAt) this.respawn(a, env.now);
        continue;
      }
      a.character.refreshStats(env.now);
      const intent = thinkAdventurer(a, brainEnv);
      const res = newStepOut();
      stepCharacter(charEnv, c, intent, res);
      const ev = c.motor.events;
      a.fx.jumped ||= ev.jumped;
      if (ev.landed) {
        a.fx.landed = true;
        a.fx.landingSpeed = Math.max(a.fx.landingSpeed, ev.landingSpeed);
      }
      a.fx.stepped += ev.stepped;
      out.push({ adventurer: a, out: res });
    }
    return out;
  }

  regenActive(now: number, dt: number): void {
    for (const a of this.all) if (a.tier === 'active') regenCharacter(a.character, now, dt);
  }

  /** An adventurer's character died (active tier). */
  onDeath(a: Adventurer, now: number, killer: string | null): void {
    const c = a.character;
    a.respawnAt = now + RESPAWN;
    c.combat.reset(this.combat);
    c.loseExp(expToNextLevel(c.level) * ADVENTURER_DEATH_PENALTY);
    a.memory.add({
      t: now,
      kind: 'died',
      detail: killer ?? undefined,
      x: Math.floor(c.motor.x / TILE_SIZE),
      importance: 0.85,
    });
    a.follower = null;
    a.action = 'rest';
  }

  private respawn(a: Adventurer, now: number): void {
    const c = a.character;
    const home = this.surfaceAt(a.profile.homeX);
    c.motor.x = home.x;
    c.motor.y = home.y;
    c.motor.vx = 0;
    c.motor.vy = 0;
    c.prevX = home.x;
    c.prevY = home.y;
    c.alive = true;
    c.statuses.clear();
    c.refreshStats(now);
    c.hp = c.stats.maxHp;
    c.mp = c.stats.maxMp;
    c.invulnUntil = now + 2;
    if (a.tier === 'active' && !this.combat.combatants.has(c.id)) this.combat.add(c);
    a.say('respawn', now, undefined, true);
  }

  /** Experience and goal progress for a kill credited to an adventurer. Returns levels gained. */
  onKill(a: Adventurer, def: MonsterDef, now: number): number {
    const c = a.character;
    const gained = c.gainExp(expForKill(def.exp, c.level, def.level));
    if (a.goal?.kind === 'slay' && a.goal.monsterId === def.id) a.goal.progress++;
    if (gained > 0) {
      c.refreshStats(now);
      c.hp = c.stats.maxHp;
      c.mp = c.stats.maxMp;
      a.memory.add({
        t: now,
        kind: 'level_up',
        detail: String(c.level),
        importance: c.level % 5 === 0 ? 0.8 : 0.4,
      });
      a.say('levelUp', now, { level: c.level }, true);
    } else if (a.rng.chance(0.15)) a.say('victory', now);
    if (def.boss) a.memory.add({ t: now, kind: 'slew', detail: def.id, importance: 1 });
    return gained;
  }

  /** The player hit a monster that was after this adventurer. */
  noteHelp(a: Adventurer, now: number): void {
    const rel = a.memory.relation('player');
    if (now - rel.lastSeen < 6 && rel.helped > 0) return;
    rel.helped++;
    rel.lastSeen = now;
    a.memory.adjust('player', 0.1 + a.profile.personality.friendliness * 0.05);
    a.memory.add({ t: now, kind: 'helped_by', subject: 'player', importance: 0.65 });
    a.say('thanks', now, undefined, true);
  }

  // --- Abstract tier ------------------------------------------------------------------------

  /** Advance off-screen adventurers (call every tick; work happens once per second). */
  stepAbstract(dt: number, now: number, night: boolean): void {
    this.abstractAcc += dt;
    if (this.abstractAcc < ABSTRACT_STEP) return;
    const step = this.abstractAcc;
    this.abstractAcc = 0;
    for (const a of this.all) if (a.tier === 'abstract') this.abstractTick(a, step, now, night);
  }

  /** Simulate `seconds` of time that passed while the game was closed (capped). */
  catchUp(seconds: number, now: number): void {
    const total = Math.min(OFFLINE_CAP, Math.max(0, seconds));
    const step = 10;
    for (let t = 0; t < total; t += step) {
      for (const a of this.all) this.abstractTick(a, step, now - total + t, false);
    }
  }

  private pickActivity(a: Adventurer, night: boolean): AbstractActivity {
    const c = a.character;
    if (c.hp < c.stats.maxHp * 0.5) return 'rest';
    if (night && !a.profile.nightOwl) return 'town';
    if (a.goal?.kind === 'explore') return 'travel';
    if (needsMining(a)) return 'mine';
    if (a.goal?.kind === 'item' && a.rng.chance(0.3)) return 'gather';
    return a.profile.archetype === 'artisan' && a.rng.chance(0.4) ? 'gather' : 'hunt';
  }

  private abstractTick(a: Adventurer, dt: number, now: number, night: boolean): void {
    const c = a.character;
    if (!c.alive) {
      if (now >= a.respawnAt) this.respawn(a, now);
      return;
    }
    a.abstractTimer -= dt;
    if (a.abstractTimer <= 0) {
      a.abstractTimer = 5;
      housekeeping(a, now, this.events, this.world.widthTiles);
    }
    if (now >= a.activityUntil) {
      a.activity = this.pickActivity(a, night);
      a.activityUntil = now + 60 + this.rng.range(0, 120);
    }
    // Where the activity happens.
    const safe = { safeFrom: this.config.safeFrom, safeTo: this.config.safeTo };
    let targetX = a.profile.homeX * TILE_SIZE;
    if (a.activity === 'hunt' || a.activity === 'gather' || a.activity === 'mine')
      targetX = huntingGround(a, safe);
    if (a.activity === 'travel' && a.goal?.kind === 'explore') targetX = a.goal.targetX * TILE_SIZE;
    const dx = targetX - c.motor.x;
    const speed = 5 * TILE_SIZE;
    if (Math.abs(dx) > 2 * TILE_SIZE) {
      c.motor.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      // Generator height only: off-screen travel must not force chunk generation.
      c.motor.y = this.world.surfaceY(Math.floor(c.motor.x / TILE_SIZE)) * TILE_SIZE;
      if (a.activity === 'travel' && Math.abs(dx) < 4 * TILE_SIZE && a.goal?.kind === 'explore')
        a.activityUntil = 0;
      return;
    }
    switch (a.activity) {
      case 'hunt':
        this.abstractHunt(a, dt, now);
        break;
      case 'mine': {
        const t = 1 - Math.exp(-dt * 0.05);
        const pick = itemRegistry.get(c.inventory.get(1)?.itemId ?? '')?.tool?.power ?? 0;
        if (this.rng.next() < t)
          c.inventory.add(pick >= 50 && this.rng.chance(0.4) ? 'iron_ore' : 'copper_ore', 1);
        if (this.rng.next() < t * 3) c.inventory.add('stone', 1);
        break;
      }
      case 'gather': {
        const t = 1 - Math.exp(-dt * 0.12);
        if (this.rng.next() < t) c.inventory.add('wood', this.rng.int(1, 3));
        if (this.rng.next() < t) c.inventory.add('fiber', 1);
        break;
      }
      case 'travel':
        a.activityUntil = 0;
        break;
      default:
        break;
    }
    c.lastHitAt = Math.min(c.lastHitAt, now - 10);
    regenCharacter(c, now, dt);
  }

  private abstractHunt(a: Adventurer, dt: number, now: number): void {
    const c = a.character;
    const pool = MONSTER_DEFS.filter((m) => m.spawn && m.level <= c.level + 1);
    const def = pool.sort((x, y) => y.level - x.level)[
      Math.min(pool.length - 1, this.rng.int(0, 1))
    ];
    if (!def) return;
    const power = c.usableWeapon()?.type === 'staff' ? c.stats.magic : c.stats.attack;
    const dps = Math.max(1, power * 1.15 * mitigation(def.defense));
    const killTime = def.hp / dps + 5;
    const kills = dt / killTime;
    let whole = Math.floor(kills);
    if (this.rng.next() < kills - whole) whole++;
    for (let i = 0; i < whole; i++) {
      this.onKill(a, def, now);
      for (const l of rollLoot(def.drops, this.rng)) c.inventory.add(l.itemId, l.count);
    }
    // Damage taken while hunting (skill and defense reduce it).
    const taken =
      def.attack * mitigation(c.stats.defense) * (dt / 6) * (1.2 - a.profile.skill * 0.6);
    c.hp -= taken;
    if (c.hp <= 0) {
      c.alive = false;
      c.hp = 0;
      this.onDeath(a, now, def.id);
    }
  }

  // --- Saving -------------------------------------------------------------------------------

  toJSON(): AdventurerSave[] {
    return this.all.map((a) => a.toJSON());
  }

  load(saves: readonly AdventurerSave[] | null | undefined): void {
    if (!Array.isArray(saves)) return;
    for (const s of saves) {
      const a = s && typeof s.key === 'string' ? this.byKey(s.key) : undefined;
      if (a) a.load(s);
    }
  }
}
