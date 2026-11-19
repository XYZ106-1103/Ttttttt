/**
 * The world simulation: world, clock, any number of players, AI adventurers, monsters, combat,
 * loose drops, economy and society. No rendering, no networking, no storage — the offline client
 * drives it with one local player; the server drives it with every connected player and is the
 * authority. Same code, same rules.
 */
import type { ActorEvent, CastFail } from '../combat/ActorCombat';
import { type CombatEvent, CombatWorld } from '../combat/CombatWorld';
import { expForKill } from '../combat/damage';
import type { LearnFail } from '../combat/progression';
import { TILE_SIZE } from '../constants';
import { JOB_STARTER_WEAPONS } from '../data/items';
import { getMonsterDef } from '../data/monsters';
import { DEFAULT_MOVEMENT, type MovementConfig } from '../data/movement';
import { MARKET_X, MERCHANT_STALLS } from '../data/npcs';
import { Economy } from '../economy/Economy';
import type { SaleRecord } from '../economy/Market';
import { expToNextLevel, type StatKey } from '../entities/stats';
import { deriveSeed, Rng } from '../math/rng';
import { claimMonster, type Monster } from '../monsters/Monster';
import type { MonsterEvent } from '../monsters/brains';
import { MonsterManager } from '../monsters/MonsterManager';
import { rollLoot } from '../monsters/spawning';
import { isRegionSolid } from '../physics/TileCollider';
import { craft, type CraftResult } from '../sandbox/crafting';
import type { EquipFail, EquipSlotId } from '../sandbox/Equipment';
import {
  type Drop,
  type InteractionContext,
  previewUse,
  type UseAction,
  type UseFailReason,
  type UseOutcome,
} from '../sandbox/interaction';
import { itemRegistry } from '../sandbox/ItemRegistry';
import type { NewsItem } from '../society/News';
import { Society } from '../society/Society';
import { WorldClock } from '../time/WorldClock';
import { DEFAULT_OVERWORLD, OverworldGenerator } from '../world/generation/OverworldGenerator';
import { World } from '../world/World';
import { type DropEntity, DropSystem, GOLD_DROP } from '../actors/DropSystem';
import {
  bestPotion,
  type CharacterEnv,
  type CharacterIntent,
  type CharacterStepOut,
  drinkPotion,
  heldMode,
  type HeldMode,
  IDLE_ACTION,
  newStepOut,
  regenCharacter,
  stepCharacter,
} from '../actors/stepCharacter';
import type { Adventurer } from '../ai/Adventurer';
import type { BrainEvent } from '../ai/brain';
import { AdventurerDirector, type SpokenLine } from '../ai/director';
import type { SocialEvent } from '../ai/social';
import { IDLE_INPUT } from '../physics/CharacterMotor';
import { Player } from './Player';
import {
  type PlayerSave,
  SAVE_VERSION,
  type SaveBundle,
  type WorldMeta,
  type WorldSocietySave,
} from './saveTypes';
import { TownServices } from './TownServices';

/** An item a player picked up (inventory or wallet). */
export interface PlayerPickup {
  readonly itemId: string;
  readonly count: number;
}

export type ConsumeFail = 'cooldown' | 'too_shallow' | 'boss_active' | 'no_room';

export type SimNotice =
  | { readonly kind: 'castFail'; readonly skill: string; readonly reason: CastFail }
  | { readonly kind: 'consumeFail'; readonly reason: ConsumeFail }
  | { readonly kind: 'weaponLevel'; readonly level: number }
  | { readonly kind: 'jobChanged'; readonly jobId: string; readonly gift: string | null }
  | { readonly kind: 'died'; readonly expLost: number }
  | { readonly kind: 'respawned' }
  | { readonly kind: 'bossSpawned'; readonly monsterId: string }
  | { readonly kind: 'bossDefeated'; readonly monsterId: string }
  | { readonly kind: 'consumed'; readonly itemId: string };

/** What happened to one player since their events were last read. */
export interface PlayerEvents {
  pickups: PlayerPickup[];
  exp: { amount: number; x: number; y: number }[];
  levelUps: number[];
  notices: SimNotice[];
  failed: UseFailReason | null;
  /** Their market listings that sold. */
  sales: SaleRecord[];
  /** Adventurers asking them to team up. */
  invites: { from: string; purpose: string }[];
}

