/**
 * Loose item drops in the world. Any living character can pick them up; drops can be owned for a
 * few seconds (loot priority) so nobody snipes another adventurer's kill.
 */
import { TILE_SIZE } from '../constants';
import { Rng } from '../math/rng';
import { type CollisionGrid, sweepX, sweepY } from '../physics/TileCollider';
import type { Drop } from '../sandbox/interaction';
import type { Character } from './Character';

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
  /** Character with pickup priority until `ownerUntil`. */
  ownerId: number | null;
  ownerUntil: number;
}

export interface PickupEvent {
  readonly characterId: number;
  readonly itemId: string;
  readonly count: number;
}

const DROP_SIZE = 10;
const DROP_GRAVITY = 900;
/** Drops fly to a character from about as far as tools can reach. */
export const MAGNET_RANGE = 5.5 * TILE_SIZE;
const PICKUP_RANGE = 14;
const DROP_LIFETIME = 300;
export const LOOT_PRIORITY = 8;

export class DropSystem {
  readonly drops: DropEntity[] = [];
  private nextId = 1;
  private readonly rng: Rng;

  constructor(seed = 7) {
    this.rng = new Rng(seed);
  }

  spawn(
    drops: readonly Drop[],
    now: number,
    ownerId: number | null = null,
    pickupDelay = 0.35,
  ): void {
    for (const d of drops) {
      this.drops.push({
        id: this.nextId++,
        itemId: d.itemId,
        count: d.count,
        x: d.x,
        y: d.y,
        vx: this.rng.range(-45, 45),
        vy: -110 - this.rng.range(0, 60),
        age: 0,
        pickupDelay,
        magnet: false,
        ownerId,
        ownerUntil: ownerId === null ? 0 : now + LOOT_PRIORITY,
      });
    }
  }

  private canTake(d: DropEntity, c: Character, now: number): boolean {
    if (!c.alive || d.pickupDelay > 0) return false;
    if (d.ownerId !== null && d.ownerId !== c.id && now < d.ownerUntil) return false;
    return c.inventory.capacityFor(d.itemId) > 0;
  }

  step(
    dt: number,
    now: number,
    grid: CollisionGrid,
    collectors: readonly Character[],
  ): PickupEvent[] {
    const out: PickupEvent[] = [];
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i] as DropEntity;
      d.age += dt;
      d.pickupDelay = Math.max(0, d.pickupDelay - dt);
      // Nearest eligible collector.
      let best: Character | null = null;
      let bd = MAGNET_RANGE;
      let bdx = 0;
      let bdy = 0;
      for (const c of collectors) {
        if (!this.canTake(d, c, now)) continue;
        const dx = c.motor.x - d.x;
        const dy = c.motor.y - c.motor.height / 2 - (d.y - DROP_SIZE / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < bd) {
          bd = dist;
          best = c;
          bdx = dx;
          bdy = dy;
        }
      }
      if (best && bd < PICKUP_RANGE) {
        const left = best.inventory.add(d.itemId, d.count);
        const taken = d.count - left;
        if (taken > 0) out.push({ characterId: best.id, itemId: d.itemId, count: taken });
        if (left === 0) {
          this.drops.splice(i, 1);
          continue;
        }
        d.count = left;
      }
      if (best) {
        // Fly toward the collector, ignoring terrain (classic sandbox magnet).
        d.magnet = true;
        const speed = 260 + d.age * 40;
        const dist = Math.max(0.001, bd);
        d.vx += ((bdx / dist) * speed - d.vx) * Math.min(1, dt * 10);
        d.vy += ((bdy / dist) * speed - d.vy) * Math.min(1, dt * 10);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      } else {
        d.magnet = false;
        d.vy = Math.min(d.vy + DROP_GRAVITY * dt, 420);
        const body = { x: d.x, y: d.y, width: DROP_SIZE, height: DROP_SIZE };
        const movedX = sweepX(grid, body, d.vx * dt);
        if (Math.abs(movedX - d.vx * dt) > 1e-6) d.vx = 0;
        const res = sweepY(grid, body, d.vy * dt, { ignorePlatforms: false });
        if (res.hitFloor) {
          d.vy = 0;
          d.vx *= 0.8;
        } else if (res.hitCeiling) d.vy = 0;
        d.x = body.x;
        d.y = body.y;
      }
      if (d.age > DROP_LIFETIME) this.drops.splice(i, 1);
    }
    return out;
  }
}
