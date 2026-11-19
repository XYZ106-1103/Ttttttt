/**
 * Runs the adventurer population at different levels of detail (design §10):
 * - active:   near a player — full Characters in the CombatWorld, brains every tick;
 * - abstract: everyone else — no physics; a coarse activity model grants the same rewards on
 *             average (exp, loot, ore) through the same progression and crafting rules;
 * - distant:  abstract adventurers far from the player are advanced in coarser steps;
 * - offline:  on load, the abstract model catches up on the time that passed (capped).
 * Promotion/demotion keeps positions, inventories, goals and memories continuous.
 *
 * The director also runs the adventurers' social life (PHASE 5): conversations between active
 * adventurers, instant meetings off-screen, market visits, parties (shared kills, raids) and
 * guilds.
 */
import type { Character } from '../actors/Character';
import {
  type CharacterEnv,
  newStepOut,
  regenCharacter,
  stepCharacter,
  type CharacterStepOut,
} from '../actors/stepCharacter';
import type { DropEntity } from '../actors/DropSystem';
import type { CombatWorld } from '../combat/CombatWorld';
import { expForKill, mitigation } from '../combat/damage';
import { TILE_SIZE } from '../constants';
import { getMonsterDef, MONSTER_DEFS, type MonsterDef } from '../data/monsters';
import { Economy } from '../economy/Economy';
import type { MovementConfig } from '../data/movement';
import { expToNextLevel } from '../entities/stats';
import { deriveSeed, Rng } from '../math/rng';
import type { Monster } from '../monsters/Monster';
import { rollLoot } from '../monsters/spawning';
import type { InteractionContext } from '../sandbox/interaction';
import { itemRegistry } from '../sandbox/ItemRegistry';
import { Society } from '../society/Society';
import type { World } from '../world/World';
import {
  type AbstractActivity,
  Adventurer,
  type AdventurerProfile,
  type AdventurerSave,
  type Conversation,
  generateProfile,
} from './Adventurer';
import {
  type BrainEvent,
  type BrainSocial,
  housekeeping,
  huntingGround,
  needsMining,
  thinkAdventurer,
} from './brain';
import { RAID_BOSS, RAID_SUMMON } from './goals';
import { NavGrid } from './nav/NavGrid';
import { merchantScore } from './personality';
import {
  availableForTalk,
  meetInstantly,
  planConversation,
  type SocialCtx,
  type SocialEvent,
  socialHousekeeping,
} from './social';
import { tradeInTown, type TradeEvent } from './trading';

export interface DirectorConfig {
  readonly count: number;
  readonly seed: number;
  /** Tile column of the village center (spawn). */
  readonly homeCenter: number;
  readonly safeFrom: number;
  readonly safeTo: number;
  readonly maxActive?: number;
  /** Tiles from a player within which adventurers become active. */
  readonly activeRadius?: number;
  readonly demoteRadius?: number;
  /** Shared world systems (created privately when absent, e.g. in tests). */
  readonly society?: Society;
  readonly economy?: Economy;
  /** Tile column of the exchange in the village. */
  readonly marketX?: number;
  /** Market stall tile columns, one per merchant. */
  readonly stallXs?: readonly number[];
}

