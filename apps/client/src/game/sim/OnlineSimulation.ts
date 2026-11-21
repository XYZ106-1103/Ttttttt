import {
  type ActionIntent,
  type ActorEvent,
  type Adventurer,
  type AdventurerSave,
  type AdventurerDirector,
  applyPrivate,
  applyVitals,
  CF_ALIVE,
  CF_BLINK,
  CF_CHARGING,
  CF_DODGING,
  CF_GROUNDED,
  CF_HURT,
  type Character,
  type CharacterView as NetCharacter,
  type CombatEvent,
  CombatWorld,
  type CraftResult,
  createMonster,
  type DropEntity,
  type Economy,
  ENT_ADVENTURER,
  ENT_DROP,
  ENT_MONSTER,
  ENT_PLAYER,
  ENT_PROJECTILE,
  ENT_ZONE,
  type EntityView,
  type EquipFail,
  type EquipSlotId,
  expToNextLevel,
  findAction,
  getMonsterDef,
  getProjectileDef,
  type HeldMode,
  IDLE_ACTION,
  type InputFrame,
  type LearnFail,
  MF_ALIVE,
  MF_STUNNED,
  MF_VULNERABLE,
  type Monster,
  type MonsterEvent,
  type MonsterManager,
  type MotorInput,
  type MovementConfig,
  type NewsItem,
  Player,
  type PlayerSlot,
  type PrivateFull,
  type Projectile,
  type SaleRecord,
  type SelfState,
  type SimNotice,
  SIM_DT,
  type Snapshot,
  type Society,
  type SpokenLine,
  type StatKey,
  FREE_MOVEMENT,
  type MotorOverride,
  moveCharacter,
  resolveSkill,
  updateCombat,
  TILE_SIZE,
  type TownServices,
  type UseAction,
  type UseFailReason,
  type UseIntent,
  type UseOutcome,
  type Vitals,
  type World,
  type WorldClock,
  WorldSim,
  type Zone,
} from '@world/shared';
import type { NetClient, ServerJson, Welcome } from '../../net/NetClient';
import type { ClientSim } from './ClientSim';
import { newSimEvents, type PickupEvent, type SimEvents } from './GameSimulation';

/** Remote entities are drawn this far in the past, between two received snapshots. */
const INTERP_DELAY = 0.1;
/** Corrections larger than this snap instead of being smoothed (respawn, teleport). */
const SNAP_DISTANCE = 64;
/** Input frames per network message (every tick: the lowest input latency). */
const SEND_EVERY = 1;
/** Unacknowledged inputs kept for replay (2 s); older ones are dropped. */
const MAX_PENDING = 120;
/** How long a predicted actor event waits for the server's echo (seconds). */
const PREDICT_MEMORY = 2;

/** Identity of an actor event for matching a prediction with the server's echo. */
function actorSig(e: ActorEvent): string {
  switch (e.type) {
    case 'action':
      return `a:${e.action.id}`;
    case 'castFail':
      return `f:${e.skill}`;
    default:
      return e.type;
  }
}
/** A held-back private update is applied this long after the last command result (ms). */
const PRIVATE_SETTLE_MS = 150;

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** Recent positions of one remote entity, for interpolation at render time. */
class Track {
  private readonly samples: Sample[] = [];

  push(s: Sample): void {
    const last = this.samples.at(-1);
    if (last && s.t <= last.t) return;
    this.samples.push(s);
    if (this.samples.length > 8) this.samples.shift();
  }

  at(t: number): Sample | null {
    const list = this.samples;
    const first = list[0];
    if (!first) return null;
    if (t <= first.t) return first;
    for (let i = 1; i < list.length; i++) {
      const b = list[i] as Sample;
      if (t <= b.t) {
        const a = list[i - 1] as Sample;
        const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        return {
          t,
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          vx: a.vx + (b.vx - a.vx) * k,
          vy: a.vy + (b.vy - a.vy) * k,
        };
      }
    }
    // Past the newest sample (late snapshot): extrapolate briefly along the velocity.
    const last = list[list.length - 1] as Sample;
    const dt = Math.min(0.15, t - last.t);
    return { t, x: last.x + last.vx * dt, y: last.y + last.vy * dt, vx: last.vx, vy: last.vy };
  }
}

interface CharacterRec {
  readonly c: Character;
  readonly track: Track;
  held: string;
  look: number;
  flags: number;
  seen: number;
}

interface MonsterRec {
  readonly m: Monster;
  readonly track: Track;
  seen: number;
}

interface ThingRec<T> {
  readonly v: T;
  readonly track: Track;
  seen: number;
}

/** Wire form of world events (actions by id). */
interface WireEvents {
  readonly combat?: readonly CombatEvent[];
  readonly monster?: readonly MonsterEvent[];
  readonly actor?: readonly { id: number; event: Record<string, unknown> }[];
  readonly uses?: readonly { id: number; out: UseOutcome }[];
  readonly levelUps?: readonly { id: number; level: number }[];
  readonly spoken?: readonly SpokenLine[];
  readonly news?: readonly NewsItem[];
}

interface PlayerWireEvents {
  readonly pickups?: readonly PickupEvent[];
  readonly exp?: readonly { amount: number; x: number; y: number }[];
  readonly levelUps?: readonly number[];
  readonly notices?: readonly SimNotice[];
  readonly failed?: UseFailReason | null;
  readonly sales?: readonly SaleRecord[];
  readonly invites?: readonly { from: string; purpose: string }[];
}

export type ConnectionState = 'online' | 'reconnecting' | 'closed';

