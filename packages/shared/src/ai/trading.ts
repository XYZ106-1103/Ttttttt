/**
 * How adventurers take part in the economy — all through the validated economy functions:
 * what they keep, what they consider surplus, what they want and how much they would pay,
 * crafting for profit, merchant arbitrage, and the offers they make to the player face to face.
 */
import { RECIPE_DEFS } from '../data/recipes';
import type { Economy } from '../economy/Economy';
import type { NpcShop } from '../economy/NpcShop';
import { craft, maxCraftable } from '../sandbox/crafting';
import { itemRegistry } from '../sandbox/ItemRegistry';
import type { Adventurer } from './Adventurer';
import { RAID_SUMMON } from './goals';
import { gearScore, planItem } from './knowledge';

export interface Offer {
  readonly itemId: string;
  readonly count: number;
  /** Price per unit. */
  readonly price: number;
}

export interface TradeEvent {
  readonly type: 'sold' | 'bought' | 'listed' | 'crafted';
  readonly key: string;
  readonly itemId: string;
  readonly count: number;
  readonly gold: number;
}

const ingredientCache = new Map<string, ReadonlySet<string>>();

/** Every item that goes into making `itemId` (recursively), including itself. */
export function ingredientTree(itemId: string): ReadonlySet<string> {
  const hit = ingredientCache.get(itemId);
  if (hit) return hit;
  const out = new Set<string>([itemId]);
  const visit = (id: string, depth: number) => {
    if (depth > 6) return;
    for (const r of RECIPE_DEFS) {
      if (r.output.item !== id) continue;
      for (const inp of r.inputs) {
        if (out.has(inp.item)) continue;
        out.add(inp.item);
        visit(inp.item, depth + 1);
      }
    }
  };
  visit(itemId, 0);
  ingredientCache.set(itemId, out);
  return out;
}

function goalItem(a: Adventurer): string | null {
  const g = a.goal;
  if (g?.kind === 'item') return g.itemId;
  if (g?.kind === 'raid') return RAID_SUMMON;
  return null;
}

/** Gold an adventurer keeps for potions and emergencies. */
export function goldReserve(a: Adventurer): number {
  return 40 + a.character.level * 8;
}

export function budget(a: Adventurer): number {
  return Math.max(0, a.character.gold - goldReserve(a));
}

function wornScore(a: Adventurer, itemId: string): number {
  const c = a.character;
  const slot = c.equipment.slotFor(itemId);
  const worn = slot ? c.equipment.get(slot) : null;
  return gearScore(worn ? itemRegistry.get(worn.itemId) : undefined);
}

/** How many of an item the adventurer wants to hold on to. */
export function keepCount(a: Adventurer, itemId: string): number {
  const c = a.character;
  const def = itemRegistry.get(itemId);
  if (!def) return 0;
  const goal = goalItem(a);
  if (goal && ingredientTree(goal).has(itemId)) return Infinity;
  if (itemId === RAID_SUMMON) return a.goal?.kind === 'raid' ? 1 : 0;
  if (itemId === 'healing_potion') return 10;
  if (itemId === 'mana_potion') return c.jobId === 'mage' ? 8 : 3;
  if (itemId === 'torch') return 10;
  if (def.tool) {
    // Keep the best tool of each type.
    let best = '';
    let bp = -1;
    for (let i = 0; i < c.inventory.size; i++) {
      const t = itemRegistry.get(c.inventory.get(i)?.itemId ?? '')?.tool;
      if (t?.type === def.tool.type && t.power > bp) {
        bp = t.power;
        best = c.inventory.get(i)?.itemId ?? '';
      }
    }
    return best === itemId ? 1 : 0;
  }
  if (def.weapon) {
    // Keep the weapon in slot 0 and anything usable soon that fits the job.
    if (c.inventory.get(0)?.itemId === itemId) return 1;
    const soon = def.weapon.reqLevel <= c.level + 3;
    return soon && gearScore(def) > gearScore(itemRegistry.get(c.inventory.get(0)?.itemId ?? ''))
      ? 1
      : 0;
  }
  if (def.equip) {
    const soon = def.equip.reqLevel <= c.level + 3;
    return soon && gearScore(def) > wornScore(a, itemId) ? 1 : 0;
  }
  // Raw materials: a merchant or artisan holds a working stock for crafting.
  if (
    def.kind === 'material' &&
    (a.profile.archetype === 'artisan' || a.profile.archetype === 'merchant')
  )
    return 12;
  return 0;
}

