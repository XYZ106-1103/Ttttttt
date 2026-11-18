import type { BaseStats, EquipmentData, InventoryData, SerializedChunk } from '@world/shared';

/** v2 (PHASE 3) adds progression, job, skills and equipment; v1 saves load with defaults. */
export const SAVE_VERSION = 2;

export interface WorldMeta {
  readonly v: number;
  readonly worldId: string;
  readonly seed: number;
  readonly timeOfDay: number;
  readonly day: number;
  readonly savedAt: number;
}

export interface PlayerSave {
  readonly v: number;
  readonly x: number;
  readonly y: number;
  readonly inventory: InventoryData;
  readonly selectedSlot: number;
  /** Chunk indices the player has seen (world map fog of war). */
  readonly explored: readonly number[];
  readonly playTime: number;
  // --- v2 ---
  readonly level?: number;
  readonly exp?: number;
  readonly jobId?: string;
  readonly stats?: BaseStats;
  readonly statPoints?: number;
  readonly skillPoints?: number;
  readonly skills?: Readonly<Record<string, number>>;
  readonly skillBar?: readonly (string | null)[];
  readonly equipment?: EquipmentData;
  readonly hp?: number;
  readonly mp?: number;
}

export interface SaveBundle {
  readonly meta: WorldMeta | null;
  readonly player: PlayerSave | null;
  readonly chunks: readonly SerializedChunk[];
}

export const EMPTY_SAVE: SaveBundle = { meta: null, player: null, chunks: [] };

/**
 * Where a world is stored. PHASE 2 keeps saves in the browser (IndexedDB); PHASE 6 adds a
 * server-backed implementation with the same interface.
 */
export interface SaveStore {
  /** False when data will not survive a reload (storage unavailable). */
  readonly persistent: boolean;
  load(worldId: string): Promise<SaveBundle>;
  saveChunks(worldId: string, chunks: readonly SerializedChunk[]): Promise<void>;
  saveState(worldId: string, meta: WorldMeta, player: PlayerSave): Promise<void>;
  clear(worldId: string): Promise<void>;
}

export class MemorySaveStore implements SaveStore {
  readonly persistent: boolean;
  private readonly chunks = new Map<string, SerializedChunk>();
  private meta: WorldMeta | null = null;
  private player: PlayerSave | null = null;

  constructor(persistent = false) {
    this.persistent = persistent;
  }

  async load(_worldId?: string): Promise<SaveBundle> {
    return { meta: this.meta, player: this.player, chunks: [...this.chunks.values()] };
  }

  async saveChunks(_worldId: string, chunks: readonly SerializedChunk[]): Promise<void> {
    for (const c of chunks) this.chunks.set(`${c.cx},${c.cy}`, c);
  }

  async saveState(_worldId: string, meta: WorldMeta, player: PlayerSave): Promise<void> {
    this.meta = meta;
    this.player = player;
  }

  async clear(): Promise<void> {
    this.chunks.clear();
    this.meta = null;
    this.player = null;
  }
}

const DB_NAME = 'project-world';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IdbSaveStore implements SaveStore {
  readonly persistent = true;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(): Promise<IdbSaveStore> {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('players')) db.createObjectStore('players');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    return new IdbSaveStore(await req(open));
  }

  private range(worldId: string): IDBKeyRange {
    return IDBKeyRange.bound(`${worldId}|`, `${worldId}|￿`);
  }

  async load(worldId: string): Promise<SaveBundle> {
    const tx = this.db.transaction(['meta', 'players', 'chunks'], 'readonly');
    const [meta, player, chunks] = await Promise.all([
      req(tx.objectStore('meta').get(worldId)) as Promise<WorldMeta | undefined>,
      req(tx.objectStore('players').get(worldId)) as Promise<PlayerSave | undefined>,
      req(tx.objectStore('chunks').getAll(this.range(worldId))) as Promise<SerializedChunk[]>,
    ]);
    return {
      meta: meta?.v === SAVE_VERSION ? meta : null,
      player: player?.v === SAVE_VERSION ? player : null,
      chunks: chunks ?? [],
    };
  }

  async saveChunks(worldId: string, chunks: readonly SerializedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const tx = this.db.transaction('chunks', 'readwrite');
    const store = tx.objectStore('chunks');
    for (const c of chunks) store.put(c, `${worldId}|${c.cx},${c.cy}`);
    await done(tx);
  }

  async saveState(worldId: string, meta: WorldMeta, player: PlayerSave): Promise<void> {
    const tx = this.db.transaction(['meta', 'players'], 'readwrite');
    tx.objectStore('meta').put(meta, worldId);
    tx.objectStore('players').put(player, worldId);
    await done(tx);
  }

  async clear(worldId: string): Promise<void> {
    const tx = this.db.transaction(['meta', 'players', 'chunks'], 'readwrite');
    tx.objectStore('meta').delete(worldId);
    tx.objectStore('players').delete(worldId);
    tx.objectStore('chunks').delete(this.range(worldId));
    await done(tx);
  }
}

/** IndexedDB when available, otherwise an in-memory store (progress lost on reload). */
export async function openSaveStore(): Promise<SaveStore> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    return await IdbSaveStore.open();
  } catch (err) {
    console.warn('Persistent saving unavailable, using memory store', err);
    return new MemorySaveStore(false);
  }
}