function list<T>(v: unknown): readonly T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function setMaxHp(c: { stats: { maxHp: number } }, maxHp: number): void {
  if (c.stats.maxHp !== maxHp) (c as { stats: object }).stats = { ...c.stats, maxHp };
}

/**
 * Online play: a replica of the server's world. Terrain is generated from the world seed and
 * corrected by the server's chunk and tile updates; characters, monsters, drops and projectiles
 * mirror the server's snapshots (drawn slightly in the past, interpolated); the local player's
 * movement is predicted from input immediately and reconciled with the server's state.
 * Commands go to the server, which validates and applies them; their effect is predicted on the
 * local mirror with the same shared rules so the UI responds instantly, and the server's state
 * overwrites the mirror when it arrives. The client decides nothing.
 */
export class OnlineSimulation implements ClientSim {
  readonly online = true;
  readonly core: WorldSim;
  readonly local: PlayerSlot;
  readonly selfKey: string;
  readonly events: SimEvents = newSimEvents();
  /** Messages for the UI layer (chat, invites, trades, errors). */
  readonly inbox: ServerJson[] = [];
  readonly admin: boolean;
  readonly look: number;
  connection: ConnectionState = 'online';
  closeReason = '';
  /** Bumps when the local player was moved by the server (respawn, teleport): snap the camera. */
  teleports = 0;
  /** First snapshot received (the player's real position is known). */
  ready = false;
  /** Largest prediction correction (pixels) since the last read (diagnostics, tests). */
  maxCorrection = 0;

  time: number;
  private lastSnapTime = 0;
  private lastSnapAt = 0;
  private seq = 0;
  /** Inputs the server has not acknowledged yet, with the combat override predicted for each. */
  private readonly pending: {
    readonly seq: number;
    readonly move: MotorInput;
    readonly ov: MotorOverride;
  }[] = [];
  /** Combat prediction runs against this private world, so it never touches replicated state. */
  private scratchCombat: CombatWorld | null = null;
  /** Actor events shown ahead of the server (so its echo of the same events is skipped). */
  private readonly predicted: { readonly sig: string; readonly at: number }[] = [];
  private outbox: InputFrame[] = [];
  private readonly offset = { x: 0, y: 0 };
  private readonly peerRecs = new Map<number, CharacterRec>();
  private readonly advRecs = new Map<number, CharacterRec>();
  private readonly monsterRecs = new Map<number, MonsterRec>();
  private readonly dropRecs = new Map<number, ThingRec<DropEntity>>();
  private readonly projectileRecs = new Map<number, ThingRec<Projectile>>();
  private readonly zoneRecs = new Map<number, ThingRec<Zone>>();
  private readonly dropList: DropEntity[] = [];
  private peerList: Player[] = [];
  private lastVitals: Vitals | null = null;
  private heldPrivate: PrivateFull | null = null;
  private lastResultAt = 0;
  private snapshotCount = 0;

  constructor(
    readonly net: NetClient,
    welcome: Welcome,
  ) {
    this.core = new WorldSim({
      seed: welcome.seed,
      worldId: welcome.worldId,
      startHour: welcome.hour,
      dayLengthSeconds: welcome.dayLength,
      monsters: false,
      adventurers: welcome.adventurers,
      warmUp: false,
    });
    this.core.clock.day = welcome.day;
    this.selfKey = welcome.key;
    this.admin = welcome.admin;
    this.look = welcome.look;
    this.local = this.core.addPlayer(welcome.key, welcome.name, null, welcome.id);
    this.local.admin = welcome.admin;
    for (const c of welcome.explored) this.local.explored.add(c);
    this.time = welcome.time;
    this.core.time = welcome.time;
    this.lastSnapTime = welcome.time;
    this.lastSnapAt = performance.now();
    net.attach({
      snapshot: (s) => this.onSnapshot(s),
      message: (m) => this.onMessage(m),
      reconnecting: (attempt) => {
        this.connection = 'reconnecting';
        if (attempt === 1) this.inbox.push({ t: 'net', state: 'reconnecting' });
      },
      reconnected: (w) => this.onReconnected(w),
      closed: (code, reason) => {
        this.connection = 'closed';
        this.closeReason = reason || String(code);
        this.inbox.push({ t: 'net', state: 'closed', code, reason });
      },
    });
  }

  // --- ClientSim: world access -----------------------------------------------------------

  get world(): World {
    return this.core.world;
  }
  get clock(): WorldClock {
    return this.core.clock;
  }
  get movement(): MovementConfig {
    return this.core.movement;
  }
  get worldId(): string {
    return this.core.worldId;
  }
  get combat(): CombatWorld {
    return this.core.combat;
  }
  get monsters(): MonsterManager {
    return this.core.monsters;
  }
  get adventurers(): AdventurerDirector {
    return this.core.adventurers;
  }
  get drops(): readonly DropEntity[] {
    return this.dropList;
  }
  get economy(): Economy {
    return this.core.economy;
  }
  get society(): Society {
    return this.core.society;
  }
  get tickCount(): number {
    return this.core.tickCount;
  }
  get monstersEnabled(): boolean {
    return true;
  }
  set monstersEnabled(on: boolean) {
    void this.net.command('dev', { cmd: 'monsters', on });
  }
  get player(): Player {
    return this.local.character;
  }
  get town(): TownServices {
    return this.local.town;
  }
  get explored(): Set<number> {
    return this.local.explored;
  }
  get playTime(): number {
    return this.local.playTime;
  }
  peers(): readonly Player[] {
    return this.peerList;
  }
  peerLook(key: string): number {
    for (const r of this.peerRecs.values()) if (r.c.key === key) return r.look;
    return 0;
  }
  characterByKey(key: string): Character | null {
    if (key === this.selfKey) return this.player;
    for (const r of this.peerRecs.values()) if (r.c.key === key) return r.c;
    return this.core.adventurers.byKey(key)?.character ?? null;
  }
  renderOffset(): { x: number; y: number } {
    return this.offset;
  }
  /** Round-trip time to the server (ms). */
  get rtt(): number {
    return this.net.rtt;
  }