/** What happened in the world (visible to anyone nearby) since last read. */
export interface WorldEvents {
  combat: CombatEvent[];
  monster: MonsterEvent[];
  /** Actions started by any character (players and adventurers). */
  actor: { id: number; event: ActorEvent }[];
  /** Item uses (mining, chopping, placing) by any character. */
  uses: { id: number; out: UseOutcome }[];
  levelUps: { id: number; level: number }[];
  ai: BrainEvent[];
  spoken: SpokenLine[];
  news: NewsItem[];
  social: SocialEvent[];
}

export function newPlayerEvents(): PlayerEvents {
  return {
    pickups: [],
    exp: [],
    levelUps: [],
    notices: [],
    failed: null,
    sales: [],
    invites: [],
  };
}

/** A player present in the world. */
export class PlayerSlot {
  readonly events = newPlayerEvents();
  /** Intent applied on the next tick (movement, item use, combat). */
  intent: CharacterIntent = { move: IDLE_INPUT, use: null, action: IDLE_ACTION };
  readonly explored = new Set<number>();
  playTime = 0;
  /** Market sales already reported. */
  seenSales = 0;
  /** May use developer commands (offline player, or admins online). */
  admin = false;
  readonly town: TownServices;

  constructor(
    readonly key: string,
    readonly character: Player,
    sim: WorldSim,
  ) {
    this.town = new TownServices(sim, key);
  }
}

export interface WorldSimOptions {
  seed: number;
  worldId: string;
  startHour?: number;
  dayLengthSeconds?: number;
  /** World-level save: meta, chunks, adventurers, society (players are added separately). */
  save?: SaveBundle;
  /** Natural monster spawning (default true). */
  monsters?: boolean;
  /** Number of AI adventurers (default 30, 0 disables them). */
  adventurers?: number;
  /** Simulate some adventurer life before a brand-new world opens (default true). */
  warmUp?: boolean;
}

/** Minutes of adventurer life simulated before a brand-new world opens. */
export const WARM_UP_MINUTES = 30;
export const RESPAWN_DELAY = 5;
/** Fraction of the current level's requirement lost on death. */
export const DEATH_EXP_PENALTY = 0.05;
/** Tiles on each side of the spawn column where monsters never spawn (the starting village). */
export const SAFE_RADIUS = 34;
/** Natural monster population cap around players. */
const MAX_MONSTERS = 26;

export class WorldSim {
  readonly seed: number;
  readonly world: World;
  readonly clock: WorldClock;
  readonly movement: MovementConfig;
  readonly worldId: string;
  readonly combat: CombatWorld;
  readonly monsters: MonsterManager;
  readonly adventurers: AdventurerDirector;
  readonly dropSystem: DropSystem;
  readonly economy: Economy;
  readonly society: Society;
  readonly worldEvents: WorldEvents = {
    combat: [],
    monster: [],
    actor: [],
    uses: [],
    levelUps: [],
    ai: [],
    spoken: [],
    news: [],
    social: [],
  };
  /** Simulation time in seconds. */
  time = 0;
  tickCount = 0;
  monstersEnabled: boolean;
  protected readonly ctx: InteractionContext;
  private readonly lootRng: Rng;
  private readonly charEnv: { -readonly [K in keyof CharacterEnv]: CharacterEnv[K] };
  private readonly slots = new Map<string, PlayerSlot>();
  private lastNewsId: number;
  private salesCheckAt = 0;

