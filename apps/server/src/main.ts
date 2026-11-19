/**
 * PROJECT WORLD server entry point. Reads configuration from the environment, connects the
 * database (or in-memory storage), loads the world and serves HTTP + WebSocket.
 */
import { Auth } from './auth';
import { loadConfig } from './config';
import { MemoryRepository } from './db/memory';
import { PostgresRepository } from './db/postgres';
import type { Repository } from './db/types';
import { WorldServer } from './game/WorldServer';
import { createApp } from './http/app';
import { createLogger } from './log';

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger();
  const repo: Repository = config.databaseUrl
    ? new PostgresRepository(config.databaseUrl)
    : new MemoryRepository();
  if (!config.databaseUrl)
    log.warn('DATABASE_URL not set: using in-memory storage (nothing persists)');
  if (repo instanceof PostgresRepository)
    repo.onError = (err) => log.warn('database connection dropped', { err: String(err) });
  await repo.init();
  const auth = new Auth(repo, config.adminEmails);
  const world = new WorldServer(
    repo,
    auth,
    {
      worldId: config.worldId,
      seed: config.worldSeed,
      adventurers: config.adventurers,
      autosaveSeconds: config.autosaveSeconds,
    },
    log,
  );
  await world.init();
  world.start();
  const { server } = createApp({ config, repo, auth, world, log });
  server.listen(config.port, config.host, () =>
    log.info('server listening', { host: config.host, port: config.port }),
  );

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    server.close();
    await world.stop();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err: String(err), stack: err.stack });
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err: String(err) }));
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${String(err)}\n`);
  process.exit(1);
});