  // --- Ticking ------------------------------------------------------------------------------

  tickAmbient(dt: number): void {
    this.advanceTime(dt);
  }

  /** One client tick: record and send the input, predict the local player, move remote things. */
  tick(
    dt: number,
    input: MotorInput,
    use: UseIntent | null = null,
    action: ActionIntent = IDLE_ACTION,
  ): void {
    this.advanceTime(dt);
    this.applyHeldPrivate();
    if (this.connection === 'online' && this.ready) {
      const frame: InputFrame = { seq: ++this.seq, move: input, use, action };
      this.outbox.push(frame);
      if (this.outbox.length >= SEND_EVERY) this.flushInputs();
      const ov = this.predictCombat(input, action, dt);
      this.pending.push({ seq: frame.seq, move: input, ov });
      if (this.pending.length > MAX_PENDING) this.pending.shift();
      this.predict(input, ov, dt);
    } else {
      const p = this.player;
      p.prevX = p.motor.x;
      p.prevY = p.motor.y;
    }
    this.interpolate();
    const k = Math.exp(-dt * 12);
    this.offset.x = Math.abs(this.offset.x * k) < 0.05 ? 0 : this.offset.x * k;
    this.offset.y = Math.abs(this.offset.y * k) < 0.05 ? 0 : this.offset.y * k;
    // Locally predicted command effects never produce events (the server's are authoritative).
    this.discardLocalEvents();
  }

  flushInputs(): void {
    if (this.outbox.length === 0) return;
    this.net.sendInputs(this.outbox);
    this.outbox = [];
  }

  /** Keep the clock on the server's time: advance locally, nudge toward the latest snapshot. */
  private advanceTime(dt: number): void {
    this.time += dt;
    const est = this.lastSnapTime + (performance.now() - this.lastSnapAt) / 1000;
    const err = est - this.time;
    if (Math.abs(err) > 1) this.time = est;
    else this.time += err * 0.1;
    this.core.time = this.time;
    this.core.clock.advance(dt);
  }

  /**
   * Attack/skill/dodge prediction: the shared combat state machine runs on the local player as
   * the server will run it, so swings, casts and dodges start the moment the key is pressed.
   * Hits and projectiles land in a scratch combat world (the server's are authoritative); the
   * actor events are shown now and the server's echo of them is skipped.
   */
  private predictCombat(move: MotorInput, action: ActionIntent, dt: number): MotorOverride {
    const c = this.player;
    if (!c.alive) return FREE_MOVEMENT;
    const scratch = (this.scratchCombat ??= new CombatWorld(this.world, 1));
    const skill = resolveSkill(c, action, this.time);
    const ov = updateCombat(c, scratch, this.world, action, skill, move.moveX, this.time, dt);
    for (const e of c.combat.events) {
      if (e.type === 'castFail') continue; // the server reports failures
      this.events.actor.push(e);
      this.predicted.push({ sig: actorSig(e), at: this.time });
    }
    c.combat.events.length = 0;
    scratch.windows.length = 0;
    scratch.projectiles.length = 0;
    scratch.zones.length = 0;
    scratch.events.length = 0;
    while (this.predicted.length > 0 && this.time - (this.predicted[0]?.at ?? 0) > PREDICT_MEMORY)
      this.predicted.shift();
    return { ...ov };
  }

  /** Did we already show this actor event of our own (predicted)? Consumes the match. */
  private wasPredicted(e: ActorEvent): boolean {
    if (e.type === 'castFail') return false;
    const sig = actorSig(e);
    const i = this.predicted.findIndex((p) => p.sig === sig);
    if (i < 0) return false;
    this.predicted.splice(0, i + 1);
    return true;
  }

  /** Movement prediction for the local player (the same motion step the server runs). */
  private predict(move: MotorInput, ov: MotorOverride, dt: number): void {
    const c = this.player;
    const m = c.motor;
    c.prevX = m.x;
    c.prevY = m.y;
    if (!c.alive) return;
    moveCharacter(c, move, ov, this.world, this.movement, this.time, dt);
  }

  /** Rewind the local player to the server's state, then replay inputs it has not applied yet. */
  private reconcile(self: SelfState, ack: number): void {
    while (this.pending.length > 0 && (this.pending[0]?.seq ?? Infinity) <= ack)
      this.pending.shift();
    const c = this.player;
    const m = c.motor;
    const beforeX = m.x;
    const beforeY = m.y;
    const prevX = c.prevX;
    const prevY = c.prevY;
    m.x = self.x;
    m.y = self.y;
    m.vx = self.vx;
    m.vy = self.vy;
    m.facing = self.facing;
    m.grounded = self.grounded;
    m.jumping = self.jumping;
    m.coyoteTimer = self.coyoteTimer;
    m.jumpBufferTimer = self.jumpBufferTimer;
    m.dropTimer = self.dropTimer;
    m.airTime = self.airTime;
    c.alive = self.alive;
    for (const f of this.pending) this.predict(f.move, f.ov, SIM_DT);
    const dx = beforeX - m.x;
    const dy = beforeY - m.y;
    if (this.ready) this.maxCorrection = Math.max(this.maxCorrection, Math.hypot(dx, dy));
    if (!this.ready || dx * dx + dy * dy > SNAP_DISTANCE * SNAP_DISTANCE) {
      this.offset.x = 0;
      this.offset.y = 0;
      c.prevX = m.x;
      c.prevY = m.y;
      if (this.ready) this.teleports++;
    } else {
      // Shift the interpolation endpoints by the correction and hide it behind a decaying offset.
      this.offset.x += dx;
      this.offset.y += dy;
      c.prevX = prevX - dx;
      c.prevY = prevY - dy;
    }
  }