/** A conversation line spoken by an active adventurer (for nearby chat). */
export interface SpokenLine {
  readonly speaker: string;
  readonly line: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface ActiveStep {
  readonly adventurer: Adventurer;
  readonly out: CharacterStepOut;
}

export interface DirectorTickEnv {
  readonly interaction: InteractionContext;
  readonly monsters: readonly Monster[];
  readonly drops: readonly DropEntity[];
  readonly player: Character | null;
  readonly now: number;
  readonly dt: number;
  readonly night: boolean;
}

const RESPAWN = 8;
/** Abstract adventurers farther than this (tiles) from the player advance in coarse steps. */
const DISTANT_RADIUS = 300;
const DISTANT_STEP = 5;
const LINE_GAP = 2.8;
/** Tiles around the player that are always rendered (wider than any screen at the min zoom). */
const VISIBLE_RADIUS = 36;
const ABSTRACT_STEP = 1;
const OFFLINE_CAP = 2 * 60 * 60;
export const ADVENTURER_DEATH_PENALTY = 0.05;

export class AdventurerDirector {
  readonly all: Adventurer[] = [];
  readonly nav: NavGrid;
  readonly events: BrainEvent[] = [];
  readonly society: Society;
  readonly economy: Economy;
  /** Social outcomes for the simulation (invitations, trades...). */
  readonly socialEvents: SocialEvent[] = [];
  readonly tradeEvents: TradeEvent[] = [];
  /** Lines spoken by active adventurers since last read. */
  readonly spoken: SpokenLine[] = [];
  readonly conversations: Conversation[] = [];
  private readonly byId = new Map<number, Adventurer>();
  private readonly keyMap = new Map<string, Adventurer>();
  private readonly rng: Rng;
  private readonly socialRng: Rng;
  private tierTimer = 0;
  private abstractAcc = 0;
  private distantAcc = 0;
  private convId = 1;
  private player: Character | null = null;
  private anchorX = 0;
  private readonly maxActive: number;
  private readonly activeRadius: number;
  private readonly demoteRadius: number;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly world: World,
    private readonly combat: CombatWorld,
    movement: MovementConfig,
    readonly config: DirectorConfig,
  ) {
    this.nav = new NavGrid(world, movement);
    this.unsubscribe = world.onTileChange((ch) => this.nav.invalidate(ch.tx, ch.ty));
    this.rng = new Rng(deriveSeed(config.seed, 'director'));
    this.socialRng = new Rng(deriveSeed(config.seed, 'social'));
    this.maxActive = config.maxActive ?? 14;
    this.activeRadius = config.activeRadius ?? 56;
    this.demoteRadius = config.demoteRadius ?? 76;
    this.society = config.society ?? new Society();
    this.economy = config.economy ?? new Economy();
    const taken = new Set<string>();
    const profiles: AdventurerProfile[] = [];
    for (let i = 0; i < config.count; i++)
      profiles.push(generateProfile(config.seed, i, config.homeCenter, taken));
    // The greediest, most sociable few keep a stall in town.
    const stalls = config.stallXs ?? [];
    const merchants = [...profiles]
      .sort((x, y) => merchantScore(y.personality) - merchantScore(x.personality))
      .slice(0, Math.min(stalls.length, Math.floor(config.count / 8)));
    merchants.forEach((m, i) => {
      profiles[m.index] = { ...m, archetype: 'merchant', stallX: stalls[i] };
    });
    for (const profile of profiles) {
      const home = this.surfaceAt(profile.homeX);
      const a = new Adventurer(profile, combat.newId(), home.x, home.y, movement);
      this.all.push(a);
      this.byId.set(a.character.id, a);
      this.keyMap.set(a.key, a);
    }
  }

  get marketX(): number {
    return (this.config.marketX ?? this.config.homeCenter) * TILE_SIZE + TILE_SIZE / 2;
  }

  /** Social context for rules that need the world (conversations, guilds, trading). */
  socialCtx(now: number, night: boolean): SocialCtx {
    return {
      society: this.society,
      economy: this.economy,
      now,
      night,
      rng: this.socialRng,
      byKey: (k) => this.keyMap.get(k),
      levelOf: (k) =>
        k === 'player' ? (this.player?.level ?? 0) : (this.keyMap.get(k)?.character.level ?? 0),
      events: this.socialEvents,
    };
  }

  /** Character for a key among those present in the active world. */
  characterOf(key: string): Character | null {
    if (key === 'player') return this.player;
    const a = this.keyMap.get(key);
    return a && a.tier === 'active' ? a.character : null;
  }

  keyOfCharacter(id: number): string | null {
    if (this.player && id === this.player.id) return 'player';
    return this.byId.get(id)?.key ?? null;
  }

  /** Same character or same party (shared claims and loot). */
  readonly allied = (a: number, b: number): boolean => {
    if (a === b) return true;
    const ka = this.keyOfCharacter(a);
    const kb = this.keyOfCharacter(b);
    return ka !== null && kb !== null && this.society.parties.same(ka, kb);
  };

  dispose(): void {
    this.unsubscribe();
  }

  get active(): Adventurer[] {
    return this.all.filter((a) => a.tier === 'active');
  }

  byCharacter(id: number): Adventurer | undefined {
    return this.byId.get(id);
  }

  byKey(key: string): Adventurer | undefined {
    return this.keyMap.get(key);
  }

  private surfaceAt(tx: number): { x: number; y: number } {
    const x = Math.max(2, Math.min(this.world.widthTiles - 3, tx));
    let ty = this.world.surfaceY(x) - 1;
    const node = this.nav.groundBelow(x, ty - 6, 16);
    if (node !== null) ty = this.nav.ty(node);
    return { x: x * TILE_SIZE + TILE_SIZE / 2, y: (ty + 1) * TILE_SIZE };
  }

  // --- Level of detail ----------------------------------------------------------------------

