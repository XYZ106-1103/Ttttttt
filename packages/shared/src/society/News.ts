/**
 * World news: notable things adventurers did anywhere in the world (guilds founded, bosses slain,
 * job advancements, rivalries...). The client shows them in chat so the player can feel the world
 * living beyond the screen. Params reference characters by key and guilds by id; the client
 * resolves names in the player's language.
 */
export type NewsKind =
  | 'guild_founded'
  | 'guild_joined'
  | 'party_formed'
  | 'raid_won'
  | 'raid_lost'
  | 'boss_slain'
  | 'job'
  | 'level'
  | 'crafted'
  | 'friends'
  | 'rivals';

export interface NewsItem {
  readonly id: number;
  readonly t: number;
  readonly kind: NewsKind;
  readonly params: Readonly<Record<string, string | number>>;
}

const KEEP = 80;

export class NewsFeed {
  private items: NewsItem[] = [];
  private nextId = 1;

  push(t: number, kind: NewsKind, params: Record<string, string | number>): NewsItem {
    const item = { id: this.nextId++, t, kind, params };
    this.items.push(item);
    if (this.items.length > KEEP) this.items.shift();
    return item;
  }

  /** Items newer than `id`. */
  since(id: number): readonly NewsItem[] {
    return this.items.filter((n) => n.id > id);
  }

  get latest(): readonly NewsItem[] {
    return this.items;
  }

  get lastId(): number {
    return this.nextId - 1;
  }

  toJSON(): { nextId: number; items: NewsItem[] } {
    return { nextId: this.nextId, items: this.items };
  }

  load(data: unknown): void {
    this.items = [];
    const d = data as { nextId?: unknown; items?: unknown } | null;
    if (!d || typeof d !== 'object') return;
    for (const n of Array.isArray(d.items) ? d.items.slice(-KEEP) : []) {
      if (!n || typeof n !== 'object') continue;
      const o = n as Record<string, unknown>;
      if (typeof o.kind !== 'string' || !Number.isFinite(Number(o.id))) continue;
      const params: Record<string, string | number> = {};
      for (const [k, v] of Object.entries((o.params as object) ?? {}))
        if (typeof v === 'string' || typeof v === 'number') params[k] = v;
      this.items.push({ id: Number(o.id), t: Number(o.t) || 0, kind: o.kind as NewsKind, params });
    }
    const maxId = this.items.reduce((m, n) => Math.max(m, n.id), 0);
    this.nextId = Math.max(maxId + 1, Number(d.nextId) || 1);
  }
}
