import { CHUNK_SIZE, TILE_SIZE } from '../constants';
import { getObjectDef } from '../data/objects';
import { Chunk } from './Chunk';
import { localIndex, tileToChunk, tileToLocal } from './coords';
import {
  CHUNK_FORMAT_VERSION,
  rleDecode,
  rleEncode,
  sanitizeObjects,
  type SerializedChunk,
} from './serialization';
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

export interface ObjectChange {
  readonly cx: number;
  readonly cy: number;
  readonly removed: WorldObject;
}

export type TileChangeListener = (change: TileChange) => void;
export type ObjectChangeListener = (change: ObjectChange) => void;

/** Tallest object footprint (tiles) — bounds object lookups. */
const MAX_OBJECT_HEIGHT = 8;

/**
 * The authoritative tile world. Chunks are generated lazily on first access, or restored from
 * persisted (modified) data when available. Unmodified chunks far from any viewer can be evicted
 * and regenerated later; modified ones are serialized before eviction.
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
  private readonly objectsModified = new Set<number>();
  private readonly persisted = new Map<number, SerializedChunk>();
  private readonly dirty = new Set<number>();
  private readonly listeners = new Set<TileChangeListener>();
  private readonly objectListeners = new Set<ObjectChangeListener>();
  private loadedCount = 0;

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

  /** Number of chunks currently resident in memory (diagnostics). */
  get chunkCount(): number {
    return this.loadedCount;
  }

  /** Number of chunks that differ from the generator (diagnostics). */
  get modifiedChunkCount(): number {
    let n = this.persisted.size;
    this.chunks.forEach((c, i) => {
      if (c && (c.modified || this.objectsModified.has(i)) && !this.persisted.has(i)) n++;
    });
    return n;
  }

  inChunkBounds(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.widthChunks && cy < this.heightChunks;
  }

  inTileBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.widthTiles && ty < this.heightTiles;
  }

  private index(cx: number, cy: number): number {
    return cy * this.widthChunks + cx;
  }

  /** Returns the chunk, restoring or generating it on first access. Undefined outside the world. */
  getChunk(cx: number, cy: number): Chunk | undefined {
    if (!this.inChunkBounds(cx, cy)) return undefined;
    const index = this.index(cx, cy);
    let chunk = this.chunks[index];
    if (!chunk) {
      chunk = new Chunk(cx, cy);
      const saved = this.persisted.get(index);
      this.generator.generateChunk(chunk);
      if (saved) {
        const okFg = rleDecode(saved.fg, chunk.fg);
        const okBg = rleDecode(saved.bg, chunk.bg);
        chunk.modified = okFg && okBg;
      }
      this.chunks[index] = chunk;
      this.loadedCount++;
    }
    return chunk;
  }

  /** Returns the chunk only if it is resident. */
  peekChunk(cx: number, cy: number): Chunk | undefined {
    if (!this.inChunkBounds(cx, cy)) return undefined;
    return this.chunks[this.index(cx, cy)];
  }

  getFg(tx: number, ty: number): number {
    const chunk = this.getChunk(tileToChunk(tx), tileToChunk(ty));
    return chunk ? (chunk.fg[localIndex(tileToLocal(tx), tileToLocal(ty))] ?? 0) : 0;
  }

  getBg(tx: number, ty: number): number {
    const chunk = this.getChunk(tileToChunk(tx), tileToChunk(ty));
    return chunk ? (chunk.bg[localIndex(tileToLocal(tx), tileToLocal(ty))] ?? 0) : 0;
  }

  /** Collision code at a tile. The left, right and bottom world edges are solid; the sky is open. */
  collisionAt(tx: number, ty: number): CollisionCode {
    if (tx < 0 || tx >= this.widthTiles || ty >= this.heightTiles) return COLLISION_SOLID;
    if (ty < 0) return COLLISION_NONE;
    return (this.tiles.collision[this.getFg(tx, ty)] ?? COLLISION_NONE) as CollisionCode;
  }

  /**
   * Change a tile. Callers must validate first (see sandbox/interaction.ts) — this is the raw
   * mutation that validated actions (and, in PHASE 6, the server) apply.
   */
  setTile(tx: number, ty: number, layer: TileLayerName, id: number): boolean {
    const cx = tileToChunk(tx);
    const cy = tileToChunk(ty);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return false;
    const def = this.tiles.get(id);
    if (id !== 0 && (!def || def.layer !== layer)) {
      throw new Error(`Tile ${id} cannot be placed on layer ${layer}`);
    }
    const arr = layer === 'fg' ? chunk.fg : chunk.bg;
    const lx = tileToLocal(tx);
    const ly = tileToLocal(ty);
    const i = localIndex(lx, ly);
    const previous = arr[i] ?? 0;
    if (previous === id) return false;
    arr[i] = id;
    chunk.version++;
    chunk.modified = true;
    this.dirty.add(this.index(cx, cy));
    // Border tiles change neighbor autotile masks.
    const touch = (ncx: number, ncy: number): void => {
      const n = this.peekChunk(ncx, ncy);
      if (n) n.version++;
    };
    if (lx === 0) touch(cx - 1, cy);
    if (lx === CHUNK_SIZE - 1) touch(cx + 1, cy);
    if (ly === 0) touch(cx, cy - 1);
    if (ly === CHUNK_SIZE - 1) touch(cx, cy + 1);
    const change: TileChange = { tx, ty, layer, previous, next: id };
    for (const l of this.listeners) l(change);
    return true;
  }

  onTileChange(listener: TileChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onObjectChange(listener: ObjectChangeListener): () => void {
    this.objectListeners.add(listener);
    return () => this.objectListeners.delete(listener);
  }

  /** World objects anchored inside a chunk (generated or restored lazily, cached). */
  objectsInChunk(cx: number, cy: number): readonly WorldObject[] {
    if (!this.inChunkBounds(cx, cy)) return [];
    const index = this.index(cx, cy);
    let list = this.objects[index];
    if (!list) {
      const saved = this.persisted.get(index);
      list = saved?.objects
        ? sanitizeObjects(saved.objects, cx, cy)
        : this.generator.generateObjects(cx, cy, this);
      if (saved?.objects) this.objectsModified.add(index);
      this.objects[index] = list;
    }
    return list;
  }

  /** The object whose footprint covers tile (tx, ty), if any. */
  objectAt(tx: number, ty: number): WorldObject | null {
    const cy0 = tileToChunk(ty);
    const cy1 = tileToChunk(ty + MAX_OBJECT_HEIGHT);
    const cx0 = tileToChunk(tx - 1);
    const cx1 = tileToChunk(tx + 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const o of this.objectsInChunk(cx, cy)) {
          const fp = getObjectDef(o.key).footprint;
          const half = (fp.w - 1) >> 1;
          if (tx >= o.tx - half && tx <= o.tx + half && ty <= o.ty && ty > o.ty - fp.h) return o;
        }
      }
    }
    return null;
  }

  /** The object standing in tile (tx, ty) as its anchor, if any. */
  objectAnchoredAt(tx: number, ty: number): WorldObject | null {
    for (const o of this.objectsInChunk(tileToChunk(tx), tileToChunk(ty))) {
      if (o.tx === tx && o.ty === ty) return o;
    }
    return null;
  }

  removeObject(target: WorldObject): boolean {
    const cx = tileToChunk(target.tx);
    const cy = tileToChunk(target.ty);
    const list = this.objectsInChunk(cx, cy) as WorldObject[];
    const i = list.findIndex((o) => o.id === target.id);
    if (i < 0) return false;
    const [removed] = list.splice(i, 1);
    const index = this.index(cx, cy);
    this.objectsModified.add(index);
    this.dirty.add(index);
    if (removed) for (const l of this.objectListeners) l({ cx, cy, removed });
    return true;
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
    while (ty > 0 && this.collisionAt(tx, ty - 1) !== COLLISION_NONE) ty--;
    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE };
  }

  // --- Persistence -----------------------------------------------------------------------------

  private serialize(index: number): SerializedChunk | null {
    const chunk = this.chunks[index];
    const saved = this.persisted.get(index);
    if (!chunk) return saved ?? null;
    const objModified = this.objectsModified.has(index);
    if (!chunk.modified && !objModified) return null;
    return {
      v: CHUNK_FORMAT_VERSION,
      cx: chunk.cx,
      cy: chunk.cy,
      fg: rleEncode(chunk.fg),
      bg: rleEncode(chunk.bg),
      objects: objModified ? [...(this.objects[index] ?? saved?.objects ?? [])] : null,
    };
  }

  /** Register previously saved chunks. Call before the chunks are first accessed. */
  loadPersisted(chunks: Iterable<SerializedChunk>): number {
    let n = 0;
    for (const c of chunks) {
      if (!c || c.v !== CHUNK_FORMAT_VERSION || !this.inChunkBounds(c.cx, c.cy)) continue;
      const index = this.index(c.cx, c.cy);
      if (this.chunks[index]) continue; // already live — live data wins
      this.persisted.set(index, c);
      n++;
    }
    return n;
  }

  /** Serialized form of every chunk changed since the last call (for incremental saving). */
  collectDirty(): SerializedChunk[] {
    const out: SerializedChunk[] = [];
    for (const index of this.dirty) {
      const s = this.serialize(index);
      if (s) {
        this.persisted.set(index, s);
        out.push(s);
      }
    }
    this.dirty.clear();
    return out;
  }

  get hasUnsavedChanges(): boolean {
    return this.dirty.size > 0;
  }

  /**
   * Release resident chunk data outside the given chunk rectangle. Modified chunks are kept as
   * serialized data (and restored on demand); unmodified ones are simply regenerated later.
   */
  evictOutside(cx0: number, cy0: number, cx1: number, cy1: number): number {
    let evicted = 0;
    for (let index = 0; index < this.chunks.length; index++) {
      const chunk = this.chunks[index];
      if (!chunk) continue;
      if (chunk.cx >= cx0 && chunk.cx <= cx1 && chunk.cy >= cy0 && chunk.cy <= cy1) continue;
      const s = this.serialize(index);
      if (s) this.persisted.set(index, s);
      this.chunks[index] = undefined;
      this.objects[index] = undefined;
      this.objectsModified.delete(index);
      this.loadedCount--;
      evicted++;
    }
    return evicted;
  }
}
