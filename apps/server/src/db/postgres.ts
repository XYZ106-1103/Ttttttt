import type { AdventurerSave, PlayerSave, SerializedChunk, WorldMeta } from '@world/shared';
import pg from 'pg';
import type {
  Account,
  CharacterRecord,
  CreateCharacterFail,
  JournalEntry,
  Repository,
  Role,
  WorldRecord,
} from './types';

/**
 * Schema migrations, applied in order and recorded in schema_migrations. Never edit an applied
 * migration; add a new one.
 */
export const MIGRATIONS: readonly { readonly id: number; readonly sql: string }[] = [
  {
    id: 1,
    sql: `
      CREATE TABLE accounts (
        id            BIGSERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX sessions_account ON sessions(account_id);
      CREATE TABLE characters (
        id         BIGSERIAL PRIMARY KEY,
        account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        look       BIGINT NOT NULL,
        level      INTEGER NOT NULL DEFAULT 1,
        job_id     TEXT NOT NULL DEFAULT 'novice',
        save       JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        saved_at   TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX characters_name ON characters(lower(name));
      CREATE INDEX characters_account ON characters(account_id);
      CREATE TABLE worlds (
        world_id    TEXT PRIMARY KEY,
        meta        JSONB NOT NULL,
        adventurers JSONB NOT NULL,
        society     JSONB NOT NULL,
        saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE chunks (
        world_id TEXT NOT NULL,
        cx       INTEGER NOT NULL,
        cy       INTEGER NOT NULL,
        data     JSONB NOT NULL,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (world_id, cx, cy)
      );
      CREATE TABLE journal (
        id     BIGSERIAL PRIMARY KEY,
        at     TIMESTAMPTZ NOT NULL,
        actor  TEXT NOT NULL,
        op     TEXT NOT NULL,
        detail JSONB NOT NULL
      );
      CREATE INDEX journal_actor ON journal(actor, at);
    `,
  },
];

type Row = Record<string, unknown>;

