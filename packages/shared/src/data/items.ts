/**
 * Item definitions. Item ids are persisted in inventories and saves — never rename an id;
 * deprecate instead. Icons are generated client-side from `icon` recipes.
 */
export type ItemKind = 'block' | 'placeable' | 'tool' | 'material';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ToolType = 'pickaxe' | 'axe';

export interface ToolStats {
  readonly type: ToolType;
  /** Damage per swing against tile durability / object hp. */
  readonly power: number;
  /** Swings per second. */
  readonly speed: number;
  /** Reach in tiles, measured from the body center to the target tile center. */
  readonly reach: number;
}

export interface ItemDef {
  readonly id: string;
  readonly nameKey: string;
  readonly descKey: string;
  readonly kind: ItemKind;
  readonly maxStack: number;
  readonly rarity: Rarity;
  /** Tile key placed by this item (blocks, torches). */
  readonly places?: string;
  readonly tool?: ToolStats;
  /** Base trade value in gold (PHASE 5 economy). */
  readonly value: number;
}

/** Placement rate and reach for blocks / bare hands. */
export const PLACE_SPEED = 8;
export const HAND_REACH = 6;
export const HAND_SPEED = 4;

const block = (id: string, value: number, places = id): ItemDef => ({
  id,
  nameKey: `item.${id}`,
  descKey: `item.${id}.desc`,
  kind: 'block',
  maxStack: 999,
  rarity: 'common',
  places,
  value,
});

const material = (
  id: string,
  value: number,
  rarity: Rarity = 'common',
  maxStack = 999,
): ItemDef => ({
  id,
  nameKey: `item.${id}`,
  descKey: `item.${id}.desc`,
  kind: 'material',
  maxStack,
  rarity,
  value,
});

const tool = (id: string, rarity: Rarity, value: number, stats: ToolStats): ItemDef => ({
  id,
  nameKey: `item.${id}`,
  descKey: `item.${id}.desc`,
  kind: 'tool',
  maxStack: 1,
  rarity,
  tool: stats,
  value,
});

const defs: ItemDef[] = [
  block('dirt', 1),
  block('stone', 2),
  block('wood_planks', 3),
  block('wood_platform', 1),
  block('stone_bricks', 4),
  {
    id: 'torch',
    nameKey: 'item.torch',
    descKey: 'item.torch.desc',
    kind: 'placeable',
    maxStack: 99,
    rarity: 'common',
    places: 'torch',
    value: 5,
  },
  material('wood', 2),
  material('fiber', 1),
  material('wildflower', 2, 'common', 99),
  material('mushroom', 3, 'common', 99),
  material('copper_ore', 8, 'uncommon'),
  material('iron_ore', 15, 'uncommon'),
  tool('worn_pickaxe', 'common', 10, { type: 'pickaxe', power: 35, speed: 3.5, reach: 6 }),
  tool('worn_axe', 'common', 10, { type: 'axe', power: 35, speed: 3, reach: 6 }),
  tool('copper_pickaxe', 'uncommon', 60, { type: 'pickaxe', power: 55, speed: 4.2, reach: 6.5 }),
  tool('copper_axe', 'uncommon', 55, { type: 'axe', power: 55, speed: 3.6, reach: 6.5 }),
  tool('iron_pickaxe', 'rare', 140, { type: 'pickaxe', power: 75, speed: 5, reach: 7 }),
  tool('iron_axe', 'rare', 130, { type: 'axe', power: 75, speed: 4.2, reach: 7 }),
];

export const ITEM_DEFS: readonly ItemDef[] = defs;

/** Items every new character starts with. */
export const STARTING_ITEMS: readonly { readonly item: string; readonly count: number }[] = [
  { item: 'worn_pickaxe', count: 1 },
  { item: 'worn_axe', count: 1 },
  { item: 'torch', count: 10 },
];
