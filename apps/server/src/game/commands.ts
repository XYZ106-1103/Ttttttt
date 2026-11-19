/**
 * Player commands over the network. Every argument is validated here (types, ranges), then the
 * request goes to the same shared rules the offline game uses (WorldSim / TownServices), which
 * validate the game logic (range, ownership, gold, space...). Nothing the client sends is trusted.
 */
import {
  EQUIP_SLOTS,
  type EquipSlotId,
  INVENTORY_SIZE,
  type PlayerRequest,
  STAT_KEYS,
  type StatKey,
  TILE_SIZE,
  type WorldSim,
} from '@world/shared';
import type { Session } from './Session';

export class CommandError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

type Args = Record<string, unknown>;

function int(a: Args, k: string, min: number, max: number): number {
  const v = a[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
    throw new CommandError(`bad_${k}`);
  return v;
}

function str(a: Args, k: string, max = 40): string {
  const v = a[k];
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new CommandError(`bad_${k}`);
  return v;
}

function oneOf<T extends string>(a: Args, k: string, options: readonly T[]): T {
  const v = a[k];
  if (typeof v !== 'string' || !(options as readonly string[]).includes(v))
    throw new CommandError(`bad_${k}`);
  return v as T;
}

const REQUESTS: readonly PlayerRequest[] = [
  'status',
  'party',
  'leave_party',
  'guild_invite',
  'guild_join',
  'bye',
];

export interface CommandContext {
  readonly sim: WorldSim;
  readonly session: Session;
  /** Record an economy/social transaction in the journal and mark state for saving soon. */
  journal(op: string, detail: Record<string, string | number | boolean | null>): void;
  /** Admin-only world operations. */
  readonly admin: AdminOps;
  /** Player ↔ player features (parties, trades) handled by the server. */
  readonly social: SocialOps;
}

export interface AdminOps {
  setTime(hours: number): void;
  setMonsters(on: boolean): void;
}

export interface SocialOps {
  invite(from: Session, toName: string): unknown;
  answerInvite(session: Session, fromKey: string, accept: boolean): unknown;
  trade(session: Session, op: string, args: Args): unknown;
}

type Handler = (ctx: CommandContext, a: Args) => unknown;

const ok = (value: unknown = true) => value;

function journalResult(
  ctx: CommandContext,
  op: string,
  r: { ok: boolean } & Record<string, unknown>,
  detail: Record<string, string | number | boolean | null>,
): unknown {
  if (r.ok) ctx.journal(op, detail);
  return r;
}

export const COMMANDS: Readonly<Record<string, Handler>> = {
  // --- Inventory, equipment, crafting --------------------------------------------------------
  select: (c, a) => ok(c.sim.selectSlot(c.session.key, int(a, 'slot', 0, 9))),
  invClick: (c, a) =>
    ok(
      c.sim.clickInventory(
        c.session.key,
        int(a, 'index', 0, INVENTORY_SIZE - 1),
        oneOf(a, 'button', ['left', 'right'] as const),
      ),
    ),
  equipClick: (c, a) =>
    c.sim.clickEquipment(c.session.key, oneOf(a, 'slot', EQUIP_SLOTS as readonly EquipSlotId[])),
  returnCursor: (c) => ok(c.sim.returnCursor(c.session.key)),
  craft: (c, a) => c.sim.craft(c.session.key, str(a, 'recipe'), int(a, 'times', 1, 99)),
  consume: (c, a) => c.sim.consume(c.session.key, int(a, 'index', 0, INVENTORY_SIZE - 1)),
  // --- Progression ---------------------------------------------------------------------------
  allocate: (c, a) =>
    c.sim.allocateStat(
      c.session.key,
      oneOf(a, 'stat', STAT_KEYS as readonly StatKey[]),
      int(a, 'amount', 1, 50),
    ),
  autoAllocate: (c) => c.sim.autoAllocate(c.session.key),
  learn: (c, a) => c.sim.learnSkill(c.session.key, str(a, 'skill')),
  skillSlot: (c, a) =>
    ok(
      c.sim.setSkillSlot(
        c.session.key,
        int(a, 'slot', 0, 3),
        a.skill === null ? null : str(a, 'skill'),
      ),
    ),
  advance: (c, a) => c.sim.advanceJob(c.session.key, str(a, 'job')),
  respawn: (c) => c.sim.requestRespawn(c.session.key),
  // --- Town ----------------------------------------------------------------------------------
  shopBuy: (c, a) => {
    const item = str(a, 'item');
    const count = int(a, 'count', 1, 999);
    const r = c.session.town.shopBuy(str(a, 'npc'), item, count);
    return journalResult(c, 'shop_buy', r, { item, count, total: 'total' in r ? r.total : 0 });
  },
  shopSell: (c, a) => {
    const slot = int(a, 'slot', 0, INVENTORY_SIZE - 1);
    const item = c.session.character.inventory.get(slot)?.itemId ?? '';
    const count = int(a, 'count', 1, 999);
    const r = c.session.town.shopSell(str(a, 'npc'), slot, count);
    return journalResult(c, 'shop_sell', r, { item, count, total: 'total' in r ? r.total : 0 });
  },
  marketList: (c, a) => {
    const slot = int(a, 'slot', 0, INVENTORY_SIZE - 1);
    const item = c.session.character.inventory.get(slot)?.itemId ?? '';
    const count = int(a, 'count', 1, 9999);
    const price = int(a, 'price', 1, 10_000_000);
    const r = c.session.town.marketList(slot, count, price);
    return journalResult(c, 'market_list', r, { item, count, price });
  },
  marketBuy: (c, a) => {
    const id = int(a, 'id', 1, 2 ** 31);
    const count = int(a, 'count', 1, 9999);
    const listing = c.sim.economy.market.get(id);
    const r = c.session.town.marketBuy(id, count);
    return journalResult(c, 'market_buy', r, {
      listing: id,
      item: listing?.itemId ?? '',
      seller: listing?.seller ?? '',
      count,
      total: 'total' in r ? r.total : 0,
    });
  },
  marketCancel: (c, a) => {
    const id = int(a, 'id', 1, 2 ** 31);
    const r = c.session.town.marketCancel(id);
    return journalResult(c, 'market_cancel', r, { listing: id });
  },
  marketCollect: (c) => {
    const r = c.session.town.marketCollect();
    if (r && (r.gold > 0 || r.items.length > 0))
      c.journal('market_collect', { gold: r.gold, items: r.items.length });
    return r;
  },
  talk: (c, a) => c.session.town.talk(str(a, 'key')),
  listen: (c, a) => ok(c.session.town.keepListening(str(a, 'key'))),
  ask: (c, a) => c.session.town.ask(str(a, 'key'), oneOf(a, 'req', REQUESTS)),
  offers: (c, a) => c.session.town.offers(str(a, 'key')),
  buyFrom: (c, a) => {
    const key = str(a, 'key');
    const item = str(a, 'item');
    const count = int(a, 'count', 1, 999);
    const r = c.session.town.buyFrom(key, item, count);
    return journalResult(c, 'npc_trade_buy', r, { with: key, item, count });
  },
  sellTo: (c, a) => {
    const key = str(a, 'key');
    const item = str(a, 'item');
    const count = int(a, 'count', 1, 999);
    const r = c.session.town.sellTo(key, item, count);
    return journalResult(c, 'npc_trade_sell', r, { with: key, item, count });
  },
  acceptAdventurer: (c, a) => c.session.town.acceptInvite(str(a, 'from')),
  declineAdventurer: (c, a) => ok(c.session.town.declineInvite(str(a, 'from'))),
  leaveParty: (c) => ok(c.session.town.leaveParty()),
  kick: (c, a) => c.session.town.kick(str(a, 'key')),
  foundGuild: (c) => {
    const r = c.session.town.foundGuild();
    if (r.ok) c.journal('guild_found', { guild: r.guild.id });
    return r.ok ? { ok: true, guild: { id: r.guild.id, name: r.guild.name } } : r;
  },
  // --- Read-only views (the client's replica of shared state) -------------------------------
  /** Market listings, reference prices, shop stock and the caller's own mailbox. */
  economy: (c) => {
    const eco = c.sim.economy;
    const market = eco.market.toJSON() as unknown as Record<string, unknown>;
    const own = eco.market.peekMail(c.session.key);
    const shops: Record<string, unknown> = {};
    for (const [id, s] of eco.shops) shops[id] = s.toJSON();
    return {
      prices: eco.prices.toJSON(),
      market: { ...market, mail: own ? { [c.session.key]: own } : {} },
      shops,
    };
  },
  /** Every adventurer's public state, and how each one feels about the caller. */
  roster: (c) =>
    c.sim.adventurers.all.map((a) => {
      const ch = a.character;
      return {
        key: a.key,
        level: ch.level,
        job: ch.jobId,
        alive: ch.alive,
        hp: Math.ceil(ch.hp),
        maxHp: ch.stats.maxHp,
        x: Math.round(ch.motor.x),
        action: a.action,
        activity: a.activity,
        rel: a.memory.relations.get(c.session.key) ?? null,
      };
    }),
  /** One adventurer in full (the inspection card): memories, goal, relations, utility scores. */
  adventurer: (c, a) => {
    const adv = c.sim.adventurers.byKey(str(a, 'key'));
    if (!adv) throw new CommandError('not_found');
    return {
      save: adv.toJSON(),
      scores: adv.scores,
      listen: Math.max(0, adv.listenUntil - c.sim.time),
    };
  },
  leaveGuild: (c) => ok(c.session.town.leaveGuild()),
  // --- Players together ----------------------------------------------------------------------
  invitePlayer: (c, a) => c.social.invite(c.session, str(a, 'name', 24)),
  answerPlayer: (c, a) => c.social.answerInvite(c.session, str(a, 'from'), a.accept === true),
  trade: (c, a) => c.social.trade(c.session, str(a, 'op', 20), a),
  // --- Developer commands (admins only) ------------------------------------------------------
  dev: (c, a) => {
    if (!c.session.admin) throw new CommandError('forbidden');
    const key = c.session.key;
    const sim = c.sim;
    switch (str(a, 'cmd')) {
      case 'level':
        return ok(sim.devSetLevel(key, int(a, 'n', 1, 200)));
      case 'gold':
        return ok(sim.devGold(key, int(a, 'n', 1, 1_000_000)));
      case 'summon':
        return sim.devSpawn(key, str(a, 'id'));
      case 'give':
        return sim.devGive(key, str(a, 'id'), int(a, 'n', 1, 999));
      case 'heal': {
        const p = c.session.character;
        if (p.alive) {
          p.hp = p.stats.maxHp;
          p.mp = p.stats.maxMp;
        }
        return ok();
      }
      case 'time':
        return ok(c.admin.setTime(int(a, 'n', 0, 24)));
      case 'monsters':
        return ok(c.admin.setMonsters(a.on === true));
      case 'tp':
        return sim.placePlayer(
          key,
          int(a, 'x', 0, sim.world.widthTiles) * TILE_SIZE + TILE_SIZE / 2,
          int(a, 'y', 0, sim.world.heightTiles) * TILE_SIZE,
        );
      case 'spawn':
        return ok(sim.respawnPlayer(key));
      default:
        throw new CommandError('unknown_dev');
    }
  },
};
