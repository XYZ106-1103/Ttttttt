/**
 * Adventurer social life — conversations, relationships, parties and guilds — as in-house rules
 * (no LLM): a conversation is planned from both sides' relationship, personalities, memories,
 * goals and inventories, then played out line by line. Outcomes (trades, party and guild
 * invitations) go through the same validated systems the player uses.
 *
 * The client turns line ids into text (`talk.<tone>.<line>` / `talk.<register>.<line>`), so all
 * wording lives in the localization files.
 */
import { MONSTER_DEFS } from '../data/monsters';
import type { Economy } from '../economy/Economy';
import { directTrade } from '../economy/trade';
import type { Rng } from '../math/rng';
import { itemRegistry } from '../sandbox/ItemRegistry';
import { GUILD_FOUND_COST, GUILD_FOUND_LEVEL } from '../society/Guild';
import { MAX_PARTY, type PartyPurpose } from '../society/Party';
import {
  compatibility,
  FRIEND_AFFINITY,
  type RelationLabel,
  relationLabel,
  RIVAL_AFFINITY,
} from '../society/relations';
import type { Society } from '../society/Society';
import type { Adventurer, ConvLine } from './Adventurer';
import { RAID_LEVEL } from './goals';
import { Memory, type MemoryEvent } from './memory';
import { budget, goldReserve, surplusOf, wantsOf } from './trading';

export interface SocialCtx {
  readonly society: Society;
  readonly economy: Economy;
  readonly now: number;
  readonly night: boolean;
  readonly rng: Rng;
  byKey(key: string): Adventurer | undefined;
  /** Level of any character by key (player included), 0 if unknown. */
  levelOf(key: string): number;
  readonly events: SocialEvent[];
}

export type SocialEvent =
  | {
      readonly type: 'trade';
      readonly seller: string;
      readonly buyer: string;
      readonly itemId: string;
      readonly count: number;
      readonly price: number;
    }
  | { readonly type: 'party'; readonly leader: string; readonly member: string }
  | { readonly type: 'guild'; readonly guild: string; readonly member: string }
  | { readonly type: 'invitePlayer'; readonly from: string; readonly purpose: PartyPurpose };

type Group = 'stranger' | 'known' | 'friend' | 'rival';

function group(label: RelationLabel): Group {
  switch (label) {
    case 'stranger':
      return 'stranger';
    case 'friend':
    case 'close_friend':
      return 'friend';
    case 'rival':
    case 'enemy':
      return 'rival';
    default:
      return 'known';
  }
}

const SHAREABLE: ReadonlySet<string> = new Set([
  'level_up',
  'job',
  'died',
  'crafted',
  'raid',
  'slew',
]);

function newsWorthy(a: Adventurer, now: number): MemoryEvent | null {
  let best: MemoryEvent | null = null;
  let bs = 0;
  for (const e of a.memory.events) {
    if (!SHAREABLE.has(e.kind) || now - e.t > 15 * 60 || a.toldNews.has(e.t)) continue;
    if (e.kind === 'crafted' && itemRegistry.get(e.detail ?? '')?.rarity === 'common') continue;
    const s = Memory.salience(e, now);
    if (s > bs) {
      bs = s;
      best = e;
    }
  }
  return best;
}

/** How keen the adventurer is on forming a party right now (0..1+). */
export function partyDesire(a: Adventurer): number {
  const p = a.profile.personality;
  let d = p.sociability * 0.5 + p.friendliness * 0.2;
  if (a.goal?.kind === 'raid') d += 0.6;
  if (a.goal?.kind === 'level' || a.goal?.kind === 'slay') d += 0.1;
  if (a.profile.archetype === 'merchant') d -= 0.6;
  if (a.character.level < 3) d -= 0.2;
  return d;
}

function partyPurposeOf(a: Adventurer): PartyPurpose {
  return a.goal?.kind === 'raid' ? 'raid' : a.goal?.kind === 'explore' ? 'explore' : 'hunt';
}

