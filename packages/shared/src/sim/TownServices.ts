import type { Adventurer } from '../ai/Adventurer';
import {
  answerGuildInvite,
  answerGuildJoin,
  answerPartyInvite,
  greetPlayer,
  type PlayerReply,
  type PlayerRequest,
  statusReply,
} from '../ai/social';
import { offersForPlayer, type Offer } from '../ai/trading';
import { TILE_SIZE } from '../constants';
import { getNpcDef, NPC_DEFS, NPC_REACH, type NpcDef } from '../data/npcs';
import type { BuyResult, Collected, ListResult } from '../economy/Market';
import type { NpcShop, ShopResult } from '../economy/NpcShop';
import { directTrade } from '../economy/trade';
import {
  ENHANCE_STONE,
  enhanceable,
  enhanceCost,
  type EnhanceResult,
  MAX_PLUS,
  rollEnhance,
} from '../sandbox/enhance';
import { itemRegistry } from '../sandbox/ItemRegistry';
import type { QuestFail } from '../quests/QuestLog';
import type { TradeFail } from '../economy/types';
import type { FoundResult } from '../society/Guild';
import { MAX_PARTY, type Party } from '../society/Party';
import type { WorldSim } from './WorldSim';

export interface NpcPlacement {
  readonly def: NpcDef;
  /** Feet position (px). */
  readonly x: number;
  readonly y: number;
}

export type ServiceFail = TradeFail | 'too_far' | 'unavailable';
export type ServiceResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ServiceFail };

const TALK_RANGE = 10;
const tooFar = { ok: false as const, reason: 'too_far' as const };
const unavailable = { ok: false as const, reason: 'unavailable' as const };

/** Where the village NPCs stand in a world. */
export function npcPlacements(sim: Pick<WorldSim, 'world'>): NpcPlacement[] {
  const sx = sim.world.generator.spawnTileX;
  return NPC_DEFS.map((def) => {
    const tx = sx + def.x;
    return { def, x: tx * TILE_SIZE + TILE_SIZE / 2, y: sim.world.surfaceY(tx) * TILE_SIZE };
  });
}

/**
 * Everything one player does with the town and its people. Each command checks the player is
 * really there (in range, alive) and then calls the validated shared economy/society rules. The
 * server runs exactly these for every request; the offline client calls them directly.
 */
export class TownServices {
  readonly npcs: readonly NpcPlacement[];
  /** Adventurers waiting for an answer to their party invitation. */
  readonly invites = new Set<string>();

  constructor(
    private readonly sim: WorldSim,
    /** The acting player's key. */
    readonly key: string,
  ) {
    this.npcs = npcPlacements(sim);
  }

  private get player() {
    const p = this.sim.playerOf(this.key);
    if (!p) throw new Error(`Player ${this.key} is not in the world`);
    return p;
  }

  private get now(): number {
    return this.sim.time;
  }

  private ctx() {
    return this.sim.adventurers.socialCtx(this.now, this.sim.clock.daylight < 0.35);
  }

  // --- NPCs ---------------------------------------------------------------------------------

  npc(id: string): NpcPlacement | undefined {
    return this.npcs.find((n) => n.def.id === id);
  }

  /** Is the player standing close enough to use this NPC? */
  near(id: string): boolean {
    const n = this.npc(id);
    const m = this.player.motor;
    return (
      !!n &&
      this.player.alive &&
      Math.abs(n.x - m.x) <= NPC_REACH * TILE_SIZE &&
      Math.abs(n.y - m.y) <= 4 * TILE_SIZE
    );
  }

  /** NPC under a world point (for clicks). */
  npcAt(x: number, y: number): NpcPlacement | null {
    for (const n of this.npcs) {
      if (Math.abs(n.x - x) <= 12 && y <= n.y + 4 && y >= n.y - 52) return n;
    }
    return null;
  }

  // --- Shop ---------------------------------------------------------------------------------

  private shopFor(npcId: string): NpcShop | null {
    const shopId = getNpcDef(npcId)?.shopId;
    return shopId ? (this.sim.economy.shop(shopId) ?? null) : null;
  }

  shopBuy(npcId: string, itemId: string, count: number): ShopResult | typeof tooFar {
    const shop = this.shopFor(npcId);
    if (!shop || !this.near(npcId)) return tooFar;
    return shop.buy(this.player, itemId, count);
  }

  shopSell(npcId: string, slot: number, count: number): ShopResult | typeof tooFar {
    const shop = this.shopFor(npcId);
    const st = this.player.inventory.get(slot);
    if (!shop || !this.near(npcId)) return tooFar;
    if (!st) return { ok: false, reason: 'no_item' };
    return shop.sell(this.player, st.itemId, count, slot);
  }

  // --- Blacksmith ---------------------------------------------------------------------------

  private smithNear(): boolean {
    return this.npcs.some((n) => n.def.role === 'smith' && this.near(n.def.id));
  }

