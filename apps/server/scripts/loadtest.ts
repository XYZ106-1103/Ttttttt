/**
 * Load test: N bot players join a running server and play (run, jump, attack, chat now and
 * then) for a while; the server's tick time and per-client bandwidth are reported.
 *
 *   pnpm --filter @world/server loadtest -- --url http://127.0.0.1:8787 --bots 100 --seconds 60
 *
 * Bots send input the way the web client does (one frame per tick, 60 Hz). Run the server in a
 * separate process (`pnpm --filter @world/server dev`) so the bots do not share its CPU.
 */
import { encodeInputs, IDLE_ACTION, type InputFrame, PROTOCOL_VERSION } from '@world/shared';
import WebSocket from 'ws';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const URL = arg('url', 'http://127.0.0.1:8787');
const BOTS = Number(arg('bots', '50'));
const SECONDS = Number(arg('seconds', '30'));
const RUN = Date.now().toString(36);

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

interface Bot {
  ws: WebSocket;
  bytes: number;
  snapshots: number;
}

async function joinBot(i: number): Promise<Bot> {
  const email = `load${RUN}${i}@bots.dev`;
  // Account creation is rate-limited per address: retry patiently.
  let reg: Record<string, unknown> = {};
  for (let tries = 0; tries < 60 && typeof reg.token !== 'string'; tries++) {
    reg = await post('/api/register', { email, password: 'password123' });
    if (typeof reg.token !== 'string') await new Promise((r) => setTimeout(r, 1000));
  }
  const token = String(reg.token);
  const c = await post('/api/characters', { name: `B${RUN.slice(-4)}${i}`, look: 3 + i }, token);
  const id = Number((c.character as { id: number }).id);
  const ws = new WebSocket(`${URL.replace('http', 'ws')}/ws`);
  const bot: Bot = { ws, bytes: 0, snapshots: 0 };
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      ws.send(JSON.stringify({ t: 'hello', token, v: PROTOCOL_VERSION, char: id }));
    });
    ws.on('message', (data, isBinary) => {
      const n = Array.isArray(data)
        ? data.reduce((a, b) => a + b.length, 0)
        : (data as Buffer).length;
      bot.bytes += n;
      if (isBinary) bot.snapshots++;
      else if (String(data).startsWith('{"t":"welcome"')) resolve();
    });
    ws.once('error', reject);
  });
  return bot;
}

async function main(): Promise<void> {
  console.log(`load test: ${BOTS} bots for ${SECONDS}s against ${URL}`);
  const bots: Bot[] = [];
  for (let i = 0; i < BOTS; i++) bots.push(await joinBot(i));
  console.log(`${bots.length} bots in the world; playing…`);
  const before = bots.map((b) => b.bytes);
  const start = Date.now();
  let seq = 0;
  const timer = setInterval(() => {
    seq++;
    const t = (Date.now() - start) / 1000;
    bots.forEach((b, i) => {
      if (b.ws.readyState !== WebSocket.OPEN) return;
      const dir = Math.sin(t * 0.7 + i) > 0 ? 1 : -1;
      const frame: InputFrame = {
        seq,
        move: {
          moveX: dir,
          jumpHeld: (seq + i) % 90 < 10,
          jumpPressed: (seq + i) % 90 === 0,
          down: false,
        },
        use: null,
        action: { ...IDLE_ACTION, attackPressed: (seq + i) % 40 === 0, aimX: dir * 40, aimY: 0 },
      };
      b.ws.send(encodeInputs([frame]));
      if ((seq + i * 37) % 900 === 0)
        b.ws.send(JSON.stringify({ t: 'chat', ch: 'near', text: 'hi' }));
    });
  }, 1000 / 60);
  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(timer);
  const health = (await (await fetch(`${URL}/api/health`)).json()) as Record<string, number>;
  const elapsed = (Date.now() - start) / 1000;
  const kbps = bots.map((b, i) => (b.bytes - (before[i] ?? 0)) / 1024 / elapsed);
  const avg = kbps.reduce((a, b) => a + b, 0) / kbps.length;
  const snaps = bots.reduce((a, b) => a + b.snapshots, 0) / bots.length / elapsed;
  console.log(
    JSON.stringify(
      {
        bots: BOTS,
        online: health.online,
        tickMsAvg: Number(health.tickMsAvg?.toFixed(3)),
        tickMsP99: Number(health.tickMsP99?.toFixed(3)),
        tickBudgetMs: 16.67,
        adventurersActive: health.adventurersActive,
        monsters: health.monsters,
        downKBpsPerClient: Number(avg.toFixed(1)),
        downKBpsMax: Number(Math.max(...kbps).toFixed(1)),
        snapshotsPerSecond: Number(snaps.toFixed(1)),
      },
      null,
      2,
    ),
  );
  for (const b of bots) b.ws.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