/** Items the adventurer would part with. */
export function surplusOf(a: Adventurer): Offer[] {
  const c = a.character;
  const counts = new Map<string, number>();
  for (let i = 0; i < c.inventory.size; i++) {
    const st = c.inventory.get(i);
    if (st) counts.set(st.itemId, (counts.get(st.itemId) ?? 0) + st.count);
  }
  const out: Offer[] = [];
  for (const [itemId, n] of counts) {
    const def = itemRegistry.get(itemId);
    if (!def || def.value <= 0) continue;
    const extra = n - keepCount(a, itemId);
    if (extra > 0) out.push({ itemId, count: extra, price: def.value });
  }
  return out;
}

/** What the adventurer is looking for, with the most it would pay per unit. */
export function wantsOf(a: Adventurer, eco: Economy): Offer[] {
  const c = a.character;
  const p = a.profile.personality;
  const out: Offer[] = [];
  const frugal = 1.05 + (1 - p.greed) * 0.3;
  const goal = goalItem(a);
  if (goal) {
    const plan = planItem((id) => c.inventory.count(id), goal, 1);
    for (const n of plan.needs) {
      out.push({
        itemId: n.itemId,
        count: n.count,
        price: Math.ceil(eco.prices.ref(n.itemId) * frugal),
      });
    }
    if (
      itemRegistry.get(goal)?.equip ||
      itemRegistry.get(goal)?.weapon ||
      itemRegistry.get(goal)?.tool
    )
      out.push({ itemId: goal, count: 1, price: Math.ceil(eco.prices.ref(goal) * frugal) });
  }
  if (c.inventory.count('healing_potion') < 4)
    out.push({
      itemId: 'healing_potion',
      count: 6,
      price: Math.ceil(eco.prices.ref('healing_potion') * 1.6),
    });
  return out;
}

/** Equipment on the market that would be an upgrade the adventurer can afford. */
function upgradeListings(a: Adventurer, eco: Economy): { id: number; price: number }[] {
  const c = a.character;
  const out: { id: number; price: number; gain: number }[] = [];
  const money = budget(a);
  for (const l of eco.market.all) {
    if (l.seller === a.key || l.price > money) continue;
    const def = itemRegistry.get(l.itemId);
    if (!def) continue;
    let gain = 0;
    if (def.equip && def.equip.reqLevel <= c.level) gain = gearScore(def) - wornScore(a, def.id);
    else if (def.weapon && def.weapon.reqLevel <= c.level && keepCount(a, def.id) > 0)
      gain = gearScore(def) - gearScore(itemRegistry.get(c.inventory.get(0)?.itemId ?? ''));
    if (gain <= 0) continue;
    // Pay up to ~1.3× reference for a real upgrade, less if greedy.
    if (l.price > eco.prices.ref(l.itemId) * (1.1 + (1 - a.profile.personality.greed) * 0.3))
      continue;
    out.push({ id: l.id, price: l.price, gain });
  }
  return out.sort((x, y) => y.gain / y.price - x.gain / x.price);
}

function askPrice(a: Adventurer, eco: Economy, itemId: string): number {
  const p = a.profile.personality;
  const base = eco.prices.suggested(itemId, eco.market.supply(itemId));
  const merchant = a.profile.archetype === 'merchant' ? 0.08 : 0;
  // Goods that came back unsold are offered cheaper next time.
  const unsold = 0.9 ** Math.min(4, a.unsold.get(itemId) ?? 0);
  return Math.max(1, Math.round(base * (0.9 + p.greed * 0.25 + merchant) * unsold));
}

/**
 * A visit to the town market: collect sales, restock potions, buy what the goal needs and
 * affordable upgrades, craft goods worth more than their materials, and list the surplus.
 */
