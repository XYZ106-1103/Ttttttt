/**
 * Item definitions. Item ids are persisted in inventories and saves — never rename an id;
 * deprecate instead. Icons are generated client-side from `icon` recipes.
 */
export type ItemKind =
  'block' | 'placeable' | 'tool' | 'material' | 'weapon' | 'armor' | 'accessory' | 'consumable';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ToolType = 'pickaxe' | 'axe';
export type WeaponType = 'sword' | 'staff' | 'bow' | 'dagger';
/** Equipment slot category an item fits into (accessories fit either accessory slot). */
export type EquipCategory = 'head' | 'body' | 'feet' | 'accessory';

/** Flat bonuses granted by equipment. Percentages are fractions (0.05 = +5%). */
export interface StatBonus {
  readonly str?: number;
  readonly dex?: number;
  readonly int?: number;
  readonly vit?: number;
  readonly luk?: number;
  readonly attack?: number;
  readonly magic?: number;
  readonly defense?: number;
  readonly maxHp?: number;
  readonly maxMp?: number;
  readonly critRate?: number;
  readonly critDamage?: number;
  readonly moveSpeed?: number;
  readonly mpRegen?: number;
}

export interface WeaponStats {
  readonly type: WeaponType;
  /** Base attack (physical) or magic attack (staves). */
  readonly attack: number;
  /** Attack speed multiplier (1 = the weapon type's base timing). */
  readonly speed: number;
  readonly reqLevel: number;
  readonly bonus?: StatBonus;
}

export interface EquipStats {
  readonly category: EquipCategory;
  readonly reqLevel: number;
  readonly bonus: StatBonus;
}

export interface ConsumableStats {
  readonly heal?: number;
  readonly mana?: number;
  /** Shared potion cooldown (s) started by using this item. */
  readonly cooldown: number;
  /** Monster id summoned by using this item (boss summons). */
  readonly summon?: string;
  /** Minimum depth below the surface (tiles) required to use the item. */
  readonly minDepth?: number;
}

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
  readonly weapon?: WeaponStats;
  readonly equip?: EquipStats;
  readonly consumable?: ConsumableStats;
  /**
   * Base trade value in gold — the anchor of the economy (NPC prices, market reference prices).
   * Crafted goods are worth about 1.35–1.4× their materials so crafting for sale pays.
   */
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

const weapon = (id: string, rarity: Rarity, value: number, stats: WeaponStats): ItemDef => ({
  id,
  nameKey: `item.${id}`,
  descKey: `item.${id}.desc`,
  kind: 'weapon',
  maxStack: 1,
  rarity,
  weapon: stats,
  value,
});

const gear = (
  id: string,
  rarity: Rarity,
  value: number,
  category: EquipCategory,
  reqLevel: number,
  bonus: StatBonus,
): ItemDef => ({
  id,
  nameKey: `item.${id}`,
  descKey: `item.${id}.desc`,
  kind: category === 'accessory' ? 'accessory' : 'armor',
  maxStack: 1,
  rarity,
  equip: { category, reqLevel, bonus },
  value,
});

const consumable = (
  id: string,
  rarity: Rarity,
  value: number,
  stats: ConsumableStats,
  maxStack = 99,
): ItemDef => ({
  id,
  nameKey: `item.${id}`,
  descKey: `item.${id}.desc`,
  kind: 'consumable',
  maxStack,
  rarity,
  consumable: stats,
  value,
});