/** Would `b` join a party `a` is forming? */
function acceptsParty(b: Adventurer, a: Adventurer, ctx: SocialCtx): boolean {
  if (ctx.society.parties.of(b.key)) return false;
  if (b.profile.archetype === 'merchant' && b.goal?.kind !== 'raid') return false;
  if (Math.abs(b.character.level - a.character.level) > 6) return false;
  const rel = b.memory.relations.get(a.key)?.affinity ?? 0;
  if (rel <= RIVAL_AFFINITY) return false;
  const guildmates = ctx.society.guilds.same(a.key, b.key) ? 0.25 : 0;
  const raid = a.goal?.kind === 'raid' && b.character.level >= RAID_LEVEL - 2 ? 0.25 : 0;
  return partyDesire(b) + rel * 0.6 + guildmates + raid + ctx.rng.range(-0.15, 0.15) > 0.6;
}

function acceptsGuild(b: Adventurer, inviter: Adventurer, ctx: SocialCtx): boolean {
  if (ctx.society.guilds.of(b.key)) return false;
  const rel = b.memory.relations.get(inviter.key)?.affinity ?? 0;
  const p = b.profile.personality;
  return (
    rel >= 0.08 &&
    rel * 1.2 + p.sociability * 0.4 + p.friendliness * 0.2 + ctx.rng.range(-0.1, 0.1) > 0.45
  );
}

// --- Conversation planning -----------------------------------------------------------------------

interface Topic {
  readonly weight: number;
  build(): ConvLine[];
}

function newsTopic(a: Adventurer, b: Adventurer, ctx: SocialCtx): Topic | null {
  const e = newsWorthy(a, ctx.now);
  if (!e) return null;
  const pb = b.profile.personality;
  const rb = b.memory.relations.get(a.key)?.affinity ?? 0;
  return {
    weight: 1.1,
    build: () => {
      const lines: ConvLine[] = [];
      const params: Record<string, string | number> = { other: b.key };
      let line: string;
      switch (e.kind) {
        case 'level_up':
          line = 'news.level';
          params.level = Number(e.detail) || a.character.level;
          break;
        case 'job':
          line = 'news.job';
          params.job = e.detail ?? a.character.jobId;
          break;
        case 'died':
          line = 'news.died';
          params.monster = e.detail ?? 'dew_slime';
          break;
        case 'crafted':
          line = 'news.crafted';
          params.item = e.detail ?? '';
          break;
        case 'raid':
          line = 'news.raid';
          params.monster = e.detail ?? 'corestone_golem';
          break;
        default:
          line = 'news.slew';
          params.monster = e.detail ?? 'corestone_golem';
      }
      a.toldNews.add(e.t);
      lines.push({ speaker: a.key, line, params });
      let react: string;
      let delta: number;
      if (e.kind === 'died') {
        const kind = rb <= RIVAL_AFFINITY || pb.friendliness < 0.3;
        react = kind ? 'react.mock' : 'react.comfort';
        delta = kind ? -0.05 : 0.06;
      } else if (e.kind === 'crafted') {
        react = 'react.praise';
        delta = 0.04;
      } else {
        const envy = pb.competitiveness > 0.62 && rb < FRIEND_AFFINITY;
        react = envy ? 'react.envy' : 'react.congrats';
        delta = envy ? -0.01 : 0.05;
      }
      lines.push({
        speaker: b.key,
        line: react,
        params: { other: a.key },
        apply: () => {
          a.memory.adjust(b.key, delta);
          b.memory.adjust(a.key, delta * 0.6);
        },
      });
      return lines;
    },
  };
}

