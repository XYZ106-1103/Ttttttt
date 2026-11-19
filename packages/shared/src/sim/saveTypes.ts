/**
 * Save formats shared by the offline client (IndexedDB) and the server (PostgreSQL). Everything
 * loaded from a save is untrusted and validated by the owning system's loader.
 */
import type { AdventurerSave } from '../ai/Adventurer';
import type { BaseStats } from '../entities/stats';
import type { EquipmentData } from '../sandbox/Equipment';
import type { InventoryData } from '../sandbox/Inventory';
import type { SerializedChunk } from '../world/serialization';

/** v2 (PHASE 3) adds progression, job, skills and equipment; v1 saves load with defaults. */
export const SAVE_VERSION = 3;

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
  // --- v3 ---
  readonly gold?: number;
}

export interface SaveBundle {
  readonly meta: WorldMeta | null;
  readonly player: PlayerSave | null;
  readonly chunks: readonly SerializedChunk[];
  /** AI adventurers (PHASE 4); null for older saves. */
  readonly adventurers?: readonly AdventurerSave[] | null;
  /** Economy and society (PHASE 5): market, prices, shops, parties, guilds, news. */
  readonly society?: WorldSocietySave | null;
}

/** Untrusted on load: every part is validated by its own loader. */
export interface WorldSocietySave {
  readonly economy: unknown;
  readonly society: unknown;
}
