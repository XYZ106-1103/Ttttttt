/**
 * Natural monster spawning rules: zone (surface / underground / deep) × time of day, off-screen
 * ring around the player, never inside the safe zone, never near torches, capped per area.
 */
import { TILE_SIZE } from '../constants';
import { biomeAt, type BiomeId } from '../data/biomes';
import { MONSTER_DEFS, type LootEntry, type MonsterDef, type SpawnZone } from '../data/monsters';
import type { Rng } from '../math/rng';
import { isRegionSolid } from '../physics/TileCollider';
import { COLLISION_NONE } from '../world/TileRegistry';
import type { World } from '../world/World';

export interface SpawnEnv {
  readonly world: World;
  readonly night: boolean;
  /** Player feet position (px). */
  readonly x: number;
  readonly y: number;
  /** Tile columns where nothing spawns (the starting village/hill). */
  readonly safeFrom: number;
  readonly safeTo: number;
  readonly rng: Rng;
  /** Torch tile id (spawns are suppressed near light sources). */
  readonly torchTile: number;
}

export interface SpawnPick {
  readonly def: MonsterDef;
  /** Feet position (px). */
  readonly x: number;
  readonly y: number;
}

export const SPAWN_RING_MIN = 26;
export const SPAWN_RING_MAX = 46;
const TORCH_RADIUS = 7;

/** Which spawn zone an empty tile belongs to. */
export function zoneAt(world: World, tx: number, ty: number): SpawnZone | null {
  if (world.collisionAt(tx, ty) !== COLLISION_NONE) return null;
  if (world.liquidAt(tx, ty) !== 0) return null;
  const depth = ty - world.surfaceY(tx);
  if (depth < 4) return world.getBg(tx, ty) === 0 ? 'surface' : null;
  if (depth < 10) return null;
  return depth >= 55 ? 'deep' : 'underground';
}

/** Cap of nearby monsters for the player's current zone. */
export function spawnCap(zone: SpawnZone | null, night: boolean): number {
  if (zone === 'surface') return night ? 7 : 4;
  if (zone === 'deep') return 7;
  return 6;
}

function torchNear(world: World, tx: number, ty: number, torch: number): boolean {
  for (let y = ty - TORCH_RADIUS; y <= ty + TORCH_RADIUS; y++)
    for (let x = tx - TORCH_RADIUS; x <= tx + TORCH_RADIUS; x++)
      if (world.getFg(x, y) === torch) return true;
  return false;
}

function pickDef(
  zone: SpawnZone,
  night: boolean,
  rng: Rng,
  defs: readonly MonsterDef[],
  biome: BiomeId,
  depth: number,
): MonsterDef | null {
  const options = defs.filter(
    (d) =>
      d.spawn &&
      d.spawn.zones.includes(zone) &&
      (d.spawn.time === 'any' || (d.spawn.time === 'night') === night) &&
      (!d.spawn.biomes || d.spawn.biomes.includes(biome)) &&
      depth >= (d.spawn.minDepth ?? -Infinity),
  );
  let total = 0;
  for (const d of options) total += d.spawn?.weight ?? 0;
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const d of options) {
    r -= d.spawn?.weight ?? 0;
    if (r <= 0) return d;
  }
  return options[options.length - 1] ?? null;
}

/** Try to find a spawn. Returns null when no valid spot was found this attempt. */
export function pickSpawn(
  env: SpawnEnv,
  defs: readonly MonsterDef[] = MONSTER_DEFS,
): SpawnPick | null {
  const { world, rng } = env;
  const ptx = Math.floor(env.x / TILE_SIZE);
  const pty = Math.floor((env.y - 1) / TILE_SIZE);
  for (let attempt = 0; attempt < 10; attempt++) {
    const tx = ptx + rng.sign() * rng.int(SPAWN_RING_MIN, SPAWN_RING_MAX);
    const ty = pty + rng.int(-14, 14);
    if (tx < 2 || tx >= world.widthTiles - 2 || ty < 2 || ty >= world.heightTiles - 2) continue;
    if (tx >= env.safeFrom && tx <= env.safeTo) continue;
    const zone = zoneAt(world, tx, ty);
    if (!zone) continue;
    const biome = biomeAt(tx, world.generator.spawnTileX).id;
    const def = pickDef(zone, env.night, rng, defs, biome, ty - world.surfaceY(tx));
    if (!def) continue;
    let fx = tx * TILE_SIZE + TILE_SIZE / 2;
    let fy: number;
    if (def.flying) {
      fy = ty * TILE_SIZE + TILE_SIZE;
    } else {
      // Drop to the floor below.
      let gy = -1;
      for (let y = ty; y < ty + 10; y++) {
        if (
          world.collisionAt(tx, y + 1) !== COLLISION_NONE &&
          world.collisionAt(tx, y) === COLLISION_NONE
        ) {
          gy = y + 1;
          break;
        }
      }
      if (gy < 0) continue;
      fy = gy * TILE_SIZE;
      if (zoneAt(world, tx, gy - 1) !== zone) continue;
    }
    const half = def.width / 2;
    if (isRegionSolid(world, fx - half, fy - def.height, fx + half, fy - 0.01)) {
      fx += TILE_SIZE / 2;
      if (isRegionSolid(world, fx - half, fy - def.height, fx + half, fy - 0.01)) continue;
    }
    if (torchNear(world, tx, ty, env.torchTile)) continue;
    return { def, x: fx, y: fy };
  }
  return null;
}

export function rollLoot(
  drops: readonly LootEntry[],
  rng: Rng,
): { itemId: string; count: number }[] {
  const out: { itemId: string; count: number }[] = [];
  for (const d of drops) {
    if (rng.next() >= d.chance) continue;
    out.push({ itemId: d.item, count: rng.int(d.min, d.max) });
  }
  return out;
}