function tradeTopic(seller: Adventurer, buyer: Adventurer, ctx: SocialCtx): Topic | null {
  if (seller.profile.personality.greed < 0.25 && seller.profile.archetype !== 'merchant')
    return null;
  const wants = wantsOf(buyer, ctx.economy);
  const surplus = surplusOf(seller);
  const rel = seller.memory.relations.get(buyer.key)?.affinity ?? 0;
  for (const w of wants) {
    const s = surplus.find((x) => x.itemId === w.itemId);
    if (!s) continue;
    const ref = ctx.economy.prices.ref(w.itemId);
    const price = Math.max(
      1,
      Math.round(ref * (0.95 + seller.profile.personality.greed * 0.2 - rel * 0.1)),
    );
    const count = Math.min(s.count, w.count, Math.floor(budget(buyer) / price));
    if (count <= 0) continue;
    const accept =
      price <= w.price && (buyer.memory.relations.get(seller.key)?.affinity ?? 0) > -0.3;
    return {
      weight: 1.3,
      build: (): ConvLine[] => [
        {
          speaker: seller.key,
          line: 'trade.offer',
          params: { other: buyer.key, item: w.itemId, count, price },
        },
        accept
          ? {
              speaker: buyer.key,
              line: 'trade.accept',
              params: { other: seller.key },
              apply: () => {
                const r = directTrade(seller.character, buyer.character, w.itemId, count, price);
                if (!r.ok) return;
                for (const [x, y] of [
                  [seller, buyer],
                  [buyer, seller],
                ] as const) {
                  const rr = x.memory.relation(y.key);
                  rr.trades++;
                  x.memory.adjust(y.key, 0.04);
                  x.memory.add({
                    t: ctx.now,
                    kind: 'traded',
                    subject: y.key,
                    detail: w.itemId,
                    importance: 0.35,
                  });
                }
                ctx.events.push({
                  type: 'trade',
                  seller: seller.key,
                  buyer: buyer.key,
                  itemId: w.itemId,
                  count,
                  price,
                });
              },
            }
          : { speaker: buyer.key, line: 'trade.decline', params: { other: seller.key } },
      ],
    };
  }
  return null;
}

function partyTopic(a: Adventurer, b: Adventurer, ctx: SocialCtx): Topic | null {
  const parties = ctx.society.parties;
  const pa = parties.of(a.key);
  if (parties.of(b.key)) return null;
  if (pa && (pa.leader !== a.key || pa.members.length >= MAX_PARTY)) return null;
  if (!pa && partyDesire(a) < 0.55) return null;
  const accept = acceptsParty(b, a, ctx);
  return {
    weight: 1 + (a.goal?.kind === 'raid' ? 1 : 0),
    build: (): ConvLine[] => [
      {
        speaker: a.key,
        line: a.goal?.kind === 'raid' ? 'party.raid' : 'party.invite',
        params: { other: b.key, monster: 'corestone_golem' },
      },
      accept
        ? {
            speaker: b.key,
            line: 'party.accept',
            params: { other: a.key },
            apply: () => formParty(a, b, ctx),
          }
        : { speaker: b.key, line: 'party.decline', params: { other: a.key } },
    ],
  };
}

/** `b` joins `a`'s party (created if needed). */
export function formParty(a: Adventurer, b: Adventurer, ctx: SocialCtx): boolean {
  const parties = ctx.society.parties;
  if (parties.of(b.key)) return false;
  let party = parties.of(a.key);
  if (!party) {
    party = parties.create(a.key, partyPurposeOf(a), ctx.now, 900 + ctx.rng.range(0, 600));
    if (!party) return false;
  }
  if (!parties.join(party.id, b.key)) return false;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    x.memory.relation(y.key).parties++;
    x.memory.adjust(y.key, 0.05);
    x.memory.add({ t: ctx.now, kind: 'party', subject: y.key, importance: 0.45 });
  }
  ctx.events.push({ type: 'party', leader: party.leader, member: b.key });
  return true;
}