  private promote(a: Adventurer, now: number): void {
    const c = a.character;
    const tx = Math.floor(c.motor.x / TILE_SIZE);
    const ty = Math.round(c.motor.y / TILE_SIZE) - 1;
    let spot: { x: number; y: number } | null = null;
    for (let r = 0; r <= 8 && !spot; r++) {
      for (const dx of r === 0 ? [0] : [-r, r]) {
        const node = this.nav.groundBelow(tx + dx, ty - 4, 14);
        if (node !== null) {
          spot = {
            x: this.nav.tx(node) * TILE_SIZE + TILE_SIZE / 2,
            y: (this.nav.ty(node) + 1) * TILE_SIZE,
          };
          break;
        }
      }
    }
    spot ??= this.surfaceAt(tx);
    c.motor.x = spot.x;
    c.motor.y = spot.y;
    c.motor.vx = 0;
    c.motor.vy = 0;
    c.motor.grounded = false;
    c.prevX = spot.x;
    c.prevY = spot.y;
    c.combat.reset(this.combat);
    a.tier = 'active';
    a.follower = null;
    a.thinkAt = now;
    a.houseAt = now;
    // Someone who was spending time in town keeps doing so for a while.
    if (a.activity === 'town' && c.alive)
      a.townUntil = now + 40 + a.rng.range(0, 80) * (0.5 + a.profile.personality.sociability);
    if (c.alive) this.combat.add(c);
  }

  private demote(a: Adventurer): void {
    if (a.talk) this.endConversation(a.talk, false);
    this.combat.remove(a.character.id);
    a.tier = 'abstract';
    a.follower = null;
    a.activityUntil = -Infinity;
    a.activity =
      a.action === 'fight' || a.action === 'seek'
        ? 'hunt'
        : a.action === 'mine'
          ? 'mine'
          : a.action === 'gather'
            ? 'gather'
            : a.action === 'rest'
              ? 'rest'
              : a.action === 'explore' || a.action === 'follow'
                ? 'travel'
                : 'town';
  }

  /** Re-evaluate which adventurers run in full detail around the anchor (the player). */
  updateTiers(anchorX: number, anchorY: number, now: number, force = false): void {
    this.anchorX = anchorX;
    if (!force && now < this.tierTimer) return;
    this.tierTimer = now + 0.5;
    const dist = (a: Adventurer) => ({
      dx: Math.abs(a.character.motor.x - anchorX) / TILE_SIZE,
      dy: Math.abs(a.character.motor.y - anchorY) / TILE_SIZE,
    });
    for (const a of this.all) {
      if (a.tier !== 'active') continue;
      const d = dist(a);
      if (d.dx > this.demoteRadius || d.dy > 60) this.demote(a);
    }
    const mates = new Set(this.society.parties.mates('player'));
    const candidates = this.all
      .filter((a) => a.tier === 'abstract' && a.character.alive)
      .map((a) => ({ a, d: dist(a) }))
      .filter(({ d }) => d.dx < this.activeRadius && d.dy < 40)
      // Party mates of the player first, then the nearest.
      .sort(
        (x, y) => (mates.has(y.a.key) ? 1 : 0) - (mates.has(x.a.key) ? 1 : 0) || x.d.dx - y.d.dx,
      );
    let active = this.active.length;
    for (const { a } of candidates) {
      if (active >= this.maxActive) break;
      this.promote(a, now);
      active++;
    }
    if (active > this.maxActive) {
      const far = this.active.sort((x, y) => dist(y).dx - dist(x).dx);
      for (let i = 0; i < active - this.maxActive; i++) {
        const a = far[i];
        if (a) this.demote(a);
      }
    }
    // Nobody may be simulated abstractly where the player can see them: if the active cap is
    // full, the rest walk on past the edge of view.
    for (const a of this.all) {
      if (a.tier !== 'abstract') continue;
      const d = dist(a);
      if (d.dx >= VISIBLE_RADIUS || d.dy >= 24) continue;
      const side = a.character.motor.x >= anchorX ? 1 : -1;
      const tx = Math.floor(anchorX / TILE_SIZE) + side * (VISIBLE_RADIUS + 2);
      a.character.motor.x = tx * TILE_SIZE + TILE_SIZE / 2;
      a.character.motor.y = this.world.surfaceY(tx) * TILE_SIZE;
    }
  }

  // --- Active tier --------------------------------------------------------------------------