  constructor(options: WorldSimOptions) {
    this.seed = options.seed;
    this.worldId = options.worldId;
    this.world = new World(new OverworldGenerator({ seed: options.seed, ...DEFAULT_OVERWORLD }));
    const save = options.save;
    if (save) this.world.loadPersisted(save.chunks);
    this.clock = new WorldClock({
      startHour: save?.meta?.timeOfDay ?? options.startHour ?? 8,
      dayLengthSeconds: options.dayLengthSeconds ?? 24 * 60,
    });
    if (save?.meta) this.clock.day = save.meta.day;
    this.movement = DEFAULT_MOVEMENT;
    this.ctx = { world: this.world, items: itemRegistry };
    this.combat = new CombatWorld(this.world, deriveSeed(options.seed, 'combat'));
    this.monsters = new MonsterManager(
      this.world,
      this.combat,
      deriveSeed(options.seed, 'monsters'),
    );
    this.lootRng = new Rng(deriveSeed(options.seed, 'loot'));
    this.dropSystem = new DropSystem(deriveSeed(options.seed, 'drops'));
    this.monstersEnabled = options.monsters ?? true;
    this.charEnv = {
      world: this.world,
      combat: this.combat,
      movement: this.movement,
      interaction: this.ctx,
      now: 0,
      dt: 0,
    };
    const sx = this.world.generator.spawnTileX;
    this.economy = new Economy({ hourSeconds: this.clock.dayLengthSeconds / 24 });
    this.society = new Society();
    this.adventurers = new AdventurerDirector(this.world, this.combat, this.movement, {
      count: options.adventurers ?? 30,
      seed: options.seed,
      homeCenter: sx,
      safeFrom: sx - SAFE_RADIUS,
      safeTo: sx + SAFE_RADIUS,
      society: this.society,
      economy: this.economy,
      marketX: sx + MARKET_X,
      stallXs: MERCHANT_STALLS.map((x) => sx + x),
    });
    this.adventurers.load(save?.adventurers);
    if (save?.society) {
      this.economy.load(save.society.economy);
      this.society.load(
        save.society.society,
        (k) => k === 'player' || k.startsWith('pc:') || this.adventurers.byKey(k) !== undefined,
      );
    }
    if (save?.meta && save.adventurers) {
      // The world kept living while it was not running.
      const away = (Date.now() - save.meta.savedAt) / 1000;
      if (away > 30) this.adventurers.catchUp(away, 0);
    } else if (options.warmUp ?? true) {
      // A new world: adventurers have already been living for a while.
      this.adventurers.catchUp(WARM_UP_MINUTES * 60, 0);
    }
    // News from before anyone arrived is history, not notifications.
    this.lastNewsId = this.society.news.lastId;
  }

  get drops(): readonly DropEntity[] {
    return this.dropSystem.drops;
  }

  get playerSlots(): readonly PlayerSlot[] {
    return [...this.slots.values()];
  }

  slot(key: string): PlayerSlot | undefined {
    return this.slots.get(key);
  }

  /** Character for a player key (present in the world). */
  playerOf(key: string): Player | undefined {
    return this.slots.get(key)?.character;
  }

  private get safe(): { safeFrom: number; safeTo: number } {
    const sx = this.world.generator.spawnTileX;
    return { safeFrom: sx - SAFE_RADIUS, safeTo: sx + SAFE_RADIUS };
  }

  // --- Players joining and leaving ----------------------------------------------------------

  /** Bring a player into the world (from their save, or new at the spawn point). */
  addPlayer(key: string, name: string, save: PlayerSave | null = null): PlayerSlot {
    const existing = this.slots.get(key);
    if (existing) return existing;
    const spawn = this.world.spawnPoint();
    const p = new Player(this.combat.newId(), name, spawn.x, spawn.y, this.movement, key);
    p.motor.grounded = true;
    const slot = new PlayerSlot(key, p, this);
    this.slots.set(key, slot);
    this.combat.add(p);
    if (save) {
      p.importSave(save);
      for (const c of save.explored ?? []) if (Number.isInteger(c)) slot.explored.add(c);
      slot.playTime = Number(save.playTime) || 0;
      if (!this.placePlayer(key, Number(save.x), Number(save.y))) this.respawnPlayer(key);
    } else p.giveStartingItems();
    this.adventurers.setPlayers(this.characters());
    return slot;
  }

  /** Take a player out of the world; returns their save. */
  removePlayer(key: string): PlayerSave | null {
    const slot = this.slots.get(key);
    if (!slot) return null;
    const save = this.exportPlayer(key);
    const p = slot.character;
    p.inventory.returnCursor();
    p.combat.reset(this.combat);
    this.combat.remove(p.id);
    this.society.parties.leave(key);
    this.slots.delete(key);
    this.adventurers.setPlayers(this.characters());
    return save;
  }

  private characters(): Player[] {
    return [...this.slots.values()].map((s) => s.character);
  }

  // --- Simulation ---------------------------------------------------------------------------

  /** Advance the world clock only (title screen). */
  tickAmbient(dt: number): void {
    this.clock.advance(dt);
    this.time += dt;
    this.tickCount++;
  }

