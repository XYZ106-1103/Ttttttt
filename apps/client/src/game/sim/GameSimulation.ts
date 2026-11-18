import {
  type CharacterProgress,
  craft,
  type CraftResult,
  createMotorState,
  createStartingProgress,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  deriveStats,
  type Drop,
  expToNextLevel,
  HOTBAR_SIZE,
  type HitProgress,
  type InteractionActor,
  type InteractionContext,
  Inventory,
  isRegionSolid,
  itemRegistry,
  type MotorInput,
  type MotorState,
  type MovementConfig,
  OverworldGenerator,
  previewUse,
  STARTING_ITEMS,
  stepMotor,
  sweepX,
  sweepY,
  TILE_SIZE,
  type UseAction,
  type UseFailReason,
  type UseOutcome,
  applyItemUse,
  World,
  WorldClock,
} from '@world/shared';
import type { PlayerSave, SaveBundle, WorldMeta } from '../persistence/SaveStore';
import { SAVE_VERSION } from '../persistence/SaveStore';

export interface PlayerCharacter {
  name: string;
  jobId: string;
  progress: CharacterProgress;
  hp: number;
  mp: number;
  motor: MotorState;
  inventory: Inventory;
  selectedSlot: number;
  /** Mining/chopping progress and use cooldown (InteractionActor state). */
  hit: HitProgress | null;
  nextUseAt: number;
  /** Feet position before the latest tick (render interpolation). */
  prevX: number;
  prevY: number;
}

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

/** Things that happened since the renderer last consumed events. */
export interface SimEvents {
  uses: UseOutcome[];
  pickups: PickupEvent[];
  failed: UseFailReason | null;
}

export interface UseIntent {
  readonly tx: number;
  readonly ty: number;
}

export interface SimulationOptions {
  seed: number;
  worldId: string;
  playerName: string;
  startHour?: number;
  dayLengthSeconds?: number;
  save?: SaveBundle;
}

const DROP_SIZE = 10;
const DROP_GRAVITY = 900;
/** Drops fly to the player from about as far as tools can reach. */
const MAGNET_RANGE = 5.5 * TILE_SIZE;
const PICKUP_RANGE = 14;
const DROP_LIFETIME = 300;

/**
 * The local simulation: world, clock, the player's character and loose item drops. Contains no
 * rendering code; PHASE 6 moves the authoritative copy to the server and this becomes the
 * client-side predictor.
 */
export class GameSimulation {
  readonly world: World;
  readonly clock: WorldClock;
  readonly movement: MovementConfig;
  readonly player: PlayerCharacter;
  readonly worldId: string;
  readonly drops: DropEntity[] = [];
  readonly explored = new Set<number>();
  readonly events: SimEvents = { uses: [], pickups: [], failed: null };
  /** Simulation time in seconds. */
  time = 0;
  tickCount = 0;
  playTime = 0;
  private nextDropId = 1;
  private readonly ctx: InteractionContext;

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

    const spawn = this.world.spawnPoint();
    const progress = createStartingProgress();
    const derived = deriveStats(progress);
    const inventory = new Inventory();
    this.player = {
      name: options.playerName,
      jobId: 'novice',
      progress,
      hp: derived.maxHp,
      mp: derived.maxMp,
      motor: createMotorState(spawn.x, spawn.y, this.movement),
      inventory,
      selectedSlot: 0,
      hit: null,
      nextUseAt: 0,
      prevX: spawn.x,
      prevY: spawn.y,
    };
    this.player.motor.grounded = true;
    if (save?.player) this.applyPlayerSave(save.player);
    else for (const s of STARTING_ITEMS) inventory.add(s.item, s.count);
  }

  private applyPlayerSave(p: PlayerSave): void {
    this.player.inventory.load(p.inventory);
    this.player.selectedSlot = Math.max(0, Math.min(HOTBAR_SIZE - 1, p.selectedSlot | 0));
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

  /** Advance one fixed step with the player's input and (optional) item-use intent. */
  tick(dt: number, input: MotorInput, use: UseIntent | null = null): void {
    const p = this.player;
    p.prevX = p.motor.x;
    p.prevY = p.motor.y;
    stepMotor(p.motor, input, this.world, this.movement, dt);
    if (use) this.use(use.tx, use.ty);
    this.stepDrops(dt);
    this.clock.advance(dt);
    this.time += dt;
    this.playTime += dt;
    this.tickCount++;
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
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as DropEntity;
      d.age += dt;
      d.pickupDelay = Math.max(0, d.pickupDelay - dt);
      const dx = px - d.x;
      const dy = py - (d.y - DROP_SIZE / 2);
      const dist = Math.hypot(dx, dy);
      const canTake = d.pickupDelay <= 0 && this.player.inventory.capacityFor(d.itemId) > 0;
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

  // --- Inventory commands (validated by the shared Inventory) ---------------------------------

  selectSlot(i: number): void {
    if (Number.isInteger(i) && i >= 0 && i < HOTBAR_SIZE && i !== this.player.selectedSlot) {
      this.player.selectedSlot = i;
      this.player.hit = null;
    }
  }

  clickInventory(index: number, button: 'left' | 'right'): void {
    this.player.inventory.click(index, button);
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

  // --- Positioning ----------------------------------------------------------------------------

  respawnPlayer(): void {
    const spawn = this.world.spawnPoint();
    this.placePlayer(spawn.x, spawn.y);
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
    return true;
  }

  expToNext(): number {
    return expToNextLevel(this.player.progress.level);
  }

  // --- Saving ---------------------------------------------------------------------------------

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
      inventory: this.player.inventory.toJSON(),
      selectedSlot: this.player.selectedSlot,
      explored: [...this.explored],
      playTime: this.playTime,
    };
  }
}
