import {
  type ActorEvent,
  applyItemUse,
  type CastFail,
  type CombatEvent,
  CombatWorld,
  craft,
  type CraftResult,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  deriveSeed,
  type Drop,
  type EquipFail,
  type EquipSlotId,
  expForKill,
  expToNextLevel,
  getMonsterDef,
  getSkillDef,
  HOTBAR_SIZE,
  type InteractionActor,
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
  OverworldGenerator,
  previewUse,
  rollLoot,
  Rng,
  type StatKey,
  stepMotor,
  sweepX,
  sweepY,
  TILE_SIZE,
  type UseAction,
  type UseFailReason,
  type UseOutcome,
  World,
  WorldClock,
} from '@world/shared';
import type { PlayerSave, SaveBundle, WorldMeta } from '../persistence/SaveStore';
import { SAVE_VERSION } from '../persistence/SaveStore';
import { Player, SKILL_BAR_SIZE } from './Player';

export { SKILL_BAR_SIZE, Player };

/** An item lying in the world, waiting to be picked up. */
export interface DropEntity {
  readonly id: number;
  readonly itemId: string;
  count: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Seconds before the drop can be picked up (so it visibly pops out first). */
  pickupDelay: number;
  magnet: boolean;
}

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
}

export interface UseIntent {
  readonly tx: number;
  readonly ty: number;
}

/** Combat input for one tick (mouse + keyboard). */
export interface ActionIntent {
  readonly attackPressed: boolean;
  readonly attackHeld: boolean;
  readonly aimX: number;
  readonly aimY: number;
  /** Skill bar slot pressed this tick (0..3). */
  readonly skillSlot: number | null;
  readonly dodge: boolean;
  readonly quickHeal: boolean;
  readonly quickMana: boolean;
}

export const IDLE_ACTION: ActionIntent = {
  attackPressed: false,
  attackHeld: false,
  aimX: 0,
  aimY: 0,
  skillSlot: null,
  dodge: false,
  quickHeal: false,
  quickMana: false,
};

export interface SimulationOptions {
  seed: number;
  worldId: string;
  playerName: string;
  startHour?: number;
  dayLengthSeconds?: number;
  save?: SaveBundle;
  /** Natural monster spawning (default true). */
  monsters?: boolean;
}

const DROP_SIZE = 10;
const DROP_GRAVITY = 900;
/** Drops fly to the player from about as far as tools can reach. */
const MAGNET_RANGE = 5.5 * TILE_SIZE;
const PICKUP_RANGE = 14;
const DROP_LIFETIME = 300;
/** Seconds without taking damage before out-of-combat regeneration kicks in. */
const OUT_OF_COMBAT = 5;
export const RESPAWN_DELAY = 5;
/** Fraction of the current level's requirement lost on death. */
export const DEATH_EXP_PENALTY = 0.05;
/** Tiles on each side of the spawn column where monsters never spawn (the starting hill). */
export const SAFE_RADIUS = 34;

