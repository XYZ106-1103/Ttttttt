/**
 * Parties: up to four characters (player and/or adventurers) who share kill experience, loot
 * priority and monster claims, and move together.
 */
import { stringList } from './Guild';

export const MAX_PARTY = 4;

export type PartyPurpose = 'hunt' | 'raid' | 'explore' | 'adventure';

export interface Party {
  readonly id: number;
  leader: string;
  members: string[];
  readonly purpose: PartyPurpose;
  readonly formedAt: number;
  /** AI parties break up after this time (Infinity for parties led by the player). */
  until: number;
}

export interface PartyData {
  readonly nextId: number;
  readonly parties: readonly Party[];
}

export type PartyChange =
  | { readonly type: 'formed'; readonly party: Party }
  | { readonly type: 'joined'; readonly party: Party; readonly key: string }
  | { readonly type: 'left'; readonly party: Party; readonly key: string }
  | { readonly type: 'disbanded'; readonly party: Party };

export class PartySystem {
  private readonly parties = new Map<number, Party>();
  private readonly byMember = new Map<string, number>();
  private nextId = 1;
  version = 0;
  /** Changes since last read (news, UI, memories). */
  readonly changes: PartyChange[] = [];

  get all(): readonly Party[] {
    return [...this.parties.values()];
  }

  get(id: number): Party | undefined {
    return this.parties.get(id);
  }

  of(key: string): Party | null {
    const id = this.byMember.get(key);
    return id === undefined ? null : (this.parties.get(id) ?? null);
  }

  same(a: string, b: string): boolean {
    if (a === b) return true;
    const pa = this.byMember.get(a);
    return pa !== undefined && pa === this.byMember.get(b);
  }

  /** Party mates of `key` (excluding `key`). */
  mates(key: string): string[] {
    return this.of(key)?.members.filter((m) => m !== key) ?? [];
  }

  create(leader: string, purpose: PartyPurpose, now: number, duration = Infinity): Party | null {
    if (this.byMember.has(leader)) return null;
    const party: Party = {
      id: this.nextId++,
      leader,
      members: [leader],
      purpose,
      formedAt: now,
      until: now + duration,
    };
    this.parties.set(party.id, party);
    this.byMember.set(leader, party.id);
    this.changes.push({ type: 'formed', party });
    this.version++;
    return party;
  }

  join(partyId: number, key: string): boolean {
    const p = this.parties.get(partyId);
    if (!p || this.byMember.has(key) || p.members.length >= MAX_PARTY) return false;
    p.members.push(key);
    this.byMember.set(key, p.id);
    this.changes.push({ type: 'joined', party: p, key });
    this.version++;
    return true;
  }

  leave(key: string): void {
    const p = this.of(key);
    if (!p) return;
    p.members = p.members.filter((m) => m !== key);
    this.byMember.delete(key);
    this.changes.push({ type: 'left', party: p, key });
    if (p.members.length <= 1) this.disband(p.id);
    else if (p.leader === key) p.leader = p.members[0] as string;
    this.version++;
  }

  disband(id: number): void {
    const p = this.parties.get(id);
    if (!p) return;
    for (const m of p.members) this.byMember.delete(m);
    this.parties.delete(id);
    this.changes.push({ type: 'disbanded', party: p });
    this.version++;
  }

  /** Break up AI parties whose time is over. */
  expire(now: number): void {
    for (const p of [...this.parties.values()]) if (now >= p.until) this.disband(p.id);
  }

  toJSON(): PartyData {
    // JSON has no Infinity: open-ended parties are saved with until = -1.
    return {
      nextId: this.nextId,
      parties: this.all.map((p) => ({ ...p, until: Number.isFinite(p.until) ? p.until : -1 })),
    };
  }

  load(data: unknown, validKey: (key: string) => boolean): void {
    this.parties.clear();
    this.byMember.clear();
    const d = data as Partial<PartyData> | null;
    if (!d || typeof d !== 'object') return;
    let maxId = 0;
    for (const raw of Array.isArray(d.parties) ? d.parties : []) {
      if (!raw || typeof raw !== 'object') continue;
      const id = Number(raw.id);
      if (!Number.isInteger(id) || this.parties.has(id)) continue;
      const members = [...new Set(stringList(raw.members).filter(validKey))].filter(
        (m) => !this.byMember.has(m),
      );
      if (members.length < 2) continue;
      const purpose = (['hunt', 'raid', 'explore', 'adventure'] as const).includes(raw.purpose)
        ? raw.purpose
        : 'hunt';
      const p: Party = {
        id,
        leader: members.includes(raw.leader) ? raw.leader : (members[0] as string),
        members: members.slice(0, MAX_PARTY),
        purpose,
        formedAt: Number(raw.formedAt) || 0,
        until:
          Number.isFinite(Number(raw.until)) && Number(raw.until) >= 0
            ? Number(raw.until)
            : Infinity,
      };
      this.parties.set(id, p);
      for (const m of p.members) this.byMember.set(m, id);
      maxId = Math.max(maxId, id);
    }
    this.nextId = Math.max(maxId + 1, Number(d.nextId) || 1);
    this.version++;
  }
}
