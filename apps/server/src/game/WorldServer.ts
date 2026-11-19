/**
 * The authoritative world: one WorldSim stepped at a fixed 60 Hz, every connected player's
 * inputs applied in order, snapshots and events sent at 20 Hz to each player for what is
 * around them, and everything saved to the repository.
 */
import {
  BIN_INPUTS,
  type ChatChannelId,
  captureVitals,
  capturePrivate,
  CHUNK_SIZE,
  decodeInputs,
  encodeSnapshot,
  IDLE_ACTION,
  type InputFrame,
  isPlayerKey,
  MAX_CHAT_LENGTH,
  MAX_MESSAGE_BYTES,
  parseClientMessage,
  PROTOCOL_VERSION,
  ProtocolError,
  SIM_DT,
  TILE_SIZE,
  type TileChange,
  type ObjectChange,
  WorldSim,
} from '@world/shared';
import type { Auth } from '../auth';
import type { JournalEntry, Repository } from '../db/types';
import type { Logger } from '../log';
import { CommandError, COMMANDS, type CommandContext, type SocialOps } from './commands';
import { buildSnapshot, filterEvents, inView, positionsOf } from './replication';
import { Session, type Transport } from './Session';
import { PlayerTrades } from './trades';

export interface WorldServerConfig {
  readonly worldId: string;
  readonly seed: number;
  readonly adventurers: number;
  /** Seconds between autosaves of players and changed chunks. */
  readonly autosaveSeconds: number;
  /** Disable the fixed-rate loop (tests drive `step()` manually). */
  readonly manualClock?: boolean;
}

/** Strip control and bidi-override characters from chat (the client renders text, never HTML). */
function cleanChat(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 32 || c === 127 || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069))
      continue;
    out += ch;
  }
  return out;
}

/** A frame with the one-shot presses of an earlier, skipped frame folded in. */
function mergePresses(skipped: InputFrame, into: InputFrame): InputFrame {
  return {
    seq: into.seq,
    move: { ...into.move, jumpPressed: into.move.jumpPressed || skipped.move.jumpPressed },
    use: into.use,
    action: {
      ...into.action,
      attackPressed: into.action.attackPressed || skipped.action.attackPressed,
      dodge: into.action.dodge || skipped.action.dodge,
      skillSlot: into.action.skillSlot ?? skipped.action.skillSlot,
      quickHeal: into.action.quickHeal || skipped.action.quickHeal,
      quickMana: into.action.quickMana || skipped.action.quickMana,
    },
  };
}

/** Chunks around a player whose authoritative data is kept in sync. */
const CHUNK_RX = 4;
const CHUNK_RY = 3;
const REPLICATE_EVERY = 3; // ticks → 20 Hz
const PRIVATE_EVERY = 4; // replications → 5 Hz
const MAX_BUFFERED = 2 * 1024 * 1024;
/** Input frames buffered beyond this are trimmed (≈130 ms at 60 Hz). */
const INPUT_BUFFER_FRAMES = 8;
/** A player whose input is late holds still for at most this many ticks (≈130 ms). */
const MAX_STALL_TICKS = 8;
const NEAR_CHAT_TILES = 40;

export class WorldServer {
  sim!: WorldSim;
  private readonly sessions = new Set<Session>();
  private readonly byKey = new Map<string, Session>();
  /** Appearance seeds of players in the world. */
  private readonly looks = new Map<string, number>();
  private nextSessionId = 1;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private acc = 0;
  private replications = 0;
  private autosaveAt = 0;
  private worldSaveAt = 0;
  private journalBuf: JournalEntry[] = [];
  private worldDirtyAt: number | null = null;
  private pendingTiles: TileChange[] = [];
  private pendingObjects: ObjectChange[] = [];
  private unsubscribe: (() => void)[] = [];
  private readonly trades: PlayerTrades;
  /** Recent tick durations (ms) for monitoring. */
  readonly tickMs: number[] = [];

  constructor(
    private readonly repo: Repository,
    private readonly auth: Auth,
    readonly config: WorldServerConfig,
    private readonly log: Logger,
  ) {
    this.trades = new PlayerTrades(this);
  }

