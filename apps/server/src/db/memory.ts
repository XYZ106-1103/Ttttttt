import type { AdventurerSave, PlayerSave, SerializedChunk, WorldMeta } from '@world/shared';
import type {
  Account,
  CharacterRecord,
  CreateCharacterFail,
  JournalEntry,
  Repository,
  Role,
  WorldRecord,
} from './types';

interface WorldState {
  meta: WorldMeta | null;
  chunks: Map<string, SerializedChunk>;
  adventurers: readonly AdventurerSave[] | null;
  society: { economy: unknown; society: unknown } | null;
}

/** In-memory repository (tests, and running without PostgreSQL — nothing survives a restart). */
export class MemoryRepository implements Repository {
  private accounts: Account[] = [];
  private readonly sessions = new Map<string, { accountId: number; expiresAt: number }>();
  private characters: CharacterRecord[] = [];
  private readonly worlds = new Map<string, WorldState>();
  readonly journal: JournalEntry[] = [];
  private nextAccount = 1;
  private nextCharacter = 1;

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async createAccount(
    email: string,
    passwordHash: string,
    role: Role,
  ): Promise<Account | 'exists'> {
    if (this.accounts.some((a) => a.email === email)) return 'exists';
    const a: Account = {
      id: this.nextAccount++,
      email,
      passwordHash,
      role,
      failedLogins: 0,
      lockedUntil: null,
    };
    this.accounts.push(a);
    return a;
  }

  async accountByEmail(email: string): Promise<Account | null> {
    return this.accounts.find((a) => a.email === email) ?? null;
  }

  async accountById(id: number): Promise<Account | null> {
    return this.accounts.find((a) => a.id === id) ?? null;
  }

  async setLoginFailures(id: number, failures: number, lockedUntil: number | null): Promise<void> {
    this.accounts = this.accounts.map((a) =>
      a.id === id ? { ...a, failedLogins: failures, lockedUntil } : a,
    );
  }

  async createSession(tokenHash: string, accountId: number, expiresAt: number): Promise<void> {
    this.sessions.set(tokenHash, { accountId, expiresAt });
  }

  async sessionAccount(tokenHash: string, now: number): Promise<number | null> {
    const s = this.sessions.get(tokenHash);
    if (!s || s.expiresAt <= now) return null;
    return s.accountId;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async listCharacters(accountId: number): Promise<CharacterRecord[]> {
    return this.characters.filter((c) => c.accountId === accountId);
  }

  async createCharacter(
    accountId: number,
    name: string,
    look: number,
    limit: number,
  ): Promise<CharacterRecord | CreateCharacterFail> {
    if (this.characters.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      return 'name_taken';
    if (this.characters.filter((c) => c.accountId === accountId).length >= limit) return 'limit';
    const c: CharacterRecord = {
      id: this.nextCharacter++,
      accountId,
      name,
      look,
      save: null,
      level: 1,
      jobId: 'novice',
    };
    this.characters.push(c);
    return c;
  }

  async character(id: number): Promise<CharacterRecord | null> {
    return this.characters.find((c) => c.id === id) ?? null;
  }

  async saveCharacter(id: number, save: PlayerSave): Promise<void> {
    this.characters = this.characters.map((c) =>
      c.id === id
        ? {
            ...c,
            save: structuredClone(save),
            level: save.level ?? 1,
            jobId: save.jobId ?? 'novice',
          }
        : c,
    );
  }

  private world(worldId: string): WorldState {
    let w = this.worlds.get(worldId);
    if (!w) {
      w = { meta: null, chunks: new Map(), adventurers: null, society: null };
      this.worlds.set(worldId, w);
    }
    return w;
  }

  async loadWorld(worldId: string): Promise<WorldRecord> {
    const w = this.world(worldId);
    return {
      meta: w.meta,
      chunks: [...w.chunks.values()].map((c) => structuredClone(c)),
      adventurers: w.adventurers ? structuredClone(w.adventurers) : null,
      society: w.society ? structuredClone(w.society) : null,
    };
  }

  async saveChunks(worldId: string, chunks: readonly SerializedChunk[]): Promise<void> {
    const w = this.world(worldId);
    for (const c of chunks) w.chunks.set(`${c.cx},${c.cy}`, structuredClone(c));
  }

  async saveWorldState(
    worldId: string,
    meta: WorldMeta,
    adventurers: readonly AdventurerSave[],
    society: { readonly economy: unknown; readonly society: unknown },
  ): Promise<void> {
    const w = this.world(worldId);
    w.meta = meta;
    w.adventurers = structuredClone(adventurers);
    w.society = structuredClone(society) as { economy: unknown; society: unknown };
  }

  async appendJournal(entries: readonly JournalEntry[]): Promise<void> {
    this.journal.push(...entries);
  }
}
