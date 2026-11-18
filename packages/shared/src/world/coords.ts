import { CHUNK_SIZE, TILE_SIZE } from '../constants';

/** World pixel → tile coordinate. */
export function pixelToTile(px: number): number {
  return Math.floor(px / TILE_SIZE);
}

/** Tile → chunk coordinate. */
export function tileToChunk(t: number): number {
  return Math.floor(t / CHUNK_SIZE);
}

/** Tile → local coordinate inside its chunk, always in [0, CHUNK_SIZE). */
export function tileToLocal(t: number): number {
  const r = t % CHUNK_SIZE;
  return r < 0 ? r + CHUNK_SIZE : r;
}

/** Index into a chunk's tile arrays. */
export function localIndex(lx: number, ly: number): number {
  return ly * CHUNK_SIZE + lx;
}
