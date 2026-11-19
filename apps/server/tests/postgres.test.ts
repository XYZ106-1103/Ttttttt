/**
 * Repository tests against a real PostgreSQL. Uses TEST_DATABASE_URL, or the local development
 * database if reachable; skipped (with a note) when no database is available.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRepository } from '../src/db/postgres';
import { Bot, newPlayer, sleep, startServer } from './helpers';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://world:world@127.0.0.1:5432/world';
const DB = `world_test_${process.pid}`;
const URL = process.env.TEST_DATABASE_URL ?? ADMIN_URL.replace(/\/[^/]+$/, `/${DB}`);

async function reachable(): Promise<boolean> {
  const c = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    if (!process.env.TEST_DATABASE_URL) {
      await c.query(`DROP DATABASE IF EXISTS ${DB}`);
      await c.query(`CREATE DATABASE ${DB}`);
    }
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

const available = await reachable();
if (!available) console.warn('PostgreSQL not reachable: skipping repository tests');

describe.skipIf(!available)('PostgreSQL repository', () => {
  let repo: PostgresRepository;

  beforeAll(async () => {
    repo = new PostgresRepository(URL);
    await repo.init();
    await repo.init(); // migrations are idempotent
  });

  afterAll(async () => {
    await repo.close();
    if (!process.env.TEST_DATABASE_URL) {
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
      await c.end();
    }
  });

  it('stores accounts, sessions and characters with uniqueness and limits', async () => {
    const a = await repo.createAccount('pg@test.dev', 'hash', 'player');
    expect(a).not.toBe('exists');
    expect(await repo.createAccount('pg@test.dev', 'hash', 'player')).toBe('exists');
    if (a === 'exists') return;
    await repo.createSession('tok', a.id, Date.now() + 60_000);
    expect(await repo.sessionAccount('tok', Date.now())).toBe(a.id);
    expect(await repo.sessionAccount('tok', Date.now() + 120_000)).toBeNull();
    await repo.deleteSession('tok');
    expect(await repo.sessionAccount('tok', Date.now())).toBeNull();
    // Five simultaneous creations against a limit of three: exactly three win.
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => repo.createCharacter(a.id, `Hero${i}`, i, 3)),
    );
    expect(results.filter((r) => typeof r === 'object')).toHaveLength(3);
    const b = await repo.createAccount('pg2@test.dev', 'hash', 'player');
    if (b === 'exists') return;
    // Names are unique regardless of case.
    expect(await repo.createCharacter(b.id, 'hero1', 9, 3)).toBe('name_taken');
    await repo.setLoginFailures(a.id, 3, Date.now() + 1000);
    expect((await repo.accountById(a.id))?.failedLogins).toBe(3);
  });

  it('saves and loads characters, world state, chunks and the journal', async () => {
    const acc = await repo.createAccount('pg3@test.dev', 'hash', 'player');
    if (acc === 'exists') return;
    const c = await repo.createCharacter(acc.id, 'Saver', 7, 3);
    if (typeof c !== 'object') return;
    await repo.saveCharacter(c.id, {
      v: 3,
      x: 10,
      y: 20,
      inventory: { slots: [{ itemId: 'wood', count: 5 }] } as never,
      selectedSlot: 0,
      explored: [1, 2],
      playTime: 5,
      level: 4,
      jobId: 'novice',
      gold: 42,
    });
    const loaded = await repo.character(c.id);
    expect(loaded?.level).toBe(4);
    expect(loaded?.save?.gold).toBe(42);
    await repo.saveChunks('w', [
      { v: 1, cx: 1, cy: 2, fg: [0, 1024], bg: [0, 1024], objects: null },
    ]);
    await repo.saveChunks('w', [
      { v: 1, cx: 1, cy: 2, fg: [5, 1024], bg: [0, 1024], objects: null },
    ]);
    await repo.saveWorldState(
      'w',
      { v: 3, worldId: 'w', seed: 1, timeOfDay: 9, day: 2, savedAt: 0 },
      [],
      { economy: { a: 1 }, society: { b: 2 } },
    );
    const w = await repo.loadWorld('w');
    expect(w.chunks).toHaveLength(1);
    expect(w.chunks[0]?.fg[0]).toBe(5);
    expect(w.meta?.day).toBe(2);
    expect(w.society).toEqual({ economy: { a: 1 }, society: { b: 2 } });
    await repo.appendJournal([
      { at: Date.now(), actor: 'pc:1', op: 'market_buy', detail: { total: 10 } },
    ]);
  });

  it('survives a server restart: players, terrain and economy come back', async () => {
    const first = await startServer({ repo: new PostgresRepository(URL) });
    const p = await newPlayer(first.url, 'restart@test.dev', 'Restart');
    const bot = await Bot.join(first.url, p.token, p.char);
    await sleep(300);
    const sim = first.world.sim;
    const me = sim.playerOf(`pc:${p.char}`);
    if (!me) throw new Error('missing');
    me.inventory.add('iron_ore', 4);
    me.gold = 77;
    const tx = Math.floor(me.motor.x / 16) + 3;
    const ty = Math.round(me.motor.y / 16);
    sim.world.setTile(tx, ty, 'fg', 0);
    bot.close();
    await sleep(300);
    await first.close();
    await first.repo.close();

    const second = await startServer({ repo: new PostgresRepository(URL) });
    expect(second.world.sim.world.getFg(tx, ty)).toBe(0);
    const again = await Bot.join(second.url, p.token, p.char);
    const me2 = second.world.sim.playerOf(`pc:${p.char}`);
    expect(me2?.inventory.count('iron_ore')).toBe(4);
    expect(me2?.gold).toBe(77);
    again.close();
    await second.close();
    await second.repo.close();
  });
});
