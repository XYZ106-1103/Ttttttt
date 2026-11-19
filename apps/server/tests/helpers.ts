import type { AddressInfo } from 'node:net';
import {
  decodeSnapshot,
  encodeInputs,
  IDLE_ACTION,
  type InputFrame,
  PROTOCOL_VERSION,
  type Snapshot,
} from '@world/shared';
import WebSocket from 'ws';
import { Auth } from '../src/auth';
import type { ServerConfig } from '../src/config';
import { MemoryRepository } from '../src/db/memory';
import type { Repository } from '../src/db/types';
import { WorldServer } from '../src/game/WorldServer';
import { createApp } from '../src/http/app';
import { createLogger } from '../src/log';

export interface TestServer {
  readonly url: string;
  readonly world: WorldServer;
  readonly repo: Repository;
  close(): Promise<void>;
}

export async function startServer(
  opts: { repo?: Repository; admins?: string[]; adventurers?: number } = {},
): Promise<TestServer> {
  const repo = opts.repo ?? new MemoryRepository();
  await repo.init();
  const log = createLogger(true);
  const auth = new Auth(repo, new Set(opts.admins ?? []));
  const world = new WorldServer(
    repo,
    auth,
    { worldId: 'test', seed: 0x5eed, adventurers: opts.adventurers ?? 0, autosaveSeconds: 60 },
    log,
  );
  await world.init();
  world.sim.monstersEnabled = false;
  world.start();
  const config: ServerConfig = {
    port: 0,
    host: '127.0.0.1',
    databaseUrl: '',
    worldId: 'test',
    worldSeed: 0x5eed,
    adventurers: 0,
    autosaveSeconds: 60,
    staticDir: '',
    adminEmails: new Set(),
    allowedOrigins: new Set(),
    authPerMinute: 10,
  };
  const { server, wss } = createApp({ config, repo, auth, world, log });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    world,
    repo,
    close: async () => {
      for (const c of wss.clients) c.terminate();
      await world.stop();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export async function api(
  base: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** Register an account and create a character; returns the token and character id. */
export async function newPlayer(
  base: string,
  email: string,
  name: string,
): Promise<{ token: string; char: number }> {
  const r = await api(base, '/api/register', { email, password: 'password123' });
  const token = String(r.json.token);
  const c = await api(base, '/api/characters', { name, look: 1234 }, token);
  return { token, char: Number((c.json.character as { id: number }).id) };
}

/** A scripted game client over a real WebSocket. */
export class Bot {
  readonly texts: Record<string, unknown>[] = [];
  snapshots: Snapshot[] = [];
  closed: { code: number; reason: string } | null = null;
  private seq = 0;
  private cmdId = 1;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      if (isBinary) this.snapshots.push(decodeSnapshot(new Uint8Array(buf)));
      else this.texts.push(JSON.parse(buf.toString('utf8')) as Record<string, unknown>);
      if (this.snapshots.length > 200) this.snapshots = this.snapshots.slice(-100);
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
    });
  }

  static async open(base: string): Promise<Bot> {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new Bot(ws);
  }

  static async join(base: string, token: string, char: number): Promise<Bot> {
    const bot = await Bot.open(base);
    bot.send({ t: 'hello', token, v: PROTOCOL_VERSION, char });
    await bot.waitFor((m) => m.t === 'welcome');
    return bot;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(
    pred: (m: Record<string, unknown>) => boolean,
    timeout = 5000,
  ): Promise<Record<string, unknown>> {
    const t0 = Date.now();
    for (;;) {
      const m = this.texts.find(pred);
      if (m) return m;
      if (Date.now() - t0 > timeout) throw new Error('timeout waiting for message');
      await sleep(20);
    }
  }

  async cmd(op: string, args: unknown = {}): Promise<Record<string, unknown>> {
    const id = this.cmdId++;
    this.send({ t: 'cmd', id, op, args });
    return this.waitFor((m) => m.t === 'res' && m.id === id);
  }

  input(frame: Partial<Omit<InputFrame, 'seq'>>, count = 1): void {
    const frames: InputFrame[] = [];
    for (let i = 0; i < count; i++) {
      frames.push({
        seq: ++this.seq,
        move: frame.move ?? { moveX: 0, jumpHeld: false, jumpPressed: false, down: false },
        use: frame.use ?? null,
        action: frame.action ?? IDLE_ACTION,
      });
    }
    for (let i = 0; i < frames.length; i += 8) this.ws.send(encodeInputs(frames.slice(i, i + 8)));
  }

  /** Send the same input as a real client would: one frame per tick, in real time. */
  async hold(frame: Partial<Omit<InputFrame, 'seq'>>, seconds: number): Promise<void> {
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      this.input(frame, 2);
      await sleep(33);
    }
  }

  get last(): Snapshot | undefined {
    return this.snapshots.at(-1);
  }

  close(): void {
    this.ws.close();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
