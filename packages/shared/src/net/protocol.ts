/**
 * The PROJECT WORLD network protocol (client ↔ authoritative server, WebSocket).
 *
 * - Binary frames carry the hot paths: input batches (client → server, ~30/s) and world
 *   snapshots (server → client, 20/s). First byte = message type.
 * - Text frames carry JSON for everything else (auth, commands and their results, events,
 *   chat, chunk data). Every incoming message is validated; anything malformed is rejected.
 */
import type { ActionIntent, UseIntent } from '../actors/stepCharacter';
import type { ActionDef } from '../combat/actions';
import { UNARMED_ACTION, WEAPON_PROFILES } from '../data/weapons';
import { SKILL_DEFS } from '../data/skills';
import type { MotorInput } from '../physics/CharacterMotor';
import { ProtocolError, Reader, Writer } from './codec';

export const PROTOCOL_VERSION = 1;
/** Largest message the server accepts (bytes). */
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const MAX_INPUTS_PER_BATCH = 8;
export const MAX_CHAT_LENGTH = 200;
/** Server snapshot rate (per second). */
export const SNAPSHOT_HZ = 20;
/** Interest radius (tiles): entities farther than this from a player are not sent to them. */
export const INTEREST_TILES_X = 72;
export const INTEREST_TILES_Y = 46;

export const BIN_SNAPSHOT = 1;
export const BIN_INPUTS = 2;

// --- Inputs ----------------------------------------------------------------------------------

export interface InputFrame {
  /** Client tick sequence number (acknowledged in snapshots for reconciliation). */
  readonly seq: number;
  readonly move: MotorInput;
  readonly use: UseIntent | null;
  readonly action: ActionIntent;
}

const F_JUMP_HELD = 1;
const F_JUMP_PRESSED = 2;
const F_DOWN = 4;
const F_ATTACK_PRESSED = 8;
const F_ATTACK_HELD = 16;
const F_DODGE = 32;
const F_QUICK_HEAL = 64;
const F_QUICK_MANA = 128;

export function encodeInputs(frames: readonly InputFrame[]): Uint8Array {
  const w = new Writer(16 + frames.length * 24);
  w.u8(BIN_INPUTS).u8(Math.min(MAX_INPUTS_PER_BATCH, frames.length));
  for (const f of frames.slice(0, MAX_INPUTS_PER_BATCH)) {
    let flags = 0;
    if (f.move.jumpHeld) flags |= F_JUMP_HELD;
    if (f.move.jumpPressed) flags |= F_JUMP_PRESSED;
    if (f.move.down) flags |= F_DOWN;
    if (f.action.attackPressed) flags |= F_ATTACK_PRESSED;
    if (f.action.attackHeld) flags |= F_ATTACK_HELD;
    if (f.action.dodge) flags |= F_DODGE;
    if (f.action.quickHeal) flags |= F_QUICK_HEAL;
    if (f.action.quickMana) flags |= F_QUICK_MANA;
    w.u32(f.seq)
      .i8(Math.round(Math.max(-1, Math.min(1, f.move.moveX)) * 100))
      .u8(flags)
      .i8(f.action.skillSlot ?? -1)
      .f32(f.action.aimX)
      .f32(f.action.aimY);
    if (f.use) w.u8(1).i32(f.use.tx).i32(f.use.ty);
    else w.u8(0);
  }
  return w.finish();
}

/** Decode and validate an input batch (throws ProtocolError on anything malformed). */
export function decodeInputs(buf: Uint8Array): InputFrame[] {
  const r = new Reader(buf);
  if (r.u8() !== BIN_INPUTS) throw new ProtocolError('not an input batch');
  const n = r.u8();
  if (n > MAX_INPUTS_PER_BATCH) throw new ProtocolError('too many inputs');
  const out: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    const seq = r.u32();
    const moveX = r.i8();
    if (moveX < -100 || moveX > 100) throw new ProtocolError('bad moveX');
    const flags = r.u8();
    const skill = r.i8();
    if (skill < -1 || skill > 3) throw new ProtocolError('bad skill slot');
    const aimX = r.f32();
    const aimY = r.f32();
    const hasUse = r.u8();
    if (hasUse > 1) throw new ProtocolError('bad use flag');
    const use = hasUse ? { tx: r.i32(), ty: r.i32() } : null;
    out.push({
      seq,
      move: {
        moveX: moveX / 100,
        jumpHeld: (flags & F_JUMP_HELD) !== 0,
        jumpPressed: (flags & F_JUMP_PRESSED) !== 0,
        down: (flags & F_DOWN) !== 0,
      },
      use,
      action: {
        attackPressed: (flags & F_ATTACK_PRESSED) !== 0,
        attackHeld: (flags & F_ATTACK_HELD) !== 0,
        aimX,
        aimY,
        skillSlot: skill >= 0 ? skill : null,
        dodge: (flags & F_DODGE) !== 0,
        quickHeal: (flags & F_QUICK_HEAL) !== 0,
        quickMana: (flags & F_QUICK_MANA) !== 0,
      },
    });
  }
  if (!r.done) throw new ProtocolError('trailing bytes');
  return out;
}