  /** Advance one fixed step with every player's current intent. */
  tick(dt: number): void {
    const now = this.time;
    const night = this.clock.daylight < 0.35;
    this.charEnv.now = now;
    this.charEnv.dt = dt;
    const players = this.characters();

    // Players.
    for (const slot of this.slots.values()) {
      const p = slot.character;
      p.refreshStats(now);
      const out = newStepOut();
      stepCharacter(this.charEnv, p, slot.intent, out);
      // A click is consumed by one tick; held buttons persist in the next intent.
      slot.intent = {
        ...slot.intent,
        action: {
          ...slot.intent.action,
          attackPressed: false,
          dodge: false,
          skillSlot: null,
          quickHeal: false,
          quickMana: false,
        },
      };
      this.handlePlayerOut(slot, out);
    }

    // Adventurers (the same step function, driven by their brains).
    this.adventurers.setPlayers(players);
    this.adventurers.updateTiers(
      players.map((p) => ({ x: p.motor.x, y: p.motor.y })),
      now,
    );
    const steps = this.adventurers.stepActive(
      {
        interaction: this.ctx,
        monsters: this.monsters.monsters,
        drops: this.dropSystem.drops,
        players,
        now,
        dt,
        night,
      },
      this.charEnv,
      this.safe,
    );
    for (const s of steps) this.handleAdventurerOut(s.adventurer, s.out);
    this.adventurers.stepAbstract(dt, now, night);

    const active = this.adventurers.active.map((a) => a.character).filter((c) => c.alive);
    this.combat.step(dt, now);
    this.monsters.step(dt, now, [...players, ...active], {
      ...this.safe,
      night,
      enabled: this.monstersEnabled && players.length > 0,
      anchors: active,
      maxMonsters: MAX_MONSTERS + Math.max(0, players.length - 1) * 8,
    });
    this.processCombatEvents();
    for (const p of players) regenCharacter(p, now, dt);
    this.adventurers.regenActive(now, dt);
    for (const pk of this.dropSystem.step(
      dt,
      now,
      this.world,
      [...players, ...active],
      this.adventurers.allied,
    )) {
      const key = this.adventurers.keyOfCharacter(pk.characterId);
      const slot = key ? this.slots.get(key) : undefined;
      if (slot) slot.events.pickups.push({ itemId: pk.itemId, count: pk.count });
    }
    if (this.dropSystem.expiredGold > 0) {
      this.economy.ledger.destroy('expired_drop', this.dropSystem.expiredGold);
      this.dropSystem.expiredGold = 0;
    }
    this.economy.tick(dt, now);
    this.drainSocial(now);
    for (const e of this.adventurers.events) this.worldEvents.ai.push(e);
    this.adventurers.events.length = 0;
    this.clock.advance(dt);
    this.time += dt;
    for (const slot of this.slots.values()) slot.playTime += dt;
    this.tickCount++;
  }

  /** Collect social happenings for players and the presentation layer. */
  private drainSocial(now: number): void {
    const d = this.adventurers;
    for (const l of d.spoken) this.worldEvents.spoken.push(l);
    d.spoken.length = 0;
    for (const e of d.socialEvents) {
      if (e.type === 'invitePlayer') {
        const slot = this.slots.get(e.to);
        if (slot) {
          slot.town.invites.add(e.from);
          slot.events.invites.push({ from: e.from, purpose: e.purpose });
        }
      } else this.worldEvents.social.push(e);
    }
    d.socialEvents.length = 0;
    d.tradeEvents.length = 0;
    d.drainSocietyChanges(now);
    if (this.society.news.lastId !== this.lastNewsId) {
      for (const n of this.society.news.since(this.lastNewsId)) this.worldEvents.news.push(n);
      this.lastNewsId = this.society.news.lastId;
    }
    // Market sales (proceeds wait in the mailbox at the exchange).
    if (now >= this.salesCheckAt) {
      this.salesCheckAt = now + 1;
      for (const slot of this.slots.values()) {
        const box = this.economy.market.peekMail(slot.key);
        const n = box?.sales.length ?? 0;
        if (box && n > slot.seenSales) {
          for (const sale of box.sales.slice(slot.seenSales)) slot.events.sales.push(sale);
        }
        slot.seenSales = n;
      }
    }
  }