  /** Place remote entities at render time (a little in the past, between snapshots). */
  private interpolate(): void {
    const rt = this.time - INTERP_DELAY;
    const place = (c: Character, track: Track) => {
      const s = track.at(rt);
      if (!s) return;
      c.prevX = c.motor.x;
      c.prevY = c.motor.y;
      c.motor.x = s.x;
      c.motor.y = s.y;
      c.motor.vx = s.vx;
      c.motor.vy = s.vy;
    };
    for (const r of this.peerRecs.values()) place(r.c, r.track);
    for (const r of this.advRecs.values()) place(r.c, r.track);
    for (const r of this.monsterRecs.values()) {
      const s = r.track.at(rt);
      if (!s) continue;
      const m = r.m;
      m.prevX = m.motor.x;
      m.prevY = m.motor.y;
      m.motor.x = s.x;
      m.motor.y = s.y;
      m.motor.vx = s.vx;
      m.motor.vy = s.vy;
    }
    for (const r of this.dropRecs.values()) {
      const s = r.track.at(rt);
      if (s) {
        r.v.x = s.x;
        r.v.y = s.y;
      }
    }
    for (const r of this.projectileRecs.values()) {
      const s = r.track.at(rt);
      if (s) {
        r.v.x = s.x;
        r.v.y = s.y;
        r.v.vx = s.vx;
        r.v.vy = s.vy;
      }
    }
  }

  private discardLocalEvents(): void {
    const w = this.core.worldEvents;
    w.combat.length = 0;
    w.monster.length = 0;
    w.actor.length = 0;
    w.uses.length = 0;
    w.levelUps.length = 0;
    w.ai.length = 0;
    w.spoken.length = 0;
    w.news.length = 0;
    w.social.length = 0;
    const p = this.local.events;
    p.pickups.length = 0;
    p.exp.length = 0;
    p.levelUps.length = 0;
    p.notices.length = 0;
    p.sales.length = 0;
    p.invites.length = 0;
    p.failed = null;
  }

  // --- Snapshots ----------------------------------------------------------------------------

  private onSnapshot(s: Snapshot): void {
    this.snapshotCount++;
    this.lastSnapTime = s.time;
    this.lastSnapAt = performance.now();
    if (!this.ready) {
      this.time = s.time;
      this.core.time = s.time;
    }
    this.core.clock.setTime(s.hour);
    this.core.clock.day = s.day;
    if (s.self) this.reconcile(s.self, s.ack);
    this.ready = true;
    const n = this.snapshotCount;
    for (const e of s.entities) this.applyEntity(e, s.time, n);
    this.prune(n);
  }

  private applyEntity(e: EntityView, t: number, n: number): void {
    switch (e.kind) {
      case ENT_PLAYER:
        this.applyPeer(e, t, n);
        break;
      case ENT_ADVENTURER:
        this.applyAdventurer(e, t, n);
        break;
      case ENT_MONSTER: {
        let r = this.monsterRecs.get(e.id);
        if (!r) {
          const def = getMonsterDef(e.def);
          if (!def) return;
          const m = createMonster(e.id, def, e.x, e.y, e.id * 7919);
          r = { m, track: new Track(), seen: n };
          this.monsterRecs.set(e.id, r);
          this.core.monsters.monsters.push(m);
        }
        const m = r.m;
        r.seen = n;
        r.track.push({ t, x: e.x, y: e.y, vx: e.vx, vy: e.vy });
        m.anim = e.anim;
        m.facing = e.facing;
        m.motor.facing = e.facing;
        m.hp = e.hp;
        setMaxHp(m, e.maxHp);
        m.alive = (e.flags & MF_ALIVE) !== 0;
        m.deadTime = e.deadTime;
        m.vulnerable = e.flags & MF_VULNERABLE ? 2 : 1;
        m.statuses.clear();
        const ids = new Set(e.statuses);
        if (e.flags & MF_STUNNED) ids.add('stun');
        for (const id of ids) m.statuses.apply(id, this.time, 0.5, {});
        break;
      }
      case ENT_DROP: {
        let r = this.dropRecs.get(e.id);
        if (!r) {
          const v: DropEntity = {
            id: e.id,
            itemId: e.item,
            count: e.count,
            x: e.x,
            y: e.y,
            vx: 0,
            vy: 0,
            age: 0,
            pickupDelay: 0,
            magnet: e.magnet,
            ownerId: null,
            ownerUntil: 0,
          };
          r = { v, track: new Track(), seen: n };
          this.dropRecs.set(e.id, r);
          this.dropList.push(v);
        }
        r.seen = n;
        r.v.count = e.count;
        r.v.magnet = e.magnet;
        r.track.push({ t, x: e.x, y: e.y, vx: 0, vy: 0 });
        break;
      }
      case ENT_PROJECTILE: {
        let r = this.projectileRecs.get(e.id);
        if (!r) {
          let def;
          try {
            def = getProjectileDef(e.def);
          } catch {
            return;
          }
          const v = {
            id: e.id,
            def,
            attack: {},
            team: 'monster',
            spec: {},
            x: e.x,
            y: e.y,
            vx: e.vx,
            vy: e.vy,
            age: 0,
            pierceLeft: 0,
            hit: new Set<number>(),
            alive: true,
          } as unknown as Projectile;
          r = { v, track: new Track(), seen: n };
          this.projectileRecs.set(e.id, r);
          this.core.combat.projectiles.push(v);
        }
        r.seen = n;
        r.track.push({ t, x: e.x, y: e.y, vx: e.vx, vy: e.vy });
        break;
      }
      case ENT_ZONE: {
        let r = this.zoneRecs.get(e.id);
        if (!r) {
          const v = {
            id: e.id,
            attack: {},
            spec: {},
            x: e.x,
            y: e.y,
            radius: e.radius,
            start: this.time,
            until: this.time + e.left,
            interval: 1,
            nextTick: Infinity,
            visual: e.tag,
          } as unknown as Zone;
          r = { v, track: new Track(), seen: n };
          this.zoneRecs.set(e.id, r);
          this.core.combat.zones.push(v);
        }
        r.seen = n;
        break;
      }
    }
  }