// --- Snapshots -------------------------------------------------------------------------------

/** The receiving player's own motor (for prediction reconciliation). */
export interface SelfState {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly grounded: boolean;
  readonly jumping: boolean;
  readonly alive: boolean;
  readonly coyoteTimer: number;
  readonly jumpBufferTimer: number;
  readonly dropTimer: number;
  readonly airTime: number;
}

export const ENT_PLAYER = 0;
export const ENT_ADVENTURER = 1;
export const ENT_MONSTER = 2;
export const ENT_DROP = 3;
export const ENT_PROJECTILE = 4;
export const ENT_ZONE = 5;

export const CF_GROUNDED = 1;
export const CF_ALIVE = 2;
export const CF_DODGING = 4;
export const CF_CHARGING = 8;
export const CF_HURT = 16;
export const CF_BLINK = 32;

export interface CharacterView {
  readonly kind: typeof ENT_PLAYER | typeof ENT_ADVENTURER;
  readonly id: number;
  readonly key: string;
  /** Display name (players) — adventurers' names come from their seeded profiles. */
  readonly name: string;
  /** Appearance seed (players). */
  readonly look: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly flags: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly level: number;
  readonly job: string;
  readonly held: string;
  /** Current brain action (adventurers; '' for players). */
  readonly action: string;
  /** Aim point while working (mining/chopping), for arm poses. */
  readonly aimX: number;
  readonly aimY: number;
}

export const MF_ALIVE = 1;
export const MF_VULNERABLE = 2;
export const MF_STUNNED = 4;

export interface MonsterView {
  readonly kind: typeof ENT_MONSTER;
  readonly id: number;
  readonly def: string;
  readonly anim: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: 1 | -1;
  readonly flags: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly deadTime: number;
  readonly statuses: readonly string[];
}

export interface DropView {
  readonly kind: typeof ENT_DROP;
  readonly id: number;
  readonly item: string;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly magnet: boolean;
}

