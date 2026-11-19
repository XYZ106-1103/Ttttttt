/** Server configuration from environment variables (with development defaults). */
export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  /** PostgreSQL connection string; empty = in-memory storage (nothing persists). */
  readonly databaseUrl: string;
  readonly worldId: string;
  readonly worldSeed: number;
  readonly adventurers: number;
  readonly autosaveSeconds: number;
  /** Built client to serve (apps/client/dist); empty = API and WebSocket only. */
  readonly staticDir: string;
  /** Accounts registered with these emails get the admin role. */
  readonly adminEmails: ReadonlySet<string>;
  /** Allowed WebSocket origins; empty = same host only. */
  readonly allowedOrigins: ReadonlySet<string>;
  /** Account requests (register/login) allowed per minute from one address. */
  readonly authPerMinute: number;
}

function list(v: string | undefined): Set<string> {
  return new Set(
    (v ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const int = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && v !== undefined && v !== '' ? Math.floor(n) : d;
  };
  return {
    port: int(env.PORT, 8787),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? '',
    worldId: env.WORLD_ID ?? 'world-1',
    worldSeed: int(env.WORLD_SEED, 0x5eed2026),
    adventurers: Math.max(0, Math.min(300, int(env.ADVENTURERS, 30))),
    autosaveSeconds: Math.max(2, int(env.AUTOSAVE_SECONDS, 10)),
    staticDir: env.STATIC_DIR ?? '',
    adminEmails: list(env.ADMIN_EMAILS),
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    authPerMinute: Math.max(1, int(env.AUTH_RATE_PER_MINUTE, 10)),
  };
}
