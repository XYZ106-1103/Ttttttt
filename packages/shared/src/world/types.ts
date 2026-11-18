import type { Chunk } from './Chunk';

/** A placed world object instance (tree, flower, campfire...). */
export interface WorldObject {
  /** Stable id derived from position; unique per tile cell. */
  readonly id: number;
  /** Key into OBJECT_DEFS. */
  readonly key: string;
  readonly variant: number;
  /** Anchor tile: the (air) tile the object stands in. Sprite is drawn bottom-center on it. */
  readonly tx: number;
  readonly ty: number;
  /** Per-instance seed for visual variation (sway phase, flicker, ...). */
  readonly seed: number;
}

/** Read access to tiles beyond the chunk currently being generated. */
export interface TileReader {
  getFg(tx: number, ty: number): number;
}

/**
 * A world generator produces chunk contents deterministically from its seed.
 * Generating the same chunk twice must give identical results, in any order — this is what lets
 * chunks stream in and out and lets the server and clients agree on unmodified terrain.
 */
export interface WorldGenerator {
  readonly seed: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** Tile column where new characters spawn. */
  readonly spawnTileX: number;
  /** Row of the topmost natural ground tile in a column (before any player edits). */
  surfaceY(tileX: number): number;
  generateChunk(chunk: Chunk): void;
  generateObjects(cx: number, cy: number, tiles: TileReader): WorldObject[];
}
