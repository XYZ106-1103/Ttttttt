import { RECIPE_DEFS, type RecipeDef } from '../data/recipes';
import type { Inventory } from './Inventory';

export type CraftFailReason =
  'unknown_recipe' | 'missing_ingredients' | 'no_space' | 'station_required';

export interface CraftResult {
  readonly ok: boolean;
  readonly reason?: CraftFailReason;
  readonly crafted: number;
}

const byId = new Map(RECIPE_DEFS.map((r) => [r.id, r]));

export function getRecipe(id: string): RecipeDef | undefined {
  return byId.get(id);
}

/** How many times a recipe can be crafted with what the inventory holds. */
export function maxCraftable(inv: Inventory, recipe: RecipeDef): number {
  let n = Infinity;
  for (const ing of recipe.inputs) n = Math.min(n, Math.floor(inv.count(ing.item) / ing.count));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Craft a recipe `times` times. Validates ingredients and output space up front, then applies
 * atomically. `stations` lists crafting stations in range (PHASE 2: hand crafting only).
 */
export function craft(
  inv: Inventory,
  recipeId: string,
  times = 1,
  stations: readonly string[] = [],
): CraftResult {
  const recipe = byId.get(recipeId);
  if (!recipe) return { ok: false, reason: 'unknown_recipe', crafted: 0 };
  if (recipe.station && !stations.includes(recipe.station))
    return { ok: false, reason: 'station_required', crafted: 0 };
  const n = Math.max(1, Math.floor(times));
  if (maxCraftable(inv, recipe) < n)
    return { ok: false, reason: 'missing_ingredients', crafted: 0 };
  // Output space must be checked as if the ingredients were already consumed.
  const outCount = recipe.output.count * n;
  const freedByInputs = recipe.inputs.some((i) => i.item === recipe.output.item);
  if (!freedByInputs && inv.capacityFor(recipe.output.item) < outCount) {
    // Consuming inputs may empty slots; simulate on a copy to be exact.
    const copy = cloneInventory(inv);
    for (const ing of recipe.inputs) copy.remove(ing.item, ing.count * n);
    if (copy.capacityFor(recipe.output.item) < outCount)
      return { ok: false, reason: 'no_space', crafted: 0 };
  }
  for (const ing of recipe.inputs) inv.remove(ing.item, ing.count * n);
  inv.add(recipe.output.item, outCount);
  return { ok: true, crafted: n };
}

function cloneInventory(inv: Inventory): Inventory {
  const Ctor = inv.constructor as new (size: number) => Inventory;
  const c = new Ctor(inv.size);
  c.load(inv.snapshot());
  return c;
}
