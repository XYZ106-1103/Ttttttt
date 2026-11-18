import { CHUNK_SIZE, TILE_SIZE } from '../constants';
import { Chunk } from './Chunk';
import { localIndex, tileToChunk, tileToLocal } from './coords';
import {
  COLLISION_NONE,
  COLLISION_SOLID,
  type CollisionCode,
  tileRegistry,
  type TileRegistry,
} from './TileRegistry';
import type { TileReader, WorldGenerator, WorldObject } from './types';

export type TileLayerName = 'fg' | 'bg';

export interface TileChange {
  readonly tx: number;
  readonly ty: number;
  readonly layer: TileLayerName;
  readonly previous: number;
  readonly next: number;
}

export type TileChangeListener = (change: TileChange) => void;

/**
 * The authoritative tile world. Chunks are generated lazily on first access.
 *
 * PHASE 1: chunk *data* stays resident once generated (a full 2048×512 world is ~4 MB);
 * rendering streams independently. PHASE 2 adds persistence of modified chunks and eviction of
 * unmodified ones.
 */
export class World implements TileReader {
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly widthChunks: number;
  readonly heightChunks: number;
  readonly generator: WorldGenerator;
  readonly tiles: TileRegistry;

  private readonly chunks: (Chunk | undefined)[];
  private readonly objects: (WorldObject[] | undefined)[];
  private readonly listeners = new Set<TileChangeListener>();
  private generatedCount = 0;

  constructor(generator: WorldGenerator, tiles: TileRegistry = tileRegistry) {
    this.generator = generator;
    this.tiles = tiles;
    this.widthTiles = generator.widthTiles;
    this.heightTiles = generator.heightTiles;
    if (this.widthTiles % CHUNK_SIZE !== 0 || this.heightTiles % CHUNK_SIZE !== 0) {
      throw new Error('World dimensions must be multiples of CHUNK_SIZE');
    }
    this.widthChunks = this.widthTiles / CHUNK_SIZE;
    this.heightChunks = this.heightTiles / CHUNK_SIZE;
    this.chunks = new Array(this.widthChunks * this.heightChunks);
    this.objects = new Array(this.widthChunks * this.heightChunks);
  }

  get seed(): number {
    return this.generator.seed;
  }

  get widthPixels(): number {
    return this.widthTiles * TILE_SIZE;
  }

  get heightPixels(): number {
    return this.heightTiles * TILE_SIZE;
  }

  /** Number of chunks generated so far (diagnostics). */
  get chunkCount(): number {
    return this.generatedCount;
  }

  inChunkBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.widthChunks && cy < this.heightChunks;
  }

  inTileBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.widthTiles && ty < this.heightTiles;
  }

  /** Returns the chunk, generating it on first access. Undefined outside the world. */
  getChunk(cx: number, cy: number): Chunk | undefined {
    if (!this.inChunkBounds(cx, cy)) return undefined;
    const index = cy * this.widthChunks + cx;
    let chunk = this.chunks[index];
    if (!chunk) {
      chunk = new Chunk(cx, cy);
      this.generator.generateChunk(chunk);
      this.chunks[index] = chunk;
      this.generatedCount++;
    }
    return chunk;
  }

  /** Returns the chunk only if it has already been generated. */
  peekChunk(cx: number, cy: number): Chunk | undefined {
    if (!this.inChunkBounds(cx, cy)) return undefined;
    return this.chunks[cy * this.widthChunks + cx];
  }

  getFg(tx: number, ty: number): number {
    const chunk = this.getChunk(tileToChunk(tx), tileToChunk(ty));
    return chunk ? (chunk.fg[localIndex(tileToLocal(tx), tileToLocal(ty))] ?? 0) : 0;
  }

  getBg(tx: number, ty: number): number {
    const chunk = this.getChunk(tileToChunk(tx), tileToChunk(ty));
    return chunk ? (chunk.bg[localIndex(tileToLocal(tx), tileToLocal(ty))] ?? 0) : 0;
  }

  /**
   * Collision code at a tile. The left, right and bottom world edges are solid; the sky is open.
   */
  collisionAt(tx: number, ty: number): CollisionCode {
    if (tx < 0 || tx >= this.widthTiles || ty >= this.heightTiles) return COLLISION_SOLID;
    if (ty < 0) return COLLISION_NONE;
    return (this.tiles.collision[this.getFg(tx, ty)] ?? COLLISION_NONE) as CollisionCode;
  }

  /**
   * Change a tile. PHASE 1 exposes this for tools/tests; PHASE 2 routes player mining/building
   * through validated actions that call it (and PHASE 6 moves validation to the server).
   */
  setTile(tx: number, ty: number, layer: TileLayerName, id: number): boolean {
    const chunk = this.getChunk(tileToChunk(tx), tileToChunk(ty));
    if (!chunk) return false;
    const def = this.tiles.get(id);
    if (id !== 0 && (!def || def.layer !== layer)) {
      throw new Error(`Tile ${id} cannot be placed on layer ${layer}`);
    }
    const arr = layer === 'fg' ? chunk.fg : chunk.bg;
    const i = localIndex(tileToLocal(tx), tileToLocal(ty));
    const previous = arr[i] ?? 0;
    if (previous === id) return false;
    arr[i] = id;
    chunk.version++;
    chunk.modified = true;
    const change: TileChange = { tx, ty, layer, previous, next: id };
    for (const l of this.listeners) l(change);
    return true;
  }

  onTileChange(listener: TileChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** World objects anchored inside a chunk (generated lazily, cached). */
  objectsInChunk(cx: number, cy: number): readonly WorldObject[] {
    if (!this.inChunkBounds(cx, cy)) return [];
    const index = cy * this.widthChunks + cx;
    let list = this.objects[index];
    if (!list) {
      list = this.generator.generateObjects(cx, cy, this);
      this.objects[index] = list;
    }
    return list;
  }

  surfaceY(tx: number): number {
    if (tx < 0) return this.generator.surfaceY(0);
    if (tx >= this.widthTiles) return this.generator.surfaceY(this.widthTiles - 1);
    return this.generator.surfaceY(tx);
  }

  /** Spawn position in world pixels (feet position: bottom-center of the body). */
  spawnPoint(): { x: number; y: number } {
    const tx = this.generator.spawnTileX;
    let ty = this.surfaceY(tx);
    // Walk upward in case something was built on the spawn column.
    while (ty > 0 && this.collisionAt(tx, ty - 1) !== COLLISION_NONE) ty--;
    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE };
  }
}
