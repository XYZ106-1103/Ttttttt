import { describe, expect, it } from 'vitest';
import { directTrade, Economy, Inventory, itemRegistry, Rng, type Trader } from '../src';

function trader(key: string, gold = 0): Trader {
  return { key, name: key, inventory: new Inventory(), gold };
}

describe('market', () => {
  it('escrows listed items, pays the seller through the mailbox minus the fee', () => {
    const eco = new Economy();
    const seller = trader('adv-01');
    const buyer = trader('player', 1000);
    seller.inventory.add('copper_sword', 1);
    const r = eco.market.list(seller, 'copper_sword', 1, 200, 0);
    expect(r.ok).toBe(true);
    expect(seller.inventory.count('copper_sword')).toBe(0);
    if (!r.ok) return;
    // Cannot buy your own listing; cannot buy without gold.
    expect(eco.market.buy(seller, r.listing.id, 1, 1)).toEqual({ ok: false, reason: 'self' });
    expect(eco.market.buy(trader('poor', 50), r.listing.id, 1, 1).ok).toBe(false);
    expect(eco.market.buy(buyer, r.listing.id, 1, 1)).toEqual({ ok: true, total: 200 });
    expect(buyer.gold).toBe(800);
    expect(buyer.inventory.count('copper_sword')).toBe(1);
    expect(eco.market.all).toHaveLength(0);
    // The seller collects 200 - 5% fee in town.
    expect(seller.gold).toBe(0);
    const got = eco.market.collect(seller);
    expect(got.gold).toBe(190);
    expect(got.sales[0]?.buyer).toBe('player');
    expect(seller.gold).toBe(190);
    expect(eco.ledger.destroyed).toBe(10);
  });

  it('supports partial buys, cancels and expiry back to the mailbox', () => {
    const eco = new Economy({ hourSeconds: 60, market: { listingTime: 100 } });
    const s = trader('adv-02');
    const b = trader('adv-03', 500);
    s.inventory.add('iron_ore', 20);
    const l = eco.market.list(s, 'iron_ore', 20, 15, 0);
    if (!l.ok) throw new Error('list failed');
    expect(eco.market.buy(b, l.listing.id, 5, 10).ok).toBe(true);
    expect(eco.market.get(l.listing.id)?.count).toBe(15);
    expect(eco.market.supply('iron_ore')).toBe(15);
    // Someone else cannot cancel it.
    expect(eco.market.cancel(b, l.listing.id)).toEqual({ ok: false, reason: 'not_seller' });
    eco.market.expire(100);
    expect(eco.market.all).toHaveLength(0);
    eco.market.collect(s);
    expect(s.inventory.count('iron_ore')).toBe(15);
  });

  it('validates counts and prices', () => {
    const eco = new Economy();
    const s = trader('a');
    s.inventory.add('wood', 10);
    expect(eco.market.list(s, 'wood', 0, 5, 0).ok).toBe(false);
    expect(eco.market.list(s, 'wood', 11, 5, 0).ok).toBe(false);
    expect(eco.market.list(s, 'wood', 2, 0, 0).ok).toBe(false);
    expect(eco.market.list(s, 'wood', 2, 2.5, 0).ok).toBe(false);
    expect(eco.market.list(s, 'nonexistent', 1, 5, 0).ok).toBe(false);
    expect(s.inventory.count('wood')).toBe(10);
  });

  it('never duplicates items or gold under random trading (conservation fuzz)', () => {
    const eco = new Economy({ hourSeconds: 60, market: { listingTime: 40 } });
    const rng = new Rng(42);
    const items = ['wood', 'iron_ore', 'copper_sword', 'healing_potion', 'slime_gel'];
    const traders = Array.from({ length: 6 }, (_, i) => {
      const t = trader(`t${i}`, 400);
      for (const id of items) t.inventory.add(id, rng.int(0, 6));
      return t;
    });
    const shop = eco.shop('general_store');
    if (!shop) throw new Error('no shop');
    const countItem = (id: string) =>
      traders.reduce((n, t) => n + t.inventory.count(id), 0) + eco.market.heldCount(id);
    const goldSupply = () => traders.reduce((n, t) => n + t.gold, 0) + eco.market.mailGold();
    const startGold = goldSupply();
    const shopFlow: Record<string, number> = {};
    for (let step = 0; step < 3000; step++) {
      const t = traders[rng.int(0, traders.length - 1)] as Trader;
      const o = traders[rng.int(0, traders.length - 1)] as Trader;
      const id = items[rng.int(0, items.length - 1)] as string;
      const now = step * 0.5;
      switch (rng.int(0, 6)) {
        case 0:
          eco.market.list(t, id, rng.int(1, 3), rng.int(1, 80), now);
          break;
        case 1: {
          const ls = eco.market.all;
          const l = ls[rng.int(0, Math.max(0, ls.length - 1))];
          if (l) eco.market.buy(t, l.id, rng.int(1, l.count), now);
          break;
        }
        case 2: {
          const l = eco.market.bySeller(t.key)[0];
          if (l) eco.market.cancel(t, l.id);
          break;
        }
        case 3:
          eco.market.collect(t);
          break;
        case 4:
          directTrade(t, o, id, rng.int(1, 3), rng.int(1, 50));
          break;
        case 5: {
          const r = shop.sell(t, id, 1);
          if (r.ok) shopFlow[id] = (shopFlow[id] ?? 0) - 1;
          break;
        }
        default: {
          const r = shop.buy(t, 'healing_potion', 1);
          if (r.ok) shopFlow.healing_potion = (shopFlow.healing_potion ?? 0) + 1;
        }
      }
      eco.tick(0.5, now);
      for (const tr of traders) expect(tr.gold).toBeGreaterThanOrEqual(0);
    }
    // Gold: transfers conserve; only shop buy-backs (faucet) and fees/sales (sinks) change it.
    expect(goldSupply()).toBe(startGold + eco.ledger.created - eco.ledger.destroyed);
    // Items: the only changes come from the shop counter.
    const rng2 = new Rng(42);
    const initial: Record<string, number> = {};
    for (let i = 0; i < 6; i++)
      for (const id of items) initial[id] = (initial[id] ?? 0) + rng2.int(0, 6);
    for (const id of items) expect(countItem(id)).toBe((initial[id] ?? 0) + (shopFlow[id] ?? 0));
  });
});

