/**
 * Guilds: lasting groups founded by a character (level and gold requirements apply to everyone,
 * player or adventurer). Members cooperate, party up more readily and share a guild log; fame
 * grows with members' achievements.
 */
import { MAX_GOLD } from '../actors/Character';
import type { Rng } from '../math/rng';
import type { Ledger, Trader } from '../economy/types';

export const GUILD_FOUND_COST = 500;
export const GUILD_FOUND_LEVEL = 8;
export const GUILD_MAX_MEMBERS = 12;
const LOG_SIZE = 40;

export interface GuildName {
  readonly ko: string;
  readonly en: string;
}

export type GuildLogKind = 'founded' | 'joined' | 'left' | 'leader' | 'level' | 'job' | 'raid';

export interface GuildLogEntry {
  readonly t: number;
  readonly kind: GuildLogKind;
  /** Character key. */
  readonly who: string;
  readonly detail?: string;
}

export interface Guild {
  readonly id: string;
  readonly name: GuildName;
  /** Palette index for the emblem color. */
  readonly emblem: number;
  leader: string;
  members: string[];
  readonly founded: number;
  fame: number;
  log: GuildLogEntry[];
}

const PREFIX: readonly [string, string][] = [
  ['새벽의', 'Dawn'],
  ['은빛', 'Silver'],
  ['붉은', 'Crimson'],
  ['푸른', 'Azure'],
  ['바람의', 'Wind'],
  ['별빛', 'Starlight'],
  ['강철', 'Iron'],
  ['고요한', 'Silent'],
  ['황금', 'Golden'],
  ['잿빛', 'Ashen'],
  ['서리', 'Frost'],
  ['떠도는', 'Wandering'],
];
const NOUN: readonly [string, string][] = [
  ['칼날', 'Blades'],
  ['늑대단', 'Wolves'],
  ['등불', 'Lanterns'],
  ['방패', 'Shields'],
  ['깃털', 'Feathers'],
  ['뿌리', 'Roots'],
  ['망치', 'Hammers'],
  ['나침반', 'Compass'],
  ['여우단', 'Foxes'],
  ['까마귀', 'Ravens'],
  ['횃불', 'Torches'],
  ['개척단', 'Pioneers'],
];
export const GUILD_EMBLEMS = 8;

export function generateGuildName(rng: Rng, taken: ReadonlySet<string>): GuildName {
  for (let i = 0; i < 40; i++) {
    const [pk, pe] = rng.pick(PREFIX);
    const [nk, ne] = rng.pick(NOUN);
    const name = { ko: `${pk} ${nk}`, en: `${pe} ${ne}` };
    if (!taken.has(name.ko)) return name;
  }
  const n = taken.size + 1;
  return { ko: `모험가 연합 ${n}`, en: `Adventurers' Union ${n}` };
}

export type FoundFail = 'in_guild' | 'level' | 'no_gold';
export type FoundResult =
  { readonly ok: true; readonly guild: Guild } | { readonly ok: false; readonly reason: FoundFail };
export type GuildFail = 'level' | 'in_guild' | 'full' | 'no_guild';

export interface GuildData {
  readonly nextId: number;
  readonly guilds: readonly Guild[];
}

