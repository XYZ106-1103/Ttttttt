import { COLLISION_NONE, COLLISION_PLATFORM, type World } from '@world/shared';
import { MASK_E, MASK_N, MASK_S, MASK_W } from '../art/tiles/TilesetGenerator';

/**
 * Neighbor-connection mask for a foreground tile. Platforms connect to platforms and to solid
 * terrain (so a bridge anchored in a cliff has no dangling end cap).
 */
export function fgMask(world: World, tx: number, ty: number, id: number): number {
  const tiles = world.tiles;
  if ((tiles.collision[id] ?? 0) === COLLISION_PLATFORM) {
    let m = 0;
    const e = world.getFg(tx + 1, ty);
    const w = world.getFg(tx - 1, ty);
    if (e !== 0 && (tiles.collision[e] ?? 0) !== COLLISION_NONE) m |= MASK_E;
    if (w !== 0 && (tiles.collision[w] ?? 0) !== COLLISION_NONE) m |= MASK_W;
    return m;
  }
  let m = 0;
  if (tiles.connects(id, world.getFg(tx, ty - 1))) m |= MASK_N;
  if (tiles.connects(id, world.getFg(tx + 1, ty))) m |= MASK_E;
  if (tiles.connects(id, world.getFg(tx, ty + 1))) m |= MASK_S;
  if (tiles.connects(id, world.getFg(tx - 1, ty))) m |= MASK_W;
  // World edges count as connected so the map border has no outline.
  if (tx === 0) m |= MASK_W;
  if (tx === world.widthTiles - 1) m |= MASK_E;
  if (ty === world.heightTiles - 1) m |= MASK_S;
  return m;
}

/** Neighbor mask for a background wall. Walls hidden behind solid tiles count as connected. */
export function bgMask(world: World, tx: number, ty: number, id: number): number {
  const tiles = world.tiles;
  const connected = (x: number, y: number): boolean => {
    const b = world.getBg(x, y);
    return tiles.connects(id, b) || (tiles.collision[world.getFg(x, y)] ?? 0) === 1;
  };
  let m = 0;
  if (connected(tx, ty - 1)) m |= MASK_N;
  if (connected(tx + 1, ty)) m |= MASK_E;
  if (connected(tx, ty + 1)) m |= MASK_S;
  if (connected(tx - 1, ty)) m |= MASK_W;
  return m;
}

/** Deterministic per-position variant so terrain doesn't show a repeating grid. */
export function tileVariant(tx: number, ty: number, variants: number): number {
  let h = Math.imul(tx, 0x27d4eb2d) ^ Math.imul(ty, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) % variants;
}

/** Neighbor offsets indexed by side (N, E, S, W) — matches SIDE_* in the tileset generator. */
export const SIDE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
