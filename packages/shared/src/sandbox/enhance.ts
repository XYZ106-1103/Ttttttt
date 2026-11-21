/**
 * Equipment enhancement (+1 … +10) at the village blacksmith. The level lives on the item
 * instance (`ItemStack.plus`), so it follows the item through the inventory, equipment, saves
 * and the network. Enhanced items are bound to their owner: they cannot be sold, listed or traded
 * (id-based removal skips them), which keeps the market's item model simple.
 *
 * Costs gold and enhancement stones; success gets harder with every level, and failing from +5
 * or higher drops the item one level. Nothing is ever destroyed.
 */
import type { ItemDef, StatBonus, WeaponStats } from '../data/items';
import type { Rng } from '../math/rng';
import type { ItemStack } from './Inventory';
import { itemRegistry } from './ItemRegistry';

export const MAX_PLUS = 10;
export const ENHANCE_STONE = 'enhance_stone';

/** Stat multiplier bonus per level (index = plus). */
export const ENHANCE_BONUS: readonly number[] = [
  0, 0.05, 0.1, 0.15, 0.2, 0.26, 0.33, 0.41, 0.5, 0.62, 0.78,
];

/** Chance to go from `plus` to `plus + 1`. */
export const ENHANCE_RATE: readonly number[] = [1, 0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.32, 0.25];

/** Failing at or above this level drops the item one level. */
export const ENHANCE_DROP_FROM = 5;

export type EnhanceFail = 'not_gear' | 'max' | 'no_gold' | 'no_stones' | 'too_far' | 'invalid';

export type EnhanceResult =
  | {
      readonly ok: true;
      readonly outcome: 'success' | 'fail' | 'drop';
      readonly itemId: string;
      readonly plus: number;
    }
  | { readonly ok: false; readonly reason: EnhanceFail };

export function enhanceable(def: ItemDef | undefined): boolean {
  return !!def && (!!def.weapon || !!def.equip);
}

export function plusOf(stack: ItemStack | null | undefined): number {
  return stack?.plus ?? 0;
}

/** Clamp an untrusted plus value (saves, network) for an item. */
export function cleanPlus(itemId: string, plus: unknown): number {
  const n = Math.floor(Number(plus));
  if (!Number.isFinite(n) || n <= 0 || !enhanceable(itemRegistry.get(itemId))) return 0;
  return Math.min(MAX_PLUS, n);
}

export interface EnhanceCost {
  readonly gold: number;
  readonly stones: number;
  readonly rate: number;
}

export function enhanceCost(def: ItemDef, plus: number): EnhanceCost {
  return {
    gold: Math.max(20, Math.round(def.value * 0.12 * (plus + 1))),
    stones: 1 + Math.floor(plus / 2),
    rate: ENHANCE_RATE[plus] ?? 0,
  };
}

function scale(v: number | undefined, k: number): number | undefined {
  if (v === undefined) return undefined;
  // Fractions (percentages) stay fractions; flat numbers round.
  return Math.abs(v) < 1 ? Math.round(v * (1 + k) * 1000) / 1000 : Math.round(v * (1 + k));
}

export function enhancedWeapon(w: WeaponStats, plus: number): WeaponStats {
  if (plus <= 0) return w;
  return { ...w, attack: Math.round(w.attack * (1 + (ENHANCE_BONUS[plus] ?? 0))) };
}

/** Defense, HP, attack and magic grow with the level; other bonuses stay as they are. */
export function enhancedBonus(b: StatBonus, plus: number): StatBonus {
  if (plus <= 0) return b;
  const k = ENHANCE_BONUS[plus] ?? 0;
  const out: Record<string, number | undefined> = { ...b };
  for (const key of ['defense', 'maxHp', 'maxMp', 'attack', 'magic'] as const)
    out[key] = scale(b[key], k);
  return out as StatBonus;
}

/** Roll one enhancement attempt; the caller has already checked and paid the cost. */
export function rollEnhance(
  plus: number,
  rng: Rng,
): { outcome: 'success' | 'fail' | 'drop'; plus: number } {
  if (rng.next() < (ENHANCE_RATE[plus] ?? 0)) return { outcome: 'success', plus: plus + 1 };
  if (plus >= ENHANCE_DROP_FROM) return { outcome: 'drop', plus: plus - 1 };
  return { outcome: 'fail', plus };
}
