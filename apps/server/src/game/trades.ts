/**
 * Player ↔ player trades: request → accept → both sides set offers (items and gold) → both
 * confirm → the server swaps everything in one step after re-checking it all. Any change to an
 * offer clears both confirmations, so nobody can swap the goods after the other side agreed.
 */
import { Inventory, itemRegistry, MAX_GOLD, TILE_SIZE } from '@world/shared';
import type { Session } from './Session';
import type { WorldServer } from './WorldServer';

const TRADE_RANGE = 10 * TILE_SIZE;
const MAX_OFFER_STACKS = 8;

interface Offer {
  items: { itemId: string; count: number }[];
  gold: number;
  confirmed: boolean;
}

interface Trade {
  readonly a: string;
  readonly b: string;
  readonly offers: Record<string, Offer>;
}

type Args = Record<string, unknown>;
type Result = { ok: true; [k: string]: unknown } | { ok: false; reason: string };

export class PlayerTrades {
  /** Pending requests: target key → requester key. */
  private readonly requests = new Map<string, string>();
  private readonly active = new Map<string, Trade>();

  constructor(private readonly server: WorldServer) {}

  private near(a: Session, b: Session): boolean {
    const ma = a.slot?.character.motor;
    const mb = b.slot?.character.motor;
    return (
      !!ma && !!mb && Math.abs(ma.x - mb.x) <= TRADE_RANGE && Math.abs(ma.y - mb.y) <= TRADE_RANGE
    );
  }

  private send(t: Trade): void {
    for (const k of [t.a, t.b]) {
      const s = this.server.sessionByKey(k);
      const other = k === t.a ? t.b : t.a;
      s?.sendJson({
        t: 'trade',
        state: 'open',
        with: other,
        withName: this.server.sessionByKey(other)?.slot?.character.name ?? '',
        mine: t.offers[k],
        theirs: t.offers[other],
      });
    }
  }

  private close(t: Trade, state: 'done' | 'cancelled', reason = ''): void {
    this.active.delete(t.a);
    this.active.delete(t.b);
    for (const k of [t.a, t.b])
      this.server.sessionByKey(k)?.sendJson({ t: 'trade', state, reason });
  }

  cancelFor(key: string): void {
    this.requests.delete(key);
    for (const [target, from] of this.requests) if (from === key) this.requests.delete(target);
    const t = this.active.get(key);
    if (t) this.close(t, 'cancelled', 'left');
  }

