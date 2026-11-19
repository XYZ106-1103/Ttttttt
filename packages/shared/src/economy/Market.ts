/**
 * The exchange (거래소): sellers list items at a unit price, buyers buy any part of a listing.
 *
 * - Listed items leave the seller's inventory at once (escrow), so they cannot be sold twice.
 * - Sale proceeds (minus a 5% fee — a gold sink) and expired or cancelled items that did not fit
 *   go to the seller's mailbox and are collected in town. Nothing is ever credited by reaching
 *   into another trader's wallet, which keeps every transfer local and verifiable.
 */
import { itemRegistry } from '../sandbox/ItemRegistry';
import type { ItemStack } from '../sandbox/Inventory';
import type { PriceBook } from './PriceBook';
import { type Failed, fail, isCount, isPrice, type Ledger, type Trader } from './types';
import { MAX_GOLD } from '../actors/Character';

export interface Listing {
  readonly id: number;
  readonly seller: string;
  readonly sellerName: string;
  readonly itemId: string;
  count: number;
  /** Price per unit. */
  readonly price: number;
  readonly listedAt: number;
  readonly expiresAt: number;
}

export interface SaleRecord {
  readonly t: number;
  readonly itemId: string;
  readonly count: number;
  /** Gold the seller receives after the fee. */
  readonly net: number;
  readonly buyer: string;
  readonly buyerName: string;
}

export interface Mailbox {
  gold: number;
  items: ItemStack[];
  /** Unread sales (for notifications), newest last. */
  sales: SaleRecord[];
}

export interface MarketConfig {
  /** Listing lifetime (simulation seconds). */
  readonly listingTime: number;
  readonly fee: number;
  readonly maxListings: number;
}

export const DEFAULT_MARKET: MarketConfig = {
  listingTime: 3 * 24 * 60,
  fee: 0.05,
  maxListings: 12,
};

export interface MarketData {
  readonly nextId: number;
  readonly listings: readonly Listing[];
  readonly mail: Record<string, Mailbox>;
}

export type ListResult = { readonly ok: true; readonly listing: Listing } | Failed;
export type BuyResult = { readonly ok: true; readonly total: number } | Failed;

export interface Collected {
  readonly gold: number;
  readonly items: readonly ItemStack[];
  readonly sales: readonly SaleRecord[];
}

export interface ListingQuery {
  readonly itemId?: string;
  readonly kind?: string;
  readonly text?: (itemId: string) => boolean;
  readonly excludeSeller?: string;
}

export class Market {
  private readonly listings = new Map<number, Listing>();
  private readonly mail = new Map<string, Mailbox>();
  private nextId = 1;
  /** Bumps on every change (UI change detection). */
  version = 0;

  constructor(
    private readonly prices: PriceBook,
    private readonly ledger: Ledger,
    readonly config: MarketConfig = DEFAULT_MARKET,
  ) {}

  get all(): readonly Listing[] {
    return [...this.listings.values()];
  }

  get(id: number): Listing | undefined {
    return this.listings.get(id);
  }

  bySeller(key: string): Listing[] {
    return this.all.filter((l) => l.seller === key);
  }

  /** Units of an item currently for sale. */
  supply(itemId: string): number {
    let n = 0;
    for (const l of this.listings.values()) if (l.itemId === itemId) n += l.count;
    return n;
  }

  /** Cheapest listing of an item not sold by `excludeSeller`. */
  cheapest(itemId: string, excludeSeller?: string): Listing | null {
    let best: Listing | null = null;
    for (const l of this.listings.values()) {
      if (l.itemId !== itemId || l.seller === excludeSeller) continue;
      if (!best || l.price < best.price) best = l;
    }
    return best;
  }

