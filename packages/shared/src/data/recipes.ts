/**
 * Crafting recipes. PHASE 2: hand-crafted (no crafting station required).
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
];
