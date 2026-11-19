/**
 * WebSocket connection to the game server: authenticates with the session token, decodes
 * snapshots, matches command results to requests, measures latency and reconnects after network
 * drops (never after the server refused the client).
 */
import {
  BIN_SNAPSHOT,
  type ChatChannelId,
  decodeSnapshot,
  encodeInputs,
  type InputFrame,
  PROTOCOL_VERSION,
  type Snapshot,
} from '@world/shared';

export interface Welcome {
  readonly key: string;
  readonly id: number;
  readonly name: string;
  readonly look: number;
  readonly admin: boolean;
  readonly seed: number;
  readonly worldId: string;
  readonly adventurers: number;
  readonly dayLength: number;
  readonly hour: number;
  readonly day: number;
  readonly time: number;
  readonly tick: number;
  readonly explored: readonly number[];
}

export interface ServerJson {
  readonly t: string;
  readonly [k: string]: unknown;
}

export type CommandResult =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };

export interface NetHandlers {
  snapshot(s: Snapshot): void;
  message(m: ServerJson): void;
  /** The connection dropped and is being re-established (attempt number, 1-based). */
  reconnecting(attempt: number): void;
  /** Back in the world after a drop. */
  reconnected(w: Welcome): void;
  /** Gone for good: refused, kicked, or reconnection gave up. */
  closed(code: number, reason: string): void;
}

/** Close codes after which reconnecting would not help. */
const FINAL_CODES = new Set([1000, 4001, 4002, 4003, 4004]);
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];
const HELLO_TIMEOUT = 8000;

type Inbound = { kind: 'snap'; s: Snapshot } | { kind: 'msg'; m: ServerJson };

export class NetClient {
  private ws: WebSocket | null = null;
  private handlers: NetHandlers | null = null;
  private readonly inbox: Inbound[] = [];
  private nextCmd = 1;
  private readonly pending = new Map<number, (r: CommandResult) => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pingSent = new Map<number, number>();
  private pingSeq = 0;
  private closedFinal = false;
  private reconnectAttempt = 0;
  /** Smoothed round-trip time (ms). */
  rtt = 0;
  /** Bytes received (diagnostics). */
  bytesIn = 0;