function guildTopic(a: Adventurer, b: Adventurer, ctx: SocialCtx): Topic | null {
  const guilds = ctx.society.guilds;
  const g = guilds.of(a.key);
  if (!g || guilds.of(b.key)) return null;
  const ra = a.memory.relations.get(b.key)?.affinity ?? 0;
  const keen = g.leader === a.key ? 0.1 : 0.2;
  if (ra < keen || (g.leader !== a.key && a.profile.personality.sociability < 0.5)) return null;
  const accept = acceptsGuild(b, a, ctx);
  return {
    weight: 1.2,
    build: (): ConvLine[] => [
      { speaker: a.key, line: 'guild.invite', params: { other: b.key, guild: g.id } },
      accept
        ? {
            speaker: b.key,
            line: 'guild.accept',
            params: { other: a.key, guild: g.id },
            apply: () => {
              if (guilds.join(g.id, b.key, ctx.now) !== null) return;
              b.memory.add({ t: ctx.now, kind: 'guild', detail: g.id, importance: 0.85 });
              b.memory.adjust(a.key, 0.08);
              a.memory.adjust(b.key, 0.05);
              ctx.events.push({ type: 'guild', guild: g.id, member: b.key });
            },
          }
        : { speaker: b.key, line: 'guild.decline', params: { other: a.key, guild: g.id } },
    ],
  };
}

function gossipTopic(a: Adventurer, b: Adventurer, ctx: SocialCtx): Topic | null {
  // Someone a has a strong opinion about (the player included).
  let who: string | null = null;
  let aff = 0;
  for (const [k, r] of a.memory.relations) {
    if (k === b.key || Math.abs(r.affinity) < 0.35) continue;
    if (Math.abs(r.affinity) > Math.abs(aff)) {
      who = k;
      aff = r.affinity;
    }
  }
  if (!who) {
    // A strong adventurer everyone talks about.
    const top = [...a.memory.relations.keys()]
      .filter((k) => k !== b.key && ctx.levelOf(k) >= a.character.level + 3)
      .sort((x, y) => ctx.levelOf(y) - ctx.levelOf(x))[0];
    if (!top) return null;
    const pb = b.profile.personality;
    return {
      weight: 0.6,
      build: (): ConvLine[] => [
        {
          speaker: a.key,
          line: 'gossip.strong',
          params: { other: b.key, who: top, level: ctx.levelOf(top) },
        },
        {
          speaker: b.key,
          line: pb.competitiveness > 0.6 ? 'react.envy' : 'react.praise',
          params: { other: a.key, who: top },
        },
      ],
    };
  }
  const subject = who;
  const bView = b.memory.relations.get(subject)?.affinity ?? 0;
  const agree =
    Math.sign(bView) === Math.sign(aff) ||
    (bView === 0 && b.profile.personality.friendliness > 0.4);
  return {
    weight: 0.8,
    build: (): ConvLine[] => [
      {
        speaker: a.key,
        line: aff > 0 ? 'gossip.good' : 'gossip.bad',
        params: { other: b.key, who: subject },
      },
      {
        speaker: b.key,
        line: agree ? 'react.agree' : 'react.disagree',
        params: { other: a.key, who: subject },
        apply: () => {
          a.memory.adjust(b.key, agree ? 0.03 : -0.03);
          b.memory.adjust(a.key, agree ? 0.03 : -0.02);
          // Reputation spreads: b's view of the subject moves toward a's.
          if (agree || bView === 0) b.memory.adjust(subject, Math.sign(aff) * 0.05);
        },
      },
    ],
  };
}

function smallTalk(a: Adventurer, b: Adventurer, ctx: SocialCtx): Topic {
  let line = ctx.night ? 'small.night' : 'small.day';
  const params: Record<string, string | number> = { other: b.key };
  if (ctx.rng.chance(0.5)) {
    const moving = [...new Set(ctx.economy.market.all.map((l) => l.itemId))]
      .map((id) => ({ id, trend: ctx.economy.prices.trend(id) }))
      .filter((x) => Math.abs(x.trend) >= 0.12)
      .sort((x, y) => Math.abs(y.trend) - Math.abs(x.trend))[0];
    if (moving) {
      line = moving.trend > 0 ? 'small.price_up' : 'small.price_down';
      params.item = moving.id;
    }
  }
  return {
    weight: 0.5,
    build: (): ConvLine[] => [
      { speaker: a.key, line, params },
      { speaker: b.key, line: 'react.agree', params: { other: a.key } },
    ],
  };
}