  private handlePlayerOut(slot: PlayerSlot, out: CharacterStepOut): void {
    const p = slot.character;
    for (const u of out.uses) {
      this.worldEvents.uses.push({ id: p.id, out: u });
      this.dropSystem.spawn(u.drops, this.time, p.id);
    }
    if (out.failed) slot.events.failed = out.failed;
    for (const e of out.actor) this.worldEvents.actor.push({ id: p.id, event: e });
    for (const f of out.castFails)
      slot.events.notices.push({ kind: 'castFail', skill: f.skill, reason: f.reason });
    if (out.weaponLevel !== null)
      slot.events.notices.push({ kind: 'weaponLevel', level: out.weaponLevel });
    if (out.consume !== null) this.consume(slot.key, out.consume);
    if (out.quick) this.quickUse(slot.key, out.quick);
  }

  private handleAdventurerOut(a: Adventurer, out: CharacterStepOut): void {
    const c = a.character;
    for (const u of out.uses) {
      this.worldEvents.uses.push({ id: c.id, out: u });
      this.dropSystem.spawn(u.drops, this.time, c.id, 0.2);
    }
    for (const e of out.actor) this.worldEvents.actor.push({ id: c.id, event: e });
    if (out.quick) {
      const slot = bestPotion(c, out.quick);
      if (slot >= 0) drinkPotion(c, slot, this.combat, this.time);
    }
  }

  private monsterById(id: number): Monster | undefined {
    return this.monsters.monsters.find((m) => m.id === id);
  }

  private slotById(id: number): PlayerSlot | undefined {
    for (const s of this.slots.values()) if (s.character.id === id) return s;
    return undefined;
  }

  private processCombatEvents(): void {
    const now = this.time;
    for (const e of this.combat.events) {
      this.worldEvents.combat.push(e);
      if (e.type === 'damage') {
        const m = this.monsterById(e.targetId);
        if (m && e.attackerId > 0 && e.source !== 'dot') {
          claimMonster(m, e.attackerId, now);
          m.damageBy.set(e.attackerId, (m.damageBy.get(e.attackerId) ?? 0) + e.amount);
          // A player stepping in for an adventurer under attack is remembered.
          const helper = this.slotById(e.attackerId);
          if (helper && m.targetId !== null && m.targetId !== e.attackerId) {
            const a = this.adventurers.byCharacter(m.targetId);
            if (a) this.adventurers.noteHelp(a, helper.key, now);
          }
        }
      }
      if (e.type === 'death') {
        const slot = this.slotById(e.targetId);
        if (slot) this.onPlayerDeath(slot);
        else {
          const a = this.adventurers.byCharacter(e.targetId);
          if (a) {
            const killer = this.monsterById(e.killerId);
            this.adventurers.onDeath(a, now, killer?.def.id ?? null);
          }
        }
      }
    }
    this.combat.events.length = 0;
    for (const e of this.monsters.events) this.worldEvents.monster.push(e);
    this.monsters.events.length = 0;
    for (const m of this.monsters.deaths) this.onMonsterDeath(m);
    this.monsters.deaths.length = 0;
  }