  stepActive(
    env: DirectorTickEnv,
    charEnv: CharacterEnv,
    safe: { safeFrom: number; safeTo: number },
  ): ActiveStep[] {
    const out: ActiveStep[] = [];
    this.player = env.player;
    const ctx = this.socialCtx(env.now, env.night);
    const active = this.active;
    const social: BrainSocial = {
      ctx,
      economy: this.economy,
      peers: active,
      marketX: this.marketX,
      characterOf: (k) => this.characterOf(k),
      allied: this.allied,
      requestTalk: (a, b) => this.requestTalk(a, b, ctx),
      abortTalk: (a) => {
        if (a.talk) this.endConversation(a.talk, false);
      },
      tradeEvents: this.tradeEvents,
    };
    const brainEnv = {
      world: this.world,
      nav: this.nav,
      combat: this.combat,
      monsters: env.monsters,
      drops: env.drops,
      player: env.player,
      now: env.now,
      dt: env.dt,
      safeFrom: safe.safeFrom,
      safeTo: safe.safeTo,
      night: env.night,
      pathBudget: 1,
      events: this.events,
      social,
    };
    for (const a of active) {
      const c = a.character;
      if (c.alive && env.now >= a.socialAt) {
        a.socialAt = env.now + 15 + this.socialRng.range(0, 10);
        socialHousekeeping(a, ctx);
      }
      if (!c.alive) {
        c.prevX = c.motor.x;
        c.prevY = c.motor.y;
        if (env.now >= a.respawnAt) this.respawn(a, env.now);
        continue;
      }
      a.character.refreshStats(env.now);
      const intent = thinkAdventurer(a, brainEnv);
      const res = newStepOut();
      stepCharacter(charEnv, c, intent, res);
      const ev = c.motor.events;
      a.fx.jumped ||= ev.jumped;
      if (ev.landed) {
        a.fx.landed = true;
        a.fx.landingSpeed = Math.max(a.fx.landingSpeed, ev.landingSpeed);
      }
      a.fx.stepped += ev.stepped;
      out.push({ adventurer: a, out: res });
    }
    this.stepConversations(env.now);
    this.society.parties.expire(env.now);
    return out;
  }

  // --- Conversations ------------------------------------------------------------------------

  private requestTalk(a: Adventurer, b: Adventurer, ctx: SocialCtx): boolean {
    if (a.talk || !availableForTalk(b) || b.tier !== 'active' || a === b) return false;
    const pb = b.profile.personality;
    const rel = b.memory.relations.get(a.key)?.affinity ?? 0;
    const busy = b.action === 'mine' || b.action === 'gather' || b.action === 'trade' ? 0.6 : 1;
    const willing = (0.35 + pb.sociability * 0.5 + rel * 0.4) * busy;
    if (!this.socialRng.chance(Math.max(0.1, Math.min(0.95, willing)))) {
      b.say('busy', ctx.now, undefined, true);
      b.talkAt = ctx.now + 30;
      return false;
    }
    const lines = planConversation(a, b, ctx);
    const conv: Conversation = { id: this.convId++, a, b, lines, index: 0, nextAt: ctx.now + 0.2 };
    a.talk = conv;
    b.talk = conv;
    for (const x of [a, b]) {
      x.action = 'talk';
      x.actionSince = ctx.now;
      x.follower = null;
      x.talkTarget = null;
    }
    this.conversations.push(conv);
    return true;
  }

  private stepConversations(now: number): void {
    for (const conv of [...this.conversations]) {
      const { a, b } = conv;
      const apart =
        Math.abs(a.character.motor.x - b.character.motor.x) > 7 * TILE_SIZE ||
        Math.abs(a.character.motor.y - b.character.motor.y) > 5 * TILE_SIZE;
      if (
        !a.character.alive ||
        !b.character.alive ||
        a.tier !== 'active' ||
        b.tier !== 'active' ||
        a.talk !== conv ||
        b.talk !== conv ||
        apart
      ) {
        this.endConversation(conv, false);
        continue;
      }
      if (now < conv.nextAt) continue;
      const line = conv.lines[conv.index];
      if (!line) {
        this.endConversation(conv, true);
        continue;
      }
      const speaker = line.speaker === a.key ? a : b;
      speaker.sayLine(line.line, now, line.params);
      this.spoken.push({ speaker: speaker.key, line: line.line, params: line.params });
      line.apply?.();
      conv.index++;
      conv.nextAt = now + LINE_GAP;
    }
  }

  private endConversation(conv: Conversation, finished: boolean): void {
    const i = this.conversations.indexOf(conv);
    if (i >= 0) this.conversations.splice(i, 1);
    const now = conv.nextAt;
    for (const x of [conv.a, conv.b]) {
      if (x.talk !== conv) continue;
      x.talk = null;
      x.talkAt = now + (finished ? 60 : 20) + this.socialRng.range(0, 60);
      if (x.action === 'talk') {
        x.action = 'wander';
        x.thinkAt = 0;
      }
    }
  }

  regenActive(now: number, dt: number): void {
    for (const a of this.all) if (a.tier === 'active') regenCharacter(a.character, now, dt);
  }

  /** An adventurer's character died (active tier). */
  onDeath(a: Adventurer, now: number, killer: string | null): void {
    const c = a.character;
    a.respawnAt = now + RESPAWN;
    c.combat.reset(this.combat);
    c.loseExp(expToNextLevel(c.level) * ADVENTURER_DEATH_PENALTY);
    a.memory.add({
      t: now,
      kind: 'died',
      detail: killer ?? undefined,
      x: Math.floor(c.motor.x / TILE_SIZE),
      importance: 0.85,
    });
    a.follower = null;
    a.action = 'rest';
  }