describe('prices and shops', () => {
  it('moves reference prices toward trades and back toward base value', () => {
    const eco = new Economy({ hourSeconds: 10 });
    const base = itemRegistry.get('iron_ore')?.value ?? 0;
    expect(eco.prices.ref('iron_ore')).toBe(base);
    for (let i = 0; i < 6; i++) eco.prices.recordSale('iron_ore', base * 3, 3);
    const high = eco.prices.ref('iron_ore');
    expect(high).toBeGreaterThan(base * 2);
    for (let i = 0; i < 200; i++) eco.tick(10, i * 10);
    expect(eco.prices.ref('iron_ore')).toBeLessThan(high);
    expect(eco.prices.history('iron_ore').length).toBeGreaterThan(0);
    // Demand above supply raises the suggested price; a glut lowers it.
    eco.prices.recordSale('wood', 2, 30);
    eco.tick(10, 0);
    expect(eco.prices.suggested('wood', 0)).toBeGreaterThanOrEqual(
      eco.prices.suggested('wood', 80),
    );
  });

  it('raises shop prices as stock runs out and pays less when flooded', () => {
    const eco = new Economy();
    const shop = eco.shop('general_store');
    if (!shop) throw new Error('no shop');
    const rich = trader('player', 100_000);
    const p0 = shop.sellPrice('healing_potion');
    expect(shop.buy(rich, 'healing_potion', 50).ok).toBe(true);
    expect(shop.sellPrice('healing_potion')).toBeGreaterThan(p0);
    expect(shop.buy(rich, 'healing_potion', 20)).toEqual({ ok: false, reason: 'out_of_stock' });
    rich.inventory.add('slime_gel', 200);
    const b0 = shop.buyPrice('slime_gel') || 1;
    shop.sell(rich, 'slime_gel', 150);
    expect(shop.buyPrice('slime_gel')).toBeLessThanOrEqual(b0);
    // Restock over time.
    for (let i = 0; i < 20; i++) eco.tick(60, i * 60);
    expect(shop.stockOf('healing_potion')).toBe(60);
  });

  it('saves and restores economy state', () => {
    const eco = new Economy();
    const s = trader('adv-01');
    s.inventory.add('iron_sword', 1);
    eco.market.list(s, 'iron_sword', 1, 400, 0);
    eco.prices.recordSale('wood', 5, 10);
    const copy = new Economy();
    copy.load(JSON.parse(JSON.stringify(eco.toJSON())));
    expect(copy.market.all).toHaveLength(1);
    expect(copy.market.all[0]?.price).toBe(400);
    expect(copy.prices.ref('wood')).toBe(eco.prices.ref('wood'));
    // Garbage is rejected, not trusted.
    copy.load({
      market: { listings: [{ id: 1, seller: 'x', itemId: 'nope', count: 1, price: 1 }] },
    });
    expect(copy.market.all).toHaveLength(0);
  });

  it('direct trades are all-or-nothing', () => {
    const a = trader('a');
    const b = trader('b', 30);
    a.inventory.add('iron_ore', 5);
    expect(directTrade(a, b, 'iron_ore', 3, 15)).toEqual({ ok: false, reason: 'no_gold' });
    expect(a.inventory.count('iron_ore')).toBe(5);
    expect(directTrade(a, b, 'iron_ore', 2, 15)).toEqual({ ok: true });
    expect(a.gold).toBe(30);
    expect(b.gold).toBe(0);
    expect(b.inventory.count('iron_ore')).toBe(2);
    expect(directTrade(a, a, 'iron_ore', 1, 1).ok).toBe(false);
  });
});
