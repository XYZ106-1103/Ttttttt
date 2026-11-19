/**
 * Market reference prices — the world's memory of what things are worth.
 *
 * Every executed market sale moves an item's reference price toward the price paid (weighted by
 * volume); prices drift back toward the item's base value over time. Demand (recent buying) and
 * supply (items currently listed) push the suggested listing price up or down, so prices react to
 * what adventurers actually make, need and sell.
 */
import { itemRegistry } from '../sandbox/ItemRegistry';

export interface PricePoint {
  /** Reference price at the sample time. */
  readonly ref: number;
  /** Units sold on the market during the sampled hour. */
  readonly volume: number;
}

interface Entry {
  ref: number;
  /** Exponential average of units bought per hour. */
  demand: number;
  volumeThisHour: number;
  history: PricePoint[];
}

export interface PriceBookData {
  readonly entries: Record<string, { ref: number; demand: number; history: PricePoint[] }>;
}

/** Hours of history kept per item (one in-game day). */
export const PRICE_HISTORY = 24;
const MIN_FACTOR = 0.25;
const MAX_FACTOR = 5;

export function baseValue(itemId: string): number {
  return itemRegistry.get(itemId)?.value ?? 0;
}

export class PriceBook {
  private readonly entries = new Map<string, Entry>();
  private hourAcc = 0;

  /** `hourSeconds`: simulation seconds per in-game hour. */
  constructor(private readonly hourSeconds = 60) {}

  private entry(itemId: string): Entry {
    let e = this.entries.get(itemId);
    if (!e) {
      e = { ref: baseValue(itemId), demand: 0, volumeThisHour: 0, history: [] };
      this.entries.set(itemId, e);
    }
    return e;
  }

  /** Current reference price (base value until the item has traded). */
  ref(itemId: string): number {
    const e = this.entries.get(itemId);
    return e ? Math.max(1, Math.round(e.ref)) : Math.max(1, baseValue(itemId));
  }

  demand(itemId: string): number {
    return this.entries.get(itemId)?.demand ?? 0;
  }

  history(itemId: string): readonly PricePoint[] {
    return this.entries.get(itemId)?.history ?? [];
  }

  /** Change of the reference price over the kept history (fraction, 0.1 = +10%). */
  trend(itemId: string): number {
    const h = this.entries.get(itemId)?.history;
    const first = h?.[0];
    if (!first) return 0;
    return (this.ref(itemId) - first.ref) / Math.max(1, first.ref);
  }

  /**
   * Price a seller should ask: the reference price nudged by demand against current supply
   * (`listed` units on the market).
   */
  suggested(itemId: string, listed: number): number {
    const e = this.entries.get(itemId);
    const demand = e?.demand ?? 0;
    const pressure = Math.tanh((demand - listed * 0.5) / 4);
    return Math.max(1, Math.round(this.ref(itemId) * (1 + 0.15 * pressure)));
  }

  /** A market sale happened. */
  recordSale(itemId: string, unitPrice: number, count: number): void {
    const base = Math.max(1, baseValue(itemId));
    const e = this.entry(itemId);
    const w = Math.min(0.5, 1 - 0.85 ** count);
    e.ref = Math.min(
      base * MAX_FACTOR,
      Math.max(base * MIN_FACTOR, e.ref + (unitPrice - e.ref) * w),
    );
    e.volumeThisHour += count;
  }

  /** Advance time: hourly samples, demand decay and drift back toward base values. */
  tick(dt: number): void {
    this.hourAcc += dt;
    while (this.hourAcc >= this.hourSeconds) {
      this.hourAcc -= this.hourSeconds;
      for (const [id, e] of this.entries) {
        const base = Math.max(1, baseValue(id));
        e.demand = e.demand * 0.8 + e.volumeThisHour * 0.2;
        e.ref += (base - e.ref) * 0.03;
        e.history.push({ ref: Math.round(e.ref), volume: e.volumeThisHour });
        if (e.history.length > PRICE_HISTORY) e.history.shift();
        e.volumeThisHour = 0;
      }
    }
  }

  toJSON(): PriceBookData {
    const entries: PriceBookData['entries'] = {};
    for (const [id, e] of this.entries) {
      entries[id] = { ref: Math.round(e.ref * 100) / 100, demand: e.demand, history: e.history };
    }
    return { entries };
  }

  load(data: unknown): void {
    this.entries.clear();
    const raw = (data as Partial<PriceBookData> | null)?.entries;
    if (!raw || typeof raw !== 'object') return;
    for (const [id, v] of Object.entries(raw)) {
      const base = baseValue(id);
      if (base <= 0 || !v || typeof v !== 'object') continue;
      const ref = Number(v.ref);
      if (!Number.isFinite(ref)) continue;
      const history = Array.isArray(v.history)
        ? v.history
            .filter((p) => p && Number.isFinite(Number(p.ref)))
            .slice(-PRICE_HISTORY)
            .map((p) => ({ ref: Number(p.ref), volume: Math.max(0, Number(p.volume) || 0) }))
        : [];
      this.entries.set(id, {
        ref: Math.min(base * MAX_FACTOR, Math.max(base * MIN_FACTOR, ref)),
        demand: Math.max(0, Number(v.demand) || 0),
        volumeThisHour: 0,
        history,
      });
    }
  }
}
