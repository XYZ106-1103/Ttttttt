/** Active status effects on one combatant. */
import { getStatusDef, type Mods, type StatusDef } from '../data/statuses';
import { addMods } from './stats';

export interface StatusInstance {
  readonly def: StatusDef;
  until: number;
  /** Strength (buff %, DoT multiplier...). */
  magnitude: number;
  /** Power of whoever applied it (scales damage over time). */
  power: number;
  sourceId: number;
  nextTick: number;
  readonly duration: number;
}

export interface StatusTick {
  readonly statusId: string;
  readonly sourceId: number;
  /** Positive = damage, negative = heal. */
  readonly amount: number;
}

export class StatusSet {
  private readonly list: StatusInstance[] = [];
  /** Bumps when statuses are added or removed (UI change detection). */
  version = 0;

  get all(): readonly StatusInstance[] {
    return this.list;
  }

  has(id: string, now: number): boolean {
    return this.list.some((s) => s.def.id === id && s.until > now);
  }

  get(id: string): StatusInstance | undefined {
    return this.list.find((s) => s.def.id === id);
  }

  /** Apply or refresh a status. Returns false for unknown ids or immunity. */
  apply(
    id: string,
    now: number,
    duration: number,
    opts: {
      magnitude?: number;
      power?: number;
      sourceId?: number;
      immune?: ReadonlySet<string>;
    } = {},
  ): boolean {
    const def = getStatusDef(id);
    if (!def || !(duration > 0) || opts.immune?.has(id)) return false;
    const d = Math.min(duration, def.maxDuration);
    const magnitude = opts.magnitude ?? 1;
    const existing = this.list.find((s) => s.def.id === id);
    if (existing) {
      existing.until = Math.max(existing.until, now + d);
      existing.magnitude = Math.max(existing.magnitude, magnitude);
      existing.power = Math.max(existing.power, opts.power ?? 0);
      this.version++;
      return true;
    }
    const interval = def.dot?.interval ?? def.hot?.interval ?? 0;
    this.list.push({
      def,
      until: now + d,
      magnitude,
      power: opts.power ?? 0,
      sourceId: opts.sourceId ?? -1,
      nextTick: now + interval,
      duration: d,
    });
    this.version++;
    return true;
  }

  remove(id: string): void {
    const i = this.list.findIndex((s) => s.def.id === id);
    if (i >= 0) {
      this.list.splice(i, 1);
      this.version++;
    }
  }

  clear(): void {
    if (this.list.length) this.version++;
    this.list.length = 0;
  }

  stunned(now: number): boolean {
    return this.list.some((s) => s.def.stun && s.until > now);
  }

  /** Summed modifiers of active statuses. */
  mods(now: number): Mods {
    const out: Record<string, number> = {};
    for (const s of this.list) if (s.until > now) addMods(out, s.def.mods, s.magnitude);
    return out;
  }

  /** Expire statuses and produce damage/heal ticks that came due. */
  step(now: number, maxHp: number): StatusTick[] {
    const ticks: StatusTick[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i] as StatusInstance;
      const interval = s.def.dot?.interval ?? s.def.hot?.interval ?? 0;
      if (interval > 0) {
        while (s.nextTick <= now && s.nextTick <= s.until + 1e-6) {
          s.nextTick += interval;
          if (s.def.dot) {
            ticks.push({
              statusId: s.def.id,
              sourceId: s.sourceId,
              amount: Math.max(1, Math.round(s.power * s.def.dot.powerRatio * s.magnitude)),
            });
          } else if (s.def.hot) {
            ticks.push({
              statusId: s.def.id,
              sourceId: s.sourceId,
              amount: -Math.max(1, Math.round(maxHp * s.def.hot.maxHpRatio * s.magnitude)),
            });
          }
        }
      }
      if (s.until <= now) {
        this.list.splice(i, 1);
        this.version++;
      }
    }
    return ticks;
  }
}