export function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export class GuildSystem {
  private readonly guilds = new Map<string, Guild>();
  private readonly byMember = new Map<string, string>();
  private nextId = 1;
  version = 0;
  /** Log entries added since last read (news). */
  readonly changes: { readonly guild: Guild; readonly entry: GuildLogEntry }[] = [];

  get all(): readonly Guild[] {
    return [...this.guilds.values()];
  }

  get(id: string): Guild | undefined {
    return this.guilds.get(id);
  }

  of(key: string): Guild | null {
    const id = this.byMember.get(key);
    return id === undefined ? null : (this.guilds.get(id) ?? null);
  }

  same(a: string, b: string): boolean {
    const g = this.byMember.get(a);
    return g !== undefined && g === this.byMember.get(b);
  }

  private log(g: Guild, entry: GuildLogEntry): void {
    g.log.push(entry);
    if (g.log.length > LOG_SIZE) g.log.shift();
    this.changes.push({ guild: g, entry });
    this.version++;
  }

  /** Found a guild: costs gold (a sink), needs a level, and the founder must be guildless. */
  found(
    founder: Trader & { readonly level: number },
    rng: Rng,
    now: number,
    ledger: Ledger,
  ): FoundResult {
    if (this.byMember.has(founder.key)) return { ok: false, reason: 'in_guild' };
    if (founder.level < GUILD_FOUND_LEVEL) return { ok: false, reason: 'level' };
    if (founder.gold < GUILD_FOUND_COST) return { ok: false, reason: 'no_gold' };
    founder.gold -= GUILD_FOUND_COST;
    ledger.destroy('guild_found', GUILD_FOUND_COST);
    const taken = new Set(this.all.map((g) => g.name.ko));
    const guild: Guild = {
      id: `g${this.nextId++}`,
      name: generateGuildName(rng, taken),
      emblem: rng.int(0, GUILD_EMBLEMS - 1),
      leader: founder.key,
      members: [founder.key],
      founded: now,
      fame: 10,
      log: [],
    };
    this.guilds.set(guild.id, guild);
    this.byMember.set(founder.key, guild.id);
    this.log(guild, { t: now, kind: 'founded', who: founder.key });
    return { ok: true, guild };
  }

  join(guildId: string, key: string, now: number): GuildFail | null {
    const g = this.guilds.get(guildId);
    if (!g) return 'no_guild';
    if (this.byMember.has(key)) return 'in_guild';
    if (g.members.length >= GUILD_MAX_MEMBERS) return 'full';
    g.members.push(key);
    this.byMember.set(key, g.id);
    g.fame += 2;
    this.log(g, { t: now, kind: 'joined', who: key });
    return null;
  }

  leave(key: string, now: number): void {
    const g = this.of(key);
    if (!g) return;
    g.members = g.members.filter((m) => m !== key);
    this.byMember.delete(key);
    if (g.members.length === 0) {
      this.guilds.delete(g.id);
      this.version++;
      return;
    }
    this.log(g, { t: now, kind: 'left', who: key });
    if (g.leader === key) {
      g.leader = g.members[0] as string;
      this.log(g, { t: now, kind: 'leader', who: g.leader });
    }
  }

  /** A member did something worth noting: adds fame and a log line. */
  note(
    key: string,
    kind: 'level' | 'job' | 'raid',
    detail: string,
    now: number,
    fame: number,
  ): void {
    const g = this.of(key);
    if (!g) return;
    g.fame = Math.min(MAX_GOLD, g.fame + fame);
    this.log(g, { t: now, kind, who: key, detail });
  }

  toJSON(): GuildData {
    return { nextId: this.nextId, guilds: this.all };
  }

  load(data: unknown, validKey: (key: string) => boolean): void {
    this.guilds.clear();
    this.byMember.clear();
    const d = data as Partial<GuildData> | null;
    if (!d || typeof d !== 'object') return;
    let maxId = 0;
    for (const raw of Array.isArray(d.guilds) ? d.guilds : []) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue;
      if (this.guilds.has(raw.id) || !raw.name || typeof raw.name.ko !== 'string') continue;
      const members = [...new Set(stringList(raw.members).filter(validKey))]
        .filter((m) => !this.byMember.has(m))
        .slice(0, GUILD_MAX_MEMBERS);
      if (members.length === 0) continue;
      const g: Guild = {
        id: raw.id,
        name: { ko: raw.name.ko.slice(0, 30), en: String(raw.name.en ?? raw.name.ko).slice(0, 40) },
        emblem: Math.abs(Math.floor(Number(raw.emblem) || 0)) % GUILD_EMBLEMS,
        leader: members.includes(raw.leader) ? raw.leader : (members[0] as string),
        members,
        founded: Number(raw.founded) || 0,
        fame: Math.max(0, Math.min(MAX_GOLD, Math.floor(Number(raw.fame) || 0))),
        log: (Array.isArray(raw.log) ? (raw.log as unknown[]) : [])
          .filter(
            (e): e is GuildLogEntry =>
              !!e &&
              typeof (e as GuildLogEntry).who === 'string' &&
              typeof (e as GuildLogEntry).kind === 'string',
          )
          .slice(-LOG_SIZE),
      };
      this.guilds.set(g.id, g);
      for (const m of members) this.byMember.set(m, g.id);
      maxId = Math.max(maxId, Number(raw.id.slice(1)) || 0);
    }
    this.nextId = Math.max(maxId + 1, Number(d.nextId) || 1);
    this.version++;
  }
}
