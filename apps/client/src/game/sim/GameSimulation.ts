import {
  type ActionIntent,
  type ActorEvent,
  type Adventurer,
  AdventurerDirector,
  type BrainEvent,
  bestPotion,
  type CastFail,
  type CharacterEnv,
  type CharacterStepOut,
  claimMonster,
  type CombatEvent,
  CombatWorld,
  craft,
  type CraftResult,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  Economy,
  GOLD_DROP,
  MARKET_X,
  MERCHANT_STALLS,
  type NewsItem,
  type SaleRecord,
  Society,
  type SocialEvent,
  type SpokenLine,
  deriveSeed,
  type Drop,
  type DropEntity,
  DropSystem,
  drinkPotion,
  type EquipFail,
  type EquipSlotId,
  expForKill,
  expToNextLevel,
  getMonsterDef,
  heldMode,
  type HeldMode,
  IDLE_ACTION,
  type InteractionContext,
  isRegionSolid,
  itemRegistry,
  JOB_STARTER_WEAPONS,
  type LearnFail,
  type Monster,
  type MonsterEvent,
  MonsterManager,
  type MotorInput,
  type MovementConfig,
  newStepOut,
  OverworldGenerator,
  previewUse,
  regenCharacter,
  rollLoot,
  Rng,
  type StatKey,
  stepCharacter,
  TILE_SIZE,
  type UseAction,
  type UseFailReason,
  type UseIntent,
  type UseOutcome,
  World,
  WorldClock,
} from '@world/shared';
import type { PlayerSave, SaveBundle, WorldMeta, WorldSocietySave } from '../persistence/SaveStore';
import { SAVE_VERSION } from '../persistence/SaveStore';
import { Player, SKILL_BAR_SIZE } from './Player';
import { TownServices } from './TownServices';

export { SKILL_BAR_SIZE, Player, IDLE_ACTION };
export type { ActionIntent, DropEntity, UseIntent };

export interface PickupEvent {
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

/** Things that happened since the renderer last consumed events. */
export interface SimEvents {
  uses: UseOutcome[];
  pickups: PickupEvent[];
  failed: UseFailReason | null;
  combat: CombatEvent[];
  monster: MonsterEvent[];
  actor: ActorEvent[];
  levelUps: number[];
  exp: { amount: number; x: number; y: number }[];
  notices: SimNotice[];
  /** Adventurer actions/uses/level-ups for the renderer. */
  aiActor: { id: number; event: ActorEvent }[];
  aiUses: { id: number; out: UseOutcome }[];
  aiLevelUps: { id: number; level: number }[];
  ai: BrainEvent[];
  /** Conversation lines spoken by active adventurers. */
  spoken: SpokenLine[];
  /** World news since last read. */
  news: NewsItem[];
  /** Adventurers asking the player to team up. */
  invites: { from: string; purpose: string }[];
  /** The player's market listings that sold. */
  sales: SaleRecord[];
  /** Social outcomes involving the player (party/guild changes, trades). */
  social: SocialEvent[];
}

export interface SimulationOptions {
  seed: number;
  worldId: string;
  playerName: string;
  startHour?: number;
  dayLengthSeconds?: number;
  save?: SaveBundle;
  /** Natural monster spawning (default true). */
  monsters?: boolean;
  /** Number of AI adventurers (default 30, 0 disables them). */
  adventurers?: number;
  /** Simulate some adventurer life before a new world starts (default true). */
  warmUp?: boolean;
}

/** Minutes of adventurer life simulated before a brand-new world opens. */
export const WARM_UP_MINUTES = 30;

export const RESPAWN_DELAY = 5;
/** Fraction of the current level's requirement lost on death. */
export const DEATH_EXP_PENALTY = 0.05;
/** Tiles on each side of the spawn column where monsters never spawn (the starting hill). */
export const SAFE_RADIUS = 34;

/**
 * The local simulation: world, clock, the player, AI adventurers, monsters, combat and loose item
 * drops. Contains no rendering code; PHASE 6 moves the authoritative copy to the server and this
 * becomes the client-side predictor.
 */
export class GameSimulation {
  readonly world: World;
  readonly clock: WorldClock;
  readonly movement: MovementConfig;
  readonly player: Player;
  readonly worldId: string;
  readonly combat: CombatWorld;
  readonly monsters: MonsterManager;
  readonly adventurers: AdventurerDirector;
  readonly dropSystem: DropSystem;
  readonly economy: Economy;
  readonly society: Society;
  /** Player-facing services: NPCs, shop, exchange, talking, parties and guilds. */
  readonly town: TownServices;
  readonly explored = new Set<number>();
  readonly events: SimEvents = {
    uses: [],
    pickups: [],
    failed: null,
    combat: [],
    monster: [],
    actor: [],
    levelUps: [],
    exp: [],
    notices: [],
    aiActor: [],
    aiUses: [],
    aiLevelUps: [],
    ai: [],
    spoken: [],
    news: [],
    invites: [],
    sales: [],
    social: [],
  };
  /** Simulation time in seconds. */
  time = 0;
  tickCount = 0;
  playTime = 0;
  monstersEnabled: boolean;
  private readonly ctx: InteractionContext;
  private readonly lootRng: Rng;
  private readonly charEnv: { -readonly [K in keyof CharacterEnv]: CharacterEnv[K] };
  private lastNewsId: number;
  private salesCheckAt = 0;