  /** Who gets credit for a kill: the live claim holder, else whoever dealt the most damage. */
  private creditFor(m: Monster): number | null {
    if (m.ownerId !== null && m.damageBy.has(m.ownerId)) return m.ownerId;
    let best: number | null = null;
    let bd = 0;
    for (const [id, d] of m.damageBy) {
      if (d > bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  }

  private onMonsterDeath(m: Monster): void {
    const x = m.motor.x;
    const y = m.motor.y - m.motor.height / 2;
    const d = this.adventurers;
    const credit = this.creditFor(m);
    const creditKey = credit !== null ? d.keyOfCharacter(credit) : null;
    if (m.def.boss) {
      // Everyone who really fought a boss gets full credit and remembers the fight.
      const fighters = [...m.damageBy.entries()]
        .filter(([, dmg]) => dmg >= m.stats.maxHp * 0.03)
        .map(([id]) => d.keyOfCharacter(id))
        .filter((k): k is string => k !== null);
      for (const k of fighters) this.creditKill(k, m, 1);
      if (fighters.length > 0) d.onRaidVictory(fighters, m.def.id, this.time);
    } else if (creditKey) {
      // Party mates nearby share the experience (with a party bonus).
      const share = d.partyShare(creditKey, x);
      const mul = AdventurerDirector.shareMul(share.length);
      for (const k of share) this.creditKill(k, m, mul);
    }
    if (credit !== null) {
      const loot = rollLoot(m.def.drops, this.lootRng);
      const gold = this.lootRng.int(m.def.gold[0], m.def.gold[1]);
      this.economy.ledger.create('loot', gold);
      this.dropSystem.spawn(
        [
          ...loot.map((l) => ({ itemId: l.itemId, count: l.count, x, y })),
          { itemId: GOLD_DROP, count: gold, x, y },
        ],
        this.time,
        credit,
      );
    }
    if (m.def.boss)
      for (const slot of this.slots.values())
        slot.events.notices.push({ kind: 'bossDefeated', monsterId: m.def.id });
  }

  /** Experience for a kill to a player or an adventurer (by key). */
  private creditKill(key: string, m: Monster, mul: number): void {
    const slot = this.slots.get(key);
    if (slot) {
      const p = slot.character;
      const amount = Math.max(1, Math.round(expForKill(m.def.exp, p.level, m.def.level) * mul));
      slot.events.exp.push({ amount, x: m.motor.x, y: m.motor.y - m.motor.height });
      const gained = p.gainExp(amount);
      if (gained > 0) {
        p.refreshStats(this.time);
        p.hp = p.stats.maxHp;
        p.mp = p.stats.maxMp;
        slot.events.levelUps.push(p.level);
        this.worldEvents.levelUps.push({ id: p.id, level: p.level });
      }
      return;
    }
    const a = this.adventurers.byKey(key);
    if (a && this.adventurers.onKill(a, m.def, this.time, mul) > 0)
      this.worldEvents.levelUps.push({ id: a.character.id, level: a.character.level });
  }

  private onPlayerDeath(slot: PlayerSlot): void {
    const p = slot.character;
    p.respawnAt = this.time + RESPAWN_DELAY;
    p.combat.reset(this.combat);
    const lost = Math.round(expToNextLevel(p.level) * DEATH_EXP_PENALTY);
    const before = p.progress.exp;
    p.loseExp(lost);
    slot.events.notices.push({ kind: 'died', expLost: before - p.progress.exp });
  }

  // --- Player commands (all validated by shared rules) -------------------------------------

  private need(key: string): PlayerSlot {
    const slot = this.slots.get(key);
    if (!slot) throw new Error(`No player ${key}`);
    return slot;
  }

  /** What the attack button does with the selected item. */
  heldMode(key: string): HeldMode {
    return heldMode(this.need(key).character);
  }

  /** Revive at the spawn point once the respawn timer allows it. */
  requestRespawn(key: string): boolean {
    const p = this.need(key).character;
    if (p.alive || this.time < p.respawnAt) return false;
    this.respawnPlayer(key);
    return true;
  }

  /** Cursor preview for the selected item at a tile. */
  preview(
    key: string,
    tx: number,
    ty: number,
  ): { action: UseAction; ok: boolean; reason?: UseFailReason } {
    const p = this.need(key).character;
    if (heldMode(p) !== 'sandbox' || !p.alive) return { action: 'none', ok: false };
    const m = p.motor;
    return previewUse(
      this.ctx,
      {
        x: m.x,
        y: m.y,
        width: m.width,
        height: m.height,
        inventory: p.inventory,
        progress: p.hit,
        nextUseAt: p.nextUseAt,
      },
      p.selectedSlot,
      tx,
      ty,
    );
  }

  /** Mining progress (0..1) of a player on a tile, if any. */
  hitProgressAt(key: string, tx: number, ty: number): number {
    const h = this.need(key).character.hit;
    if (!h || h.key !== `t:${tx},${ty}` || this.time - h.lastHit > 3) return 0;
    const def = this.world.tiles.get(this.world.getFg(tx, ty));
    return def && def.durability > 0 ? Math.min(1, h.damage / def.durability) : 0;
  }

  /** Use the consumable in an inventory slot. */
  consume(key: string, index: number): boolean {
    const slot = this.need(key);
    const p = slot.character;
    const st = p.inventory.get(index);
    const def = st ? itemRegistry.get(st.itemId) : undefined;
    const c = def?.consumable;
    if (!st || !c || !p.alive) return false;
    if (c.summon) {
      const m = p.motor;
      const tx = Math.floor(m.x / TILE_SIZE);
      const depth = Math.floor((m.y - 1) / TILE_SIZE) - this.world.surfaceY(tx);
      if (depth < (c.minDepth ?? 0)) {
        slot.events.notices.push({ kind: 'consumeFail', reason: 'too_shallow' });
        return false;
      }
      if (this.monsters.bossActive) {
        slot.events.notices.push({ kind: 'consumeFail', reason: 'boss_active' });
        return false;
      }
      const at = this.findSpawnSpot(p, c.summon, [12, 9, 15, 6]);
      if (!at) {
        slot.events.notices.push({ kind: 'consumeFail', reason: 'no_room' });
        return false;
      }
      const boss = this.monsters.spawn(c.summon, at.x, at.y);
      p.inventory.removeAt(index, 1);
      this.adventurers.onBossSpawned(boss, this.time, key);
      slot.events.notices.push({ kind: 'bossSpawned', monsterId: c.summon });
      slot.events.notices.push({ kind: 'consumed', itemId: st.itemId });
      return true;
    }
    const r = drinkPotion(p, index, this.combat, this.time);
    if (r === 'cooldown') slot.events.notices.push({ kind: 'consumeFail', reason: 'cooldown' });
    if (r !== 'ok') return false;
    slot.events.notices.push({ kind: 'consumed', itemId: st.itemId });
    return true;
  }

  /** Quick-use the strongest potion of a kind from anywhere in the inventory (H / J keys). */
  quickUse(key: string, kind: 'heal' | 'mana'): boolean {
    const best = bestPotion(this.need(key).character, kind);
    return best >= 0 ? this.consume(key, best) : false;
  }

  /** Ground spot near a character (distances in tiles, either side) where a monster fits. */
  private findSpawnSpot(
    near: Player,
    monsterId: string,
    distances: readonly number[],
  ): { x: number; y: number } | null {
    const def = getMonsterDef(monsterId);
    if (!def) return null;
    const m = near.motor;
    const half = def.width / 2;
    for (const dist of distances) {
      for (const dir of [1, -1]) {
        const x = m.x + dir * dist * TILE_SIZE;
        const tx = Math.floor(x / TILE_SIZE);
        for (let dy = -4; dy <= 6; dy++) {
          const ty = Math.floor(m.y / TILE_SIZE) + dy;
          if (this.world.collisionAt(tx, ty) === 0) continue;
          const y = ty * TILE_SIZE;
          if (def.flying) return { x, y: y - TILE_SIZE * 3 };
          if (!isRegionSolid(this.world, x - half, y - def.height, x + half, y - 0.01))
            return { x, y };
        }
      }
    }
    return null;
  }

  spawnDrops(drops: readonly Drop[], owner: number | null = null): void {
    this.dropSystem.spawn(drops, this.time, owner);
  }

  selectSlot(key: string, i: number): void {
    this.need(key).character.select(i);
  }

  clickInventory(key: string, index: number, button: 'left' | 'right'): void {
    const p = this.need(key).character;
    // Right-click on equipment equips it (quick equip).
    const st = p.inventory.get(index);
    if (button === 'right' && !p.inventory.cursor && st && itemRegistry.get(st.itemId)?.equip) {
      p.equipFromInventory(index);
      return;
    }
    p.inventory.click(index, button);
  }

  clickEquipment(key: string, slot: EquipSlotId): EquipFail | null {
    const p = this.need(key).character;
    return p.equipment.click(p.inventory, slot, p.level);
  }

  /** Return the cursor stack to the inventory; whatever does not fit is dropped at the player. */
  returnCursor(key: string): void {
    const p = this.need(key).character;
    const left = p.inventory.returnCursor();
    if (left) {
      const m = p.motor;
      this.dropSystem.spawn(
        [{ itemId: left.itemId, count: left.count, x: m.x, y: m.y - m.height / 2 }],
        this.time,
        null,
        2,
      );
    }
  }

  craft(key: string, recipeId: string, times = 1): CraftResult {
    return craft(this.need(key).character.inventory, recipeId, times);
  }

  allocateStat(key: string, stat: StatKey, amount = 1): boolean {
    return this.need(key).character.allocate(stat, amount);
  }

  autoAllocate(key: string): boolean {
    return this.need(key).character.autoAllocate();
  }

  learnSkill(key: string, skillId: string): LearnFail | null {
    return this.need(key).character.learn(skillId);
  }

  setSkillSlot(key: string, slot: number, skillId: string | null): void {
    this.need(key).character.setSkillSlot(slot, skillId);
  }

  /** Advance to a new job; hands out that job's starter weapon. */
  advanceJob(key: string, jobId: string): boolean {
    const slot = this.need(key);
    const p = slot.character;
    if (!p.advance(jobId)) return false;
    const gift = JOB_STARTER_WEAPONS[jobId] ?? null;
    if (gift) {
      const left = p.inventory.add(gift, 1);
      if (left > 0) {
        const m = p.motor;
        this.dropSystem.spawn(
          [{ itemId: gift, count: 1, x: m.x, y: m.y - m.height / 2 }],
          this.time,
          p.id,
        );
      }
    }
    p.refreshStats(this.time);
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    slot.events.notices.push({ kind: 'jobChanged', jobId, gift });
    return true;
  }

  // --- Developer commands (offline player; admins online) ----------------------------------

  devSetLevel(key: string, level: number): void {
    const slot = this.need(key);
    const p = slot.character;
    const target = Math.max(1, Math.min(200, Math.floor(level)));
    const before = p.level;
    while (p.level < target) p.gainExp(expToNextLevel(p.level) - p.progress.exp);
    if (p.level > before) slot.events.levelUps.push(p.level);
    p.refreshStats(this.time);
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
  }

  /** Developer gold (accounted as a faucet so the money supply stays verifiable). */
  devGold(key: string, amount: number): void {
    const p = this.need(key).character;
    const n = Math.max(0, Math.min(1_000_000, Math.floor(amount)));
    p.gold = Math.min(99_999_999, p.gold + n);
    this.economy.ledger.create('loot', n);
  }

  devSpawn(key: string, monsterId: string): boolean {
    const p = this.need(key).character;
    const at = this.findSpawnSpot(p, monsterId, [7, 5, 9, 3]);
    if (!at) return false;
    // The summoner holds the claim, so bystanders leave it alone.
    claimMonster(this.monsters.spawn(monsterId, at.x, at.y), p.id, this.time);
    return true;
  }

  devGive(key: string, itemId: string, count: number): boolean {
    if (!itemRegistry.has(itemId)) return false;
    this.need(key).character.inventory.add(itemId, Math.max(1, Math.min(999, Math.floor(count))));
    return true;
  }

  // --- Positioning --------------------------------------------------------------------------

  respawnPlayer(key: string): void {
    const slot = this.need(key);
    const p = slot.character;
    const spawn = this.world.spawnPoint();
    this.placePlayer(key, spawn.x, spawn.y);
    if (!p.alive) {
      p.alive = true;
      p.statuses.clear();
      p.refreshStats(this.time);
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      p.invulnUntil = this.time + 2;
      slot.events.notices.push({ kind: 'respawned' });
    }
  }

  /** Place a player's feet at a world position if the body fits there. */
  placePlayer(key: string, x: number, y: number): boolean {
    const p = this.need(key).character;
    const m = p.motor;
    const half = m.width / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (
      x - half < 0 ||
      x + half > this.world.widthPixels ||
      y - m.height < 0 ||
      y > this.world.heightPixels
    ) {
      return false;
    }
    if (isRegionSolid(this.world, x - half, y - m.height, x + half, y)) return false;
    m.x = x;
    m.y = y;
    m.vx = 0;
    m.vy = 0;
    m.grounded = false;
    p.prevX = x;
    p.prevY = y;
    p.combat.reset(this.combat);
    return true;
  }

  // --- Saving -------------------------------------------------------------------------------

  exportMeta(): WorldMeta {
    return {
      v: SAVE_VERSION,
      worldId: this.worldId,
      seed: this.seed,
      timeOfDay: this.clock.timeOfDay,
      day: this.clock.day,
      savedAt: Date.now(),
    };
  }

  exportPlayer(key: string): PlayerSave | null {
    const slot = this.slots.get(key);
    if (!slot) return null;
    const m = slot.character.motor;
    return {
      v: SAVE_VERSION,
      x: m.x,
      y: m.y,
      explored: [...slot.explored],
      playTime: slot.playTime,
      ...slot.character.exportFields(),
    };
  }

  exportAdventurers(): ReturnType<AdventurerDirector['toJSON']> {
    return this.adventurers.toJSON();
  }

  exportSociety(): WorldSocietySave {
    return { economy: this.economy.toJSON(), society: this.society.toJSON() };
  }
}

/** Monster ownership helper for UI/debug: the character holding a monster's claim. */
export function monsterOwner(m: Monster, now: number): number | null {
  return m.ownerId !== null && now <= m.ownerUntil ? m.ownerId : null;
}