  private respawn(a: Adventurer, now: number): void {
    const c = a.character;
    const home = this.surfaceAt(a.profile.homeX);
    c.motor.x = home.x;
    c.motor.y = home.y;
    c.motor.vx = 0;
    c.motor.vy = 0;
    c.prevX = home.x;
    c.prevY = home.y;
    c.alive = true;
    c.statuses.clear();
    c.refreshStats(now);
    c.hp = c.stats.maxHp;
    c.mp = c.stats.maxMp;
    c.invulnUntil = now + 2;
    if (a.tier === 'active' && !this.combat.combatants.has(c.id)) this.combat.add(c);
    a.say('respawn', now, undefined, true);
  }

  /** Experience and goal progress for a kill credited to an adventurer. Returns levels gained. */
  onKill(a: Adventurer, def: MonsterDef, now: number, expMul = 1): number {
    const c = a.character;
    const gained = c.gainExp(
      Math.max(1, Math.round(expForKill(def.exp, c.level, def.level) * expMul)),
    );
    if (a.goal?.kind === 'slay' && a.goal.monsterId === def.id) a.goal.progress++;
    if (gained > 0) {
      c.refreshStats(now);
      c.hp = c.stats.maxHp;
      c.mp = c.stats.maxMp;
      a.memory.add({
        t: now,
        kind: 'level_up',
        detail: String(c.level),
        importance: c.level % 5 === 0 ? 0.8 : 0.4,
      });
      a.say('levelUp', now, { level: c.level }, true);
      if (c.level % 5 === 0) {
        this.society.guilds.note(a.key, 'level', String(c.level), now, 3);
        if (c.level >= 10) this.society.news.push(now, 'level', { who: a.key, level: c.level });
      }
    } else if (a.rng.chance(0.15)) a.say('victory', now);
    if (def.boss) a.memory.add({ t: now, kind: 'slew', detail: def.id, importance: 1 });
    return gained;
  }

  /**
   * Party mates (keys) who share a kill made by `key` at pixel x: alive, and near enough
   * (active members by position, abstract members by their activity area).
   */
  partyShare(key: string, x: number): string[] {
    const party = this.society.parties.of(key);
    if (!party) return [key];
    const out: string[] = [];
    for (const k of party.members) {
      const ch = k === 'player' ? this.player : this.keyMap.get(k)?.character;
      if (!ch || !ch.alive) continue;
      if (k === key || Math.abs(ch.motor.x - x) < 40 * TILE_SIZE) out.push(k);
    }
    return out;
  }

  /** Experience multiplier per member for a kill shared by `n` party members. */
  static shareMul(n: number): number {
    return n <= 1 ? 1 : (1 + 0.2 * (n - 1)) / n;
  }

  /** A boss appeared near the player: brave adventurers rally and one asks to team up. */
  onBossSpawned(boss: Monster, now: number): void {
    const eligible = this.active
      .filter((a) => {
        const c = a.character;
        return (
          c.alive &&
          c.level >= boss.def.level - 6 &&
          a.profile.personality.courage >= 0.35 &&
          Math.abs(c.motor.x - boss.motor.x) < 50 * TILE_SIZE
        );
      })
      .sort((x, y) => y.character.level - x.character.level);
    const lead = eligible.find((a) => !this.society.parties.of(a.key));
    if (lead && this.society.parties.mates('player').length < 3) {
      lead.sayLine('p.raid.ask', now, { monster: boss.def.id });
      this.socialEvents.push({ type: 'invitePlayer', from: lead.key, purpose: 'raid' });
    }
    for (const a of eligible)
      a.memory.add({ t: now, kind: 'boss_seen', detail: boss.def.id, importance: 0.7 });
  }

  /** A boss fell: everyone who fought it remembers the others (the player included). */
  onRaidVictory(keys: readonly string[], bossId: string, now: number): void {
    for (const k of keys) {
      const a = this.keyMap.get(k);
      if (!a) continue;
      for (const other of keys) {
        if (other === k) continue;
        const r = a.memory.relation(other);
        r.raids++;
        a.memory.adjust(other, 0.2);
      }
      a.memory.add({
        t: now,
        kind: 'raid',
        detail: bossId,
        subject: keys.includes('player') ? 'player' : undefined,
        importance: 1,
      });
      if (a.goal?.kind === 'raid') a.goal.done = true;
      this.society.guilds.note(k, 'raid', bossId, now, 30);
    }
    this.society.news.push(now, 'boss_slain', { who: keys.join(','), monster: bossId });
  }

  /** The player hit a monster that was after this adventurer. */
  noteHelp(a: Adventurer, now: number): void {
    const rel = a.memory.relation('player');
    if (now - rel.lastSeen < 6 && rel.helped > 0) return;
    rel.helped++;
    rel.lastSeen = now;
    a.memory.adjust('player', 0.1 + a.profile.personality.friendliness * 0.05);
    a.memory.add({ t: now, kind: 'helped_by', subject: 'player', importance: 0.65 });
    a.say('thanks', now, undefined, true);
  }

