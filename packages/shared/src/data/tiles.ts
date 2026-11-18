/**
 * Tile (block) definitions — the single source of truth for gameplay properties of terrain.
 *
 * Visual recipes live in the client (`apps/client/src/game/art/tiles/tileArt.ts`) keyed by `key`,
 * so that the server can load this file without pulling in any rendering code.
 *
 * IDs are persisted in chunk data. Never renumber an existing tile; only append new ones.
 */

export type TileLayer = 'fg' | 'bg';

/** How a tile interacts with moving bodies. */
export type TileCollision = 'none' | 'solid' | 'platform';

export interface TileDef {
  readonly id: number;
  readonly key: string;
  /** i18n key for the display name. */
  readonly nameKey: string;
  readonly layer: TileLayer;
  readonly collision: TileCollision;
  /**
   * Tiles in the same merge group connect visually (no outline between them),
   * e.g. dirt, grass and stone blend into one continuous landmass.
   */
  readonly mergeGroup: string;
  /** Mining resistance (PHASE 2). */
  readonly hardness: number;
  /** Light transmission multiplier applied when light leaves this tile (0 = opaque, 1 = clear). */
  readonly lightPass: number;
  /** Minimap color (#rrggbb). */
  readonly mapColor: string;
}

/** Reserved id for "nothing here" in both layers. */
export const AIR = 0;

const defs: TileDef[] = [
  {
    id: AIR,
    key: 'air',
    nameKey: 'tile.air',
    layer: 'fg',
    collision: 'none',
    mergeGroup: 'none',
    hardness: 0,
    lightPass: 0.92,
    mapColor: '#000000',
  },
  // --- Foreground terrain -------------------------------------------------------------------
  {
    id: 1,
    key: 'dirt',
    nameKey: 'tile.dirt',
    layer: 'fg',
    collision: 'solid',
    mergeGroup: 'earth',
    hardness: 1,
    lightPass: 0.66,
    mapColor: '#8a5a3b',
  },
  {
    id: 2,
    key: 'grass',
    nameKey: 'tile.grass',
    layer: 'fg',
    collision: 'solid',
    mergeGroup: 'earth',
    hardness: 1,
    lightPass: 0.66,
    mapColor: '#4fa04a',
  },
  {
    id: 3,
    key: 'stone',
    nameKey: 'tile.stone',
    layer: 'fg',
    collision: 'solid',
    mergeGroup: 'earth',
    hardness: 3,
    lightPass: 0.64,
    mapColor: '#6b7182',
  },
  {
    id: 4,
    key: 'wood_platform',
    nameKey: 'tile.wood_platform',
    layer: 'fg',
    collision: 'platform',
    mergeGroup: 'platform',
    hardness: 1,
    lightPass: 0.9,
    mapColor: '#b5824e',
  },
  {
    id: 5,
    key: 'wood_planks',
    nameKey: 'tile.wood_planks',
    layer: 'fg',
    collision: 'solid',
    mergeGroup: 'planks',
    hardness: 2,
    lightPass: 0.66,
    mapColor: '#9c6b3f',
  },
  {
    id: 6,
    key: 'mossy_stone',
    nameKey: 'tile.mossy_stone',
    layer: 'fg',
    collision: 'solid',
    mergeGroup: 'earth',
    hardness: 3,
    lightPass: 0.64,
    mapColor: '#5f7a5c',
  },
  // --- Background walls ---------------------------------------------------------------------
  {
    id: 64,
    key: 'dirt_wall',
    nameKey: 'tile.dirt_wall',
    layer: 'bg',
    collision: 'none',
    mergeGroup: 'earth_wall',
    hardness: 1,
    lightPass: 1,
    mapColor: '#4a3022',
  },
  {
    id: 65,
    key: 'stone_wall',
    nameKey: 'tile.stone_wall',
    layer: 'bg',
    collision: 'none',
    mergeGroup: 'earth_wall',
    hardness: 2,
    lightPass: 1,
    mapColor: '#3a3e4a',
  },
  {
    id: 66,
    key: 'wood_beam',
    nameKey: 'tile.wood_beam',
    layer: 'bg',
    collision: 'none',
    mergeGroup: 'beam',
    hardness: 1,
    lightPass: 1,
    mapColor: '#6b4a30',
  },
];

export const TILE_DEFS: readonly TileDef[] = defs;

/** Upper bound (exclusive) for tile ids, used to size lookup tables. */
export const MAX_TILE_ID = 128;