  /** Common character fields (other players and adventurers). */
  private applyCharacter(r: CharacterRec, e: NetCharacter, t: number, n: number): void {
    const c = r.c;
    r.seen = n;
    r.flags = e.flags;
    r.track.push({ t, x: e.x, y: e.y, vx: e.vx, vy: e.vy });
    c.motor.facing = e.facing;
    c.facing = e.facing;
    c.motor.grounded = (e.flags & CF_GROUNDED) !== 0;
    c.alive = (e.flags & CF_ALIVE) !== 0;
    c.hp = e.hp;
    setMaxHp(c, e.maxHp);
    if (c.level !== e.level) {
      c.level = e.level;
      c.progress = { ...c.progress, level: e.level };
    }
    c.jobId = e.job;
    const now = this.time;
    c.staggerUntil = e.flags & CF_HURT ? now + 0.12 : 0;
    c.combat.dodgeUntil = e.flags & CF_DODGING ? now + 0.12 : 0;
    if (e.flags & CF_CHARGING) {
      if (Number.isNaN(c.combat.chargeStart)) c.combat.chargeStart = now;
    } else c.combat.chargeStart = Number.NaN;
    if (e.flags & CF_BLINK) {
      c.invulnUntil = now + 0.15;
      c.lastHitAt = now;
    }
    if (r.held !== e.held) {
      r.held = e.held;
      c.inventory.load({ slots: e.held ? [{ itemId: e.held, count: 1 }] : [], cursor: null });
      c.selectedSlot = 0;
    }
  }

  private applyPeer(e: NetCharacter, t: number, n: number): void {
    let r = this.peerRecs.get(e.id);
    if (!r) {
      const p = new Player(e.id, e.name, e.x, e.y, this.movement, e.key);
      p.motor.x = e.x;
      p.motor.y = e.y;
      p.prevX = e.x;
      p.prevY = e.y;
      r = { c: p, track: new Track(), held: '\u0000', look: e.look, flags: 0, seen: n };
      this.peerRecs.set(e.id, r);
      this.peerList = [...this.peerList, p];
    }
    r.look = e.look;
    this.applyCharacter(r, e, t, n);
  }

  private applyAdventurer(e: NetCharacter, t: number, n: number): void {
    let r = this.advRecs.get(e.id);
    if (!r) {
      const a = this.core.adventurers.byKey(e.key);
      if (!a) return;
      const c = a.character;
      c.motor.x = e.x;
      c.motor.y = e.y;
      c.prevX = e.x;
      c.prevY = e.y;
      a.tier = 'active';
      r = { c, track: new Track(), held: '\u0000', look: 0, flags: e.flags, seen: n };
      this.advRecs.set(e.id, r);
    }
    const a = this.core.adventurers.byKey(e.key) as Adventurer;
    const wasGrounded = (r.flags & CF_GROUNDED) !== 0;
    const vyBefore = r.c.motor.vy;
    this.applyCharacter(r, e, t, n);
    const grounded = (e.flags & CF_GROUNDED) !== 0;
    if (!wasGrounded && grounded) {
      a.fx.landed = true;
      a.fx.landingSpeed = Math.max(vyBefore, 0);
    } else if (wasGrounded && !grounded && e.vy < -80) a.fx.jumped = true;
    if (grounded && Math.abs(e.vx) > 20) a.fx.stepped++;
    a.action = e.action as Adventurer['action'];
    const working = e.action === 'fight' || e.action === 'mine' || e.action === 'gather';
    a.targetTile = working
      ? { tx: Math.floor(e.aimX / TILE_SIZE), ty: Math.floor(e.aimY / TILE_SIZE) }
      : null;
  }