  // --- Abstract tier ------------------------------------------------------------------------

  /** Advance off-screen adventurers (call every tick; work happens once per second). */
  stepAbstract(dt: number, now: number, night: boolean): void {
    this.abstractAcc += dt;
    this.distantAcc += dt;
    if (this.abstractAcc < ABSTRACT_STEP) return;
    const step = this.abstractAcc;
    this.abstractAcc = 0;
    const distantStep = this.distantAcc >= DISTANT_STEP ? this.distantAcc : 0;
    if (distantStep > 0) this.distantAcc = 0;
    for (const a of this.all) {
      if (a.tier !== 'abstract') continue;
      // Far from the player: coarser (cheaper) steps.
      if (Math.abs(a.character.motor.x - this.anchorX) > DISTANT_RADIUS * TILE_SIZE) {
        if (distantStep > 0) this.abstractTick(a, distantStep, now, night);
      } else this.abstractTick(a, step, now, night);
    }
    this.abstractSocial(step, now, night);
    this.society.parties.expire(now);
    this.drainSocietyChanges(now);
  }

  /** Turn party/guild changes into world news (and keep the change lists bounded). */
  drainSocietyChanges(now: number): void {
    for (const ch of this.society.parties.changes) {
      if (ch.type === 'formed' && ch.party.purpose === 'raid' && ch.party.leader !== 'player')
        this.society.news.push(now, 'party_formed', { who: ch.party.leader });
    }
    this.society.parties.changes.length = 0;
    for (const ch of this.society.guilds.changes) {
      if (ch.entry.kind === 'joined')
        this.society.news.push(now, 'guild_joined', { who: ch.entry.who, guild: ch.guild.id });
    }
    this.society.guilds.changes.length = 0;
  }

  /** Off-screen social life: people in the same place meet; conversations resolve at once. */
  private abstractSocial(dt: number, now: number, night: boolean): void {
    const ctx = this.socialCtx(now, night);
    const pool = this.all.filter((a) => a.tier === 'abstract' && a.character.alive);
    for (const a of pool) {
      if (now >= a.socialAt) {
        a.socialAt = now + 20 + this.socialRng.range(0, 10);
        socialHousekeeping(a, ctx);
      }
      if (now < a.talkAt) continue;
      const rate =
        (a.activity === 'town' ? 0.03 : 0.008) * (0.4 + a.profile.personality.sociability);
      if (!this.socialRng.chance(Math.min(0.9, rate * dt))) continue;
      const near = pool.filter(
        (b) =>
          b !== a &&
          now >= b.talkAt &&
          Math.abs(b.character.motor.x - a.character.motor.x) < 30 * TILE_SIZE &&
          now - (a.memory.relations.get(b.key)?.lastTalk ?? -1e9) > 300,
      );
      const b = near.length > 0 ? near[this.socialRng.int(0, near.length - 1)] : undefined;
      if (!b) continue;
      meetInstantly(a, b, ctx);
      a.talkAt = now + 90 + this.socialRng.range(0, 90);
      b.talkAt = now + 60 + this.socialRng.range(0, 60);
    }
  }

  /** Simulate `seconds` of time that passed while the game was closed (capped). */
  catchUp(seconds: number, now: number): void {
    const total = Math.min(OFFLINE_CAP, Math.max(0, seconds));
    const step = 10;
    for (let t = 0; t < total; t += step) {
      const at = now - total + t;
      for (const a of this.all) this.abstractTick(a, step, at, false);
      this.abstractSocial(step, at, false);
      this.economy.tick(step, at);
      this.society.parties.expire(at);
      this.drainSocietyChanges(at);
    }
    // What happened while away is in memories and the news, not in per-tick event lists.
    this.tradeEvents.length = 0;
    this.socialEvents.length = 0;
    this.spoken.length = 0;
    this.events.length = 0;
  }

