/**
 * World object definitions: non-tile things that live on the map (trees, plants, props, light
 * sources). Objects are anchored to the tile they stand in (bottom-center) and occupy a
 * footprint of tiles above it.
 */

export interface ObjectLight {
  /** Linear RGB light color, 0..2 (values above 1 over-brighten). */
  readonly color: readonly [number, number, number];
  /** Flicker amplitude 0..1 (campfires, torches). */
  readonly flicker: number;
}

export type ObjectDepth = 'back' | 'front';

export interface ObjectDrop {
  readonly item: string;
  readonly min: number;
  readonly max: number;
  /** Probability the drop happens at all. */
  readonly chance: number;
}

export interface HarvestDef {
  /** Tool required: 'hand' means anything (or nothing) works. */
  readonly tool: 'hand' | 'axe' | 'pickaxe';
  /** Hit points (tool power per swing); hand-harvested objects break in one use. */
  readonly hp: number;
  readonly drops: readonly ObjectDrop[];
}

export interface WorldObjectDef {
  readonly key: string;
  readonly nameKey: string;
  /** Number of visual variants the art pipeline must provide. */
  readonly variants: number;
  /** Render behind (back) or in front of (front) characters. */
  readonly depth: ObjectDepth;
  /** Whether the sprite sways in the wind. */
  readonly sways: boolean;
  /** Tiles occupied: `w` centered on the anchor column, `h` upward from the anchor row. */
  readonly footprint: { readonly w: number; readonly h: number };
  /** The tile under the anchor cannot be mined while this object stands on it. */
  readonly blocksSupport: boolean;
  /** Placing a block on the anchor tile silently removes the object (grass, flowers). */
  readonly replaceable: boolean;
  /** How the object can be harvested, or null if permanent. */
  readonly harvest: HarvestDef | null;
  readonly light?: ObjectLight;
}

const plant = (
  key: string,
  variants: number,
  depth: ObjectDepth,
  sways: boolean,
  drops: ObjectDrop[],
): WorldObjectDef => ({
  key,
  nameKey: `object.${key}`,
  variants,
  depth,
  sways,
  footprint: { w: 1, h: 1 },
  blocksSupport: false,
  replaceable: true,
  harvest: { tool: 'hand', hp: 1, drops },
});

const defs: WorldObjectDef[] = [
  {
    key: 'tree_oak',
    nameKey: 'object.tree_oak',
    variants: 4,
    depth: 'back',
    sways: false,
    footprint: { w: 1, h: 5 },
    blocksSupport: true,
    replaceable: false,
    harvest: { tool: 'axe', hp: 140, drops: [{ item: 'wood', min: 5, max: 8, chance: 1 }] },
  },
  {
    key: 'tree_pine',
    nameKey: 'object.tree_pine',
    variants: 3,
    depth: 'back',
    sways: false,
    footprint: { w: 1, h: 6 },
    blocksSupport: true,
    replaceable: false,
    harvest: { tool: 'axe', hp: 160, drops: [{ item: 'wood', min: 6, max: 9, chance: 1 }] },
  },
  plant('bush', 3, 'back', false, [{ item: 'fiber', min: 1, max: 2, chance: 0.8 }]),
  plant('grass_tuft', 4, 'back', true, [{ item: 'fiber', min: 1, max: 1, chance: 0.35 }]),
  plant('tall_grass', 3, 'front', true, [{ item: 'fiber', min: 1, max: 2, chance: 0.6 }]),
  plant('flower', 5, 'back', true, [{ item: 'wildflower', min: 1, max: 1, chance: 1 }]),
  {
    ...plant('rock', 3, 'back', false, []),
    replaceable: false,
    harvest: { tool: 'pickaxe', hp: 60, drops: [{ item: 'stone', min: 2, max: 4, chance: 1 }] },
  },
  plant('mushroom', 2, 'back', false, [{ item: 'mushroom', min: 1, max: 1, chance: 1 }]),
  {
    key: 'campfire',
    nameKey: 'object.campfire',
    variants: 1,
    depth: 'back',
    sways: false,
    footprint: { w: 1, h: 1 },
    blocksSupport: true,
    replaceable: false,
    harvest: null,
    light: { color: [1.7, 1.05, 0.55], flicker: 0.18 },
  },
  {
    key: 'signpost',
    nameKey: 'object.signpost',
    variants: 1,
    depth: 'back',
    sways: false,
    footprint: { w: 1, h: 1 },
    blocksSupport: true,
    replaceable: false,
    harvest: null,
  },
  // --- Village (PHASE 5) ----------------------------------------------------------------------
  {
    key: 'shop_stall',
    nameKey: 'object.shop_stall',
    variants: 1,
    depth: 'back',
    sways: false,
    footprint: { w: 3, h: 3 },
    blocksSupport: true,
    replaceable: false,
    harvest: null,
    light: { color: [1.25, 0.9, 0.5], flicker: 0.06 },
  },
  {
    key: 'merchant_stall',
    nameKey: 'object.merchant_stall',
    variants: 4,
    depth: 'back',
    sways: false,
    footprint: { w: 3, h: 3 },
    blocksSupport: true,
    replaceable: false,
    harvest: null,
  },
  {
    key: 'exchange_board',
    nameKey: 'object.exchange_board',
    variants: 1,
    depth: 'back',
    sways: false,
    footprint: { w: 3, h: 3 },
    blocksSupport: true,
    replaceable: false,
    harvest: null,
    light: { color: [1.1, 0.85, 0.55], flicker: 0.05 },
  },
  {
    key: 'guild_banner',
    nameKey: 'object.guild_banner',
    variants: 1,
    depth: 'back',
    sways: true,
    footprint: { w: 1, h: 4 },
    blocksSupport: true,
    replaceable: false,
    harvest: null,
  },
];

export const OBJECT_DEFS: readonly WorldObjectDef[] = defs;

const byKey = new Map(defs.map((d) => [d.key, d]));

export function getObjectDef(key: string): WorldObjectDef {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown world object: ${key}`);
  return def;
}
