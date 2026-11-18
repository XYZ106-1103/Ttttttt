/**
 * What an adventurer "knows" about the world's items: where each item comes from (mining a tile,
 * harvesting an object, a monster's loot, or a recipe). Derived from game data, so new items,
 * recipes and monsters are understood automatically.
 */
import { ITEM_DEFS, type ItemDef, type WeaponType } from '../data/items';
import { MONSTER_DEFS } from '../data/monsters';
import { OBJECT_DEFS } from '../data/objects';
import { RECIPE_DEFS, type RecipeDef } from '../data/recipes';
import { TILE_DEFS } from '../data/tiles';

export type ItemSource =
  | {
      readonly kind: 'tile';
      readonly tileKey: string;
      readonly minPower: number;
      readonly minDepth: number;
    }
  | {
      readonly kind: 'object';
      readonly objectKey: string;
      readonly tool: 'hand' | 'axe' | 'pickaxe';
    }
  | {
      readonly kind: 'monster';
      readonly monsterId: string;
      readonly chance: number;
      readonly level: number;
    }
  | { readonly kind: 'recipe'; readonly recipe: RecipeDef };

/** Depth below the surface (tiles) where each mineable tile starts to appear. */
export const TILE_DEPTH: Readonly<Record<string, number>> = {
  dirt: 0,
  grass: 0,
  stone: 6,
  copper_ore: 9,
  iron_ore: 32,
};

const cache = new Map<string, ItemSource[]>();

export function sourcesOf(itemId: string): readonly ItemSource[] {
  const hit = cache.get(itemId);
  if (hit) return hit;
  const out: ItemSource[] = [];
  for (const r of RECIPE_DEFS)
    if (r.output.item === itemId) out.push({ kind: 'recipe', recipe: r });
  for (const t of TILE_DEFS) {
    if (t.drop !== itemId || t.durability <= 0 || t.key === 'torch' || t.layer !== 'fg') continue;
    if (TILE_DEPTH[t.key] === undefined) continue;
    out.push({
      kind: 'tile',
      tileKey: t.key,
      minPower: t.minPower,
      minDepth: TILE_DEPTH[t.key] ?? 0,
    });
  }
  for (const o of OBJECT_DEFS) {
    const h = o.harvest;
    if (!h || !h.drops.some((d) => d.item === itemId)) continue;
    out.push({ kind: 'object', objectKey: o.key, tool: h.tool });
  }
  for (const m of MONSTER_DEFS) {
    if (!m.spawn) continue;
    const d = m.drops.find((x) => x.item === itemId);
    if (d) out.push({ kind: 'monster', monsterId: m.id, chance: d.chance, level: m.level });
  }
  out.sort((a, b) => rank(a) - rank(b));
  cache.set(itemId, out);
  return out;
}

function rank(s: ItemSource): number {
  switch (s.kind) {
    case 'recipe':
      return 0;
    case 'tile':
      return 1 + s.minDepth / 100;
    case 'object':
      return 2;
    case 'monster':
      return 3 + s.level / 100 - s.chance * 0.5;
  }
}

export interface Need {
  readonly itemId: string;
  readonly count: number;
  readonly source: ItemSource;
}

export interface Plan {
  /** Recipes that can be crafted right now toward the goal (deepest first). */
  readonly craftable: readonly RecipeDef[];
  /** Raw materials still missing and where to get them. */
  readonly needs: readonly Need[];
}

/**
 * Work out how to obtain `count` of an item given what the inventory holds: which recipes are
 * ready and which raw materials are missing. Depth-limited; cycles are ignored.
 */
export function planItem(countOf: (itemId: string) => number, itemId: string, count: number): Plan {
  const craftable: RecipeDef[] = [];
  const needs: Need[] = [];
  const reserved = new Map<string, number>();
  const have = (id: string): number => countOf(id) - (reserved.get(id) ?? 0);
  const visit = (id: string, n: number, depth: number): boolean => {
    const missing = n - Math.max(0, have(id));
    if (missing <= 0) {
      reserved.set(id, (reserved.get(id) ?? 0) + n);
      return true;
    }
    if (depth > 4) return false;
    const sources = sourcesOf(id);
    const recipe = sources.find((s) => s.kind === 'recipe');
    if (recipe && recipe.kind === 'recipe') {
      const times = Math.ceil(missing / recipe.recipe.output.count);
      let ready = true;
      for (const ing of recipe.recipe.inputs)
        ready = visit(ing.item, ing.count * times, depth + 1) && ready;
      if (ready) craftable.push(recipe.recipe);
      return false;
    }
    const raw = sources[0];
    if (raw) needs.push({ itemId: id, count: missing, source: raw });
    return false;
  };
  visit(itemId, count, 0);
  return { craftable, needs };
}

/** Weapons of a type, weakest first. */
export function weaponsOfType(type: WeaponType): ItemDef[] {
  return ITEM_DEFS.filter((d) => d.weapon?.type === type).sort(
    (a, b) =>
      (a.weapon?.reqLevel ?? 0) - (b.weapon?.reqLevel ?? 0) ||
      (a.weapon?.attack ?? 0) - (b.weapon?.attack ?? 0),
  );
}

/** Equipment score used to compare gear (higher is better). */
export function gearScore(def: ItemDef | undefined): number {
  const b = def?.equip?.bonus ?? def?.weapon?.bonus;
  if (!def) return 0;
  let s = (def.weapon?.attack ?? 0) * 3;
  if (b) {
    s +=
      (b.defense ?? 0) * 2 +
      (b.maxHp ?? 0) * 0.15 +
      (b.maxMp ?? 0) * 0.08 +
      (b.attack ?? 0) * 3 +
      (b.magic ?? 0) * 3;
    s += ((b.str ?? 0) + (b.dex ?? 0) + (b.int ?? 0) + (b.vit ?? 0) + (b.luk ?? 0)) * 1.5;
    s += ((b.critRate ?? 0) + (b.moveSpeed ?? 0)) * 60 + (b.mpRegen ?? 0) * 4;
  }
  return s;
}
