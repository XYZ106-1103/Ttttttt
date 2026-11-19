/** Face-to-face trades between two traders (player ↔ adventurer, adventurer ↔ adventurer). */
import { MAX_GOLD } from '../actors/Character';
import { itemRegistry } from '../sandbox/ItemRegistry';
import { fail, isCount, isPrice, type TradeResult, type Trader } from './types';

export interface TradeRecord {
  readonly t: number;
  readonly seller: string;
  readonly buyer: string;
  readonly itemId: string;
  readonly count: number;
  readonly unitPrice: number;
}

/**
 * `seller` hands `count` of `itemId` to `buyer` for `unitPrice` each. All-or-nothing: either both
 * the goods and the gold move, or nothing changes.
 */
export function directTrade(
  seller: Trader,
  buyer: Trader,
  itemId: string,
  count: number,
  unitPrice: number,
): TradeResult {
  if (seller === buyer || seller.key === buyer.key) return fail('self');
  if (!itemRegistry.get(itemId)) return fail('no_item');
  if (!isCount(count)) return fail('bad_count');
  if (!isPrice(unitPrice)) return fail('bad_price');
  const total = unitPrice * count;
  if (seller.inventory.count(itemId) < count) return fail('no_item');
  if (buyer.gold < total) return fail('no_gold');
  if (seller.gold + total > MAX_GOLD) return fail('no_room');
  if (buyer.inventory.capacityFor(itemId) < count) return fail('no_room');
  seller.inventory.remove(itemId, count);
  buyer.inventory.add(itemId, count);
  buyer.gold -= total;
  seller.gold += total;
  return { ok: true };
}
