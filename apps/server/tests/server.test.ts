import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENT_PLAYER, TILE_SIZE } from '@world/shared';
import { api, Bot, newPlayer, sleep, startServer, type TestServer } from './helpers';

let srv: TestServer;

beforeEach(async () => {
  srv = await startServer();
});

afterEach(async () => {
  await srv.close();
});

describe('accounts API', () => {
  it('registers, logs in, creates characters and validates everything', async () => {
    const base = srv.url;
    expect(
      (await api(base, '/api/register', { email: 'bad', password: 'password123' })).status,
    ).toBe(400);
    expect((await api(base, '/api/register', { email: 'a@b.dev', password: 'short' })).status).toBe(
      400,
    );
    const reg = await api(base, '/api/register', { email: 'A@B.dev', password: 'password123' });
    expect(reg.status).toBe(201);
    expect(
      (await api(base, '/api/register', { email: 'a@b.dev', password: 'password123' })).status,
    ).toBe(409);
    expect(
      (await api(base, '/api/login', { email: 'a@b.dev', password: 'wrong-pass' })).status,
    ).toBe(401);
    const login = await api(base, '/api/login', { email: 'a@b.dev', password: 'password123' });
    expect(login.status).toBe(200);
    const token = String(login.json.token);
    expect((await api(base, '/api/characters')).status).toBe(401);
    expect((await api(base, '/api/characters', { name: 'x', look: 1 }, token)).status).toBe(400);
    expect((await api(base, '/api/characters', { name: '<script>', look: 1 }, token)).status).toBe(
      400,
    );
    expect((await api(base, '/api/characters', { name: '운영자', look: 1 }, token)).status).toBe(
      400,
    );
    expect((await api(base, '/api/characters', { name: '여행자', look: 1 }, token)).status).toBe(
      201,
    );
    expect((await api(base, '/api/characters', { name: '여행자', look: 2 }, token)).status).toBe(
      409,
    );
    expect((await api(base, '/api/characters', { name: 'Two', look: 2 }, token)).status).toBe(201);
    expect((await api(base, '/api/characters', { name: 'Three', look: 3 }, token)).status).toBe(
      201,
    );
    expect((await api(base, '/api/characters', { name: 'Four', look: 4 }, token)).status).toBe(400);
    const list = await api(base, '/api/characters', undefined, token);
    expect((list.json.characters as unknown[]).length).toBe(3);
  });

  it('locks an account after repeated wrong passwords', async () => {
    const base = srv.url;
    await api(base, '/api/register', { email: 'lock@b.dev', password: 'password123' });
    let last = 0;
    for (let i = 0; i < 5; i++)
      last = (await api(base, '/api/login', { email: 'lock@b.dev', password: 'nope-nope' })).status;
    expect(last).toBe(423);
    // Even the right password is refused while locked.
    expect(
      (await api(base, '/api/login', { email: 'lock@b.dev', password: 'password123' })).status,
    ).toBe(423);
  });
});