/**
 * The local simulation: world, clock, the player's character, monsters, combat and loose item
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
  readonly drops: DropEntity[] = [];
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
  };
  /** Simulation time in seconds. */
  time = 0;
  tickCount = 0;
  playTime = 0;
  monstersEnabled: boolean;
  private nextDropId = 1;
  private readonly ctx: InteractionContext;
  private readonly lootRng: Rng;

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
    this.monstersEnabled = options.monsters ?? true;

    const spawn = this.world.spawnPoint();
    // Ids come from the combat world so players and monsters never collide.
    this.player = new Player(
      this.combat.newId(),
      options.playerName,
      spawn.x,
      spawn.y,
      this.movement,
    );
    this.player.motor.grounded = true;
    this.combat.add(this.player);
    if (save?.player) this.applyPlayerSave(save.player);
    else this.player.giveStartingItems();
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
  heldMode(): 'weapon' | 'consumable' | 'sandbox' {
    const st = this.player.inventory.get(this.player.selectedSlot);
    const def = st ? itemRegistry.get(st.itemId) : undefined;
    if (def?.weapon) return 'weapon';
    if (def?.consumable) return 'consumable';
    return 'sandbox';
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
    p.prevX = p.motor.x;
    p.prevY = p.motor.y;
    p.refreshStats(now);

    if (p.alive) this.tickPlayer(dt, input, use, action);

    this.combat.step(dt, now);
    this.monsters.step(dt, now, [p], {
      safeFrom: this.world.generator.spawnTileX - SAFE_RADIUS,
      safeTo: this.world.generator.spawnTileX + SAFE_RADIUS,
      night: this.clock.daylight < 0.35,
      enabled: this.monstersEnabled,
    });
    this.processCombatEvents();
    if (p.alive) this.regen(dt);
    this.stepDrops(dt);
    this.clock.advance(dt);
    this.time += dt;
    this.playTime += dt;
    this.tickCount++;
  }

  private tickPlayer(
    dt: number,
    input: MotorInput,
    use: UseIntent | null,
    action: ActionIntent,
  ): void {
    const p = this.player;
    const now = this.time;

    // Skill keys auto-swap to a matching weapon from the hotbar.
    let skill: string | null = null;
    if (action.skillSlot !== null) {
      skill = p.skillBar[action.skillSlot] ?? null;
      const def = skill ? getSkillDef(skill) : undefined;
      if (def?.weapon && p.usableWeapon()?.type !== def.weapon) {
        const slot = p.findHotbarWeapon(def.weapon);
        if (slot >= 0) {
          this.selectSlot(slot);
          p.refreshStats(now);
        }
      }
    }
    if (action.quickHeal) this.quickUse('heal');
    if (action.quickMana) this.quickUse('mana');

    const mode = this.heldMode();
    const weapon = p.usableWeapon();
    if (mode === 'weapon' && !weapon && action.attackPressed) {
      this.events.notices.push({ kind: 'weaponLevel', level: p.heldWeapon()?.reqLevel ?? 1 });
    }
    if (mode === 'consumable' && action.attackPressed) this.consume(p.selectedSlot);

    const override = p.combat.update(
      {
        self: p,
        combat: this.combat,
        grid: this.world,
        weapon,
        canAttack: mode === 'weapon' && weapon !== null,
        skillLevel: (id) => p.skillLevel(id),
        now,
        dt,
      },
      {
        attackPressed: action.attackPressed,
        attackHeld: action.attackHeld,
        aimX: action.aimX,
        aimY: action.aimY,
        skill,
        dodge: action.dodge,
        moveX: input.moveX,
      },
    );
    for (const e of p.combat.events) {
      this.events.actor.push(e);
      if (e.type === 'castFail')
        this.events.notices.push({ kind: 'castFail', skill: e.skill, reason: e.reason });
    }
    p.combat.events.length = 0;

    const staggered = now < p.staggerUntil;
    const m = p.motor;
    if (override.vx !== null) m.vx = override.vx;
    if (override.vy !== null) m.vy = override.vy;
    const dashing = override.vx !== null;
    const moveX = dashing
      ? Math.sign(override.vx ?? 0)
      : staggered
        ? 0
        : input.moveX * override.moveMul;
    stepMotor(
      m,
      {
        moveX,
        jumpHeld: input.jumpHeld && !override.noJump,
        jumpPressed: input.jumpPressed && !override.noJump && !staggered,
        down: input.down,
        speedMul: dashing ? Math.abs(override.vx ?? 0) / this.movement.runSpeed : p.stats.moveSpeed,
        jumpMul: p.stats.jump,
        gravityMul: override.gravityMul,
      },
      this.world,
      this.movement,
      dt,
    );
    if (override.facing) m.facing = override.facing;
    p.facing = m.facing;
    if (use && mode === 'sandbox') this.use(use.tx, use.ty);
    if (m.y > this.world.heightPixels + 64) this.combat.kill(p, -1);
  }

  private regen(dt: number): void {
    const p = this.player;
    const calm = this.time - p.lastHitAt > OUT_OF_COMBAT;
    p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.hpRegen * (calm ? 4 : 0.5) * dt);
    p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.mpRegen * (calm ? 2 : 1) * dt);
  }

  private monsterById(id: number): Monster | undefined {
    return this.monsters.monsters.find((m) => m.id === id);
  }

  private processCombatEvents(): void {
    const p = this.player;
    for (const e of this.combat.events) {
      this.events.combat.push(e);
      if (e.type === 'damage' && e.attackerId === p.id) {
        const m = this.monsterById(e.targetId);
        if (m) m.damageBy.set(p.id, (m.damageBy.get(p.id) ?? 0) + e.amount);
      }
      if (e.type === 'death' && e.targetId === p.id) this.onPlayerDeath();
    }
    this.combat.events.length = 0;
    for (const e of this.monsters.events) this.events.monster.push(e);
    this.monsters.events.length = 0;
    for (const m of this.monsters.deaths) this.onMonsterDeath(m);
    this.monsters.deaths.length = 0;
  }

  private onMonsterDeath(m: Monster): void {
    const p = this.player;
    const x = m.motor.x;
    const y = m.motor.y - m.motor.height / 2;
    if (m.damageBy.has(p.id)) {
      const amount = expForKill(m.def.exp, p.level, m.def.level);
      this.events.exp.push({ amount, x, y: m.motor.y - m.motor.height });
      const gained = p.gainExp(amount);
      if (gained > 0) {
        p.refreshStats(this.time);
        p.hp = p.stats.maxHp;
        p.mp = p.stats.maxMp;
        this.events.levelUps.push(p.level);
      }
      const loot = rollLoot(m.def.drops, this.lootRng);
      this.spawnDrops(loot.map((l) => ({ itemId: l.itemId, count: l.count, x, y })));
    }
    if (m.def.boss) this.events.notices.push({ kind: 'bossDefeated', monsterId: m.def.id });
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

  private actor(): InteractionActor {
    const p = this.player;
    const m = p.motor;
    return {
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      inventory: p.inventory,
      progress: p.hit,
      nextUseAt: p.nextUseAt,
    };
  }

  /** Cursor preview for the selected item at a tile. */
  preview(tx: number, ty: number): { action: UseAction; ok: boolean; reason?: UseFailReason } {
    if (this.heldMode() !== 'sandbox' || !this.player.alive) return { action: 'none', ok: false };
    return previewUse(this.ctx, this.actor(), this.player.selectedSlot, tx, ty);
  }

  /** Mining progress (0..1) on a tile currently being hit, if any. */
  hitProgressAt(tx: number, ty: number): number {
    const h = this.player.hit;
    if (!h || h.key !== `t:${tx},${ty}` || this.time - h.lastHit > 3) return 0;
    const def = this.world.tiles.get(this.world.getFg(tx, ty));
    return def && def.durability > 0 ? Math.min(1, h.damage / def.durability) : 0;
  }

  private use(tx: number, ty: number): void {
    const actor = this.actor();
    const out = applyItemUse(this.ctx, actor, this.player.selectedSlot, tx, ty, this.time);
    this.player.hit = actor.progress;
    this.player.nextUseAt = actor.nextUseAt;
    if (out.ok) {
      this.events.uses.push(out);
      this.spawnDrops(out.drops);
    } else if (
      out.reason &&
      out.reason !== 'cooldown' &&
      out.reason !== 'nothing' &&
      out.reason !== 'out_of_reach'
    ) {
      this.events.failed = out.reason;
    }
  }

  // --- Consumables --------------------------------------------------------------------------

  /** Use the consumable in an inventory slot. */
  consume(index: number): boolean {
    const p = this.player;
    const st = p.inventory.get(index);
    const def = st ? itemRegistry.get(st.itemId) : undefined;
    const c = def?.consumable;
    if (!st || !c || !p.alive) return false;
    if (this.time < p.potionCooldownUntil && (c.heal || c.mana)) {
      this.events.notices.push({ kind: 'consumeFail', reason: 'cooldown' });
      return false;
    }
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
      this.monsters.spawn(c.summon, at.x, at.y);
      this.events.notices.push({ kind: 'bossSpawned', monsterId: c.summon });
    }
    if (c.heal) this.combat.heal(p, c.heal);
    if (c.mana) this.combat.heal(p, c.mana, true);
    if (c.heal || c.mana) p.potionCooldownUntil = this.time + c.cooldown;
    p.inventory.removeAt(index, 1);
    this.events.notices.push({ kind: 'consumed', itemId: st.itemId });
    return true;
  }

  /** Quick-use the strongest potion of a kind from anywhere in the inventory (H / J keys). */
  quickUse(kind: 'heal' | 'mana'): boolean {
    const inv = this.player.inventory;
    let best = -1;
    let bestValue = 0;
    for (let i = 0; i < inv.size; i++) {
      const st = inv.get(i);
      const c = st ? itemRegistry.get(st.itemId)?.consumable : undefined;
      const v = kind === 'heal' ? (c?.heal ?? 0) : (c?.mana ?? 0);
      if (v > bestValue) {
        best = i;
        bestValue = v;
      }
    }
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

  spawnDrops(drops: readonly Drop[]): void {
    for (const d of drops) {
      this.drops.push({
        id: this.nextDropId++,
        itemId: d.itemId,
        count: d.count,
        x: d.x,
        y: d.y,
        vx: (Math.random() - 0.5) * 90,
        vy: -110 - Math.random() * 60,
        age: 0,
        pickupDelay: 0.35,
        magnet: false,
      });
    }
  }

  private stepDrops(dt: number): void {
    const m = this.player.motor;
    const px = m.x;
    const py = m.y - m.height / 2;
    const alive = this.player.alive;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as DropEntity;
      d.age += dt;
      d.pickupDelay = Math.max(0, d.pickupDelay - dt);
      const dx = px - d.x;
      const dy = py - (d.y - DROP_SIZE / 2);
      const dist = Math.hypot(dx, dy);
      const canTake =
        alive && d.pickupDelay <= 0 && this.player.inventory.capacityFor(d.itemId) > 0;
      if (canTake && dist < PICKUP_RANGE) {
        const left = this.player.inventory.add(d.itemId, d.count);
        const taken = d.count - left;
        if (taken > 0) this.events.pickups.push({ itemId: d.itemId, count: taken });
        if (left === 0) {
          this.drops.splice(i, 1);
          continue;
        }
        d.count = left;
      }
      if (canTake && dist < MAGNET_RANGE) d.magnet = true;
      if (d.magnet && canTake) {
        // Fly toward the player, ignoring terrain (classic sandbox magnet).
        const speed = 260 + d.age * 40;
        d.vx += ((dx / dist) * speed - d.vx) * Math.min(1, dt * 10);
        d.vy += ((dy / dist) * speed - d.vy) * Math.min(1, dt * 10);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      } else {
        d.magnet = false;
        d.vy = Math.min(d.vy + DROP_GRAVITY * dt, 420);
        const body = { x: d.x, y: d.y, width: DROP_SIZE, height: DROP_SIZE };
        const movedX = sweepX(this.world, body, d.vx * dt);
        if (Math.abs(movedX - d.vx * dt) > 1e-6) d.vx = 0;
        const res = sweepY(this.world, body, d.vy * dt, { ignorePlatforms: false });
        if (res.hitFloor) {
          d.vy = 0;
          d.vx *= 0.8;
        } else if (res.hitCeiling) d.vy = 0;
        d.x = body.x;
        d.y = body.y;
      }
      if (d.age > DROP_LIFETIME) this.drops.splice(i, 1);
    }
  }

  // --- Inventory & equipment commands (validated by shared rules) ---------------------------

  selectSlot(i: number): void {
    if (Number.isInteger(i) && i >= 0 && i < HOTBAR_SIZE && i !== this.player.selectedSlot) {
      this.player.selectedSlot = i;
      this.player.hit = null;
      this.player.combat.chargeStart = Number.NaN;
    }
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
      this.spawnDrops([{ itemId: left.itemId, count: left.count, x: m.x, y: m.y - m.height / 2 }]);
      for (const d of this.drops.slice(-1)) d.pickupDelay = 2;
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
        this.spawnDrops([{ itemId: gift, count: 1, x: m.x, y: m.y - m.height / 2 }]);
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

  devSpawn(monsterId: string): boolean {
    const at = this.findSpawnSpot(monsterId, [7, 5, 9, 3]);
    if (!at) return false;
    this.monsters.spawn(monsterId, at.x, at.y);
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
}