  constructor(options: SimulationOptions) {
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

    const spawn = this.world.spawnPoint();
    // Ids come from the combat world so players, adventurers and monsters never collide.
    this.player = new Player(
      this.combat.newId(),
      options.playerName,
      spawn.x,
      spawn.y,
      this.movement,
    );
    this.player.motor.grounded = true;
    this.combat.add(this.player);
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
    this.town = new TownServices(this);
    if (save?.player) this.applyPlayerSave(save.player);
    else this.player.giveStartingItems();
    this.adventurers.load(save?.adventurers);
    if (save?.society) {
      this.economy.load(save.society.economy);
      this.society.load(
        save.society.society,
        (k) => k === 'player' || this.adventurers.byKey(k) !== undefined,
      );
    }
    if (save?.meta && save.adventurers) {
      // The world kept living while the game was closed.
      const away = (Date.now() - save.meta.savedAt) / 1000;
      if (away > 30) this.adventurers.catchUp(away, 0);
    } else if (options.warmUp ?? true) {
      // A new world: adventurers have already been living for a while when the player arrives.
      this.adventurers.catchUp(WARM_UP_MINUTES * 60, 0);
    }
    // News from before the player arrived is history, not notifications.
    this.lastNewsId = this.society.news.lastId;
  }

  get drops(): readonly DropEntity[] {
    return this.dropSystem.drops;
  }

  private applyPlayerSave(p: PlayerSave): void {
    this.player.importSave(p);
    for (const c of p.explored ?? []) if (Number.isInteger(c)) this.explored.add(c);
    this.playTime = Number(p.playTime) || 0;
    if (!this.placePlayer(Number(p.x), Number(p.y))) this.respawnPlayer();
  }

  /** Advance the world clock only (title screen). */
  tickAmbient(dt: number): void {
    this.clock.advance(dt);
    this.time += dt;
    this.tickCount++;
  }

  /** What the attack button does with the selected item. */
  heldMode(): HeldMode {
    return heldMode(this.player);
  }

  private get safe(): { safeFrom: number; safeTo: number } {
    const sx = this.world.generator.spawnTileX;
    return { safeFrom: sx - SAFE_RADIUS, safeTo: sx + SAFE_RADIUS };
  }