export interface ProjectileView {
  readonly kind: typeof ENT_PROJECTILE;
  readonly id: number;
  readonly def: string;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface ZoneView {
  readonly kind: typeof ENT_ZONE;
  readonly id: number;
  readonly tag: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Seconds left. */
  readonly left: number;
}

export type EntityView = CharacterView | MonsterView | DropView | ProjectileView | ZoneView;

export interface Snapshot {
  readonly tick: number;
  readonly time: number;
  /** Last input sequence the server applied for this client. */
  readonly ack: number;
  readonly hour: number;
  readonly day: number;
  readonly self: SelfState | null;
  readonly entities: readonly EntityView[];
}

/** Per-message string table: repeated ids (item, monster, job...) are sent once. */
class Pool {
  readonly list: string[] = [];
  private readonly index = new Map<string, number>();
  id(s: string): number {
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
}

function writeSelf(w: Writer, s: SelfState): void {
  let flags = 0;
  if (s.grounded) flags |= 1;
  if (s.jumping) flags |= 2;
  if (s.alive) flags |= 4;
  if (s.facing < 0) flags |= 8;
  w.f32(s.x)
    .f32(s.y)
    .f32(s.vx)
    .f32(s.vy)
    .u8(flags)
    .f32(s.coyoteTimer)
    .f32(s.jumpBufferTimer)
    .f32(s.dropTimer)
    .f32(s.airTime);
}

function readSelf(r: Reader): SelfState {
  const x = r.f32();
  const y = r.f32();
  const vx = r.f32();
  const vy = r.f32();
  const flags = r.u8();
  return {
    x,
    y,
    vx,
    vy,
    grounded: (flags & 1) !== 0,
    jumping: (flags & 2) !== 0,
    alive: (flags & 4) !== 0,
    facing: flags & 8 ? -1 : 1,
    coyoteTimer: r.f32(),
    jumpBufferTimer: r.f32(),
    dropTimer: r.f32(),
    airTime: r.f32(),
  };
}

export function encodeSnapshot(s: Snapshot): Uint8Array {
  const pool = new Pool();
  const body = new Writer(256 + s.entities.length * 40);
  body.u16(s.entities.length);
  for (const e of s.entities) {
    body.u8(e.kind).u32(e.id);
    switch (e.kind) {
      case ENT_PLAYER:
      case ENT_ADVENTURER:
        body
          .u16(pool.id(e.key))
          .u16(pool.id(e.name))
          .u32(e.look)
          .f32(e.x)
          .f32(e.y)
          .f32(e.vx)
          .f32(e.vy)
          .i8(e.facing)
          .u8(e.flags)
          .u32(Math.max(0, Math.round(e.hp)))
          .u32(Math.max(1, Math.round(e.maxHp)))
          .u16(e.level)
          .u16(pool.id(e.job))
          .u16(pool.id(e.held))
          .u16(pool.id(e.action))
          .f32(e.aimX)
          .f32(e.aimY);
        break;
      case ENT_MONSTER:
        body
          .u16(pool.id(e.def))
          .u16(pool.id(e.anim))
          .f32(e.x)
          .f32(e.y)
          .f32(e.vx)
          .f32(e.vy)
          .i8(e.facing)
          .u8(e.flags)
          .u32(Math.max(0, Math.round(e.hp)))
          .u32(Math.max(1, Math.round(e.maxHp)))
          .f32(e.deadTime)
          .u8(Math.min(255, e.statuses.length));
        for (const st of e.statuses.slice(0, 255)) body.u16(pool.id(st));
        break;
      case ENT_DROP:
        body
          .u16(pool.id(e.item))
          .u16(Math.min(65535, e.count))
          .f32(e.x)
          .f32(e.y)
          .u8(e.magnet ? 1 : 0);
        break;
      case ENT_PROJECTILE:
        body.u16(pool.id(e.def)).f32(e.x).f32(e.y).f32(e.vx).f32(e.vy);
        break;
      case ENT_ZONE:
        body.u16(pool.id(e.tag)).f32(e.x).f32(e.y).f32(e.radius).f32(e.left);
        break;
    }
  }
  const w = new Writer(body.length + 64 + pool.list.length * 12);
  w.u8(BIN_SNAPSHOT).u32(s.tick).f64(s.time).u32(s.ack).f32(s.hour).u16(s.day);
  if (s.self) {
    w.u8(1);
    writeSelf(w, s.self);
  } else w.u8(0);
  w.u16(pool.list.length);
  for (const str of pool.list) w.str(str);
  const head = w.finish();
  const tail = body.finish();
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

export function decodeSnapshot(buf: Uint8Array): Snapshot {
  const r = new Reader(buf);
  if (r.u8() !== BIN_SNAPSHOT) throw new ProtocolError('not a snapshot');
  const tick = r.u32();
  const time = r.f64();
  const ack = r.u32();
  const hour = r.f32();
  const day = r.u16();
  const self = r.u8() ? readSelf(r) : null;
  const pool: string[] = [];
  const pn = r.u16();
  for (let i = 0; i < pn; i++) pool.push(r.str());
  const ps = (): string => {
    const i = r.u16();
    const s = pool[i];
    if (s === undefined) throw new ProtocolError('bad string index');
    return s;
  };
  const n = r.u16();
  const entities: EntityView[] = [];
  for (let i = 0; i < n; i++) {
    const kind = r.u8();
    const id = r.u32();
    switch (kind) {
      case ENT_PLAYER:
      case ENT_ADVENTURER:
        entities.push({
          kind,
          id,
          key: ps(),
          name: ps(),
          look: r.u32(),
          x: r.f32(),
          y: r.f32(),
          vx: r.f32(),
          vy: r.f32(),
          facing: r.i8() < 0 ? -1 : 1,
          flags: r.u8(),
          hp: r.u32(),
          maxHp: r.u32(),
          level: r.u16(),
          job: ps(),
          held: ps(),
          action: ps(),
          aimX: r.f32(),
          aimY: r.f32(),
        });
        break;
      case ENT_MONSTER: {
        const def = ps();
        const anim = ps();
        const x = r.f32();
        const y = r.f32();
        const vx = r.f32();
        const vy = r.f32();
        const facing = r.i8() < 0 ? -1 : 1;
        const flags = r.u8();
        const hp = r.u32();
        const maxHp = r.u32();
        const deadTime = r.f32();
        const sn = r.u8();
        const statuses: string[] = [];
        for (let k = 0; k < sn; k++) statuses.push(ps());
        entities.push({
          kind,
          id,
          def,
          anim,
          x,
          y,
          vx,
          vy,
          facing,
          flags,
          hp,
          maxHp,
          deadTime,
          statuses,
        });
        break;
      }
      case ENT_DROP:
        entities.push({
          kind,
          id,
          item: ps(),
          count: r.u16(),
          x: r.f32(),
          y: r.f32(),
          magnet: r.u8() === 1,
        });
        break;
      case ENT_PROJECTILE:
        entities.push({ kind, id, def: ps(), x: r.f32(), y: r.f32(), vx: r.f32(), vy: r.f32() });
        break;
      case ENT_ZONE:
        entities.push({
          kind,
          id,
          tag: ps(),
          x: r.f32(),
          y: r.f32(),
          radius: r.f32(),
          left: r.f32(),
        });
        break;
      default:
        throw new ProtocolError(`unknown entity kind ${kind}`);
    }
  }
  if (!r.done) throw new ProtocolError('trailing bytes');
  return { tick, time, ack, hour, day, self, entities };
}

// --- Action registry (actions are sent by id) -------------------------------------------------

let actionIndex: Map<string, ActionDef> | null = null;

function collectActions(v: unknown, out: Map<string, ActionDef>, depth: number): void {
  if (!v || typeof v !== 'object' || depth > 4) return;
  if (Array.isArray(v)) {
    for (const x of v) collectActions(x, out, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.id === 'string' && typeof o.duration === 'number' && Array.isArray(o.events)) {
    out.set(o.id, o as unknown as ActionDef);
    return;
  }
  for (const x of Object.values(o)) collectActions(x, out, depth + 1);
}

/** Look up a character action definition (weapon attacks, skills) by id. */
export function findAction(id: string): ActionDef | undefined {
  if (!actionIndex) {
    actionIndex = new Map();
    collectActions(WEAPON_PROFILES, actionIndex, 0);
    collectActions(UNARMED_ACTION, actionIndex, 0);
    for (const s of SKILL_DEFS) if (s.action) actionIndex.set(s.action.id, s.action);
  }
  return actionIndex.get(id);
}

// --- JSON messages ----------------------------------------------------------------------------

export type ChatChannelId = 'all' | 'near' | 'party' | 'guild' | 'whisper';

/** Client → server text messages. */
export type ClientMessage =
  | { readonly t: 'hello'; readonly token: string; readonly v: number; readonly char: number }
  | { readonly t: 'cmd'; readonly id: number; readonly op: string; readonly args: unknown }
  | { readonly t: 'chat'; readonly ch: ChatChannelId; readonly text: string; readonly to?: string }
  | { readonly t: 'ping'; readonly n: number };

/** Parse and shape-check a client text message (throws ProtocolError). */
export function parseClientMessage(text: string): ClientMessage {
  if (text.length > MAX_MESSAGE_BYTES) throw new ProtocolError('message too large');
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new ProtocolError('invalid json');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new ProtocolError('not an object');
  const m = o as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      if (
        typeof m.token !== 'string' ||
        m.token.length > 200 ||
        typeof m.v !== 'number' ||
        !Number.isInteger(m.char) ||
        (m.char as number) <= 0
      )
        throw new ProtocolError('bad hello');
      return { t: 'hello', token: m.token, v: m.v, char: m.char as number };
    case 'cmd':
      if (!Number.isInteger(m.id) || typeof m.op !== 'string' || m.op.length > 40)
        throw new ProtocolError('bad cmd');
      return { t: 'cmd', id: m.id as number, op: m.op, args: m.args };
    case 'chat': {
      const ch = m.ch;
      if (ch !== 'all' && ch !== 'near' && ch !== 'party' && ch !== 'guild' && ch !== 'whisper')
        throw new ProtocolError('bad channel');
      if (typeof m.text !== 'string' || m.text.length === 0 || m.text.length > MAX_CHAT_LENGTH)
        throw new ProtocolError('bad chat');
      if (m.to !== undefined && (typeof m.to !== 'string' || m.to.length > 40))
        throw new ProtocolError('bad whisper target');
      return { t: 'chat', ch, text: m.text, to: m.to as string | undefined };
    }
    case 'ping':
      if (typeof m.n !== 'number') throw new ProtocolError('bad ping');
      return { t: 'ping', n: m.n };
    default:
      throw new ProtocolError('unknown message');
  }
}
