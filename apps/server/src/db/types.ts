import type { AdventurerSave, PlayerSave, SerializedChunk, WorldMeta } from '@world/shared';

export type Role = 'player' | 'admin';

export interface Account {
  readonly id: number;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly failedLogins: number;
  readonly lockedUntil: number | null;
}

export interface CharacterRecord {
  readonly id: number;
  readonly accountId: number;
  readonly name: string;
  /** Appearance seed chosen at creation. */
  readonly look: number;
  readonly save: PlayerSave | null;
  readonly level: number;
  readonly jobId: string;
}

export interface WorldRecord {
  readonly meta: WorldMeta | null;
  readonly chunks: readonly SerializedChunk[];
  readonly adventurers: readonly AdventurerSave[] | null;
  readonly society: { readonly economy: unknown; readonly society: unknown } | null;
}

/** An economy or social transaction, written as it happens (audit trail). */
export interface JournalEntry {
  readonly at: number;
  readonly actor: string;
  readonly op: string;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export type CreateCharacterFail = 'name_taken' | 'limit';

/**
 * Persistence for the server. PostgreSQL in production; an in-memory implementation for tests
 * and for running without a database.
 */
export interface Repository {
  init(): Promise<void>;
  close(): Promise<void>;

  createAccount(email: string, passwordHash: string, role: Role): Promise<Account | 'exists'>;
  accountByEmail(email: string): Promise<Account | null>;
  accountById(id: number): Promise<Account | null>;
  setLoginFailures(accountId: number, failures: number, lockedUntil: number | null): Promise<void>;

  createSession(tokenHash: string, accountId: number, expiresAt: number): Promise<void>;
  sessionAccount(tokenHash: string, now: number): Promise<number | null>;
  deleteSession(tokenHash: string): Promise<void>;

  listCharacters(accountId: number): Promise<CharacterRecord[]>;
  createCharacter(
    accountId: number,
    name: string,
    look: number,
    limit: number,
  ): Promise<CharacterRecord | CreateCharacterFail>;
  character(id: number): Promise<CharacterRecord | null>;
  saveCharacter(id: number, save: PlayerSave): Promise<void>;

  loadWorld(worldId: string): Promise<WorldRecord>;
  saveChunks(worldId: string, chunks: readonly SerializedChunk[]): Promise<void>;
  saveWorldState(
    worldId: string,
    meta: WorldMeta,
    adventurers: readonly AdventurerSave[],
    society: { readonly economy: unknown; readonly society: unknown },
  ): Promise<void>;

  appendJournal(entries: readonly JournalEntry[]): Promise<void>;
}