  /** Advance one fixed step with the player's movement, item-use and combat intents. */
  tick(
    dt: number,
    input: MotorInput,
    use: UseIntent | null = null,
    action: ActionIntent = IDLE_ACTION,
  ): void {
    const p = this.player;
    const now = this.time;
    const night = this.clock.daylight < 0.35;
    this.charEnv.now = now;
    this.charEnv.dt = dt;
    p.refreshStats(now);

    // Player.
    const out = newStepOut();
    stepCharacter(this.charEnv, p, { move: input, use, action }, out);
    this.handlePlayerOut(out);

    // Adventurers (the same step function, driven by their brains).
    const pm = p.motor;
    this.adventurers.updateTiers(pm.x, pm.y, now);
    const steps = this.adventurers.stepActive(
      {
        interaction: this.ctx,
        monsters: this.monsters.monsters,
        drops: this.dropSystem.drops,
        player: p,
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
    this.monsters.step(dt, now, [p, ...active], {
      ...this.safe,
      night,
      enabled: this.monstersEnabled,
      anchors: active,
      maxMonsters: 26,
    });
    this.processCombatEvents();
    regenCharacter(p, now, dt);
    this.adventurers.regenActive(now, dt);
    const allied = this.adventurers.allied;
    for (const pk of this.dropSystem.step(dt, now, this.world, [p, ...active], allied)) {
      if (pk.characterId === p.id) this.events.pickups.push({ itemId: pk.itemId, count: pk.count });
    }
    if (this.dropSystem.expiredGold > 0) {
      this.economy.ledger.destroy('expired_drop', this.dropSystem.expiredGold);
      this.dropSystem.expiredGold = 0;
    }
    this.economy.tick(dt, now);
    this.drainSocial(now);
    for (const e of this.adventurers.events) this.events.ai.push(e);
    this.adventurers.events.length = 0;
    this.clock.advance(dt);
    this.time += dt;
    this.playTime += dt;
    this.tickCount++;
  }

  /** Collect social happenings for the presentation layer. */
  private drainSocial(now: number): void {
    const d = this.adventurers;
    for (const l of d.spoken) this.events.spoken.push(l);
    d.spoken.length = 0;
    for (const e of d.socialEvents) {
      if (e.type === 'invitePlayer') {
        this.town.invites.add(e.from);
        this.events.invites.push({ from: e.from, purpose: e.purpose });
      } else this.events.social.push(e);
    }
    d.socialEvents.length = 0;
    d.tradeEvents.length = 0;
    d.drainSocietyChanges(now);
    if (this.society.news.lastId !== this.lastNewsId) {
      for (const n of this.society.news.since(this.lastNewsId)) this.events.news.push(n);
      this.lastNewsId = this.society.news.lastId;
    }
    // Player's market sales (proceeds wait in the mailbox at the exchange).
    if (now >= this.salesCheckAt) {
      this.salesCheckAt = now + 1;
      const box = this.economy.market.peekMail('player');
      if (box && box.sales.length > this.town.seenSales) {
        for (const sale of box.sales.slice(this.town.seenSales)) this.events.sales.push(sale);
        this.town.seenSales = box.sales.length;
      }
    }
  }

  private handlePlayerOut(out: CharacterStepOut): void {
    for (const u of out.uses) {
      this.events.uses.push(u);
      this.dropSystem.spawn(u.drops, this.time, this.player.id);
    }
    if (out.failed) this.events.failed = out.failed;
    for (const e of out.actor) this.events.actor.push(e);
    for (const f of out.castFails)
      this.events.notices.push({ kind: 'castFail', skill: f.skill, reason: f.reason });
    if (out.weaponLevel !== null)
      this.events.notices.push({ kind: 'weaponLevel', level: out.weaponLevel });
    if (out.consume !== null) this.consume(out.consume);
    if (out.quick) this.quickUse(out.quick);
  }

  private handleAdventurerOut(a: Adventurer, out: CharacterStepOut): void {
    const c = a.character;
    for (const u of out.uses) {
      this.events.aiUses.push({ id: c.id, out: u });
      this.dropSystem.spawn(u.drops, this.time, c.id, 0.2);
    }
    for (const e of out.actor) this.events.aiActor.push({ id: c.id, event: e });
    if (out.quick) {
      const slot = bestPotion(c, out.quick);
      if (slot >= 0) drinkPotion(c, slot, this.combat, this.time);
    }
  }

  private monsterById(id: number): Monster | undefined {
    return this.monsters.monsters.find((m) => m.id === id);
  }

  private processCombatEvents(): void {
    const p = this.player;
    const now = this.time;
    for (const e of this.combat.events) {
      this.events.combat.push(e);
      if (e.type === 'damage') {
        const m = this.monsterById(e.targetId);
        if (m && e.attackerId > 0 && e.source !== 'dot') {
          claimMonster(m, e.attackerId, now);
          m.damageBy.set(e.attackerId, (m.damageBy.get(e.attackerId) ?? 0) + e.amount);
          // The player stepping in for an adventurer under attack is remembered.
          if (e.attackerId === p.id && m.targetId !== null && m.targetId !== p.id) {
            const a = this.adventurers.byCharacter(m.targetId);
            if (a) this.adventurers.noteHelp(a, now);
          }
        }
      }
      if (e.type === 'death') {
        if (e.targetId === p.id) this.onPlayerDeath();
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
    for (const e of this.monsters.events) this.events.monster.push(e);
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
    if (m.def.boss) this.events.notices.push({ kind: 'bossDefeated', monsterId: m.def.id });
  }

  /** Experience for a kill to the player or an adventurer (by key). */
  private creditKill(key: string, m: Monster, mul: number): void {
    const p = this.player;
    if (key === 'player') {
      const amount = Math.max(1, Math.round(expForKill(m.def.exp, p.level, m.def.level) * mul));
      this.events.exp.push({ amount, x: m.motor.x, y: m.motor.y - m.motor.height });
      const gained = p.gainExp(amount);
      if (gained > 0) {
        p.refreshStats(this.time);
        p.hp = p.stats.maxHp;
        p.mp = p.stats.maxMp;
        this.events.levelUps.push(p.level);
      }
      return;
    }
    const a = this.adventurers.byKey(key);
    if (a && this.adventurers.onKill(a, m.def, this.time, mul) > 0)
      this.events.aiLevelUps.push({ id: a.character.id, level: a.character.level });
  }

  private onPlayerDeath(): void {
    const p = this.player;
    p.respawnAt = this.time + RESPAWN_DELAY;
    p.combat.reset(this.combat);
    const lost = Math.round(expToNextLevel(p.level) * DEATH_EXP_PENALTY);
    const before = p.progress.exp;
    p.loseExp(lost);
    this.events.notices.push({ kind: 'died', expLost: before - p.progress.exp });
  }

  /** Revive at the spawn point once the respawn timer allows it. */
  requestRespawn(): boolean {
    const p = this.player;
    if (p.alive || this.time < p.respawnAt) return false;
    this.respawnPlayer();
    return true;
  }

  /** Cursor preview for the selected item at a tile. */
  preview(tx: number, ty: number): { action: UseAction; ok: boolean; reason?: UseFailReason } {
    const p = this.player;
    if (this.heldMode() !== 'sandbox' || !p.alive) return { action: 'none', ok: false };
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

  /** Mining progress (0..1) on a tile currently being hit, if any. */
  hitProgressAt(tx: number, ty: number): number {
    const h = this.player.hit;
    if (!h || h.key !== `t:${tx},${ty}` || this.time - h.lastHit > 3) return 0;
    const def = this.world.tiles.get(this.world.getFg(tx, ty));
    return def && def.durability > 0 ? Math.min(1, h.damage / def.durability) : 0;
  }

  // --- Consumables --------------------------------------------------------------------------

  /** Use the consumable in an inventory slot. */
  consume(index: number): boolean {
    const p = this.player;
    const st = p.inventory.get(index);
    const def = st ? itemRegistry.get(st.itemId) : undefined;
    const c = def?.consumable;
    if (!st || !c || !p.alive) return false;
    if (c.summon) {
      const m = p.motor;
      const tx = Math.floor(m.x / TILE_SIZE);
      const depth = Math.floor((m.y - 1) / TILE_SIZE) - this.world.surfaceY(tx);
      if (depth < (c.minDepth ?? 0)) {
        this.events.notices.push({ kind: 'consumeFail', reason: 'too_shallow' });
        return false;
      }
      if (this.monsters.bossActive) {
        this.events.notices.push({ kind: 'consumeFail', reason: 'boss_active' });
        return false;
      }
      const at = this.findSpawnSpot(c.summon, [12, 9, 15, 6]);
      if (!at) {
        this.events.notices.push({ kind: 'consumeFail', reason: 'no_room' });
        return false;
      }
      const boss = this.monsters.spawn(c.summon, at.x, at.y);
      p.inventory.removeAt(index, 1);
      this.adventurers.onBossSpawned(boss, this.time);
      this.events.notices.push({ kind: 'bossSpawned', monsterId: c.summon });
      this.events.notices.push({ kind: 'consumed', itemId: st.itemId });
      return true;
    }
    const r = drinkPotion(p, index, this.combat, this.time);
    if (r === 'cooldown') this.events.notices.push({ kind: 'consumeFail', reason: 'cooldown' });
    if (r !== 'ok') return false;
    this.events.notices.push({ kind: 'consumed', itemId: st.itemId });
    return true;
  }

  /** Quick-use the strongest potion of a kind from anywhere in the inventory (H / J keys). */
  quickUse(kind: 'heal' | 'mana'): boolean {
    const best = bestPotion(this.player, kind);
    return best >= 0 ? this.consume(best) : false;
  }

  /** Ground spot near the player (distances in tiles, either side) where a monster fits. */
  private findSpawnSpot(
    monsterId: string,
    distances: readonly number[],
  ): { x: number; y: number } | null {
    const def = getMonsterDef(monsterId);
    if (!def) return null;
    const m = this.player.motor;
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

  // --- Drops --------------------------------------------------------------------------------

  spawnDrops(drops: readonly Drop[], owner: number | null = null): void {
    this.dropSystem.spawn(drops, this.time, owner);
  }

  // --- Inventory & equipment commands (validated by shared rules) ---------------------------

  selectSlot(i: number): void {
    this.player.select(i);
  }

  clickInventory(index: number, button: 'left' | 'right'): void {
    const p = this.player;
    // Right-click on equipment equips it (quick equip).
    const st = p.inventory.get(index);
    if (button === 'right' && !p.inventory.cursor && st && itemRegistry.get(st.itemId)?.equip) {
      p.equipFromInventory(index);
      return;
    }
    p.inventory.click(index, button);
  }

  clickEquipment(slot: EquipSlotId): EquipFail | null {
    return this.player.equipment.click(this.player.inventory, slot, this.player.level);
  }

  /** Return the cursor stack to the inventory; whatever does not fit is dropped at the player. */
  returnCursor(): void {
    const left = this.player.inventory.returnCursor();
    if (left) {
      const m = this.player.motor;
      this.dropSystem.spawn(
        [{ itemId: left.itemId, count: left.count, x: m.x, y: m.y - m.height / 2 }],
        this.time,
        null,
        2,
      );
    }
  }

  craft(recipeId: string, times = 1): CraftResult {
    return craft(this.player.inventory, recipeId, times);
  }

  // --- Progression commands -----------------------------------------------------------------

  allocateStat(stat: StatKey, amount = 1): boolean {
    return this.player.allocate(stat, amount);
  }

  autoAllocate(): boolean {
    return this.player.autoAllocate();
  }

  learnSkill(skillId: string): LearnFail | null {
    return this.player.learn(skillId);
  }

  setSkillSlot(slot: number, skillId: string | null): void {
    this.player.setSkillSlot(slot, skillId);
  }

  /** Advance to a new job; hands out that job's starter weapon. */
  advanceJob(jobId: string): boolean {
    const p = this.player;
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
    this.events.notices.push({ kind: 'jobChanged', jobId, gift });
    return true;
  }

  // --- Developer commands (single player only; PHASE 6 restricts them to admins) ------------

  devSetLevel(level: number): void {
    const p = this.player;
    const target = Math.max(1, Math.min(200, Math.floor(level)));
    const before = p.level;
    while (p.level < target) p.gainExp(expToNextLevel(p.level) - p.progress.exp);
    if (p.level > before) this.events.levelUps.push(p.level);
    p.refreshStats(this.time);
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
  }

  /** Developer gold (accounted as a faucet so the money supply stays verifiable). */
  devGold(amount: number): void {
    const n = Math.max(0, Math.min(1_000_000, Math.floor(amount)));
    this.player.gold = Math.min(99_999_999, this.player.gold + n);
    this.economy.ledger.create('loot', n);
  }

  devSpawn(monsterId: string): boolean {
    const at = this.findSpawnSpot(monsterId, [7, 5, 9, 3]);
    if (!at) return false;
    // The summoner holds the claim, so bystanders leave it alone.
    claimMonster(this.monsters.spawn(monsterId, at.x, at.y), this.player.id, this.time);
    return true;
  }

  // --- Positioning --------------------------------------------------------------------------

  respawnPlayer(): void {
    const p = this.player;
    const spawn = this.world.spawnPoint();
    this.placePlayer(spawn.x, spawn.y);
    if (!p.alive) {
      p.alive = true;
      p.statuses.clear();
      p.refreshStats(this.time);
      p.hp = p.stats.maxHp;
      p.mp = p.stats.maxMp;
      p.invulnUntil = this.time + 2;
      this.events.notices.push({ kind: 'respawned' });
    }
  }

  /** Place the player's feet at a world position if the body fits there. */
  placePlayer(x: number, y: number): boolean {
    const m = this.player.motor;
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
    this.player.prevX = x;
    this.player.prevY = y;
    this.player.combat.reset(this.combat);
    return true;
  }

  expToNext(): number {
    return expToNextLevel(this.player.progress.level);
  }

  // --- Saving -------------------------------------------------------------------------------

  exportMeta(seed: number): WorldMeta {
    return {
      v: SAVE_VERSION,
      worldId: this.worldId,
      seed,
      timeOfDay: this.clock.timeOfDay,
      day: this.clock.day,
      savedAt: Date.now(),
    };
  }

  exportPlayer(): PlayerSave {
    const m = this.player.motor;
    return {
      v: SAVE_VERSION,
      x: m.x,
      y: m.y,
      explored: [...this.explored],
      playTime: this.playTime,
      ...this.player.exportFields(),
    };
  }

  exportAdventurers(): ReturnType<AdventurerDirector['toJSON']> {
    return this.adventurers.toJSON();
  }

  exportSociety(): WorldSocietySave {
    return { economy: this.economy.toJSON(), society: this.society.toJSON() };
  }
}

/** Monster ownership helper kept for UI/debug: the character holding a monster's claim. */
export function monsterOwner(m: Monster, now: number): number | null {
  return m.ownerId !== null && now <= m.ownerUntil ? m.ownerId : null;
}