const defs: ItemDef[] = [
  block('dirt', 1),
  block('stone', 2),
  block('wood_planks', 3),
  block('wood_platform', 1),
  block('stone_bricks', 4),
  block('snow_block', 1, 'snow'),
  block('ice_block', 2, 'ice'),
  block('sand', 1),
  block('sandstone', 3),
  block('ash_block', 1, 'ash'),
  block('basalt', 3),
  block('obsidian', 12),
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
  material('silver_ore', 22, 'uncommon'),
  material('gold_ore', 35, 'rare'),
  material('frostite_ore', 40, 'rare'),
  material('magmite_ore', 45, 'rare'),
  material('crystal_shard', 60, 'epic'),
  tool('worn_pickaxe', 'common', 10, { type: 'pickaxe', power: 35, speed: 3.5, reach: 6 }),
  tool('worn_axe', 'common', 10, { type: 'axe', power: 35, speed: 3, reach: 6 }),
  tool('copper_pickaxe', 'uncommon', 120, { type: 'pickaxe', power: 55, speed: 4.2, reach: 6.5 }),
  tool('copper_axe', 'uncommon', 100, { type: 'axe', power: 55, speed: 3.6, reach: 6.5 }),
  tool('iron_pickaxe', 'rare', 250, { type: 'pickaxe', power: 75, speed: 5, reach: 7 }),
  tool('iron_axe', 'rare', 215, { type: 'axe', power: 75, speed: 4.2, reach: 7 }),

  // --- Monster materials ---------------------------------------------------------------------
  material('slime_gel', 3),
  material('beetle_shell', 6),
  material('bat_wing', 8, 'uncommon'),
  material('wisp_ember', 14, 'uncommon'),
  material('corestone', 60, 'epic', 99),

  // --- Weapons (one line per weapon type and tier) ------------------------------------------
  weapon('training_sword', 'common', 16, { type: 'sword', attack: 10, speed: 1, reqLevel: 1 }),
  weapon('copper_sword', 'uncommon', 140, { type: 'sword', attack: 18, speed: 1, reqLevel: 5 }),
  weapon('iron_sword', 'rare', 320, {
    type: 'sword',
    attack: 30,
    speed: 1.05,
    reqLevel: 12,
    bonus: { str: 2 },
  }),
  weapon('oak_staff', 'common', 22, { type: 'staff', attack: 11, speed: 1, reqLevel: 1 }),
  weapon('ember_staff', 'uncommon', 140, {
    type: 'staff',
    attack: 21,
    speed: 1,
    reqLevel: 7,
    bonus: { int: 2, maxMp: 20 },
  }),
  weapon('iron_staff', 'rare', 320, {
    type: 'staff',
    attack: 31,
    speed: 1.05,
    reqLevel: 12,
    bonus: { int: 3 },
  }),
  weapon('oak_bow', 'common', 20, { type: 'bow', attack: 9, speed: 1, reqLevel: 1 }),
  weapon('copper_bow', 'uncommon', 95, { type: 'bow', attack: 16, speed: 1.05, reqLevel: 5 }),
  weapon('iron_bow', 'rare', 230, {
    type: 'bow',
    attack: 27,
    speed: 1.1,
    reqLevel: 12,
    bonus: { dex: 2 },
  }),
  weapon('worn_dagger', 'common', 16, { type: 'dagger', attack: 8, speed: 1, reqLevel: 1 }),
  weapon('copper_dagger', 'uncommon', 105, {
    type: 'dagger',
    attack: 15,
    speed: 1.05,
    reqLevel: 5,
    bonus: { critRate: 0.03 },
  }),
  weapon('iron_dagger', 'rare', 245, {
    type: 'dagger',
    attack: 25,
    speed: 1.1,
    reqLevel: 12,
    bonus: { luk: 2, critRate: 0.03 },
  }),

  // --- Armor & accessories -------------------------------------------------------------------
  gear('traveler_hood', 'common', 20, 'head', 1, { defense: 2, maxHp: 10 }),
  gear('traveler_coat', 'common', 30, 'body', 1, { defense: 3, maxHp: 15 }),
  gear('traveler_boots', 'common', 18, 'feet', 1, { defense: 1, moveSpeed: 0.03 }),
  gear('copper_helmet', 'uncommon', 110, 'head', 5, { defense: 5, maxHp: 20 }),
  gear('copper_armor', 'uncommon', 190, 'body', 5, { defense: 8, maxHp: 30 }),
  gear('copper_greaves', 'uncommon', 100, 'feet', 5, { defense: 4, moveSpeed: 0.02 }),
  gear('iron_helmet', 'rare', 270, 'head', 12, { defense: 9, maxHp: 40 }),
  gear('iron_armor', 'rare', 450, 'body', 12, { defense: 14, maxHp: 60 }),
  gear('iron_greaves', 'rare', 250, 'feet', 12, { defense: 7, moveSpeed: 0.03 }),
  gear('thorn_charm', 'uncommon', 70, 'accessory', 3, { attack: 3, critRate: 0.02 }),
  gear('bat_brooch', 'uncommon', 115, 'accessory', 6, { moveSpeed: 0.06, dex: 2 }),
  gear('ember_bead', 'rare', 200, 'accessory', 9, { magic: 5, mpRegen: 1, int: 2 }),
  gear('corestone_ring', 'epic', 400, 'accessory', 14, {
    defense: 6,
    maxHp: 80,
    str: 3,
    dex: 3,
    int: 3,
    luk: 3,
  }),

  // --- Consumables ---------------------------------------------------------------------------
  consumable('healing_potion', 'common', 12, { heal: 80, cooldown: 4 }),
  consumable('mana_potion', 'common', 12, { mana: 50, cooldown: 4 }),
  consumable(
    'golem_heart',
    'rare',
    300,
    { cooldown: 2, summon: 'corestone_golem', minDepth: 30 },
    10,
  ),
];

export const ITEM_DEFS: readonly ItemDef[] = defs;

/** Items every new character starts with. */
export const STARTING_ITEMS: readonly { readonly item: string; readonly count: number }[] = [
  { item: 'worn_pickaxe', count: 1 },
  { item: 'worn_axe', count: 1 },
  { item: 'training_sword', count: 1 },
  { item: 'torch', count: 10 },
  { item: 'healing_potion', count: 5 },
];

/** Gift handed out on job advancement (one starter weapon of the job's weapon type). */
export const JOB_STARTER_WEAPONS: Readonly<Record<string, string>> = {
  warrior: 'copper_sword',
  mage: 'ember_staff',
  archer: 'copper_bow',
  rogue: 'copper_dagger',
};
