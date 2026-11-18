/**
 * Crafting recipes. Hand-crafted for now (no crafting station required).
 * Stations (workbench, furnace, anvil) are added by giving recipes a `station`.
 */
export interface RecipeIngredient {
  readonly item: string;
  readonly count: number;
}

export interface RecipeDef {
  readonly id: string;
  readonly output: RecipeIngredient;
  readonly inputs: readonly RecipeIngredient[];
  /** Required crafting station object key, or null for hand crafting. */
  readonly station: string | null;
}

const r = (id: string, out: string, outCount: number, inputs: [string, number][]): RecipeDef => ({
  id,
  output: { item: out, count: outCount },
  inputs: inputs.map(([item, count]) => ({ item, count })),
  station: null,
});

export const RECIPE_DEFS: readonly RecipeDef[] = [
  r('wood_planks', 'wood_planks', 2, [['wood', 1]]),
  r('wood_platform', 'wood_platform', 2, [['wood_planks', 1]]),
  r('torch', 'torch', 3, [
    ['wood', 1],
    ['fiber', 1],
  ]),
  r('stone_bricks', 'stone_bricks', 1, [['stone', 2]]),
  r('copper_pickaxe', 'copper_pickaxe', 1, [
    ['copper_ore', 10],
    ['wood', 4],
  ]),
  r('copper_axe', 'copper_axe', 1, [
    ['copper_ore', 8],
    ['wood', 4],
  ]),
  r('iron_pickaxe', 'iron_pickaxe', 1, [
    ['iron_ore', 12],
    ['wood', 4],
  ]),
  r('iron_axe', 'iron_axe', 1, [
    ['iron_ore', 10],
    ['wood', 4],
  ]),

  // Consumables
  r('healing_potion', 'healing_potion', 2, [
    ['mushroom', 1],
    ['slime_gel', 2],
  ]),
  r('mana_potion', 'mana_potion', 2, [
    ['wildflower', 2],
    ['slime_gel', 1],
  ]),

  // Weapons
  r('training_sword', 'training_sword', 1, [['wood', 6]]),
  r('oak_staff', 'oak_staff', 1, [
    ['wood', 6],
    ['wildflower', 2],
  ]),
  r('oak_bow', 'oak_bow', 1, [
    ['wood', 5],
    ['fiber', 4],
  ]),
  r('worn_dagger', 'worn_dagger', 1, [
    ['stone', 4],
    ['wood', 2],
  ]),
  r('copper_sword', 'copper_sword', 1, [
    ['copper_ore', 12],
    ['wood', 3],
  ]),
  r('copper_bow', 'copper_bow', 1, [
    ['copper_ore', 6],
    ['wood', 6],
    ['fiber', 6],
  ]),
  r('copper_dagger', 'copper_dagger', 1, [
    ['copper_ore', 8],
    ['beetle_shell', 2],
  ]),
  r('ember_staff', 'ember_staff', 1, [
    ['copper_ore', 6],
    ['wood', 6],
    ['wisp_ember', 3],
  ]),
  r('iron_sword', 'iron_sword', 1, [
    ['iron_ore', 14],
    ['beetle_shell', 4],
  ]),
  r('iron_staff', 'iron_staff', 1, [
    ['iron_ore', 10],
    ['wisp_ember', 6],
  ]),
  r('iron_bow', 'iron_bow', 1, [
    ['iron_ore', 8],
    ['bat_wing', 4],
    ['fiber', 8],
  ]),
  r('iron_dagger', 'iron_dagger', 1, [
    ['iron_ore', 10],
    ['bat_wing', 3],
  ]),

  // Armor & accessories
  r('traveler_hood', 'traveler_hood', 1, [
    ['fiber', 8],
    ['slime_gel', 2],
  ]),
  r('traveler_coat', 'traveler_coat', 1, [
    ['fiber', 12],
    ['slime_gel', 3],
  ]),
  r('traveler_boots', 'traveler_boots', 1, [
    ['fiber', 6],
    ['slime_gel', 2],
  ]),
  r('copper_helmet', 'copper_helmet', 1, [['copper_ore', 10]]),
  r('copper_armor', 'copper_armor', 1, [
    ['copper_ore', 16],
    ['beetle_shell', 2],
  ]),
  r('copper_greaves', 'copper_greaves', 1, [['copper_ore', 9]]),
  r('iron_helmet', 'iron_helmet', 1, [
    ['iron_ore', 12],
    ['beetle_shell', 3],
  ]),
  r('iron_armor', 'iron_armor', 1, [
    ['iron_ore', 20],
    ['beetle_shell', 5],
  ]),
  r('iron_greaves', 'iron_greaves', 1, [
    ['iron_ore', 11],
    ['bat_wing', 2],
  ]),
  r('thorn_charm', 'thorn_charm', 1, [
    ['beetle_shell', 6],
    ['fiber', 4],
  ]),
  r('bat_brooch', 'bat_brooch', 1, [
    ['bat_wing', 6],
    ['copper_ore', 4],
  ]),
  r('ember_bead', 'ember_bead', 1, [
    ['wisp_ember', 8],
    ['copper_ore', 4],
  ]),
  r('corestone_ring', 'corestone_ring', 1, [
    ['corestone', 3],
    ['iron_ore', 6],
  ]),

  // Boss summon
  r('golem_heart', 'golem_heart', 1, [
    ['stone', 40],
    ['iron_ore', 6],
    ['wisp_ember', 4],
  ]),
];