  private pickActivity(a: Adventurer, night: boolean): AbstractActivity {
    const c = a.character;
    if (c.hp < c.stats.maxHp * 0.5) return 'rest';
    const party = this.society.parties.of(a.key);
    if (party && party.leader !== a.key) {
      if (party.leader === 'player') return 'travel';
      const lead = this.keyMap.get(party.leader);
      if (lead) return lead.activity === 'rest' ? 'hunt' : lead.activity;
    }
    if (
      a.goal?.kind === 'raid' &&
      party?.leader === a.key &&
      party.members.length >= 3 &&
      c.inventory.count(RAID_SUMMON) > 0 &&
      party.members.every((k) => this.keyMap.get(k)?.tier === 'abstract')
    )
      return 'raid';
    if (a.profile.archetype === 'merchant') {
      if (night) return 'town';
      const r = a.rng.next();
      return r < 0.6 ? 'town' : r < 0.8 ? 'gather' : 'hunt';
    }
    // Market visits: full bags, low on potions, or a break in town (sociable people more often).
    if (
      c.inventory.freeSlots() < 6 ||
      (c.inventory.count('healing_potion') < 3 && c.gold >= 40) ||
      a.rng.chance(0.08 + a.profile.personality.sociability * 0.2)
    )
      return 'town';
    if (night && !a.profile.nightOwl) return 'town';
    if (a.goal?.kind === 'explore') return 'travel';
    if (needsMining(a)) return 'mine';
    if (a.goal?.kind === 'item' && a.rng.chance(0.3)) return 'gather';
    return a.profile.archetype === 'artisan' && a.rng.chance(0.4) ? 'gather' : 'hunt';
  }

  private abstractTick(a: Adventurer, dt: number, now: number, night: boolean): void {
    const c = a.character;
    if (!c.alive) {
      if (now >= a.respawnAt) this.respawn(a, now);
      return;
    }
    a.abstractTimer -= dt;
    if (a.abstractTimer <= 0) {
      a.abstractTimer = 5;
      housekeeping(a, now, this.events, this.world.widthTiles);
    }
    if (now >= a.activityUntil) {
      if (a.activity === 'raid') this.abstractRaid(a, now);
      a.activity = this.pickActivity(a, night);
      a.activityUntil = now + (a.activity === 'raid' ? 120 : 60 + this.rng.range(0, 120));
    }
    // Where the activity happens.
    const safe = { safeFrom: this.config.safeFrom, safeTo: this.config.safeTo };
    let targetX = a.profile.homeX * TILE_SIZE;
    if (a.activity === 'hunt' || a.activity === 'gather' || a.activity === 'mine')
      targetX = huntingGround(a, safe);
    if (a.activity === 'travel' && a.goal?.kind === 'explore') targetX = a.goal.targetX * TILE_SIZE;
    if (a.activity === 'town') {
      targetX =
        a.profile.stallX !== undefined
          ? a.profile.stallX * TILE_SIZE
          : this.marketX + ((a.profile.index % 7) - 3) * 2 * TILE_SIZE;
    }
    // Party members stay with their leader.
    const party = this.society.parties.of(a.key);
    if (party && party.leader !== a.key) {
      const lead =
        party.leader === 'player' ? this.player : this.keyMap.get(party.leader)?.character;
      if (lead) targetX = lead.motor.x + ((a.profile.index % 3) - 1) * 2 * TILE_SIZE;
    }
    const dx = targetX - c.motor.x;
    const speed = 5 * TILE_SIZE;
    if (Math.abs(dx) > 2 * TILE_SIZE) {
      c.motor.x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      // Generator height only: off-screen travel must not force chunk generation.
      c.motor.y = this.world.surfaceY(Math.floor(c.motor.x / TILE_SIZE)) * TILE_SIZE;
      if (a.activity === 'travel' && Math.abs(dx) < 4 * TILE_SIZE && a.goal?.kind === 'explore')
        a.activityUntil = now;
      return;
    }
    switch (a.activity) {
      case 'hunt':
        // Party members are credited through the leader's kills.
        if (!party || party.leader === a.key || party.leader === 'player')
          this.abstractHunt(a, dt, now);
        break;
      case 'town':
        if (now >= a.tradeAt) {
          tradeInTown(a, this.economy, now, this.tradeEvents);
          a.tradeAt =
            now + (a.profile.archetype === 'merchant' ? 50 : 150 + this.rng.range(0, 150));
        }
        break;
      case 'mine': {
        const t = 1 - Math.exp(-dt * 0.05);
        const pick = itemRegistry.get(c.inventory.get(1)?.itemId ?? '')?.tool?.power ?? 0;
        if (this.rng.next() < t)
          c.inventory.add(pick >= 50 && this.rng.chance(0.4) ? 'iron_ore' : 'copper_ore', 1);
        if (this.rng.next() < t * 3) c.inventory.add('stone', 1);
        break;
      }
      case 'gather': {
        const t = 1 - Math.exp(-dt * 0.12);
        if (this.rng.next() < t) c.inventory.add('wood', this.rng.int(1, 3));
        if (this.rng.next() < t) c.inventory.add('fiber', 1);
        break;
      }
      case 'travel':
        a.activityUntil = now;
        break;
      default:
        break;
    }
    c.lastHitAt = Math.min(c.lastHitAt, now - 10);
    regenCharacter(c, now, dt);
  }

