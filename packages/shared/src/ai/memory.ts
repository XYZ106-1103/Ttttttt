/**
 * Adventurer memory: notable events with importance and decay, plus relationships with the player
 * and other adventurers. Memories change behaviour (avoid places where they died, warm up to
 * people who helped them) and feed what they say.
 */
export type MemoryKind =
  | 'met'
  | 'helped_by'
  | 'died'
  | 'level_up'
  | 'job'
  | 'crafted'
  | 'goal_done'
  | 'fled'
  | 'slew'
  | 'boss_seen'
  | 'talked'
  | 'traded'
  | 'party'
  | 'raid'
  | 'guild'
  | 'quarrel';

export interface MemoryEvent {
  /** World time (s). */
  readonly t: number;
  readonly kind: MemoryKind;
  /** Who it involved: 'player' or an adventurer key. */
  readonly subject?: string;
  /** Free detail (item id, monster id, job id, level). */
  readonly detail?: string;
  /** Tile column where it happened. */
  readonly x?: number;
  /** 0..1 — core memories (≥ 0.8) barely fade. */
  readonly importance: number;
}

export interface Relation {
  /** -1..1 */
  affinity: number;
  met: number;
  helped: number;
  lastSeen: number;
  /** Conversations held. */
  talks: number;
  /** Trades made with each other. */
  trades: number;
  /** Parties formed together. */
  parties: number;
  /** Bosses fought together. */
  raids: number;
  /** World time of the last conversation. */
  lastTalk: number;
}

export function newRelation(): Relation {
  return {
    affinity: 0,
    met: 0,
    helped: 0,
    lastSeen: -1,
    talks: 0,
    trades: 0,
    parties: 0,
    raids: 0,
    lastTalk: -1e9,
  };
}

const MAX_EVENTS = 60;
const HALF_LIFE = 20 * 60;

export class Memory {
  events: MemoryEvent[] = [];
  readonly relations = new Map<string, Relation>();

  static salience(e: MemoryEvent, now: number): number {
    const age = Math.max(0, now - e.t);
    const half = e.importance >= 0.8 ? HALF_LIFE * 12 : HALF_LIFE;
    return e.importance * Math.pow(0.5, age / half);
  }

  add(e: MemoryEvent): void {
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) {
      const now = e.t;
      this.events.sort((a, b) => Memory.salience(b, now) - Memory.salience(a, now));
      this.events.length = MAX_EVENTS;
      this.events.sort((a, b) => a.t - b.t);
    }
  }

  /** Most salient memories first. */
  recall(now: number, n = 5): MemoryEvent[] {
    return [...this.events]
      .sort((a, b) => Memory.salience(b, now) - Memory.salience(a, now))
      .slice(0, n);
  }

  relation(subject: string): Relation {
    let r = this.relations.get(subject);
    if (!r) {
      r = newRelation();
      this.relations.set(subject, r);
    }
    return r;
  }

  adjust(subject: string, delta: number): void {
    const r = this.relation(subject);
    r.affinity = Math.max(-1, Math.min(1, r.affinity + delta));
  }

  /** How strongly a place is remembered as dangerous (0..1), within `radius` tiles. */
  dangerNear(tx: number, now: number, radius = 30): number {
    let d = 0;
    for (const e of this.events) {
      if (e.kind !== 'died' && e.kind !== 'fled') continue;
      if (e.x === undefined || Math.abs(e.x - tx) > radius) continue;
      d = Math.max(d, Memory.salience(e, now) * (e.kind === 'died' ? 1 : 0.5));
    }
    return Math.min(1, d);
  }

  toJSON(): { events: MemoryEvent[]; relations: [string, Relation][] } {
    return { events: this.events, relations: [...this.relations.entries()] };
  }

  load(data: unknown): void {
    this.events = [];
    this.relations.clear();
    if (!data || typeof data !== 'object') return;
    const d = data as { events?: unknown; relations?: unknown };
    if (Array.isArray(d.events)) {
      for (const e of d.events.slice(-MAX_EVENTS)) {
        if (!e || typeof e !== 'object') continue;
        const ev = e as Record<string, unknown>;
        if (typeof ev.kind !== 'string' || !Number.isFinite(Number(ev.t))) continue;
        this.events.push({
          t: Number(ev.t),
          kind: ev.kind as MemoryKind,
          subject: typeof ev.subject === 'string' ? ev.subject : undefined,
          detail: typeof ev.detail === 'string' ? ev.detail : undefined,
          x: Number.isFinite(Number(ev.x)) ? Number(ev.x) : undefined,
          importance: Math.max(0, Math.min(1, Number(ev.importance) || 0)),
        });
      }
    }
    if (Array.isArray(d.relations)) {
      for (const pair of d.relations) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string' || !pair[1]) continue;
        const r = pair[1] as Record<string, unknown>;
        const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));
        this.relations.set(pair[0], {
          affinity: Math.max(-1, Math.min(1, Number(r.affinity) || 0)),
          met: count(r.met),
          helped: count(r.helped),
          lastSeen: Number(r.lastSeen) || -1,
          talks: count(r.talks),
          trades: count(r.trades),
          parties: count(r.parties),
          raids: count(r.raids),
          lastTalk: Number.isFinite(Number(r.lastTalk)) ? Number(r.lastTalk) : -1e9,
        });
      }
    }
  }
}