export function tradeInTown(a: Adventurer, eco: Economy, now: number, events: TradeEvent[]): void {
  const c = a.character;
  const shop = eco.shop('general_store');
  // 1. Collect the mailbox.
  const got = eco.market.collect(c);
  for (const s of got.sales) {
    events.push({ type: 'sold', key: a.key, itemId: s.itemId, count: s.count, gold: s.net });
    a.unsold.delete(s.itemId);
  }
  for (const st of got.items) a.unsold.set(st.itemId, (a.unsold.get(st.itemId) ?? 0) + 1);
  // 2. Potions.
  if (shop) restockPotions(a, shop, events);
  // 3. Goal materials and gear from the market.
  for (const w of wantsOf(a, eco)) {
    let need = w.count;
    for (let guard = 0; guard < 4 && need > 0; guard++) {
      const l = eco.market.cheapest(w.itemId, a.key);
      if (!l || l.price > w.price) break;
      const n = Math.min(need, l.count, Math.floor(budget(a) / l.price));
      if (n <= 0 || !eco.market.buy(c, l.id, n, now).ok) break;
      need -= n;
      events.push({ type: 'bought', key: a.key, itemId: w.itemId, count: n, gold: n * l.price });
    }
  }
  for (const u of upgradeListings(a, eco).slice(0, 1)) {
    const l = eco.market.get(u.id);
    if (l && eco.market.buy(c, l.id, 1, now).ok)
      events.push({ type: 'bought', key: a.key, itemId: l.itemId, count: 1, gold: l.price });
  }
  // 4. Merchants buy underpriced goods to resell.
  if (a.profile.archetype === 'merchant') {
    for (const l of eco.market.all) {
      if (l.seller === a.key) continue;
      if (l.price > eco.prices.ref(l.itemId) * 0.72) continue;
      const n = Math.min(l.count, Math.floor(budget(a) / l.price));
      if (n > 0 && eco.market.buy(c, l.id, n, now).ok)
        events.push({ type: 'bought', key: a.key, itemId: l.itemId, count: n, gold: n * l.price });
    }
  }
  // 5. Craft for profit (artisans and merchants).
  if (a.profile.archetype === 'artisan' || a.profile.archetype === 'merchant')
    craftForProfit(a, eco, events, now);
  // 6. Withdraw listings priced far above the market; list the surplus.
  for (const l of eco.market.bySeller(a.key)) {
    if (
      now - l.listedAt > eco.market.config.listingTime * 0.5 &&
      l.price > eco.prices.ref(l.itemId) * 1.15
    )
      eco.market.cancel(c, l.id);
  }
  const slots = (a.profile.archetype === 'merchant' ? 10 : 5) - eco.market.bySeller(a.key).length;
  const surplus = surplusOf(a).sort((x, y) => y.price * y.count - x.price * x.count);
  let listed = 0;
  for (const s of surplus) {
    const def = itemRegistry.get(s.itemId);
    if (!def) continue;
    // Bulk junk goes to the shop counter; everything else to the exchange.
    const junk = def.value <= 2 && s.count >= 20;
    if ((junk || listed >= slots) && shop) {
      if (junk || c.inventory.freeSlots() < 6) {
        const r = shop.sell(c, s.itemId, s.count);
        if (r.ok)
          events.push({
            type: 'sold',
            key: a.key,
            itemId: s.itemId,
            count: s.count,
            gold: r.total,
          });
      }
      continue;
    }
    const count = Math.min(s.count, def.maxStack);
    const r = eco.market.list(c, s.itemId, count, askPrice(a, eco, s.itemId), now);
    if (r.ok) {
      listed++;
      events.push({ type: 'listed', key: a.key, itemId: s.itemId, count, gold: r.listing.price });
    }
  }
}

function restockPotions(a: Adventurer, shop: NpcShop, events: TradeEvent[]): void {
  const c = a.character;
  const have = c.inventory.count('healing_potion');
  if (have >= 4) return;
  const unit = shop.sellPrice('healing_potion');
  const n = Math.min(
    6 - have,
    shop.stockOf('healing_potion'),
    Math.floor((c.gold - 10) / Math.max(1, unit)),
  );
  if (n > 0 && shop.buy(c, 'healing_potion', n).ok)
    events.push({ type: 'bought', key: a.key, itemId: 'healing_potion', count: n, gold: n * unit });
}