  /** Try to enhance the equipment in an inventory slot (pays gold and stones up front). */
  enhance(slot: number): EnhanceResult {
    if (!this.smithNear()) return { ok: false, reason: 'too_far' };
    const p = this.player;
    const st = p.inventory.get(slot);
    const def = st ? itemRegistry.get(st.itemId) : undefined;
    if (!st || !def) return { ok: false, reason: 'invalid' };
    if (!enhanceable(def)) return { ok: false, reason: 'not_gear' };
    const plus = st.plus ?? 0;
    if (plus >= MAX_PLUS) return { ok: false, reason: 'max' };
    const cost = enhanceCost(def, plus);
    if (p.gold < cost.gold) return { ok: false, reason: 'no_gold' };
    if (p.inventory.count(ENHANCE_STONE) < cost.stones) return { ok: false, reason: 'no_stones' };
    p.gold -= cost.gold;
    p.inventory.remove(ENHANCE_STONE, cost.stones);
    this.sim.economy.ledger.destroy('enhance', cost.gold);
    const r = rollEnhance(plus, this.sim.enhanceRng);
    p.inventory.setPlus(slot, r.plus);
    p.refreshStats(this.now);
    this.sim.onEnhanced(this.key, st.itemId, r.plus, r.outcome);
    return { ok: true, outcome: r.outcome, itemId: st.itemId, plus: r.plus };
  }

  // --- Quests -------------------------------------------------------------------------------

  /** Is the player next to the quest giver? */
  questGiverNear(): boolean {
    return this.npcs.some((n) => n.def.role === 'quests' && this.near(n.def.id));
  }

  acceptQuest(
    id: string,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: QuestFail } {
    if (!this.questGiverNear()) return { ok: false, reason: 'too_far' };
    const fail = this.sim.acceptQuest(this.key, id);
    return fail ? { ok: false, reason: fail } : { ok: true };
  }

  turnInQuest(
    id: string,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: QuestFail } {
    if (!this.questGiverNear()) return { ok: false, reason: 'too_far' };
    const fail = this.sim.turnInQuest(this.key, id);
    return fail ? { ok: false, reason: fail } : { ok: true };
  }

  abandonQuest(id: string): boolean {
    return this.sim.abandonQuest(this.key, id);
  }

  // --- Exchange -----------------------------------------------------------------------------

  private atExchange(): boolean {
    return this.npcs.some((n) => n.def.role === 'exchange' && this.near(n.def.id));
  }

  marketList(slot: number, count: number, price: number): ListResult | typeof tooFar {
    if (!this.atExchange()) return tooFar;
    const st = this.player.inventory.get(slot);
    if (!st) return { ok: false, reason: 'no_item' };
    return this.sim.economy.market.list(this.player, st.itemId, count, price, this.now, slot);
  }

  marketBuy(listingId: number, count: number): BuyResult | typeof tooFar {
    if (!this.atExchange()) return tooFar;
    return this.sim.economy.market.buy(this.player, listingId, count, this.now);
  }

  marketCancel(listingId: number): ServiceResult {
    if (!this.atExchange()) return tooFar;
    return this.sim.economy.market.cancel(this.player, listingId);
  }

  marketCollect(): Collected | null {
    if (!this.atExchange()) return null;
    const got = this.sim.economy.market.collect(this.player);
    const slot = this.sim.slot(this.key);
    if (slot) slot.seenSales = 0;
    return got;
  }

  // --- Adventurers --------------------------------------------------------------------------

  /** An adventurer the player can talk to right now (present, alive, close). */
  talkable(key: string): Adventurer | null {
    const a = this.sim.adventurers.byKey(key);
    const m = this.player.motor;
    if (!a || a.tier !== 'active' || !a.character.alive || !this.player.alive) return null;
    const am = a.character.motor;
    if (Math.abs(am.x - m.x) > TALK_RANGE * TILE_SIZE || Math.abs(am.y - m.y) > 5 * TILE_SIZE)
      return null;
    return a;
  }

  /** Start (or keep) a conversation: the adventurer stops to listen and greets the player. */
  talk(key: string): PlayerReply | null {
    const a = this.talkable(key);
    if (!a) return null;
    a.listenUntil = this.now + 4;
    a.listenTo = this.key;
    return greetPlayer(a, this.ctx(), this.key);
  }

  /** Keep the adventurer listening while the dialogue is open. */
  keepListening(key: string): void {
    const a = this.talkable(key);
    if (a) {
      a.listenUntil = this.now + 4;
      a.listenTo = this.key;
    }
  }