  query(q: ListingQuery = {}): Listing[] {
    return this.all
      .filter(
        (l) =>
          (!q.itemId || l.itemId === q.itemId) &&
          (!q.kind || itemRegistry.get(l.itemId)?.kind === q.kind) &&
          (!q.excludeSeller || l.seller !== q.excludeSeller) &&
          (!q.text || q.text(l.itemId)),
      )
      .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.price - b.price || a.id - b.id);
  }

  mailbox(key: string): Mailbox {
    let m = this.mail.get(key);
    if (!m) {
      m = { gold: 0, items: [], sales: [] };
      this.mail.set(key, m);
    }
    return m;
  }

  peekMail(key: string): Readonly<Mailbox> | null {
    return this.mail.get(key) ?? null;
  }

  /**
   * List `count` of an item. With `slot`, the items come from that inventory slot (the UI path);
   * otherwise from anywhere in the inventory.
   */
  list(
    t: Trader,
    itemId: string,
    count: number,
    price: number,
    now: number,
    slot?: number,
  ): ListResult {
    if (!isCount(count)) return fail('bad_count');
    if (!isPrice(price)) return fail('bad_price');
    const def = itemRegistry.get(itemId);
    if (!def || def.value <= 0) return fail('not_sold');
    if (this.bySeller(t.key).length >= this.config.maxListings) return fail('too_many');
    if (slot !== undefined) {
      const st = t.inventory.get(slot);
      if (!st || st.itemId !== itemId || st.count < count) return fail('no_item');
      t.inventory.removeAt(slot, count);
    } else if (!t.inventory.remove(itemId, count)) return fail('no_item');
    const listing: Listing = {
      id: this.nextId++,
      seller: t.key,
      sellerName: t.name,
      itemId,
      count,
      price,
      listedAt: now,
      expiresAt: now + this.config.listingTime,
    };
    this.listings.set(listing.id, listing);
    this.version++;
    return { ok: true, listing };
  }

  buy(t: Trader, listingId: number, count: number, now: number): BuyResult {
    const l = this.listings.get(listingId);
    if (!l) return fail('no_listing');
    if (now >= l.expiresAt) return fail('expired');
    if (l.seller === t.key) return fail('self');
    if (!isCount(count) || count > l.count) return fail('bad_count');
    const total = l.price * count;
    if (t.gold < total) return fail('no_gold');
    if (t.inventory.capacityFor(l.itemId) < count) return fail('no_room');
    // All checks passed: apply atomically.
    t.gold -= total;
    t.inventory.add(l.itemId, count);
    l.count -= count;
    if (l.count <= 0) this.listings.delete(l.id);
    const fee = Math.max(1, Math.floor(total * this.config.fee));
    const net = total - fee;
    this.ledger.destroy('market_fee', fee);
    const box = this.mailbox(l.seller);
    box.gold = Math.min(MAX_GOLD, box.gold + net);
    box.sales.push({ t: now, itemId: l.itemId, count, net, buyer: t.key, buyerName: t.name });
    if (box.sales.length > 30) box.sales.shift();
    this.prices.recordSale(l.itemId, l.price, count);
    this.version++;
    return { ok: true, total };
  }

  /** Withdraw a listing; what does not fit in the inventory goes to the mailbox. */
  cancel(t: Trader, listingId: number): { readonly ok: true } | Failed {
    const l = this.listings.get(listingId);
    if (!l) return fail('no_listing');
    if (l.seller !== t.key) return fail('not_seller');
    this.listings.delete(l.id);
    const left = t.inventory.add(l.itemId, l.count);
    if (left > 0) this.mailbox(t.key).items.push({ itemId: l.itemId, count: left });
    this.version++;
    return { ok: true };
  }

  /** Return expired listings to their sellers' mailboxes. */
  expire(now: number): number {
    let n = 0;
    for (const l of [...this.listings.values()]) {
      if (now < l.expiresAt) continue;
      this.listings.delete(l.id);
      this.mailbox(l.seller).items.push({ itemId: l.itemId, count: l.count });
      n++;
    }
    if (n > 0) this.version++;
    return n;
  }

  /** Move mailbox gold and items into the trader's wallet and inventory (what fits). */
  collect(t: Trader): Collected {
    const box = this.mail.get(t.key);
    if (!box) return { gold: 0, items: [], sales: [] };
    const gold = Math.min(box.gold, MAX_GOLD - t.gold);
    t.gold += gold;
    box.gold -= gold;
    const items: ItemStack[] = [];
    const keep: ItemStack[] = [];
    for (const st of box.items) {
      const left = t.inventory.add(st.itemId, st.count);
      if (st.count - left > 0) items.push({ itemId: st.itemId, count: st.count - left });
      if (left > 0) keep.push({ itemId: st.itemId, count: left });
    }
    box.items = keep;
    const sales = box.sales;
    box.sales = [];
    if (box.gold <= 0 && box.items.length === 0) this.mail.delete(t.key);
    if (gold > 0 || items.length > 0 || sales.length > 0) this.version++;
    return { gold, items, sales };
  }

  /** Gold held in mailboxes (part of the money supply). */
  mailGold(): number {
    let g = 0;
    for (const m of this.mail.values()) g += m.gold;
    return g;
  }

  /** Units of an item held by the market (listings + mailboxes) — for conservation checks. */
  heldCount(itemId: string): number {
    let n = this.supply(itemId);
    for (const m of this.mail.values())
      for (const st of m.items) if (st.itemId === itemId) n += st.count;
    return n;
  }

  toJSON(): MarketData {
    const mail: Record<string, Mailbox> = {};
    for (const [k, m] of this.mail) mail[k] = m;
    return { nextId: this.nextId, listings: this.all, mail };
  }

  /** Load saved state (untrusted: unknown items, bad numbers and duplicates are dropped). */
  load(data: unknown): void {
    this.listings.clear();
    this.mail.clear();
    const d = data as Partial<MarketData> | null;
    if (!d || typeof d !== 'object') return;
    let maxId = 0;
    for (const l of Array.isArray(d.listings) ? d.listings : []) {
      if (!l || typeof l !== 'object') continue;
      const id = Number(l.id);
      if (!Number.isInteger(id) || id <= 0 || this.listings.has(id)) continue;
      if (typeof l.seller !== 'string' || !itemRegistry.get(l.itemId)) continue;
      if (!isCount(Number(l.count)) || !isPrice(Number(l.price))) continue;
      const max = itemRegistry.get(l.itemId)?.maxStack ?? 1;
      this.listings.set(id, {
        id,
        seller: l.seller,
        sellerName: typeof l.sellerName === 'string' ? l.sellerName.slice(0, 24) : '?',
        itemId: l.itemId,
        count: Math.min(Number(l.count), Math.max(max, 1) * 10),
        price: Number(l.price),
        listedAt: Number(l.listedAt) || 0,
        expiresAt: Number(l.expiresAt) || 0,
      });
      maxId = Math.max(maxId, id);
    }
    for (const [k, m] of Object.entries(d.mail && typeof d.mail === 'object' ? d.mail : {})) {
      if (!m || typeof m !== 'object') continue;
      const items = (Array.isArray(m.items) ? m.items : []).filter(
        (st) => st && itemRegistry.get(st.itemId) && isCount(Number(st.count)),
      );
      const sales = (Array.isArray(m.sales) ? m.sales : []).slice(-30);
      const gold = Math.max(0, Math.min(MAX_GOLD, Math.floor(Number(m.gold) || 0)));
      if (gold > 0 || items.length > 0 || sales.length > 0)
        this.mail.set(k, { gold, items: items.map((s) => ({ ...s })), sales });
    }
    this.nextId = Math.max(maxId + 1, Number.isInteger(d.nextId) ? Number(d.nextId) : 1);
    this.version++;
  }
}