/** Craft items whose market value clearly beats their materials' (up to a couple per visit). */
export function craftForProfit(
  a: Adventurer,
  eco: Economy,
  events: TradeEvent[],
  now: number,
): void {
  const c = a.character;
  const goal = goalItem(a);
  const reserved = goal ? ingredientTree(goal) : new Set<string>();
  const options = RECIPE_DEFS.map((r) => {
    const cost = r.inputs.reduce((s, i) => s + eco.prices.ref(i.item) * i.count, 0);
    const worth = eco.prices.ref(r.output.item) * r.output.count;
    return { r, margin: worth / Math.max(1, cost) };
  })
    .filter(({ r, margin }) => margin >= 1.15 && !r.inputs.some((i) => reserved.has(i.item)))
    .filter(({ r }) => itemRegistry.get(r.output.item)?.kind !== 'block')
    .sort((x, y) => y.margin - x.margin);
  let made = 0;
  for (const { r, margin } of options) {
    if (made >= 2) break;
    // Do not flood the market: skip goods already plentiful.
    if (eco.market.supply(r.output.item) >= 4) continue;
    if (maxCraftable(c.inventory, r) <= 0 && margin >= 1.25) buyInputs(a, eco, r, events, now);
    if (maxCraftable(c.inventory, r) <= 0) continue;
    if (craft(c.inventory, r.id, 1).ok) {
      made++;
      events.push({
        type: 'crafted',
        key: a.key,
        itemId: r.output.item,
        count: r.output.count,
        gold: 0,
      });
    }
  }
}

/** Buy the missing materials for one craft of `r` if the market has them cheaply enough. */
function buyInputs(
  a: Adventurer,
  eco: Economy,
  r: (typeof RECIPE_DEFS)[number],
  events: TradeEvent[],
  now: number,
): void {
  const c = a.character;
  const worth = eco.prices.ref(r.output.item) * r.output.count;
  const plan: { id: number; n: number; cost: number }[] = [];
  let cost = 0;
  for (const inp of r.inputs) {
    const missing = inp.count - c.inventory.count(inp.item);
    if (missing <= 0) continue;
    const l = eco.market.cheapest(inp.item, a.key);
    if (!l || l.count < missing || l.price > eco.prices.ref(inp.item) * 1.1) return;
    plan.push({ id: l.id, n: missing, cost: l.price * missing });
    cost += l.price * missing;
  }
  // Only worth it if the finished good still clearly beats what the materials cost.
  const owned = r.inputs.reduce(
    (s, i) => s + Math.min(i.count, c.inventory.count(i.item)) * eco.prices.ref(i.item),
    0,
  );
  if (plan.length === 0 || cost > budget(a) || (cost + owned) * 1.15 > worth) return;
  for (const p of plan) {
    const l = eco.market.get(p.id);
    if (!l || !eco.market.buy(c, p.id, p.n, now).ok) return;
    events.push({ type: 'bought', key: a.key, itemId: l.itemId, count: p.n, gold: p.cost });
  }
}

/**
 * What the adventurer offers the player face to face: their surplus (priced a little better
 * than the market for friends) and what they would buy.
 */
export function offersForPlayer(
  a: Adventurer,
  eco: Economy,
  affinity: number,
): { sells: Offer[]; buys: Offer[] } {
  const p = a.profile.personality;
  const friend = Math.max(-0.3, Math.min(1, affinity));
  const sellMul = 0.95 + p.greed * 0.3 - friend * 0.15;
  const buyMul = 0.7 + (1 - p.greed) * 0.2 + friend * 0.12;
  const sells = surplusOf(a)
    .map((s) => ({
      itemId: s.itemId,
      count: Math.min(s.count, itemRegistry.get(s.itemId)?.maxStack ?? 1),
      price: Math.max(1, Math.round(eco.prices.ref(s.itemId) * sellMul)),
    }))
    .sort((x, y) => y.price - x.price)
    .slice(0, 12);
  const buys = wantsOf(a, eco)
    .map((w) => ({
      itemId: w.itemId,
      count: w.count,
      price: Math.max(1, Math.min(w.price, Math.round(eco.prices.ref(w.itemId) * buyMul))),
    }))
    .filter((w) => w.price * Math.min(1, w.count) <= a.character.gold)
    .slice(0, 8);
  return { sells, buys };
}