  handle(s: Session, op: string, args: Args): Result {
    switch (op) {
      case 'request': {
        const name = typeof args.name === 'string' ? args.name.slice(0, 24) : '';
        const to = this.server.sessionByName(name);
        if (!to || to === s) return { ok: false, reason: 'not_found' };
        if (this.active.has(s.key) || this.active.has(to.key)) return { ok: false, reason: 'busy' };
        if (!this.near(s, to)) return { ok: false, reason: 'too_far' };
        this.requests.set(to.key, s.key);
        to.sendJson({ t: 'tradeRequest', from: s.key, name: s.slot?.character.name ?? '' });
        return { ok: true };
      }
      case 'accept': {
        const from = this.requests.get(s.key);
        const other = from ? this.server.sessionByKey(from) : undefined;
        this.requests.delete(s.key);
        if (!from || !other) return { ok: false, reason: 'no_request' };
        if (this.active.has(s.key) || this.active.has(from)) return { ok: false, reason: 'busy' };
        if (!this.near(s, other)) return { ok: false, reason: 'too_far' };
        const t: Trade = {
          a: from,
          b: s.key,
          offers: {
            [from]: { items: [], gold: 0, confirmed: false },
            [s.key]: { items: [], gold: 0, confirmed: false },
          },
        };
        this.active.set(from, t);
        this.active.set(s.key, t);
        this.send(t);
        return { ok: true };
      }
      case 'decline': {
        const from = this.requests.get(s.key);
        this.requests.delete(s.key);
        if (from) this.server.sessionByKey(from)?.sendJson({ t: 'trade', state: 'declined' });
        return { ok: true };
      }
      case 'offer': {
        const t = this.active.get(s.key);
        if (!t) return { ok: false, reason: 'no_trade' };
        const inv = s.character.inventory;
        const gold = Number(args.gold);
        if (!Number.isInteger(gold) || gold < 0 || gold > s.character.gold)
          return { ok: false, reason: 'bad_gold' };
        const raw = Array.isArray(args.items) ? args.items : [];
        if (raw.length > MAX_OFFER_STACKS) return { ok: false, reason: 'too_many' };
        const totals = new Map<string, number>();
        for (const it of raw) {
          const o = (it ?? {}) as Args;
          const itemId = typeof o.itemId === 'string' ? o.itemId : '';
          const count = Number(o.count);
          if (!itemRegistry.get(itemId) || !Number.isInteger(count) || count <= 0)
            return { ok: false, reason: 'bad_item' };
          totals.set(itemId, (totals.get(itemId) ?? 0) + count);
        }
        for (const [itemId, n] of totals)
          if (inv.count(itemId) < n) return { ok: false, reason: 'no_item' };
        t.offers[s.key] = {
          items: [...totals].map(([itemId, count]) => ({ itemId, count })),
          gold,
          confirmed: false,
        };
        const other = t.offers[s.key === t.a ? t.b : t.a];
        if (other) other.confirmed = false;
        this.send(t);
        return { ok: true };
      }
      case 'confirm': {
        const t = this.active.get(s.key);
        const mine = t?.offers[s.key];
        if (!t || !mine) return { ok: false, reason: 'no_trade' };
        mine.confirmed = true;
        const other = t.offers[s.key === t.a ? t.b : t.a];
        if (other?.confirmed) {
          const r = this.execute(t);
          if (r.ok) this.close(t, 'done');
          else {
            for (const o of Object.values(t.offers)) o.confirmed = false;
            this.send(t);
          }
          return r;
        }
        this.send(t);
        return { ok: true, waiting: true };
      }
      case 'cancel': {
        const t = this.active.get(s.key);
        if (t) this.close(t, 'cancelled', 'cancelled');
        return { ok: true };
      }
      default:
        return { ok: false, reason: 'bad_op' };
    }
  }

  /** Swap both offers atomically after re-validating everything. */
  private execute(t: Trade): Result {
    const sa = this.server.sessionByKey(t.a);
    const sb = this.server.sessionByKey(t.b);
    const oa = t.offers[t.a];
    const ob = t.offers[t.b];
    if (!sa?.slot || !sb?.slot || !oa || !ob) return { ok: false, reason: 'gone' };
    if (!this.near(sa, sb)) return { ok: false, reason: 'too_far' };
    const ca = sa.character;
    const cb = sb.character;
    if (ca.gold < oa.gold || cb.gold < ob.gold) return { ok: false, reason: 'no_gold' };
    if (ca.gold - oa.gold + ob.gold > MAX_GOLD || cb.gold - ob.gold + oa.gold > MAX_GOLD)
      return { ok: false, reason: 'gold_cap' };
    // Dry run on copies: both must be able to give what they offered and hold what they get.
    const dry = (inv: Inventory, give: Offer, get: Offer): boolean => {
      const copy = new Inventory();
      copy.load(inv.toJSON());
      for (const it of give.items) if (!copy.remove(it.itemId, it.count)) return false;
      for (const it of get.items) if (copy.add(it.itemId, it.count) > 0) return false;
      return true;
    };
    if (!dry(ca.inventory, oa, ob) || !dry(cb.inventory, ob, oa))
      return { ok: false, reason: 'no_room' };
    for (const it of oa.items) ca.inventory.remove(it.itemId, it.count);
    for (const it of ob.items) cb.inventory.remove(it.itemId, it.count);
    for (const it of ob.items) ca.inventory.add(it.itemId, it.count);
    for (const it of oa.items) cb.inventory.add(it.itemId, it.count);
    ca.gold = ca.gold - oa.gold + ob.gold;
    cb.gold = cb.gold - ob.gold + oa.gold;
    this.server.journal(t.a, 'player_trade', {
      with: t.b,
      gave: JSON.stringify(oa.items),
      gaveGold: oa.gold,
      got: JSON.stringify(ob.items),
      gotGold: ob.gold,
    });
    this.server.sendPrivate(sa, true);
    this.server.sendPrivate(sb, true);
    return { ok: true };
  }
}