function quarrelTopic(a: Adventurer, b: Adventurer): Topic {
  return {
    weight: 2,
    build: (): ConvLine[] => [
      { speaker: a.key, line: 'quarrel.taunt', params: { other: b.key } },
      {
        speaker: b.key,
        line: 'quarrel.retort',
        params: { other: a.key },
        apply: () => {
          a.memory.adjust(b.key, -0.04);
          b.memory.adjust(a.key, -0.04);
        },
      },
    ],
  };
}

function pickWeighted(topics: Topic[], rng: Rng): Topic | null {
  let total = 0;
  for (const t of topics) total += t.weight;
  let r = rng.next() * total;
  for (const t of topics) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return topics[topics.length - 1] ?? null;
}

/** Plan a whole conversation started by `a`. Effects run as their lines are spoken. */
export function planConversation(a: Adventurer, b: Adventurer, ctx: SocialCtx): ConvLine[] {
  const ra = a.memory.relation(b.key);
  const rb = b.memory.relation(a.key);
  const ga = group(relationLabel(ra));
  const gb = group(relationLabel(rb));
  const lines: ConvLine[] = [
    { speaker: a.key, line: `hello.${ga}`, params: { other: b.key, name: a.key } },
    { speaker: b.key, line: `reply.${gb}`, params: { other: a.key, name: b.key } },
  ];
  const topics: Topic[] = [];
  if (ga === 'rival' || gb === 'rival') topics.push(quarrelTopic(a, b));
  const candidates = [
    newsTopic(a, b, ctx),
    newsTopic(b, a, ctx),
    tradeTopic(a, b, ctx) ?? tradeTopic(b, a, ctx),
    partyTopic(a, b, ctx),
    guildTopic(a, b, ctx) ?? guildTopic(b, a, ctx),
    gossipTopic(a, b, ctx),
  ];
  for (const t of candidates) if (t) topics.push(t);
  topics.push(smallTalk(a, b, ctx));
  const n =
    (a.profile.personality.sociability + b.profile.personality.sociability) / 2 > 0.55 ? 2 : 1;
  for (let i = 0; i < n && topics.length > 0; i++) {
    const t = pickWeighted(topics, ctx.rng);
    if (!t) break;
    topics.splice(topics.indexOf(t), 1);
    lines.push(...t.build());
  }
  const friendly = relationLabel(ra) === 'friend' || relationLabel(ra) === 'close_friend';
  lines.push({
    speaker: a.key,
    line: friendly ? 'bye.friend' : 'bye.plain',
    params: { other: b.key },
    apply: () => settleConversation(a, b, ctx),
  });
  return lines;
}

/** Relationship bookkeeping at the end of a conversation; announces new friendships/rivalries. */
export function settleConversation(a: Adventurer, b: Adventurer, ctx: SocialCtx): void {
  const compat = compatibility(a.profile.personality, b.profile.personality);
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const r = x.memory.relation(y.key);
    const before = r.affinity;
    if (r.met === 0) x.memory.add({ t: ctx.now, kind: 'met', subject: y.key, importance: 0.4 });
    r.met++;
    r.talks++;
    r.lastTalk = ctx.now;
    r.lastSeen = ctx.now;
    x.memory.adjust(
      y.key,
      0.015 +
        compat * 0.05 +
        x.profile.personality.friendliness * 0.015 +
        ctx.rng.range(-0.01, 0.01),
    );
    if (before < FRIEND_AFFINITY && r.affinity >= FRIEND_AFFINITY && x === a) {
      const other = b.memory.relations.get(a.key)?.affinity ?? 0;
      if (other >= FRIEND_AFFINITY - 0.05)
        ctx.society.news.push(ctx.now, 'friends', { a: a.key, b: b.key });
    }
    if (before > RIVAL_AFFINITY && r.affinity <= RIVAL_AFFINITY && x === a) {
      x.memory.add({ t: ctx.now, kind: 'quarrel', subject: y.key, importance: 0.6 });
      ctx.society.news.push(ctx.now, 'rivals', { a: a.key, b: b.key });
    }
  }
}

