/**
 * Platformer navigation graph over the tile world, sized for a character body (1 tile wide,
 * 3 tiles tall). Nodes are tiles a character can stand in; edges are the moves the real motor
 * can perform: walk, auto-step up one tile, walk off a ledge and fall, drop through a platform,
 * and jumps. Jump edges are found by running the actual CharacterMotor on scripted inputs, so a
 * follower replaying the same inputs lands exactly where the edge says.
 */
import { TILE_SIZE } from '../../constants';
import type { MovementConfig } from '../../data/movement';
import { createMotorState, stepMotor } from '../../physics/CharacterMotor';
import type { CollisionGrid } from '../../physics/TileCollider';
import { COLLISION_NONE, COLLISION_PLATFORM, COLLISION_SOLID } from '../../world/TileRegistry';

export type EdgeKind = 'walk' | 'step' | 'drop' | 'jump' | 'through';

export interface NavEdge {
  readonly to: number;
  readonly kind: EdgeKind;
  readonly cost: number;
  readonly dir: -1 | 0 | 1;
  /** Jump script: horizontal input and how many ticks jump is held. */
  readonly moveX?: number;
  readonly holdTicks?: number;
}

export interface NavWorld extends CollisionGrid {
  readonly widthTiles: number;
  readonly heightTiles: number;
}

const SIM_DT = 1 / 60;
const MAX_FALL = 14;
const JUMP_VARIANTS: readonly [number, number][] = [
  // [moveX fraction, ticks jump is held]
  [1, 40],
  [0.6, 40],
  [0.3, 40],
  [1, 9],
  [0.45, 12],
];

export class NavGrid {
  private readonly jumpCache = new Map<number, NavEdge[]>();
  /** Diagnostics: jump traces simulated. */
  traces = 0;

  constructor(
    readonly world: NavWorld,
    readonly movement: MovementConfig,
  ) {}

  key(tx: number, ty: number): number {
    return ty * this.world.widthTiles + tx;
  }

  tx(key: number): number {
    return key % this.world.widthTiles;
  }

  ty(key: number): number {
    return Math.floor(key / this.world.widthTiles);
  }

  /** Space a body can occupy (lava never: paths keep out of it). */
  private free(tx: number, ty: number): boolean {
    return (
      this.world.collisionAt(tx, ty) !== COLLISION_SOLID &&
      (this.world.liquidAt?.(tx, ty) ?? 0) !== 2
    );
  }

  /** Something to stand on; water counts (adventurers swim across lakes along the surface). */
  private floor(tx: number, ty: number): boolean {
    return this.world.collisionAt(tx, ty) !== COLLISION_NONE || this.world.liquidAt?.(tx, ty) === 1;
  }

  /** Body fits in column tx with feet on top of row ty + 1. */
  fits(tx: number, ty: number): boolean {
    return (
      tx >= 1 &&
      tx < this.world.widthTiles - 1 &&
      ty >= 3 &&
      ty < this.world.heightTiles - 1 &&
      this.free(tx, ty) &&
      this.free(tx, ty - 1) &&
      this.free(tx, ty - 2)
    );
  }

  standable(tx: number, ty: number): boolean {
    return this.fits(tx, ty) && this.floor(tx, ty + 1);
  }

  /** Nearest standable node at or below (tx, ty), searching down a few tiles. */
  groundBelow(tx: number, ty: number, depth = MAX_FALL): number | null {
    for (let y = ty; y <= ty + depth; y++) if (this.standable(tx, y)) return this.key(tx, y);
    return null;
  }

  /** Node a body with feet at (x, y) stands on, if standable. */
  nodeAt(x: number, y: number): number | null {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.round(y / TILE_SIZE) - 1;
    for (const dy of [0, -1, 1]) if (this.standable(tx, ty + dy)) return this.key(tx, ty + dy);
    return null;
  }

  /** Drop jump-edge caches near a changed tile. */
  invalidate(tx: number, ty: number): void {
    for (const k of this.jumpCache.keys()) {
      if (Math.abs(this.tx(k) - tx) <= 8 && Math.abs(this.ty(k) - ty) <= 10)
        this.jumpCache.delete(k);
    }
  }

  clear(): void {
    this.jumpCache.clear();
  }

  edges(key: number, wantJumps = true): NavEdge[] {
    const tx = this.tx(key);
    const ty = this.ty(key);
    const out: NavEdge[] = [];
    for (const d of [-1, 1] as const) {
      const nx = tx + d;
      if (this.standable(nx, ty)) out.push({ to: this.key(nx, ty), kind: 'walk', cost: 1, dir: d });
      else if (this.standable(nx, ty - 1) && this.free(tx, ty - 3))
        out.push({ to: this.key(nx, ty - 1), kind: 'step', cost: 1.4, dir: d });
      else if (this.fits(nx, ty) && !this.floor(nx, ty + 1)) {
        // Walk off the ledge and fall.
        for (let k = 1; k <= MAX_FALL; k++) {
          if (!this.free(nx, ty + k)) break;
          if (this.standable(nx, ty + k)) {
            out.push({ to: this.key(nx, ty + k), kind: 'drop', cost: 1 + k * 0.35, dir: d });
            break;
          }
        }
      }
    }
    if (this.world.collisionAt(tx, ty + 1) === COLLISION_PLATFORM) {
      for (let k = 2; k <= MAX_FALL; k++) {
        if (!this.free(tx, ty + k)) break;
        if (this.standable(tx, ty + k)) {
          out.push({ to: this.key(tx, ty + k), kind: 'through', cost: 1 + k * 0.35, dir: 0 });
          break;
        }
      }
    }
    if (wantJumps) for (const e of this.jumpEdges(key)) out.push(e);
    return out;
  }

  /** Jump edges from a node (cached). */
  jumpEdges(key: number): NavEdge[] {
    const hit = this.jumpCache.get(key);
    if (hit) return hit;
    const tx = this.tx(key);
    const ty = this.ty(key);
    const out: NavEdge[] = [];
    const seen = new Set<number>([key]);
    for (const d of [-1, 1] as const) {
      for (const [k, hold] of JUMP_VARIANTS) {
        const land = this.traceJump(tx, ty, d * k, hold);
        if (land === null || seen.has(land)) continue;
        // Plain walks/steps are already covered by cheaper edges.
        const ltx = this.tx(land);
        const lty = this.ty(land);
        if (Math.abs(ltx - tx) <= 1 && lty >= ty - 1 && lty <= ty) continue;
        seen.add(land);
        out.push({
          to: land,
          kind: 'jump',
          cost: 2.2 + Math.abs(ltx - tx) * 0.9 + Math.max(0, ty - lty) * 0.4,
          dir: d,
          moveX: d * k,
          holdTicks: hold,
        });
      }
    }
    this.jumpCache.set(key, out);
    if (this.jumpCache.size > 40_000) this.jumpCache.clear();
    return out;
  }

  /** Replay a jump with the real motor from a standing start; returns the landing node. */
  traceJump(tx: number, ty: number, moveX: number, holdTicks: number): number | null {
    this.traces++;
    const m = createMotorState(tx * TILE_SIZE + TILE_SIZE / 2, (ty + 1) * TILE_SIZE, this.movement);
    m.grounded = true;
    for (let i = 0; i < 110; i++) {
      stepMotor(
        m,
        { moveX, jumpHeld: i < holdTicks, jumpPressed: i === 0, down: false },
        this.world,
        this.movement,
        SIM_DT,
      );
      if (i > 2 && m.grounded) {
        const node = this.nodeAt(m.x, m.y);
        return node;
      }
    }
    return null;
  }
}