  async init(): Promise<void> {
    const w = await this.repo.loadWorld(this.config.worldId);
    this.sim = new WorldSim({
      seed: w.meta?.seed ?? this.config.seed,
      worldId: this.config.worldId,
      adventurers: this.config.adventurers,
      save: {
        meta: w.meta,
        player: null,
        chunks: w.chunks,
        adventurers: w.adventurers,
        society: w.society,
      },
    });
    this.unsubscribe.push(this.sim.world.onTileChange((c) => this.pendingTiles.push(c)));
    this.unsubscribe.push(this.sim.world.onObjectChange((c) => this.pendingObjects.push(c)));
    this.log.info('world loaded', {
      worldId: this.config.worldId,
      seed: this.sim.seed,
      chunks: w.chunks.length,
      adventurers: this.sim.adventurers.all.length,
    });
  }

  start(): void {
    if (this.config.manualClock) return;
    this.lastTime = performance.now();
    this.timer = setInterval(() => this.pump(), 1000 / 120);
  }

  /** Advance the simulation by the real time that passed (fixed steps, bounded catch-up). */
  private pump(): void {
    const now = performance.now();
    this.acc += Math.min(250, now - this.lastTime) / 1000;
    this.lastTime = now;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 8) {
      this.acc -= SIM_DT;
      this.step();
      steps++;
    }
  }

  /** One authoritative tick. */
  step(): void {
    const t0 = performance.now();
    try {
      for (const s of this.sessions) if (s.state === 'playing') this.applyInput(s);
      this.sim.tick(SIM_DT);
      if (this.sim.tickCount % REPLICATE_EVERY === 0) this.replicate();
      this.housekeeping();
    } catch (err) {
      this.log.error('tick failed', { err: String(err), stack: (err as Error).stack });
    }
    this.tickMs.push(performance.now() - t0);
    if (this.tickMs.length > 600) this.tickMs.shift();
  }

  /**
   * Apply one input frame for this tick. The server applies exactly the frames the client sent,
   * one per tick, in order, so the client's prediction (which replays the same frames) agrees.
   * When a frame is late the player holds still for that tick (a short stall, capped) rather
   * than guessing an input; after a longer gap (frozen tab, lost connection) they stand idle.
   * Frames piling up beyond a small buffer are dropped (their presses carry over) so input
   * latency stays bounded. Never more than one frame is applied per tick.
   */
  private applyInput(s: Session): void {
    const slot = s.slot;
    if (!slot) return;
    while (s.inputs.length > INPUT_BUFFER_FRAMES) {
      const skipped = s.inputs.shift() as InputFrame;
      s.ack = skipped.seq;
      s.carry = s.carry ? mergePresses(s.carry, skipped) : skipped;
    }
    const next = s.inputs.shift();
    if (next) {
      const frame = s.carry ? mergePresses(s.carry, next) : next;
      s.carry = null;
      s.missingInputs = 0;
      s.ack = next.seq;
      s.lastInput = next;
      slot.intent = { move: frame.move, use: frame.use, action: frame.action };
      return;
    }
    s.missingInputs++;
    if (s.lastInput && s.missingInputs <= MAX_STALL_TICKS) {
      slot.stall = true;
      return;
    }
    slot.intent = {
      move: { moveX: 0, jumpHeld: false, jumpPressed: false, down: false },
      use: null,
      action: IDLE_ACTION,
    };
  }

  // --- Replication --------------------------------------------------------------------------

  private replicate(): void {
    this.replications++;
    const sim = this.sim;
    const pos = positionsOf(sim);
    const speaker = (key: string) => {
      const a = sim.adventurers.byKey(key);
      return a?.tier === 'active' ? a.character.motor : undefined;
    };
    for (const s of this.sessions) {
      if (s.state !== 'playing' || !s.slot) continue;
      if (s.transport.buffered > MAX_BUFFERED) continue; // slow client: skip, it catches up later
      const me = s.slot.character;
      const view = { x: me.motor.x, y: me.motor.y };
      s.transport.sendBinary(encodeSnapshot(buildSnapshot(sim, s.slot, s.ack, this.looks)));
      const pe = s.slot.events;
      const barks: unknown[] = [];
      for (const a of sim.adventurers.active) {
        const b = a.bark;
        if (!b || b.until <= sim.time || !inView(view, a.character.motor.x, a.character.motor.y))
          continue;
        if (s.barks.get(a.character.id) === b.until) continue;
        s.barks.set(a.character.id, b.until);
        barks.push({
          id: a.character.id,
          key: b.key,
          params: b.params ?? null,
          talk: !!b.talk,
          left: b.until - sim.time,
        });
      }
      if (s.barks.size > 200) s.barks.clear();
      const tiles = this.pendingTiles
        .filter((c) => inView(view, c.tx * TILE_SIZE, c.ty * TILE_SIZE))
        .map((c) => [c.tx, c.ty, c.layer === 'fg' ? 0 : 1, c.next]);
      const objects = this.pendingObjects
        .filter((c) => inView(view, c.removed.tx * TILE_SIZE, c.removed.ty * TILE_SIZE))
        .map((c) => [c.cx, c.cy, c.removed.id]);
      for (const c of this.pendingTiles)
        this.touchKnown(s, Math.floor(c.tx / CHUNK_SIZE), Math.floor(c.ty / CHUNK_SIZE));
      for (const c of this.pendingObjects) this.touchKnown(s, c.cx, c.cy);
      s.sendJson({
        t: 'ev',
        w: filterEvents(sim.worldEvents, view, pos, speaker),
        p: {
          pickups: pe.pickups,
          exp: pe.exp,
          levelUps: pe.levelUps,
          notices: pe.notices,
          failed: pe.failed,
          sales: pe.sales,
          invites: pe.invites,
        },
        vit: captureVitals(me),
        barks,
        tiles,
        objects,
      });
      pe.pickups.length = 0;
      pe.exp.length = 0;
      pe.levelUps.length = 0;
      pe.notices.length = 0;
      pe.failed = null;
      pe.sales.length = 0;
      pe.invites.length = 0;
      if (this.replications % PRIVATE_EVERY === 0) this.sendPrivate(s);
    }
    const w = sim.worldEvents;
    w.combat.length = 0;
    w.monster.length = 0;
    w.actor.length = 0;
    w.uses.length = 0;
    w.levelUps.length = 0;
    w.ai.length = 0;
    w.spoken.length = 0;
    w.news.length = 0;
    w.social.length = 0;
    this.pendingTiles = [];
    this.pendingObjects = [];
  }

  /** The client already got this chunk's changes incrementally: record its new stamp. */
  private touchKnown(s: Session, cx: number, cy: number): void {
    const index = cy * this.sim.world.widthChunks + cx;
    if (s.knownChunks.has(index)) s.knownChunks.set(index, this.sim.world.chunkStamp(cx, cy));
  }

  sendPrivate(s: Session, force = false): void {
    if (!s.slot) return;
    const full = capturePrivate(s.slot.character);
    const json = JSON.stringify(full);
    if (!force && json === s.lastPrivate) return;
    s.lastPrivate = json;
    s.transport.sendText(`{"t":"me","d":${json}}`);
  }

  /** Send authoritative data of modified chunks around each player (others they generate). */
  private syncChunks(s: Session): void {
    if (!s.slot) return;
    const world = this.sim.world;
    const m = s.slot.character.motor;
    const pcx = Math.floor(m.x / TILE_SIZE / CHUNK_SIZE);
    const pcy = Math.floor(m.y / TILE_SIZE / CHUNK_SIZE);
    for (let cy = pcy - CHUNK_RY; cy <= pcy + CHUNK_RY; cy++) {
      for (let cx = pcx - CHUNK_RX; cx <= pcx + CHUNK_RX; cx++) {
        if (!world.inChunkBounds(cx, cy)) continue;
        const index = cy * world.widthChunks + cx;
        const stamp = world.chunkStamp(cx, cy);
        if (s.knownChunks.get(index) === stamp) continue;
        const data = world.chunkData(cx, cy);
        if (data) s.sendJson({ t: 'chunk', d: data });
        s.knownChunks.set(index, stamp);
      }
    }
  }

  // --- Housekeeping: chunk sync, saving, journal ---------------------------------------------

  private housekeeping(): void {
    const tick = this.sim.tickCount;
    if (tick % 30 === 0)
      for (const s of this.sessions) if (s.state === 'playing') this.syncChunks(s);
    const now = Date.now();
    if (this.journalBuf.length > 0 && tick % 60 === 0) {
      const batch = this.journalBuf;
      this.journalBuf = [];
      this.repo
        .appendJournal(batch)
        .catch((err) => this.log.error('journal write failed', { err: String(err) }));
    }
    if (now >= this.autosaveAt) {
      this.autosaveAt = now + this.config.autosaveSeconds * 1000;
      void this.saveAll(false);
    }
    // After a trade: save the world's economy within a couple of seconds.
    if (this.worldDirtyAt !== null && now - this.worldDirtyAt > 2000) void this.saveWorld();
    if (now >= this.worldSaveAt) {
      this.worldSaveAt = now + 30_000;
      void this.saveWorld();
    }
  }

  journal(
    actor: string,
    op: string,
    detail: Record<string, string | number | boolean | null>,
  ): void {
    this.journalBuf.push({ at: Date.now(), actor, op, detail });
    this.worldDirtyAt ??= Date.now();
  }

  private saving = false;

  /** Save every online player and changed chunks. */
  async saveAll(includeWorld: boolean): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      const chunks = this.sim.world.collectDirty();
      await this.repo.saveChunks(this.config.worldId, chunks);
      for (const s of this.sessions) {
        if (s.state !== 'playing') continue;
        const save = this.sim.exportPlayer(s.key);
        if (save) await this.repo.saveCharacter(s.characterId, save);
      }
      if (includeWorld) await this.saveWorld();
    } catch (err) {
      this.log.error('autosave failed', { err: String(err) });
    } finally {
      this.saving = false;
    }
  }

  private async saveWorld(): Promise<void> {
    this.worldDirtyAt = null;
    try {
      await this.repo.saveWorldState(
        this.config.worldId,
        this.sim.exportMeta(),
        this.sim.exportAdventurers(),
        this.sim.exportSociety(),
      );
      if (this.journalBuf.length > 0) {
        const batch = this.journalBuf;
        this.journalBuf = [];
        await this.repo.appendJournal(batch);
      }
    } catch (err) {
      this.log.error('world save failed', { err: String(err) });
    }
  }

  /** Stop the loop, disconnect everyone and save the whole world. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const s of [...this.sessions]) await this.leave(s, 1001, 'server shutting down');
    await this.saveAll(true);
    for (const u of this.unsubscribe) u();
  }

  // --- Connections --------------------------------------------------------------------------

  connect(transport: Transport, ip: string): Session {
    const s = new Session(this.nextSessionId++, transport, ip);
    this.sessions.add(s);
    // A client that does not authenticate promptly is dropped.
    setTimeout(() => {
      if (s.state === 'auth') transport.close(4001, 'auth timeout');
    }, 10_000).unref?.();
    return s;
  }

  get online(): readonly Session[] {
    return [...this.sessions].filter((s) => s.state === 'playing');
  }

  sessionByKey(key: string): Session | undefined {
    return this.byKey.get(key);
  }

  sessionByName(name: string): Session | undefined {
    const n = name.toLowerCase();
    return this.online.find((s) => s.slot?.character.name.toLowerCase() === n);
  }

  async onText(s: Session, text: string): Promise<void> {
    if (s.state === 'closed') return;
    if (!s.messages.take()) {
      s.strike('rate');
      return;
    }
    let msg;
    try {
      msg = parseClientMessage(text);
    } catch (err) {
      if (err instanceof ProtocolError) s.strike(err.message);
      return;
    }
    if (s.state === 'auth') {
      if (msg.t !== 'hello') {
        s.transport.close(4001, 'expected hello');
        return;
      }
      await this.hello(s, msg.token, msg.v, msg.char);
      return;
    }
    switch (msg.t) {
      case 'ping':
        s.sendJson({ t: 'pong', n: msg.n, time: this.sim.time });
        return;
      case 'chat':
        this.chat(s, msg.ch, msg.text, msg.to);
        return;
      case 'cmd':
        this.command(s, msg.id, msg.op, msg.args);
        return;
      default:
        s.strike('unexpected message');
    }
  }

  onBinary(s: Session, data: Uint8Array): void {
    if (s.state !== 'playing') return;
    if (data.length > MAX_MESSAGE_BYTES || !s.messages.take()) {
      s.strike('rate');
      return;
    }
    try {
      if (data[0] !== BIN_INPUTS) throw new ProtocolError('unknown binary message');
      const frames: InputFrame[] = decodeInputs(data);
      s.queueInputs(frames);
    } catch (err) {
      if (err instanceof ProtocolError) s.strike(err.message);
      else throw err;
    }
  }

  async onClose(s: Session): Promise<void> {
    await this.leave(s, 1000, 'closed');
  }

  private async hello(s: Session, token: string, v: number, characterId: number): Promise<void> {
    if (v !== PROTOCOL_VERSION) {
      s.sendJson({ t: 'error', code: 'version', need: PROTOCOL_VERSION });
      s.transport.close(4003, 'protocol version');
      return;
    }
    const accountId = await this.auth.session(token);
    const account = accountId !== null ? await this.repo.accountById(accountId) : null;
    const record = account ? await this.repo.character(characterId) : null;
    if (!account || !record || record.accountId !== account.id || s.state !== 'auth') {
      s.sendJson({ t: 'error', code: 'unauthorized' });
      s.transport.close(4001, 'unauthorized');
      return;
    }
    s.accountId = account.id;
    s.characterId = record.id;
    s.admin = account.role === 'admin';
    // One connection per character: the newest wins.
    const old = this.byKey.get(s.key);
    if (old) await this.leave(old, 4004, 'logged in elsewhere');
    const slot = this.sim.addPlayer(s.key, record.name, record.save);
    slot.admin = s.admin;
    s.slot = slot;
    s.state = 'playing';
    this.byKey.set(s.key, s);
    this.looks.set(s.key, record.look);
    s.sendJson({
      t: 'welcome',
      key: s.key,
      id: slot.character.id,
      name: record.name,
      look: record.look,
      admin: s.admin,
      seed: this.sim.seed,
      worldId: this.config.worldId,
      adventurers: this.sim.adventurers.all.length,
      dayLength: this.sim.clock.dayLengthSeconds,
      hour: this.sim.clock.timeOfDay,
      day: this.sim.clock.day,
      time: this.sim.time,
      tick: this.sim.tickCount,
      explored: [...slot.explored],
    });
    this.sendPrivate(s, true);
    this.syncChunks(s);
    this.log.info('player joined', {
      key: s.key,
      name: record.name,
      ip: s.ip,
      online: this.online.length,
    });
    this.broadcastSystem('joined', { name: record.name }, s);
  }

  private async leave(s: Session, code: number, reason: string): Promise<void> {
    if (s.state === 'closed') return;
    const wasPlaying = s.state === 'playing';
    s.state = 'closed';
    this.sessions.delete(s);
    try {
      s.transport.close(code, reason);
    } catch {
      // already closed
    }
    if (!wasPlaying || this.byKey.get(s.key) !== s) return;
    this.byKey.delete(s.key);
    this.looks.delete(s.key);
    this.trades.cancelFor(s.key);
    const name = s.slot?.character.name ?? '';
    const save = this.sim.removePlayer(s.key);
    if (save) {
      try {
        await this.repo.saveCharacter(s.characterId, save);
      } catch (err) {
        this.log.error('save on leave failed', { key: s.key, err: String(err) });
      }
    }
    this.log.info('player left', { key: s.key, reason, online: this.online.length });
    this.broadcastSystem('left', { name });
  }

  // --- Commands and chat --------------------------------------------------------------------

  private command(s: Session, id: number, op: string, args: unknown): void {
    if (!s.commands.take()) {
      s.sendJson({ t: 'res', id, ok: false, error: 'rate_limited' });
      return;
    }
    const handler = COMMANDS[op];
    if (!handler) {
      s.sendJson({ t: 'res', id, ok: false, error: 'unknown_command' });
      s.strike('unknown command');
      return;
    }
    const ctx: CommandContext = {
      sim: this.sim,
      session: s,
      journal: (o, detail) => this.journal(s.key, o, detail),
      admin: {
        setTime: (h) => this.sim.clock.setTime(h),
        setMonsters: (on) => {
          this.sim.monstersEnabled = on;
          if (!on) this.sim.monsters.clear();
        },
      },
      social: this.socialOps,
    };
    try {
      const value = handler(
        ctx,
        args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
      );
      s.sendJson({ t: 'res', id, ok: true, value: value ?? null });
      // Immediate feedback for inventory-changing commands.
      this.sendPrivate(s);
    } catch (err) {
      if (err instanceof CommandError) s.sendJson({ t: 'res', id, ok: false, error: err.code });
      else {
        this.log.error('command failed', {
          op,
          key: s.key,
          err: String(err),
          stack: (err as Error).stack,
        });
        s.sendJson({ t: 'res', id, ok: false, error: 'internal' });
      }
    }
  }

  private readonly socialOps: SocialOps = {
    invite: (from, toName) => {
      const to = this.sessionByName(toName);
      if (!to || to === from) return { ok: false, reason: 'not_found' };
      const parties = this.sim.society.parties;
      const mine = parties.of(from.key);
      if (mine && mine.members.length >= 4) return { ok: false, reason: 'full' };
      if (parties.of(to.key)) return { ok: false, reason: 'busy' };
      to.playerInvites.add(from.key);
      to.sendJson({ t: 'invite', from: from.key, name: from.character.name });
      return { ok: true };
    },
    answerInvite: (s, fromKey, accept) => {
      if (!s.playerInvites.delete(fromKey)) return { ok: false, reason: 'no_invite' };
      const from = this.byKey.get(fromKey);
      if (!accept || !from) return { ok: true, joined: false };
      const parties = this.sim.society.parties;
      if (parties.of(s.key)) return { ok: false, reason: 'busy' };
      const party = parties.of(from.key) ?? parties.create(from.key, 'adventure', this.sim.time);
      if (!party || !parties.join(party.id, s.key)) return { ok: false, reason: 'full' };
      this.journal(s.key, 'party_join', { with: from.key });
      return { ok: true, joined: true };
    },
    trade: (s, op, args) => this.trades.handle(s, op, args),
  };

  private chat(s: Session, ch: ChatChannelId, raw: string, to?: string): void {
    if (!s.chat.take()) {
      s.sendJson({ t: 'chat', ch: 'system', code: 'chat_rate' });
      return;
    }
    // Strip control characters; the client renders text, never HTML.
    const text = cleanChat(raw).trim().slice(0, MAX_CHAT_LENGTH);
    if (!text || !s.slot) return;
    const name = s.slot.character.name;
    const msg = { t: 'chat', ch, from: s.key, name, text };
    const me = s.slot.character.motor;
    const society = this.sim.society;
    switch (ch) {
      case 'all':
        for (const o of this.online) o.sendJson(msg);
        break;
      case 'near':
        for (const o of this.online) {
          const m = o.slot?.character.motor;
          if (
            m &&
            Math.abs(m.x - me.x) < NEAR_CHAT_TILES * TILE_SIZE &&
            Math.abs(m.y - me.y) < NEAR_CHAT_TILES * TILE_SIZE
          )
            o.sendJson(msg);
        }
        break;
      case 'party': {
        const p = society.parties.of(s.key);
        if (!p) return s.sendJson({ t: 'chat', ch: 'system', code: 'no_party' });
        for (const k of p.members) if (isPlayerKey(k)) this.byKey.get(k)?.sendJson(msg);
        break;
      }
      case 'guild': {
        const g = society.guilds.of(s.key);
        if (!g) return s.sendJson({ t: 'chat', ch: 'system', code: 'no_guild' });
        for (const k of g.members) if (isPlayerKey(k)) this.byKey.get(k)?.sendJson(msg);
        break;
      }
      case 'whisper': {
        const target = to ? this.sessionByName(to) : undefined;
        if (!target)
          return s.sendJson({ t: 'chat', ch: 'system', code: 'no_player', name: to ?? '' });
        target.sendJson({ ...msg, to: target.slot?.character.name ?? '' });
        s.sendJson({ ...msg, to: target.slot?.character.name ?? '' });
        break;
      }
    }
  }

  private broadcastSystem(code: string, params: Record<string, string>, except?: Session): void {
    for (const o of this.online)
      if (o !== except) o.sendJson({ t: 'chat', ch: 'system', code, ...params });
  }

  /** Server status for /api/health. */
  status(): Record<string, number> {
    const ms = [...this.tickMs].sort((a, b) => a - b);
    return {
      online: this.online.length,
      tick: this.sim.tickCount,
      tickMsAvg: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0,
      tickMsP99: ms.length ? (ms[Math.floor(ms.length * 0.99)] ?? 0) : 0,
      adventurersActive: this.sim.adventurers.active.length,
      monsters: this.sim.monsters.monsters.length,
    };
  }
}
