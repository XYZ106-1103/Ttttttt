/**
 * The world economy: reference prices, the exchange, NPC shops and the gold ledger, saved and
 * advanced together.
 */
import { SHOP_DEFS } from '../data/shops';
import { Market, type MarketConfig, DEFAULT_MARKET } from './Market';
import { NpcShop } from './NpcShop';
import { PriceBook } from './PriceBook';
import { Ledger } from './types';

export interface EconomyData {
  readonly prices: unknown;
  readonly market: unknown;
  readonly shops: Record<string, unknown>;
  readonly ledger: { created: number; destroyed: number };
}

export interface EconomyConfig {
  /** Simulation seconds per in-game hour (restocks, price samples). */
  readonly hourSeconds: number;
  readonly market?: Partial<MarketConfig>;
}

export class Economy {
  readonly ledger = new Ledger();
  readonly prices: PriceBook;
  readonly market: Market;
  readonly shops = new Map<string, NpcShop>();
  private expireAcc = 0;

  constructor(config: EconomyConfig = { hourSeconds: 60 }) {
    this.prices = new PriceBook(config.hourSeconds);
    this.market = new Market(this.prices, this.ledger, { ...DEFAULT_MARKET, ...config.market });
    for (const def of SHOP_DEFS)
      this.shops.set(def.id, new NpcShop(def, this.prices, this.ledger, config.hourSeconds));
  }

  shop(id: string): NpcShop | undefined {
    return this.shops.get(id);
  }

  tick(dt: number, now: number): void {
    this.prices.tick(dt);
    for (const s of this.shops.values()) s.tick(dt);
    this.expireAcc += dt;
    if (this.expireAcc >= 5) {
      this.expireAcc = 0;
      this.market.expire(now);
    }
  }

  toJSON(): EconomyData {
    const shops: Record<string, unknown> = {};
    for (const [id, s] of this.shops) shops[id] = s.toJSON();
    return {
      prices: this.prices.toJSON(),
      market: this.market.toJSON(),
      shops,
      ledger: { created: this.ledger.created, destroyed: this.ledger.destroyed },
    };
  }

  load(data: unknown): void {
    const d = data as Partial<EconomyData> | null;
    if (!d || typeof d !== 'object') return;
    this.prices.load(d.prices);
    this.market.load(d.market);
    for (const [id, s] of this.shops) s.load(d.shops?.[id]);
    this.ledger.created = Math.max(0, Number(d.ledger?.created) || 0);
    this.ledger.destroyed = Math.max(0, Number(d.ledger?.destroyed) || 0);
  }
}