  /** Forget entities the latest snapshot no longer contains (out of view, despawned, gone). */
  private prune(n: number): void {
    let peersChanged = false;
    for (const [id, r] of this.peerRecs)
      if (r.seen !== n) {
        this.peerRecs.delete(id);
        peersChanged = true;
      }
    if (peersChanged) this.peerList = [...this.peerRecs.values()].map((r) => r.c as Player);
    for (const [id, r] of this.advRecs)
      if (r.seen !== n) {
        this.advRecs.delete(id);
        const a = this.core.adventurers.byCharacter(id);
        if (a) a.tier = 'abstract';
      }
    const monsters = this.core.monsters.monsters;
    for (const [id, r] of this.monsterRecs)
      if (r.seen !== n) {
        this.monsterRecs.delete(id);
        const i = monsters.indexOf(r.m);
        if (i >= 0) monsters.splice(i, 1);
      }
    for (const [id, r] of this.dropRecs)
      if (r.seen !== n) {
        this.dropRecs.delete(id);
        const i = this.dropList.indexOf(r.v);
        if (i >= 0) this.dropList.splice(i, 1);
      }
    const projectiles = this.core.combat.projectiles;
    for (const [id, r] of this.projectileRecs)
      if (r.seen !== n) {
        this.projectileRecs.delete(id);
        r.v.alive = false;
        const i = projectiles.indexOf(r.v);
        if (i >= 0) projectiles.splice(i, 1);
      }
    const zones = this.core.combat.zones;
    for (const [id, r] of this.zoneRecs)
      if (r.seen !== n) {
        this.zoneRecs.delete(id);
        const i = zones.indexOf(r.v);
        if (i >= 0) zones.splice(i, 1);
      }
  }

  // --- Messages -------------------------------------------------------------------------------

  private onMessage(m: ServerJson): void {
    switch (m.t) {
      case 'ev':
        this.onEvents(m);
        break;
      case 'me':
        this.onPrivate(m.d as PrivateFull);
        break;
      case 'soc':
        this.applySociety(m.d);
        break;
      case 'chunk':
        try {
          this.world.applyChunkData(m.d as Parameters<World['applyChunkData']>[0]);
        } catch (err) {
          console.warn('bad chunk', err);
        }
        break;
      case 'res':
        this.lastResultAt = performance.now();
        this.inbox.push(m);
        break;
      default:
        this.inbox.push(m);
    }
  }

  private onPrivate(p: PrivateFull): void {
    if (!p || typeof p !== 'object' || !p.snap) return;
    // While commands are in flight this update may predate them: hold it until they settle,
    // so predicted changes do not flicker back and forth.
    if (this.net.commandsInFlight > 0) {
      this.heldPrivate = p;
      return;
    }
    this.heldPrivate = null;
    this.applyPrivateNow(p);
  }

  private applyHeldPrivate(): void {
    if (
      this.heldPrivate &&
      this.net.commandsInFlight === 0 &&
      performance.now() - this.lastResultAt > PRIVATE_SETTLE_MS
    ) {
      const p = this.heldPrivate;
      this.heldPrivate = null;
      this.applyPrivateNow(p);
    }
  }

  private applyPrivateNow(p: PrivateFull): void {
    const c = this.player;
    try {
      applyPrivate(c, p);
      if (this.lastVitals) applyVitals(c, this.lastVitals, this.time);
    } catch (err) {
      console.warn('bad private state', err);
    }
  }

  private onEvents(m: ServerJson): void {
    const e = this.events;
    const me = this.player.id;
    const w = (m.w ?? {}) as WireEvents;
    for (const c of list<CombatEvent>(w.combat)) e.combat.push(c);
    for (const x of list<MonsterEvent>(w.monster)) {
      e.monster.push(x);
      if (x.type === 'phase') {
        const r = this.monsterRecs.get(x.id);
        if (r) r.m.brain.phase = x.phase;
      }
    }
    for (const a of list<{ id: number; event: Record<string, unknown> }>(w.actor)) {
      const ev = this.actorEvent(a.event);
      if (!ev) continue;
      if (a.id === me) {
        if (!this.wasPredicted(ev)) e.actor.push(ev);
      } else if (this.peerRecs.has(a.id)) e.peerActor.push({ id: a.id, event: ev });
      else e.aiActor.push({ id: a.id, event: ev });
    }
    for (const u of list<{ id: number; out: UseOutcome }>(w.uses)) {
      if (u.id === me) e.uses.push(u.out);
      else if (this.peerRecs.has(u.id)) e.peerUses.push(u);
      else e.aiUses.push(u);
    }
    for (const l of list<{ id: number; level: number }>(w.levelUps)) {
      if (l.id === me) continue;
      if (this.peerRecs.has(l.id)) e.peerLevelUps.push(l);
      else e.aiLevelUps.push(l);
    }
    for (const s of list<SpokenLine>(w.spoken)) e.spoken.push(s);
    for (const n of list<NewsItem>(w.news)) e.news.push(n);

    const p = (m.p ?? {}) as PlayerWireEvents;
    for (const x of list<PickupEvent>(p.pickups)) e.pickups.push(x);
    for (const x of list<{ amount: number; x: number; y: number }>(p.exp)) e.exp.push(x);
    for (const x of list<number>(p.levelUps)) e.levelUps.push(x);
    for (const x of list<SimNotice>(p.notices)) e.notices.push(x);
    for (const x of list<SaleRecord>(p.sales)) e.sales.push(x);
    for (const x of list<{ from: string; purpose: string }>(p.invites)) e.invites.push(x);
    if (p.failed) e.failed = p.failed;

    if (m.vit && typeof m.vit === 'object') {
      const v = m.vit as Vitals;
      this.lastVitals = v;
      try {
        // The predicted combat state stays ahead of the server's: keep the local charge timer
        // and never shorten a cooldown or dodge the client has already started.
        const ac = this.player.combat;
        const charge = ac.chargeStart;
        const dodgeCd = ac.dodgeCooldownUntil;
        const dodgeUntil = ac.dodgeUntil;
        const cds = new Map(ac.cooldowns);
        applyVitals(this.player, v, this.time);
        ac.chargeStart = charge;
        ac.dodgeCooldownUntil = Math.max(ac.dodgeCooldownUntil, dodgeCd);
        ac.dodgeUntil = Math.max(ac.dodgeUntil, dodgeUntil);
        for (const [id, until] of cds)
          if (until > (ac.cooldowns.get(id) ?? 0)) ac.cooldowns.set(id, until);
      } catch (err) {
        console.warn('bad vitals', err);
      }
    }
    for (const b of list<{
      id: number;
      key: string;
      params: Record<string, string | number> | null;
      talk: boolean;
      left: number;
    }>(m.barks)) {
      const a = this.core.adventurers.byCharacter(b.id);
      if (a)
        a.bark = {
          key: b.key,
          params: b.params ?? undefined,
          talk: b.talk,
          until: this.time + b.left,
        };
    }
    for (const t of list<readonly number[]>(m.tiles)) {
      const [tx, ty, layer, id] = t;
      if (tx === undefined || ty === undefined || id === undefined) continue;
      try {
        this.world.setTile(tx, ty, layer === 1 ? 'bg' : 'fg', id);
      } catch {
        // unknown tile id: the next chunk sync corrects it
      }
    }
    for (const o of list<readonly number[]>(m.objects)) {
      const [cx, cy, id] = o;
      if (cx === undefined || cy === undefined || id === undefined) continue;
      if (!this.world.inChunkBounds(cx, cy)) continue;
      const obj = this.world.objectsInChunk(cx, cy).find((x) => x.id === id);
      if (obj) this.world.removeObject(obj);
    }
  }