/** Off-screen: two adventurers meet and the whole conversation resolves at once. */
export function meetInstantly(a: Adventurer, b: Adventurer, ctx: SocialCtx): void {
  for (const line of planConversation(a, b, ctx)) line.apply?.();
}

/** Is `b` free to be talked to? */
export function availableForTalk(b: Adventurer): boolean {
  return (
    b.character.alive &&
    b.talk === null &&
    b.action !== 'fight' &&
    b.action !== 'flee' &&
    b.action !== 'follow'
  );
}

// --- Social housekeeping (guild founding, leaving bad company) --------------------------------

export function socialHousekeeping(a: Adventurer, ctx: SocialCtx): void {
  const c = a.character;
  const p = a.profile.personality;
  const guilds = ctx.society.guilds;
  const g = guilds.of(a.key);
  if (!g) {
    const friends = [...a.memory.relations.values()].filter(
      (r) => r.affinity >= FRIEND_AFFINITY,
    ).length;
    const ambition = p.sociability * 0.5 + p.competitiveness * 0.3 + p.friendliness * 0.2;
    if (
      c.level >= GUILD_FOUND_LEVEL &&
      c.gold >= GUILD_FOUND_COST + goldReserve(a) &&
      ambition > 0.55 &&
      friends >= 1 &&
      ctx.rng.chance(0.2)
    ) {
      const r = guilds.found(c, ctx.rng, ctx.now, ctx.economy.ledger);
      if (r.ok) {
        a.memory.add({ t: ctx.now, kind: 'guild', detail: r.guild.id, importance: 0.95 });
        ctx.society.news.push(ctx.now, 'guild_founded', { who: a.key, guild: r.guild.id });
      }
    }
  } else if (g.leader !== a.key) {
    const leaderView = a.memory.relations.get(g.leader)?.affinity ?? 0;
    if (leaderView <= RIVAL_AFFINITY) guilds.leave(a.key, ctx.now);
  }
  // Leave a party whose members turned sour, or the player's party when it is time to go.
  const party = ctx.society.parties.of(a.key);
  if (party && party.members.includes('player') && ctx.now >= a.partyUntil) {
    ctx.society.parties.leave(a.key);
    a.partyUntil = Infinity;
    a.say('partyBye', ctx.now, undefined, true);
    return;
  }
  if (party) {
    for (const m of party.members) {
      if (m !== a.key && (a.memory.relations.get(m)?.affinity ?? 0) <= RIVAL_AFFINITY) {
        ctx.society.parties.leave(a.key);
        break;
      }
    }
  }
}

// --- Talking with the player -----------------------------------------------------------------

export type PlayerRequest =
  'status' | 'party' | 'leave_party' | 'guild_invite' | 'guild_join' | 'bye';

export interface PlayerReply {
  readonly line: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly accepted?: boolean;
}

