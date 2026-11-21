/**
 * Shared economy types. Every gold or item transfer goes through validated, all-or-nothing
 * functions in this folder (shops, market, direct trades) — never by writing `gold` or inventories
 * from UI or AI code. PHASE 6 runs the same functions on the server.
 */
import type { Inventory } from '../sandbox/Inventory';

/** Anyone who can own gold and items: the player or an adventurer (both are Characters). */
export interface Trader {
  /** Stable identity ('player' or 'adv-07'). */
  readonly key: string;
  readonly name: string;
  readonly inventory: Inventory;
  gold: number;
}

export type TradeFail =
  | 'no_item'
  | 'no_gold'
  | 'no_room'
  | 'bad_count'
  | 'bad_price'
  | 'self'
  | 'not_sold'
  | 'out_of_stock'
  | 'too_many'
  | 'no_listing'
  | 'not_seller'
  | 'expired'
  /** Enhanced items are bound to their owner. */
  | 'bound';

export type Failed = { readonly ok: false; readonly reason: TradeFail };
export type TradeResult = { readonly ok: true } | Failed;

export const fail = (reason: TradeFail): Failed => ({ ok: false, reason });
export const OK: TradeResult = { ok: true };

/** Where gold enters (faucets) and leaves (sinks) the world. */
export type GoldFlow =
  | 'loot'
  | 'shop_buyback'
  | 'shop_sale'
  | 'market_fee'
  | 'guild_found'
  | 'expired_drop'
  | 'enhance'
  | 'quest';

/**
 * Gold accounting. Transfers between traders never touch it; only faucets and sinks do, so
 * `money supply = start + created - destroyed` can be checked at any time (duplication guard).
 */
export class Ledger {
  created = 0;
  destroyed = 0;
  readonly flows: Partial<Record<GoldFlow, number>> = {};

  create(flow: GoldFlow, amount: number): void {
    if (amount <= 0) return;
    this.created += amount;
    this.flows[flow] = (this.flows[flow] ?? 0) + amount;
  }

  destroy(flow: GoldFlow, amount: number): void {
    if (amount <= 0) return;
    this.destroyed += amount;
    this.flows[flow] = (this.flows[flow] ?? 0) + amount;
  }
}

export function isCount(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 9999;
}

export function isPrice(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 10_000_000;
}