  /** Actor event with its action resolved from the id the server sent. */
  private actorEvent(raw: Record<string, unknown>): ActorEvent | null {
    if (!raw || typeof raw.type !== 'string') return null;
    if (raw.type !== 'action') return raw as unknown as ActorEvent;
    const action = typeof raw.action === 'string' ? findAction(raw.action) : undefined;
    return action ? ({ ...raw, action } as unknown as ActorEvent) : null;
  }

  private onReconnected(w: Welcome): void {
    this.connection = 'online';
    this.pending.length = 0;
    this.predicted.length = 0;
    this.outbox = [];
    this.ready = false;
    this.lastSnapTime = w.time;
    this.lastSnapAt = performance.now();
    for (const c of w.explored) this.local.explored.add(c);
    this.inbox.push({ t: 'net', state: 'online' });
  }

  // --- Shared state views (parties, guilds, market, adventurers) ---------------------------

  /** Send a command; resolves with the server's value, or null when it failed. */
  async query(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const r = await this.net.command(op, args);
    return r.ok ? r.value : null;
  }

  /** Parties, guilds, news and the player's own mailbox (pushed by the server on change). */
  private applySociety(raw: unknown): void {
    const d = raw as {
      society?: unknown;
      mail?: { gold?: number; items?: unknown; sales?: unknown };
    };
    if (!d || typeof d !== 'object') return;
    try {
      this.core.society.load(d.society, () => true);
      const box = this.core.economy.market.mailbox(this.selfKey);
      box.gold = Math.max(0, Number(d.mail?.gold) || 0);
      box.items = Array.isArray(d.mail?.items) ? (d.mail.items as typeof box.items) : [];
      box.sales = Array.isArray(d.mail?.sales) ? (d.mail.sales as typeof box.sales) : [];
    } catch (err) {
      console.warn('bad society view', err);
    }
  }

  /** Market listings, prices and shop stock (fetched while a trading window is open). */
  async refreshEconomy(): Promise<void> {
    const v = (await this.query('economy')) as {
      prices?: unknown;
      market?: unknown;
      shops?: Record<string, unknown>;
    } | null;
    if (!v) return;
    try {
      this.core.economy.load({ ...v, ledger: { created: 0, destroyed: 0 } });
    } catch (err) {
      console.warn('bad economy view', err);
    }
  }

  /** Every adventurer's public state and relation to this player (roster window). */
  async refreshRoster(): Promise<void> {
    const list = (await this.query('roster')) as
      | {
          key: string;
          level: number;
          job: string;
          alive: boolean;
          hp: number;
          maxHp: number;
          x: number;
          action: string;
          activity: string;
          rel: Record<string, number> | null;
        }[]
      | null;
    if (!Array.isArray(list)) return;
    for (const e of list) {
      const a = this.core.adventurers.byKey(e.key);
      if (!a) continue;
      const c = a.character;
      if (!this.advRecs.has(c.id)) {
        // Not in view: take the server's word for everything (mirrored ones come in snapshots).
        c.level = e.level;
        c.progress = { ...c.progress, level: e.level };
        c.jobId = e.job;
        c.alive = e.alive;
        c.hp = e.hp;
        setMaxHp(c, e.maxHp);
        c.motor.x = e.x;
        c.prevX = e.x;
        a.action = e.action as Adventurer['action'];
      }
      a.activity = e.activity as Adventurer['activity'];
      if (e.rel)
        a.memory.relations.set(this.selfKey, { ...e.rel } as unknown as NonNullable<
          ReturnType<typeof a.memory.relations.get>
        >);
      else a.memory.relations.delete(this.selfKey);
    }
  }