describe('game connection', () => {
  it("rejects bad tokens and other accounts' characters", async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const b = await newPlayer(srv.url, 'b@x.dev', 'Bob');
    const bad = await Bot.open(srv.url);
    bad.send({ t: 'hello', token: 'x'.repeat(43), v: 1, char: a.char });
    await sleep(300);
    expect(bad.closed?.code).toBe(4001);
    const thief = await Bot.open(srv.url);
    thief.send({ t: 'hello', token: b.token, v: 1, char: a.char });
    await sleep(300);
    expect(thief.closed?.code).toBe(4001);
  });

  it('two players see each other move; the server applies at most one input per tick', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const b = await newPlayer(srv.url, 'b@x.dev', 'Bob');
    const alice = await Bot.join(srv.url, a.token, a.char);
    const bob = await Bot.join(srv.url, b.token, b.char);
    await sleep(400);
    const seen = bob.last?.entities.find((e) => e.kind === ENT_PLAYER);
    expect(seen && 'name' in seen ? seen.name : '').toBe('Alice');
    const x0 = alice.last?.self?.x ?? 0;
    // A cheating client floods 600 "run right" frames at once: still only one per tick applies.
    const move = { moveX: 1, jumpHeld: false, jumpPressed: false, down: false };
    alice.input({ move }, 600);
    await sleep(1000);
    const x1 = alice.last?.self?.x ?? 0;
    const runSpeed = srv.world.sim.movement.runSpeed;
    expect(x1 - x0).toBeGreaterThan(20);
    // At most ~1.2 s of running (the queue is capped), never 10 s worth.
    expect(x1 - x0).toBeLessThan(runSpeed * 1.6);
    expect(alice.last?.ack ?? 0).toBeGreaterThan(0);
    const fromBob = bob.last?.entities.find((e) => e.kind === ENT_PLAYER);
    expect(fromBob && 'x' in fromBob ? Math.abs(fromBob.x - x1) : 99).toBeLessThan(runSpeed * 0.3);
    alice.close();
    bob.close();
  });

  it('a client that stops sending input stands still instead of running on', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const alice = await Bot.join(srv.url, a.token, a.char);
    await sleep(300);
    const move = { moveX: 1, jumpHeld: false, jumpPressed: false, down: false };
    await alice.hold({ move }, 0.5);
    // The client freezes (background tab, lost packets): no more frames.
    await sleep(500);
    const p = srv.world.sim.playerOf('pc:' + a.char);
    const x0 = p?.motor.x ?? 0;
    await sleep(500);
    expect(Math.abs((p?.motor.x ?? 0) - x0)).toBeLessThan(2);
    alice.close();
  });

  it('delivers chat by channel and lets players party up', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const b = await newPlayer(srv.url, 'b@x.dev', 'Bob');
    const alice = await Bot.join(srv.url, a.token, a.char);
    const bob = await Bot.join(srv.url, b.token, b.char);
    alice.send({ t: 'chat', ch: 'all', text: 'hello <b>world</b>' });
    const msg = await bob.waitFor((m) => m.t === 'chat' && m.ch === 'all');
    expect(msg.text).toBe('hello <b>world</b>');
    expect(msg.name).toBe('Alice');
    alice.send({ t: 'chat', ch: 'whisper', to: 'bob', text: 'psst' });
    expect((await bob.waitFor((m) => m.t === 'chat' && m.ch === 'whisper')).text).toBe('psst');
    expect((await alice.cmd('invitePlayer', { name: 'Bob' })).value).toMatchObject({ ok: true });
    const invite = await bob.waitFor((m) => m.t === 'invite');
    expect(
      (await bob.cmd('answerPlayer', { from: invite.from, accept: true })).value,
    ).toMatchObject({
      joined: true,
    });
    expect(srv.world.sim.society.parties.same('pc:' + a.char, 'pc:' + b.char)).toBe(true);
    bob.send({ t: 'chat', ch: 'party', text: 'party up' });
    expect((await alice.waitFor((m) => m.t === 'chat' && m.ch === 'party')).text).toBe('party up');
  });

  it('trades between players atomically, with both confirmations', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const b = await newPlayer(srv.url, 'b@x.dev', 'Bob');
    const alice = await Bot.join(srv.url, a.token, a.char);
    const bob = await Bot.join(srv.url, b.token, b.char);
    const sim = srv.world.sim;
    const pa = sim.playerOf('pc:' + a.char);
    const pb = sim.playerOf('pc:' + b.char);
    if (!pa || !pb) throw new Error('players missing');
    pa.inventory.add('iron_ore', 10);
    pb.gold = 500;
    expect((await alice.cmd('trade', { op: 'request', name: 'Bob' })).value).toMatchObject({
      ok: true,
    });
    await bob.waitFor((m) => m.t === 'tradeRequest');
    expect((await bob.cmd('trade', { op: 'accept' })).value).toMatchObject({ ok: true });
    // Offering more than you have is refused.
    expect(
      (
        await alice.cmd('trade', {
          op: 'offer',
          items: [{ itemId: 'iron_ore', count: 99 }],
          gold: 0,
        })
      ).value,
    ).toMatchObject({ ok: false });
    await alice.cmd('trade', { op: 'offer', items: [{ itemId: 'iron_ore', count: 10 }], gold: 0 });
    await bob.cmd('trade', { op: 'offer', items: [], gold: 300 });
    await alice.cmd('trade', { op: 'confirm' });
    // Bob changes his offer after Alice confirmed: her confirmation is cleared.
    await bob.cmd('trade', { op: 'offer', items: [], gold: 100 });
    expect((await bob.cmd('trade', { op: 'confirm' })).value).toMatchObject({ waiting: true });
    expect(pa.inventory.count('iron_ore')).toBe(10);
    await alice.cmd('trade', { op: 'confirm' });
    expect(pa.inventory.count('iron_ore')).toBe(0);
    expect(pb.inventory.count('iron_ore')).toBe(10);
    expect(pa.gold).toBe(100);
    expect(pb.gold).toBe(400);
  });

  it('serves views of shared state: society pushes, market, roster, adventurer cards', async () => {
    await srv.close();
    srv = await startServer({ adventurers: 4 });
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const alice = await Bot.join(srv.url, a.token, a.char);
    const soc = await alice.waitFor((m) => m.t === 'soc');
    expect(soc.d).toMatchObject({ society: { parties: expect.anything() } });
    // The market view carries only the caller's own mailbox.
    srv.world.sim.economy.market.mailbox('pc:999').gold = 50;
    const eco = (await alice.cmd('economy')).value as { market: { mail: object } };
    expect(Object.keys(eco.market.mail)).not.toContain('pc:999');
    const roster = (await alice.cmd('roster')).value as { key: string }[];
    expect(roster).toHaveLength(4);
    const first = roster[0]?.key ?? '';
    const card = (await alice.cmd('adventurer', { key: first })).value as { save: { key: string } };
    expect(card.save.key).toBe(first);
    expect(await alice.cmd('adventurer', { key: 'nobody' })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
    alice.close();
  });

  it('enforces admin-only commands and validates arguments', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const alice = await Bot.join(srv.url, a.token, a.char);
    expect(await alice.cmd('dev', { cmd: 'gold', n: 1000 })).toMatchObject({
      ok: false,
      error: 'forbidden',
    });
    expect(await alice.cmd('select', { slot: 99 })).toMatchObject({ ok: false, error: 'bad_slot' });
    expect(await alice.cmd('invClick', { index: 3, button: 'middle' })).toMatchObject({
      ok: false,
    });
    expect(await alice.cmd('nope')).toMatchObject({ ok: false, error: 'unknown_command' });
    expect(srv.world.sim.playerOf('pc:' + a.char)?.gold).toBe(0);
  });

  it('disconnects clients that keep sending garbage', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const alice = await Bot.join(srv.url, a.token, a.char);
    for (let i = 0; i < 12; i++) alice.ws.send(Buffer.from([2, 200, 1, 2, 3]));
    await sleep(300);
    expect(alice.closed?.code).toBe(4002);
  });

  it('replicates tile changes and saves the character on leave', async () => {
    const a = await newPlayer(srv.url, 'a@x.dev', 'Alice');
    const b = await newPlayer(srv.url, 'b@x.dev', 'Bob');
    const alice = await Bot.join(srv.url, a.token, a.char);
    const bob = await Bot.join(srv.url, b.token, b.char);
    await sleep(300);
    const p = srv.world.sim.playerOf('pc:' + a.char);
    if (!p) throw new Error('missing');
    const tx = Math.floor(p.motor.x / TILE_SIZE) + 2;
    const ty = Math.round(p.motor.y / TILE_SIZE);
    // Alice digs with the pickaxe (slot 0) by holding "use" on a tile.
    await alice.hold({ use: { tx, ty } }, 1.5);
    const tiles = await bob.waitFor(
      (m) =>
        m.t === 'ev' &&
        Array.isArray(m.tiles) &&
        (m.tiles as number[][]).some((c) => c[0] === tx && c[1] === ty),
    );
    expect(tiles).toBeTruthy();
    p.inventory.add('copper_ore', 3);
    alice.close();
    await sleep(400);
    const rec = await srv.repo.character(a.char);
    expect(rec?.save?.inventory).toBeTruthy();
    const again = await Bot.join(srv.url, a.token, a.char);
    expect(srv.world.sim.playerOf('pc:' + a.char)?.inventory.count('copper_ore')).toBe(3);
    again.close();
  });
});