  ask(key: string, req: PlayerRequest): PlayerReply | null {
    const a = this.talkable(key);
    if (!a) return null;
    a.listenUntil = this.now + 4;
    a.listenTo = this.key;
    const ctx = this.ctx();
    const society = this.sim.society;
    const me = this.key;
    switch (req) {
      case 'status':
        return statusReply(a, ctx);
      case 'party': {
        const mine = society.parties.of(me);
        if (mine && mine.members.length >= MAX_PARTY)
          return { line: 'p.party.full', accepted: false };
        if (society.parties.same(me, a.key)) return { line: 'p.party.already', accepted: false };
        const r = answerPartyInvite(a, ctx, me, this.player.level);
        if (r.accepted && !this.joinPlayerParty(a))
          return { line: 'p.party.full', accepted: false };
        return r;
      }
      case 'leave_party':
        if (!society.parties.same(me, a.key)) return null;
        society.parties.leave(a.key);
        return { line: 'p.party.leave' };
      case 'guild_invite': {
        const g = society.guilds.of(me);
        if (!g) return null;
        const r = answerGuildInvite(a, ctx, me);
        if (r.accepted && society.guilds.join(g.id, a.key, this.now) === null) {
          a.memory.add({
            t: this.now,
            kind: 'guild',
            detail: g.id,
            subject: me,
            importance: 0.85,
          });
          a.memory.adjust(me, 0.08);
          return r;
        }
        return r.accepted ? { line: 'p.guild.decline', accepted: false } : r;
      }
      case 'guild_join': {
        if (society.guilds.of(me)) return null;
        const r = answerGuildJoin(a, ctx, me);
        const g = society.guilds.of(a.key);
        if (r.accepted && g && society.guilds.join(g.id, me, this.now) === null) return r;
        return r.accepted ? { line: 'p.guildjoin.decline', accepted: false } : r;
      }
      case 'bye':
        a.listenUntil = this.now;
        return { line: 'p.bye' };
    }
  }

  /** `a` joins the player's party (creating one led by the player if needed). */
  private joinPlayerParty(a: Adventurer): boolean {
    const parties = this.sim.society.parties;
    const party = parties.of(this.key) ?? parties.create(this.key, 'adventure', this.now);
    if (!party || !parties.join(party.id, a.key)) return false;
    const rel = a.memory.relation(this.key);
    rel.parties++;
    a.memory.adjust(this.key, 0.05);
    a.memory.add({ t: this.now, kind: 'party', subject: this.key, importance: 0.6 });
    // Companions travel with the player for a while, longer if they like them.
    a.partyUntil = this.now + (12 + Math.max(0, rel.affinity) * 40) * 60;
    return true;
  }

  get party(): Party | null {
    return this.sim.society.parties.of(this.key);
  }

  /** Accept an adventurer's invitation to team up (e.g. when a boss appears). */
  acceptInvite(from: string): boolean {
    if (!this.invites.has(from)) return false;
    this.invites.delete(from);
    const a = this.sim.adventurers.byKey(from);
    if (!a || !a.character.alive) return false;
    return this.joinPlayerParty(a);
  }

  declineInvite(from: string): void {
    this.invites.delete(from);
    this.sim.adventurers.byKey(from)?.memory.adjust(this.key, -0.02);
  }

  leaveParty(): void {
    this.sim.society.parties.leave(this.key);
  }

  /** Party leader removes a member. */
  kick(key: string): boolean {
    const p = this.party;
    if (!p || p.leader !== this.key || !p.members.includes(key) || key === this.key) return false;
    this.sim.society.parties.leave(key);
    this.sim.adventurers.byKey(key)?.memory.adjust(this.key, -0.08);
    return true;
  }

  // --- Face-to-face trade -------------------------------------------------------------------

  offers(key: string): { sells: Offer[]; buys: Offer[] } | null {
    const a = this.talkable(key);
    if (!a) return null;
    return offersForPlayer(a, this.sim.economy, a.memory.relation(this.key).affinity);
  }

  buyFrom(key: string, itemId: string, count: number): ServiceResult {
    const a = this.talkable(key);
    const offer = this.offers(key)?.sells.find((o) => o.itemId === itemId);
    if (!a) return tooFar;
    if (!offer || count > offer.count) return unavailable;
    const r = directTrade(a.character, this.player, itemId, count, offer.price);
    if (r.ok) this.noteTrade(a, itemId);
    return r;
  }

  sellTo(key: string, itemId: string, count: number): ServiceResult {
    const a = this.talkable(key);
    const offer = this.offers(key)?.buys.find((o) => o.itemId === itemId);
    if (!a) return tooFar;
    if (!offer || count > offer.count) return unavailable;
    const r = directTrade(this.player, a.character, itemId, count, offer.price);
    if (r.ok) this.noteTrade(a, itemId);
    return r;
  }

  private noteTrade(a: Adventurer, itemId: string): void {
    a.listenUntil = this.now + 4;
    a.memory.relation(this.key).trades++;
    a.memory.adjust(this.key, 0.03);
    a.memory.add({
      t: this.now,
      kind: 'traded',
      subject: this.key,
      detail: itemId,
      importance: 0.35,
    });
  }

  // --- Guilds -------------------------------------------------------------------------------

  foundGuild(): FoundResult | typeof tooFar {
    const registrar = this.npcs.find((n) => n.def.role === 'guild');
    if (!registrar || !this.near(registrar.def.id)) return tooFar;
    const r = this.sim.society.guilds.found(
      this.player,
      this.sim.adventurers.socialCtx(this.now, false).rng,
      this.now,
      this.sim.economy.ledger,
    );
    if (r.ok)
      this.sim.society.news.push(this.now, 'guild_founded', { who: this.key, guild: r.guild.id });
    return r;
  }

  leaveGuild(): void {
    this.sim.society.guilds.leave(this.key, this.now);
  }
}