  /** One adventurer in full (inspection card): memories, goal, relations, scores. */
  async refreshAdventurer(key: string): Promise<void> {
    const v = (await this.query('adventurer', { key })) as {
      save: AdventurerSave;
      scores: Adventurer['scores'];
      listen: number;
    } | null;
    const a = this.core.adventurers.byKey(key);
    if (!v || !a) return;
    const c = a.character;
    const mirrored = this.advRecs.has(c.id);
    const keep = { x: c.motor.x, y: c.motor.y, prevX: c.prevX, prevY: c.prevY, alive: c.alive };
    try {
      a.load(v.save);
    } catch (err) {
      console.warn('bad adventurer view', err);
      return;
    }
    if (mirrored) {
      // Snapshots own position and liveness of adventurers in view.
      c.motor.x = keep.x;
      c.motor.y = keep.y;
      c.prevX = keep.prevX;
      c.prevY = keep.prevY;
      c.alive = keep.alive;
      const r = this.advRecs.get(c.id);
      if (r) r.held = c.inventory.get(c.selectedSlot)?.itemId ?? '';
    }
    a.scores = v.scores ?? {};
    a.listenUntil = this.time + (Number(v.listen) || 0);
  }

  /** Messages for the UI since the last call. */
  drainInbox(): ServerJson[] {
    return this.inbox.splice(0);
  }

  // --- Commands (validated and applied by the server; predicted locally) -------------------

  /** Send a command, predicting its effect on the local mirror with the shared rules. */
  private send<T>(op: string, args: Record<string, unknown>, predict: () => T): T {
    const out = predict();
    this.discardLocalEvents();
    void this.net.command(op, args);
    return out;
  }

  heldMode(): HeldMode {
    return this.core.heldMode(this.selfKey);
  }
  requestRespawn(): boolean {
    const p = this.player;
    if (p.alive || this.time < p.respawnAt) return false;
    void this.net.command('respawn');
    return true;
  }
  preview(tx: number, ty: number): { action: UseAction; ok: boolean; reason?: UseFailReason } {
    return this.core.preview(this.selfKey, tx, ty);
  }
  hitProgressAt(tx: number, ty: number): number {
    return this.core.hitProgressAt(this.selfKey, tx, ty);
  }
  consume(index: number): boolean {
    void this.net.command('consume', { index });
    return true;
  }
  quickUse(): boolean {
    // Quick potions travel with the input (action.quickHeal / quickMana).
    return false;
  }
  selectSlot(i: number): void {
    if (this.player.selectedSlot === i) return;
    this.send('select', { slot: i }, () => this.core.selectSlot(this.selfKey, i));
  }
  clickInventory(index: number, button: 'left' | 'right'): void {
    this.send('invClick', { index, button }, () =>
      this.core.clickInventory(this.selfKey, index, button),
    );
  }
  clickEquipment(slot: EquipSlotId): EquipFail | null {
    return this.send('equipClick', { slot }, () => this.core.clickEquipment(this.selfKey, slot));
  }
  returnCursor(): void {
    if (!this.player.inventory.cursor) return;
    this.send('returnCursor', {}, () => this.core.returnCursor(this.selfKey));
  }
  craft(recipeId: string, times = 1): CraftResult {
    return this.send('craft', { recipe: recipeId, times }, () =>
      this.core.craft(this.selfKey, recipeId, times),
    );
  }
  allocateStat(stat: StatKey, amount = 1): boolean {
    return this.send('allocate', { stat, amount }, () =>
      this.core.allocateStat(this.selfKey, stat, amount),
    );
  }
  autoAllocate(): boolean {
    return this.send('autoAllocate', {}, () => this.core.autoAllocate(this.selfKey));
  }
  learnSkill(skillId: string): LearnFail | null {
    return this.send('learn', { skill: skillId }, () =>
      this.core.learnSkill(this.selfKey, skillId),
    );
  }
  setSkillSlot(slot: number, skillId: string | null): void {
    this.send('skillSlot', { slot, skill: skillId }, () =>
      this.core.setSkillSlot(this.selfKey, slot, skillId),
    );
  }
  advanceJob(jobId: string): boolean {
    return this.send('advance', { job: jobId }, () => this.core.advanceJob(this.selfKey, jobId));
  }
  devSetLevel(level: number): void {
    void this.net.command('dev', {
      cmd: 'level',
      n: Math.max(1, Math.min(200, Math.floor(level))),
    });
  }
  devGold(amount: number): void {
    void this.net.command('dev', { cmd: 'gold', n: Math.max(1, Math.floor(amount)) });
  }
  devSpawn(monsterId: string): boolean {
    void this.net.command('dev', { cmd: 'summon', id: monsterId });
    return this.admin;
  }
  devGive(itemId: string, count: number): boolean {
    void this.net.command('dev', {
      cmd: 'give',
      id: itemId,
      n: Math.max(1, Math.min(999, Math.floor(count))),
    });
    return this.admin;
  }
  devHeal(): void {
    void this.net.command('dev', { cmd: 'heal' });
  }
  devTime(hours: number): void {
    void this.net.command('dev', { cmd: 'time', n: Math.max(0, Math.min(24, Math.floor(hours))) });
  }
  respawnPlayer(): void {
    void this.net.command('dev', { cmd: 'spawn' });
  }
  placePlayer(x: number, y: number): boolean {
    void this.net.command('dev', {
      cmd: 'tp',
      x: Math.floor(x / TILE_SIZE),
      y: Math.floor(y / TILE_SIZE),
    });
    return this.admin;
  }
  expToNext(): number {
    return expToNextLevel(this.player.progress.level);
  }

  /** Leave the world. */
  close(): void {
    this.flushInputs();
    this.net.detach();
    this.net.close();
    this.connection = 'closed';
    this.core.adventurers.dispose();
  }
}