  private abstractHunt(a: Adventurer, dt: number, now: number): void {
    const c = a.character;
    const pool = MONSTER_DEFS.filter((m) => m.spawn && m.level <= c.level + 1);
    const def = pool.sort((x, y) => y.level - x.level)[
      Math.min(pool.length - 1, this.rng.int(0, 1))
    ];
    if (!def) return;
    const power = c.usableWeapon()?.type === 'staff' ? c.stats.magic : c.stats.attack;
    const dps = Math.max(1, power * 1.15 * mitigation(def.defense));
    const killTime = def.hp / dps + 5;
    const party = this.society.parties.of(a.key);
    const crew = party
      ? party.members
          .map((k) => this.keyMap.get(k))
          .filter((m) => !!m && m.character.alive && m.tier === 'abstract')
      : [a];
    // A party clears monsters faster; the leader's kills are shared.
    const kills = (dt / killTime) * (1 + 0.6 * (crew.length - 1));
    let whole = Math.floor(kills);
    if (this.rng.next() < kills - whole) whole++;
    const mul = AdventurerDirector.shareMul(crew.length);
    for (let i = 0; i < whole; i++) {
      for (const m of crew) if (m) this.onKill(m, def, now, mul);
      const looter = crew[this.rng.int(0, crew.length - 1)] ?? a;
      for (const l of rollLoot(def.drops, this.rng))
        looter.character.inventory.add(l.itemId, l.count);
      const gold = this.rng.int(def.gold[0], def.gold[1]);
      looter.character.gold += gold;
      this.economy.ledger.create('loot', gold);
    }
    // Damage taken while hunting (skill and defense reduce it).
    const taken =
      def.attack * mitigation(c.stats.defense) * (dt / 6) * (1.2 - a.profile.skill * 0.6);
    c.hp -= taken;
    if (c.hp <= 0) {
      c.alive = false;
      c.hp = 0;
      this.onDeath(a, now, def.id);
    }
  }

  /** Off-screen boss raid by an all-adventurer party (leader holds the summoning item). */
  private abstractRaid(leader: Adventurer, now: number): void {
    const party = this.society.parties.of(leader.key);
    const def = getMonsterDef(RAID_BOSS);
    if (!party || !def || !leader.character.inventory.remove(RAID_SUMMON, 1)) return;
    const crew = party.members
      .map((k) => this.keyMap.get(k))
      .filter((m): m is Adventurer => !!m && m.character.alive && m.tier === 'abstract');
    if (crew.length < 3) return;
    const avgLevel = crew.reduce((n, m) => n + m.character.level, 0) / crew.length;
    const avgSkill = crew.reduce((n, m) => n + m.profile.skill, 0) / crew.length;
    const chance = Math.max(
      0.08,
      Math.min(0.92, 0.2 + (avgLevel - 12) * 0.12 + (crew.length - 3) * 0.15 + avgSkill * 0.2),
    );
    if (this.rng.chance(chance)) {
      for (const m of crew) {
        this.onKill(m, def, now);
        m.character.inventory.add('corestone', 1);
        const gold = Math.round(this.rng.int(def.gold[0], def.gold[1]) / crew.length);
        m.character.gold += gold;
        this.economy.ledger.create('loot', gold);
      }
      for (const l of rollLoot(def.drops, this.rng))
        leader.character.inventory.add(l.itemId, l.count);
      this.onRaidVictoryQuiet(
        crew.map((m) => m.key),
        def.id,
        now,
      );
      this.society.news.push(now, 'raid_won', {
        who: leader.key,
        count: crew.length,
        monster: def.id,
      });
    } else {
      for (const m of crew) {
        m.character.hp = 0;
        m.character.alive = false;
        m.respawnAt = now + RESPAWN;
        m.memory.add({ t: now, kind: 'died', detail: def.id, importance: 0.85 });
      }
      this.society.news.push(now, 'raid_lost', {
        who: leader.key,
        count: crew.length,
        monster: def.id,
      });
    }
    this.society.parties.disband(party.id);
  }

  private onRaidVictoryQuiet(keys: readonly string[], bossId: string, now: number): void {
    for (const k of keys) {
      const a = this.keyMap.get(k);
      if (!a) continue;
      for (const other of keys) {
        if (other === k) continue;
        a.memory.relation(other).raids++;
        a.memory.adjust(other, 0.15);
      }
      a.memory.add({ t: now, kind: 'raid', detail: bossId, importance: 1 });
      if (a.goal?.kind === 'raid') a.goal.done = true;
      this.society.guilds.note(k, 'raid', bossId, now, 30);
    }
  }

  // --- Saving -------------------------------------------------------------------------------

  toJSON(): AdventurerSave[] {
    return this.all.map((a) => a.toJSON());
  }

  load(saves: readonly AdventurerSave[] | null | undefined): void {
    if (!Array.isArray(saves)) return;
    for (const s of saves) {
      const a = s && typeof s.key === 'string' ? this.byKey(s.key) : undefined;
      if (a) a.load(s);
    }
  }
}