  private constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly characterId: number,
    public welcome: Welcome,
  ) {}

  /** Connect, authenticate and wait for the welcome (rejects with an error code). */
  static async connect(url: string, token: string, characterId: number): Promise<NetClient> {
    const { ws, welcome, early } = await NetClient.open(url, token, characterId);
    const c = new NetClient(url, token, characterId, welcome);
    c.adopt(ws, early);
    return c;
  }

  private static open(
    url: string,
    token: string,
    characterId: number,
  ): Promise<{ ws: WebSocket; welcome: Welcome; early: Inbound[] }> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('network'));
        return;
      }
      ws.binaryType = 'arraybuffer';
      const early: Inbound[] = [];
      let done = false;
      const fail = (code: string) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore
        }
        reject(new Error(code));
      };
      const timer = setTimeout(() => fail('timeout'), HELLO_TIMEOUT);
      ws.onopen = () =>
        ws.send(JSON.stringify({ t: 'hello', token, v: PROTOCOL_VERSION, char: characterId }));
      ws.onmessage = (e: MessageEvent) => {
        if (done) return;
        if (typeof e.data !== 'string') {
          const s = NetClient.decode(e.data);
          if (s) early.push({ kind: 'snap', s });
          return;
        }
        const m = NetClient.parse(e.data);
        if (!m) return;
        if (m.t === 'welcome') {
          done = true;
          clearTimeout(timer);
          ws.onmessage = null;
          ws.onclose = null;
          ws.onerror = null;
          resolve({ ws, welcome: m as unknown as Welcome, early });
        } else if (m.t === 'error') fail(String(m.code ?? 'refused'));
        else early.push({ kind: 'msg', m });
      };
      ws.onerror = () => fail('network');
      ws.onclose = (e: { code: number; reason: string }) =>
        fail(e.code === 4001 ? 'unauthorized' : e.code === 4003 ? 'version' : 'network');
    });
  }

  private static parse(text: string): ServerJson | null {
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === 'object' && typeof (v as ServerJson).t === 'string'
        ? (v as ServerJson)
        : null;
    } catch {
      return null;
    }
  }

  private static decode(data: unknown): Snapshot | null {
    if (!(data instanceof ArrayBuffer)) return null;
    const bytes = new Uint8Array(data);
    if (bytes[0] !== BIN_SNAPSHOT) return null;
    try {
      return decodeSnapshot(bytes);
    } catch (err) {
      console.warn('bad snapshot', err);
      return null;
    }
  }

  private adopt(ws: WebSocket, early: Inbound[]): void {
    this.ws = ws;
    this.inbox.push(...early);
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data === 'string') {
        this.bytesIn += e.data.length;
        const m = NetClient.parse(e.data);
        if (m) this.receive({ kind: 'msg', m });
      } else {
        this.bytesIn += (e.data as ArrayBuffer).byteLength;
        const s = NetClient.decode(e.data);
        if (s) this.receive({ kind: 'snap', s });
      }
    };
    ws.onclose = (e: { code: number; reason: string }) => this.onSocketClosed(e.code, e.reason);
    ws.onerror = () => undefined;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.ping(), 2000);
    this.ping();
  }

  /** Start delivering messages (buffered ones first). */
  attach(handlers: NetHandlers): void {
    this.handlers = handlers;
    const queued = this.inbox.splice(0);
    for (const x of queued) this.deliver(x);
  }

  detach(): void {
    this.handlers = null;
  }

  private receive(x: Inbound): void {
    if (x.kind === 'msg') {
      const m = x.m;
      if (m.t === 'res' && typeof m.id === 'number') {
        const done = this.pending.get(m.id);
        if (done) {
          this.pending.delete(m.id);
          done(
            m.ok === true
              ? { ok: true, value: m.value ?? null }
              : { ok: false, error: String(m.error ?? 'failed') },
          );
        }
        // Results also reach the simulation (pending-command bookkeeping).
      } else if (m.t === 'pong' && typeof m.n === 'number') {
        const sent = this.pingSent.get(m.n);
        this.pingSent.delete(m.n);
        if (sent !== undefined) {
          const sample = performance.now() - sent;
          this.rtt = this.rtt === 0 ? sample : this.rtt * 0.8 + sample * 0.2;
        }
        return;
      }
    }
    if (this.handlers) this.deliver(x);
    else this.inbox.push(x);
  }

  private deliver(x: Inbound): void {
    if (!this.handlers) return;
    if (x.kind === 'snap') this.handlers.snapshot(x.s);
    else this.handlers.message(x.m);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private send(data: string | Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(data as string | Uint8Array<ArrayBuffer>);
  }

  sendInputs(frames: readonly InputFrame[]): void {
    if (frames.length > 0) this.send(encodeInputs(frames));
  }

  /** Send a command; resolves with the server's result (or a local error when disconnected). */
  command(op: string, args: Record<string, unknown> = {}): Promise<CommandResult> {
    if (!this.connected) return Promise.resolve({ ok: false, error: 'disconnected' });
    const id = this.nextCmd++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.send(JSON.stringify({ t: 'cmd', id, op, args }));
    });
  }

  /** Commands sent and not yet answered. */
  get commandsInFlight(): number {
    return this.pending.size;
  }

  chat(ch: ChatChannelId, text: string, to?: string): void {
    this.send(JSON.stringify(to ? { t: 'chat', ch, text, to } : { t: 'chat', ch, text }));
  }

  private ping(): void {
    if (!this.connected) return;
    const n = ++this.pingSeq;
    this.pingSent.set(n, performance.now());
    if (this.pingSent.size > 20) this.pingSent.clear();
    this.send(JSON.stringify({ t: 'ping', n }));
  }

  private failPending(): void {
    for (const done of this.pending.values()) done({ ok: false, error: 'disconnected' });
    this.pending.clear();
  }

  private onSocketClosed(code: number, reason: string): void {
    this.ws = null;
    this.failPending();
    if (this.closedFinal) return;
    if (FINAL_CODES.has(code)) {
      this.finish(code, reason);
      return;
    }
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    while (!this.closedFinal && this.reconnectAttempt < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[this.reconnectAttempt] ?? 8000;
      this.reconnectAttempt++;
      this.handlers?.reconnecting(this.reconnectAttempt);
      await new Promise((r) => setTimeout(r, delay));
      if (this.closedFinal) return;
      try {
        const { ws, welcome, early } = await NetClient.open(this.url, this.token, this.characterId);
        if (this.closedFinal) {
          ws.close(1000);
          return;
        }
        this.welcome = welcome;
        this.reconnectAttempt = 0;
        this.adopt(ws, []);
        this.handlers?.reconnected(welcome);
        for (const x of early) this.receive(x);
        return;
      } catch (err) {
        const code = err instanceof Error ? err.message : 'network';
        if (code === 'unauthorized' || code === 'version') {
          this.finish(4001, code);
          return;
        }
      }
    }
    if (!this.closedFinal) this.finish(1006, 'reconnect_failed');
  }

  private finish(code: number, reason: string): void {
    this.closedFinal = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.handlers?.closed(code, reason);
  }

  /** Leave the world (no reconnection). */
  close(): void {
    this.closedFinal = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.failPending();
    try {
      this.ws?.close(1000, 'bye');
    } catch {
      // ignore
    }
    this.ws = null;
  }
}
