import type { InputFrame, Player, PlayerSlot, TownServices } from '@world/shared';

/** What the gateway gives a session to talk to its client. */
export interface Transport {
  sendText(text: string): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
  /** Bytes queued but not yet sent (backpressure). */
  readonly buffered: number;
}

/** Token bucket: `rate` tokens per second, up to `burst`. */
export class RateLimit {
  private tokens: number;
  private last: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.last = now;
  }

  take(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.rate);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Inputs waiting to be applied, at most one per server tick. */
export const MAX_QUEUED_INPUTS = 20;

/** One connected client. */
export class Session {
  state: 'auth' | 'playing' | 'closed' = 'auth';
  accountId = 0;
  characterId = 0;
  admin = false;
  slot: PlayerSlot | null = null;
  readonly inputs: InputFrame[] = [];
  lastInput: InputFrame | null = null;
  /** Consecutive ticks without a fresh input. */
  missingInputs = 0;
  /** One-shot presses of skipped frames, applied with the next frame. */
  carry: InputFrame | null = null;
  /** Highest input sequence applied. */
  ack = 0;
  /** Protocol violations; too many and the client is disconnected. */
  strikes = 0;
  /** Chunk replication bookkeeping: chunk index → change stamp the client has. */
  readonly knownChunks = new Map<number, string>();
  lastPrivate = '';
  /** Tick of the last snapshot/events sent, and how many were sent. */
  lastSentTick = 0;
  replications = 0;
  /** Last society view sent (parties, guilds, news, own mailbox). */
  lastSocial = '';
  readonly messages = new RateLimit(120, 240);
  readonly commands = new RateLimit(20, 40);
  readonly chat = new RateLimit(1, 5);
  /** Adventurer barks already sent (id → bark until). */
  readonly barks = new Map<number, number>();
  /** Pending invitations from other players (keys). */
  readonly playerInvites = new Set<string>();
  connectedAt = Date.now();

  constructor(
    readonly id: number,
    readonly transport: Transport,
    readonly ip: string,
  ) {}

  get key(): string {
    return `pc:${this.characterId}`;
  }

  get character(): Player {
    if (!this.slot) throw new Error('session not in world');
    return this.slot.character;
  }

  get town(): TownServices {
    if (!this.slot) throw new Error('session not in world');
    return this.slot.town;
  }

  sendJson(message: unknown): void {
    if (this.state === 'closed') return;
    this.transport.sendText(JSON.stringify(message));
  }

  /** Queue an input batch; extra frames beyond the cap are dropped (no speed-ups). */
  queueInputs(frames: readonly InputFrame[]): void {
    for (const f of frames) {
      if (f.seq <= this.ack || (this.inputs.length > 0 && f.seq <= (this.inputs.at(-1)?.seq ?? 0)))
        continue;
      this.inputs.push(f);
    }
    if (this.inputs.length > MAX_QUEUED_INPUTS)
      this.inputs.splice(0, this.inputs.length - MAX_QUEUED_INPUTS);
  }

  strike(reason: string): boolean {
    this.strikes++;
    if (this.strikes >= 10) {
      this.transport.close(4002, `protocol: ${reason}`);
      return true;
    }
    return false;
  }
}
