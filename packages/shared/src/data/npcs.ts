/**
 * Village NPCs (non-player characters). They never move or fight; talking to one opens its
 * service. Positions are tile columns relative to the spawn column.
 */
export type NpcRole = 'shop' | 'exchange' | 'guild' | 'smith' | 'quests';

export interface NpcDef {
  readonly id: string;
  readonly nameKey: string;
  readonly role: NpcRole;
  /** Tile column relative to spawn. */
  readonly x: number;
  /** Seed for the procedural appearance. */
  readonly look: number;
  readonly facing: 1 | -1;
  readonly shopId?: string;
}

export const NPC_DEFS: readonly NpcDef[] = [
  {
    id: 'shopkeeper',
    nameKey: 'npc.shopkeeper',
    role: 'shop',
    x: -17,
    look: 0x5a17,
    facing: 1,
    shopId: 'general_store',
  },
  { id: 'clerk', nameKey: 'npc.clerk', role: 'exchange', x: 18, look: 0x3c11, facing: -1 },
  { id: 'registrar', nameKey: 'npc.registrar', role: 'guild', x: -25, look: 0x7e42, facing: 1 },
  {
    id: 'blacksmith',
    nameKey: 'npc.blacksmith',
    role: 'smith',
    x: 5,
    look: 0x2b9d,
    facing: -1,
    shopId: 'smithy',
  },
  { id: 'guide', nameKey: 'npc.guide', role: 'quests', x: -7, look: 0x61c3, facing: 1 },
];

/** Market stall columns (relative to spawn) kept by merchant adventurers. */
export const MERCHANT_STALLS: readonly number[] = [-11, 10, 23];
/** Where adventurers gather to use the exchange (relative to spawn). */
export const MARKET_X = 15;
/** How close (tiles) a character must be to use an NPC's service. */
export const NPC_REACH = 6;

export function getNpcDef(id: string): NpcDef | undefined {
  return NPC_DEFS.find((n) => n.id === id);
}
