/**
 * HTTP side of the server: the account API, health check, static client files, and the
 * WebSocket upgrade for the game connection.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { MAX_MESSAGE_BYTES } from '@world/shared';
import { WebSocketServer } from 'ws';
import { type Auth, MAX_CHARACTERS, validName } from '../auth';
import type { ServerConfig } from '../config';
import type { Repository } from '../db/types';
import type { Logger } from '../log';
import { RateLimit } from '../game/Session';
import type { WorldServer } from '../game/WorldServer';

const MAX_BODY = 4 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!(req.headers['content-type'] ?? '').startsWith('application/json'))
    throw new HttpError(415, 'json_required');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'too_large');
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

function bearer(req: IncomingMessage): string {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

export interface AppDeps {
  readonly config: ServerConfig;
  readonly repo: Repository;
  readonly auth: Auth;
  readonly world: WorldServer;
  readonly log: Logger;
}

export function createApp(deps: AppDeps): { server: Server; wss: WebSocketServer } {
  const { config, repo, auth, world, log } = deps;
  const authLimits = new Map<string, RateLimit>();
  const limitAuth = (ip: string) => {
    let l = authLimits.get(ip);
    if (!l) {
      l = new RateLimit(10 / 60, 8);
      authLimits.set(ip, l);
      if (authLimits.size > 10_000) authLimits.clear();
    }
    if (!l.take()) throw new HttpError(429, 'rate_limited');
  };
  const account = async (req: IncomingMessage): Promise<number> => {
    const id = await auth.session(bearer(req));
    if (id === null) throw new HttpError(401, 'unauthorized');
    return id;
  };
  const adventurerNames = () =>
    new Set(
      world.sim.adventurers.all.flatMap((a) => [
        a.profile.name.ko,
        a.profile.name.en.toLowerCase(),
      ]),
    );

  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    if (path === '/api/health' && method === 'GET')
      return send(res, 200, { ok: true, ...world.status() });
    if (path === '/api/register' && method === 'POST') {
      limitAuth(clientIp(req));
      const b = await readJson(req);
      const r = await auth.register(String(b.email ?? ''), String(b.password ?? ''));
      return r.ok
        ? send(res, 201, { token: r.token })
        : send(res, r.reason === 'exists' ? 409 : 400, { error: r.reason });
    }
    if (path === '/api/login' && method === 'POST') {
      limitAuth(clientIp(req));
      const b = await readJson(req);
      const r = await auth.login(String(b.email ?? ''), String(b.password ?? ''));
      return r.ok
        ? send(res, 200, { token: r.token })
        : send(res, r.reason === 'locked' ? 423 : 401, { error: r.reason });
    }
    if (path === '/api/logout' && method === 'POST') {
      await auth.logout(bearer(req));
      return send(res, 200, { ok: true });
    }
    if (path === '/api/characters' && method === 'GET') {
      const id = await account(req);
      const list = await repo.listCharacters(id);
      return send(res, 200, {
        characters: list.map((c) => ({
          id: c.id,
          name: c.name,
          look: c.look,
          level: c.level,
          jobId: c.jobId,
        })),
        max: MAX_CHARACTERS,
      });
    }
    if (path === '/api/characters' && method === 'POST') {
      const id = await account(req);
      const b = await readJson(req);
      const name = String(b.name ?? '').trim();
      const look = Number(b.look);
      if (
        !validName(name) ||
        adventurerNames().has(name) ||
        adventurerNames().has(name.toLowerCase())
      )
        return send(res, 400, { error: 'bad_name' });
      if (!Number.isInteger(look) || look < 0 || look > 0xffffffff)
        return send(res, 400, { error: 'bad_look' });
      const r = await repo.createCharacter(id, name, look, MAX_CHARACTERS);
      if (r === 'name_taken') return send(res, 409, { error: r });
      if (r === 'limit') return send(res, 400, { error: r });
      return send(res, 201, {
        character: { id: r.id, name: r.name, look: r.look, level: 1, jobId: 'novice' },
      });
    }
    throw new HttpError(404, 'not_found');
  }

  const staticRoot = config.staticDir ? resolve(config.staticDir) : '';

  function serveStatic(res: ServerResponse, path: string): void {
    if (!staticRoot) throw new HttpError(404, 'not_found');
    const rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '');
    let file = resolve(join(staticRoot, rel));
    if (!file.startsWith(staticRoot)) throw new HttpError(403, 'forbidden');
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticRoot, 'index.html');
    if (!existsSync(file)) throw new HttpError(404, 'not_found');
    const ext = extname(file);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const handle = path.startsWith('/api/')
      ? api(req, res, path)
      : Promise.resolve(serveStatic(res, path));
    handle.catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.code });
      log.error('http error', { path, err: String(err) });
      send(res, 500, { error: 'internal' });
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = (req.headers.origin ?? '').toLowerCase();
    const host = (req.headers.host ?? '').toLowerCase();
    const allowed =
      config.allowedOrigins.size > 0
        ? config.allowedOrigins.has(origin)
        : !origin || origin.endsWith(`//${host}`);
    if (url.pathname !== '/ws' || !allowed) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const session = world.connect(
        {
          sendText: (t) => {
            if (ws.readyState === ws.OPEN) ws.send(t);
          },
          sendBinary: (b) => {
            if (ws.readyState === ws.OPEN) ws.send(b, { binary: true });
          },
          close: (code, reason) => ws.close(code, reason.slice(0, 120)),
          get buffered() {
            return ws.bufferedAmount;
          },
        },
        clientIp(req),
      );
      ws.on('message', (data, isBinary) => {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        if (isBinary)
          world.onBinary(session, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        else
          world
            .onText(session, buf.toString('utf8'))
            .catch((err: unknown) => log.error('message failed', { err: String(err) }));
      });
      ws.on('close', () => void world.onClose(session));
      ws.on('error', () => void world.onClose(session));
    });
  });
  return { server, wss };
}