/** The adventurer greets the player, remembering shared history. */
export function greetPlayer(a: Adventurer, ctx: SocialCtx): PlayerReply {
  const rel = a.memory.relation('player');
  const label = relationLabel(rel);
  let line: string;
  if (ctx.society.parties.same(a.key, 'player')) line = 'p.hello.party';
  else if (rel.raids > 0 && rel.affinity > 0) line = 'p.hello.raid';
  else if (rel.helped > 0 && rel.affinity > 0.1) line = 'p.hello.helped';
  else line = `p.hello.${group(label)}`;
  // Talking warms people up a little (once every few minutes).
  if (ctx.now - rel.lastTalk > 180) {
    if (rel.met === 0)
      a.memory.add({ t: ctx.now, kind: 'met', subject: 'player', importance: 0.5 });
    rel.met++;
    rel.talks++;
    rel.lastTalk = ctx.now;
    rel.lastSeen = ctx.now;
    a.memory.adjust('player', 0.02 + a.profile.personality.friendliness * 0.03);
  }
  return { line, params: { name: a.key } };
}

export function statusReply(a: Adventurer, ctx: SocialCtx): PlayerReply {
  const g = a.goal;
  if (!g) return { line: 'p.status.none' };
  switch (g.kind) {
    case 'level':
      return { line: 'p.status.level', params: { target: g.target } };
    case 'item':
      return { line: 'p.status.item', params: { item: g.itemId } };
    case 'explore':
      return { line: 'p.status.explore' };
    case 'slay':
      return {
        line: 'p.status.slay',
        params: { monster: g.monsterId, left: Math.max(1, g.count - g.progress) },
      };
    case 'wealth':
      return { line: 'p.status.wealth', params: { gold: g.target } };
    case 'raid':
      return {
        line: ctx.society.parties.of(a.key) ? 'p.status.raid_ready' : 'p.status.raid',
        params: { monster: g.monsterId },
      };
  }
}

/** Would the adventurer join the player's party? */
export function answerPartyInvite(a: Adventurer, ctx: SocialCtx, playerLevel: number): PlayerReply {
  const rel = a.memory.relation('player');
  const theirs = ctx.society.parties.of(a.key);
  if (theirs && !ctx.society.parties.same(a.key, 'player'))
    return { line: 'p.party.busy', accepted: false };
  if (rel.affinity <= RIVAL_AFFINITY) return { line: 'p.party.decline', accepted: false };
  const p = a.profile.personality;
  const gap = Math.abs(playerLevel - a.character.level);
  const score =
    rel.affinity * 0.9 +
    p.sociability * 0.4 +
    p.friendliness * 0.3 +
    (rel.raids > 0 ? 0.3 : 0) +
    (rel.helped > 0 ? 0.15 : 0) -
    (gap > 8 ? 0.3 : 0) -
    (a.profile.archetype === 'merchant' ? 0.4 : 0);
  return score > 0.45
    ? { line: 'p.party.accept', accepted: true }
    : { line: 'p.party.decline', accepted: false };
}

/** Would the adventurer join the player's guild? */
export function answerGuildInvite(a: Adventurer, ctx: SocialCtx): PlayerReply {
  if (ctx.society.guilds.of(a.key)) return { line: 'p.guild.have', accepted: false };
  const rel = a.memory.relation('player').affinity;
  const ok = rel >= 0.2 && rel + a.profile.personality.sociability * 0.4 > 0.5;
  return { line: ok ? 'p.guild.accept' : 'p.guild.decline', accepted: ok };
}

/** The player asks to join the adventurer's guild. */
export function answerGuildJoin(a: Adventurer, ctx: SocialCtx): PlayerReply {
  const g = ctx.society.guilds.of(a.key);
  if (!g) return { line: 'p.guildjoin.none', accepted: false };
  const rel = a.memory.relation('player').affinity;
  const ok =
    rel >= 0.15 || (g.leader === a.key && rel >= 0.05 && a.profile.personality.sociability > 0.6);
  return {
    line: ok ? 'p.guildjoin.accept' : 'p.guildjoin.decline',
    params: { guild: g.id },
    accepted: ok,
  };
}

/** Monsters of a boss kind (used for raid checks). */
export function isBossId(id: string): boolean {
  return MONSTER_DEFS.some((m) => m.id === id && m.boss);
}