function toAccount(r: Row): Account {
  return {
    id: Number(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    role: r.role === 'admin' ? 'admin' : 'player',
    failedLogins: Number(r.failed_logins) || 0,
    lockedUntil: r.locked_until ? new Date(r.locked_until as string).getTime() : null,
  };
}

function toCharacter(r: Row): CharacterRecord {
  return {
    id: Number(r.id),
    accountId: Number(r.account_id),
    name: String(r.name),
    look: Number(r.look),
    save: (r.save as PlayerSave | null) ?? null,
    level: Number(r.level) || 1,
    jobId: String(r.job_id ?? 'novice'),
  };
}

export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 8 });
    // An idle connection dropped by the database (restart, failover) must not crash the server;
    // the pool replaces it and the next query reports any real problem.
    this.pool.on('error', (err) => this.onError(err));
  }

  /** Called for errors on idle connections (replaced by the pool). */
  onError: (err: Error) => void = () => undefined;

  /** Apply pending migrations inside a transaction (guarded by an advisory lock). */
  async init(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(424242)');
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
      );
      const done = new Set(
        (await client.query('SELECT id FROM schema_migrations')).rows.map((r: Row) => Number(r.id)),
      );
      for (const m of MIGRATIONS) {
        if (done.has(m.id)) continue;
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async createAccount(
    email: string,
    passwordHash: string,
    role: Role,
  ): Promise<Account | 'exists'> {
    const r = await this.pool.query(
      `INSERT INTO accounts (email, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [email, passwordHash, role],
    );
    const row = r.rows[0] as Row | undefined;
    return row ? toAccount(row) : 'exists';
  }

  async accountByEmail(email: string): Promise<Account | null> {
    const r = await this.pool.query('SELECT * FROM accounts WHERE email = $1', [email]);
    const row = r.rows[0] as Row | undefined;
    return row ? toAccount(row) : null;
  }

  async accountById(id: number): Promise<Account | null> {
    const r = await this.pool.query('SELECT * FROM accounts WHERE id = $1', [id]);
    const row = r.rows[0] as Row | undefined;
    return row ? toAccount(row) : null;
  }

  async setLoginFailures(id: number, failures: number, lockedUntil: number | null): Promise<void> {
    await this.pool.query(
      'UPDATE accounts SET failed_logins = $2, locked_until = $3 WHERE id = $1',
      [id, failures, lockedUntil === null ? null : new Date(lockedUntil)],
    );
  }

  async createSession(tokenHash: string, accountId: number, expiresAt: number): Promise<void> {
    await this.pool.query(
      'INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, accountId, new Date(expiresAt)],
    );
    // Opportunistic cleanup of expired sessions.
    await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
  }

  async sessionAccount(tokenHash: string, now: number): Promise<number | null> {
    const r = await this.pool.query(
      'SELECT account_id FROM sessions WHERE token_hash = $1 AND expires_at > $2',
      [tokenHash, new Date(now)],
    );
    const row = r.rows[0] as Row | undefined;
    return row ? Number(row.account_id) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async listCharacters(accountId: number): Promise<CharacterRecord[]> {
    const r = await this.pool.query('SELECT * FROM characters WHERE account_id = $1 ORDER BY id', [
      accountId,
    ]);
    return r.rows.map((row: Row) => toCharacter(row));
  }

  async createCharacter(
    accountId: number,
    name: string,
    look: number,
    limit: number,
  ): Promise<CharacterRecord | CreateCharacterFail> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize creations per account so the limit cannot be raced.
      await client.query('SELECT pg_advisory_xact_lock($1)', [accountId]);
      const count = await client.query(
        'SELECT count(*)::int AS n FROM characters WHERE account_id = $1',
        [accountId],
      );
      if (Number((count.rows[0] as Row).n) >= limit) {
        await client.query('ROLLBACK');
        return 'limit';
      }
      const r = await client.query(
        `INSERT INTO characters (account_id, name, look) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING RETURNING *`,
        [accountId, name, look],
      );
      const row = r.rows[0] as Row | undefined;
      if (!row) {
        await client.query('ROLLBACK');
        return 'name_taken';
      }
      await client.query('COMMIT');
      return toCharacter(row);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async character(id: number): Promise<CharacterRecord | null> {
    const r = await this.pool.query('SELECT * FROM characters WHERE id = $1', [id]);
    const row = r.rows[0] as Row | undefined;
    return row ? toCharacter(row) : null;
  }

  async saveCharacter(id: number, save: PlayerSave): Promise<void> {
    await this.pool.query(
      `UPDATE characters SET save = $2, level = $3, job_id = $4, saved_at = now() WHERE id = $1`,
      [id, JSON.stringify(save), save.level ?? 1, save.jobId ?? 'novice'],
    );
  }

  async loadWorld(worldId: string): Promise<WorldRecord> {
    const w = await this.pool.query('SELECT * FROM worlds WHERE world_id = $1', [worldId]);
    const c = await this.pool.query('SELECT data FROM chunks WHERE world_id = $1', [worldId]);
    const row = w.rows[0] as Row | undefined;
    return {
      meta: (row?.meta as WorldMeta | undefined) ?? null,
      chunks: c.rows.map((r: Row) => r.data as SerializedChunk),
      adventurers: (row?.adventurers as AdventurerSave[] | undefined) ?? null,
      society: (row?.society as { economy: unknown; society: unknown } | undefined) ?? null,
    };
  }

  async saveChunks(worldId: string, chunks: readonly SerializedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const ch of chunks) {
        await client.query(
          `INSERT INTO chunks (world_id, cx, cy, data) VALUES ($1, $2, $3, $4)
           ON CONFLICT (world_id, cx, cy) DO UPDATE SET data = EXCLUDED.data, saved_at = now()`,
          [worldId, ch.cx, ch.cy, JSON.stringify(ch)],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async saveWorldState(
    worldId: string,
    meta: WorldMeta,
    adventurers: readonly AdventurerSave[],
    society: { readonly economy: unknown; readonly society: unknown },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO worlds (world_id, meta, adventurers, society) VALUES ($1, $2, $3, $4)
       ON CONFLICT (world_id) DO UPDATE SET meta = EXCLUDED.meta, adventurers = EXCLUDED.adventurers,
         society = EXCLUDED.society, saved_at = now()`,
      [worldId, JSON.stringify(meta), JSON.stringify(adventurers), JSON.stringify(society)],
    );
  }

  async appendJournal(entries: readonly JournalEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const values: unknown[] = [];
    const rows = entries.map((e, i) => {
      values.push(new Date(e.at), e.actor, e.op, JSON.stringify(e.detail));
      return `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`;
    });
    await this.pool.query(
      `INSERT INTO journal (at, actor, op, detail) VALUES ${rows.join(', ')}`,
      values,
    );
  }
}
