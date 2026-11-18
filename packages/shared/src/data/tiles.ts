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
  /** Hit points removed by tool power per swing. -1 = cannot be broken (with current tools). */
  readonly durability: number;
  /** Minimum pickaxe power required to damage the tile at all. */
  readonly minPower: number;
  /** Item dropped when broken, or null. */
  readonly drop: string | null;
  /** Light transmission multiplier applied when light leaves this tile (0 = opaque, 1 = clear). */
  readonly lightPass: number;
  /** Emitted light (linear RGB, may exceed 1), e.g. torches. */
  readonly light?: readonly [number, number, number];
  /** Rendered as an animated sprite instead of being baked into the chunk texture. */
  readonly animated?: boolean;
  /** Minimap color (#rrggbb). */
  readonly mapColor: string;
}

/** Reserved id for "nothing here" in both layers. */
export const AIR = 0;

const fg = (d: Omit<TileDef, 'layer'>): TileDef => ({ ...d, layer: 'fg' });
const bg = (d: Omit<TileDef, 'layer' | 'collision'>): TileDef => ({
  ...d,
  layer: 'bg',
  collision: 'none',
});

const defs: TileDef[] = [
  fg({
    id: AIR,
    key: 'air',
    nameKey: 'tile.air',
    collision: 'none',
    mergeGroup: 'none',
    durability: -1,
    minPower: 0,
    drop: null,
    lightPass: 0.92,
    mapColor: '#000000',
  }),
  // --- Foreground terrain -------------------------------------------------------------------
  fg({
    id: 1,
    key: 'dirt',
    nameKey: 'tile.dirt',
    collision: 'solid',
    mergeGroup: 'earth',
    durability: 50,
    minPower: 0,
    drop: 'dirt',
    lightPass: 0.66,
    mapColor: '#8a5a3b',
  }),
  fg({
    id: 2,
    key: 'grass',
    nameKey: 'tile.grass',
    collision: 'solid',
    mergeGroup: 'earth',
    durability: 50,
    minPower: 0,
    drop: 'dirt',
    lightPass: 0.66,
    mapColor: '#4fa04a',
  }),
  fg({
    id: 3,
    key: 'stone',
    nameKey: 'tile.stone',
    collision: 'solid',
    mergeGroup: 'earth',
    durability: 100,
    minPower: 0,
    drop: 'stone',
    lightPass: 0.64,
    mapColor: '#6b7182',
  }),
  fg({
    id: 4,
    key: 'wood_platform',
    nameKey: 'tile.wood_platform',
    collision: 'platform',
    mergeGroup: 'platform',
    durability: 30,
    minPower: 0,
    drop: 'wood_platform',
    lightPass: 0.9,
    mapColor: '#b5824e',
  }),
  fg({
    id: 5,
    key: 'wood_planks',
    nameKey: 'tile.wood_planks',
    collision: 'solid',
    mergeGroup: 'planks',
    durability: 60,
    minPower: 0,
    drop: 'wood_planks',
    lightPass: 0.66,
    mapColor: '#9c6b3f',
  }),
  fg({
    id: 6,
    key: 'mossy_stone',
    nameKey: 'tile.mossy_stone',
    collision: 'solid',
    mergeGroup: 'earth',
    durability: 100,
    minPower: 0,
    drop: 'stone',
    lightPass: 0.64,
    mapColor: '#5f7a5c',
  }),
  fg({
    id: 7,
    key: 'copper_ore',
    nameKey: 'tile.copper_ore',
    collision: 'solid',
    mergeGroup: 'earth',
    durability: 150,
    minPower: 0,
    drop: 'copper_ore',
    lightPass: 0.64,
    mapColor: '#c87a4a',
  }),
  fg({
    id: 8,
    key: 'iron_ore',
    nameKey: 'tile.iron_ore',
    collision: 'solid',
    mergeGroup: 'earth',
    durability: 200,
    minPower: 50,
    drop: 'iron_ore',
    lightPass: 0.64,
    mapColor: '#b0b8c8',
  }),
  fg({
    id: 9,
    key: 'torch',
    nameKey: 'tile.torch',
    collision: 'none',
    mergeGroup: 'none',
    durability: 1,
    minPower: 0,
    drop: 'torch',
    lightPass: 0.92,
    light: [1.55, 1.1, 0.62],
    animated: true,
    mapColor: '#ffcc66',
  }),
  fg({
    id: 10,
    key: 'stone_bricks',
    nameKey: 'tile.stone_bricks',
    collision: 'solid',
    mergeGroup: 'bricks',
    durability: 120,
    minPower: 0,
    drop: 'stone_bricks',
    lightPass: 0.64,
    mapColor: '#7a7f8c',
  }),
  // --- Background walls (hammers arrive later; walls cannot be removed yet) -------------------
  bg({
    id: 64,
    key: 'dirt_wall',
    nameKey: 'tile.dirt_wall',
    mergeGroup: 'earth_wall',
    durability: -1,
    minPower: 0,
    drop: null,
    lightPass: 1,
    mapColor: '#4a3022',
  }),
  bg({
    id: 65,
    key: 'stone_wall',
    nameKey: 'tile.stone_wall',
    mergeGroup: 'earth_wall',
    durability: -1,
    minPower: 0,
    drop: null,
    lightPass: 1,
    mapColor: '#3a3e4a',
  }),
  bg({
    id: 66,
    key: 'wood_beam',
    nameKey: 'tile.wood_beam',
    mergeGroup: 'beam',
    durability: -1,
    minPower: 0,
    drop: null,
    lightPass: 1,
    mapColor: '#6b4a30',
  }),
];

export const TILE_DEFS: readonly TileDef[] = defs;

/** Upper bound (exclusive) for tile ids, used to size lookup tables. */
export const MAX_TILE_ID = 128;
