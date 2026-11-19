/**
 * An NPC shop: finite stock that restocks hourly (scarcity raises prices) and a buy-back counter
 * that pays less for items it has recently been flooded with (glut lowers prices).
 */
import { MAX_GOLD } from '../actors/Character';
import type { ShopDef } from '../data/shops';
import { itemRegistry } from '../sandbox/ItemRegistry';
import { baseValue, type PriceBook } from './PriceBook';
import { type Failed, fail, isCount, type Ledger, type Trader } from './types';

export interface ShopData {
  readonly stock: Record<string, number>;
  readonly glut: Record<string, number>;
}

export type ShopResult = { readonly ok: true; readonly total: number } | Failed;

export class NpcShop {
  private readonly stock = new Map<string, number>();
  /** Units recently bought back, per item (decays hourly). */
  private readonly glut = new Map<string, number>();
  private hourAcc = 0;
  version = 0;

  constructor(
    readonly def: ShopDef,
    private readonly prices: PriceBook,
    private readonly ledger: Ledger,
    private readonly hourSeconds = 60,
  ) {
    for (const s of def.stock) this.stock.set(s.item, s.max);
  }

  get items(): readonly {
    readonly itemId: string;
    readonly stock: number;
    readonly max: number;
  }[] {
    return this.def.stock.map((s) => ({
      itemId: s.item,
      stock: Math.floor(this.stock.get(s.item) ?? 0),
      max: s.max,
    }));
  }

  stockOf(itemId: string): number {
    return Math.floor(this.stock.get(itemId) ?? 0);
  }

  /** What a trader pays the shop per unit. */
  sellPrice(itemId: string): number {
    const s = this.def.stock.find((x) => x.item === itemId);
    if (!s) return 0;
    const left = (this.stock.get(itemId) ?? 0) / Math.max(1, s.max);
    return Math.ceil(baseValue(itemId) * this.def.markup * (1 + 0.5 * (1 - left)));
  }

  /** What the shop pays a trader per unit (0 = not bought). */
  buyPrice(itemId: string): number {
    const def = itemRegistry.get(itemId);
    if (!def || def.value <= 0) return 0;
    const glut = this.glut.get(itemId) ?? 0;
    const raw = this.prices.ref(itemId) * this.def.buyRate * (1 / (1 + glut * 0.02));
    return Math.max(1, Math.floor(raw));
  }

  /** Trader buys `count` from the shop. */
  buy(t: Trader, itemId: string, count: number): ShopResult {
    if (!isCount(count)) return fail('bad_count');
    const unit = this.sellPrice(itemId);
    if (unit <= 0) return fail('not_sold');
    if (this.stockOf(itemId) < count) return fail('out_of_stock');
    const total = unit * count;
    if (t.gold < total) return fail('no_gold');
    if (t.inventory.capacityFor(itemId) < count) return fail('no_room');
    t.gold -= total;
    t.inventory.add(itemId, count);
    this.stock.set(itemId, (this.stock.get(itemId) ?? 0) - count);
    this.ledger.destroy('shop_sale', total);
    this.version++;
    return { ok: true, total };
  }

  /** Trader sells `count` to the shop, from `slot` (UI) or from anywhere. */
  sell(t: Trader, itemId: string, count: number, slot?: number): ShopResult {
    if (!isCount(count)) return fail('bad_count');
    const unit = this.buyPrice(itemId);
    if (unit <= 0) return fail('not_sold');
    const total = unit * count;
    if (t.gold + total > MAX_GOLD) return fail('no_room');
    if (slot !== undefined) {
      const st = t.inventory.get(slot);
      if (!st || st.itemId !== itemId || st.count < count) return fail('no_item');
      t.inventory.removeAt(slot, count);
    } else if (!t.inventory.remove(itemId, count)) return fail('no_item');
    t.gold += total;
    this.glut.set(itemId, (this.glut.get(itemId) ?? 0) + count);
    this.ledger.create('shop_buyback', total);
    this.version++;
    return { ok: true, total };
  }

  tick(dt: number): void {
    this.hourAcc += dt;
    while (this.hourAcc >= this.hourSeconds) {
      this.hourAcc -= this.hourSeconds;
      for (const s of this.def.stock) {
        this.stock.set(s.item, Math.min(s.max, (this.stock.get(s.item) ?? 0) + s.restock));
      }
      for (const [k, v] of this.glut) {
        const next = v * 0.7 - 0.5;
        if (next <= 0) this.glut.delete(k);
        else this.glut.set(k, next);
      }
      this.version++;
    }
  }

  toJSON(): ShopData {
    return { stock: Object.fromEntries(this.stock), glut: Object.fromEntries(this.glut) };
  }

  load(data: unknown): void {
    const d = data as Partial<ShopData> | null;
    if (!d || typeof d !== 'object') return;
    for (const s of this.def.stock) {
      const v = Number(d.stock?.[s.item]);
      if (Number.isFinite(v)) this.stock.set(s.item, Math.max(0, Math.min(s.max, v)));
    }
    this.glut.clear();
    for (const [k, v] of Object.entries(d.glut ?? {})) {
      const n = Number(v);
      if (itemRegistry.get(k) && Number.isFinite(n) && n > 0) this.glut.set(k, Math.min(500, n));
    }
    this.version++;
  }
}
