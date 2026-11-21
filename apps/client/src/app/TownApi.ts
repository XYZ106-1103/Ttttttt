import type { PlayerRequest, TownServices } from '@world/shared';

type R<K extends keyof TownServices> = TownServices[K] extends (...a: never[]) => infer T
  ? T
  : never;

/**
 * Town services as the UI uses them. Results are asynchronous: offline they come straight from
 * the local rules, online from the server (which validates everything); the UI never applies
 * effects itself, it shows the result and the next state update.
 */
export interface TownApi {
  /** Close enough to an adventurer to talk (local view). */
  talkable(key: string): boolean;
  talk(key: string): Promise<R<'talk'>>;
  keepListening(key: string): void;
  ask(key: string, req: PlayerRequest): Promise<R<'ask'>>;
  offers(key: string): Promise<R<'offers'>>;
  buyFrom(key: string, itemId: string, count: number): Promise<R<'buyFrom'>>;
  sellTo(key: string, itemId: string, count: number): Promise<R<'sellTo'>>;
  shopBuy(npcId: string, itemId: string, count: number): Promise<R<'shopBuy'>>;
  shopSell(npcId: string, slot: number, count: number): Promise<R<'shopSell'>>;
  enhance(slot: number): Promise<R<'enhance'>>;
  acceptQuest(id: string): Promise<R<'acceptQuest'>>;
  turnInQuest(id: string): Promise<R<'turnInQuest'>>;
  abandonQuest(id: string): void;
  /** Next to the quest giver (local view). */
  questGiverNear(): boolean;
  marketList(slot: number, count: number, price: number): Promise<R<'marketList'>>;
  marketBuy(listingId: number, count: number): Promise<R<'marketBuy'>>;
  marketCancel(listingId: number): Promise<R<'marketCancel'>>;
  marketCollect(): Promise<R<'marketCollect'>>;
  foundGuild(): Promise<R<'foundGuild'>>;
  leaveGuild(): void;
  /** Answer an adventurer's party invitation. */
  acceptInvite(from: string): Promise<boolean>;
  declineInvite(from: string): void;
  leaveParty(): void;
  kick(key: string): void;
}

/** Offline: the local simulation's town services. */
export function localTown(town: TownServices): TownApi {
  return {
    talkable: (key) => town.talkable(key) !== null,
    talk: async (key) => town.talk(key),
    keepListening: (key) => town.keepListening(key),
    ask: async (key, req) => town.ask(key, req),
    offers: async (key) => town.offers(key),
    buyFrom: async (key, item, n) => town.buyFrom(key, item, n),
    sellTo: async (key, item, n) => town.sellTo(key, item, n),
    shopBuy: async (npc, item, n) => town.shopBuy(npc, item, n),
    shopSell: async (npc, slot, n) => town.shopSell(npc, slot, n),
    enhance: async (slot) => town.enhance(slot),
    acceptQuest: async (id) => town.acceptQuest(id),
    turnInQuest: async (id) => town.turnInQuest(id),
    abandonQuest: (id) => void town.abandonQuest(id),
    questGiverNear: () => town.questGiverNear(),
    marketList: async (slot, n, price) => town.marketList(slot, n, price),
    marketBuy: async (id, n) => town.marketBuy(id, n),
    marketCancel: async (id) => town.marketCancel(id),
    marketCollect: async () => town.marketCollect(),
    foundGuild: async () => town.foundGuild(),
    leaveGuild: () => town.leaveGuild(),
    acceptInvite: async (from) => town.acceptInvite(from),
    declineInvite: (from) => town.declineInvite(from),
    leaveParty: () => town.leaveParty(),
    kick: (key) => void town.kick(key),
  };
}

/** Sends a command to the server; resolves with its result value, or null when it failed. */
export type CommandSender = (op: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Online: every request goes to the server. `local` answers range checks from the replica (the
 * server checks again). Failed requests (network, validation) resolve to a "too far"/null result
 * so the UI shows a message instead of hanging.
 */
export function remoteTown(local: TownServices, send: CommandSender): TownApi {
  const fail = { ok: false as const, reason: 'too_far' as const };
  const req = async <T>(op: string, args: Record<string, unknown>, fallback: T): Promise<T> => {
    const v = await send(op, args);
    return (v ?? fallback) as T;
  };
  return {
    talkable: (key) => local.talkable(key) !== null,
    talk: (key) => req('talk', { key }, null),
    keepListening: (key) => void send('listen', { key }),
    ask: (key, r) => req('ask', { key, req: r }, null),
    offers: (key) => req('offers', { key }, null),
    buyFrom: (key, item, count) => req('buyFrom', { key, item, count }, fail),
    sellTo: (key, item, count) => req('sellTo', { key, item, count }, fail),
    shopBuy: (npc, item, count) => req('shopBuy', { npc, item, count }, fail),
    shopSell: (npc, slot, count) => req('shopSell', { npc, slot, count }, fail),
    enhance: (slot) => req('enhance', { slot }, fail),
    acceptQuest: (id) => req('acceptQuest', { id }, fail),
    turnInQuest: (id) => req('turnInQuest', { id }, fail),
    abandonQuest: (id) => void send('abandonQuest', { id }),
    questGiverNear: () => local.questGiverNear(),
    marketList: (slot, count, price) => req('marketList', { slot, count, price }, fail),
    marketBuy: (id, count) => req('marketBuy', { id, count }, fail),
    marketCancel: (id) => req('marketCancel', { id }, fail),
    marketCollect: () => req('marketCollect', {}, null),
    foundGuild: () => req('foundGuild', {}, fail),
    leaveGuild: () => void send('leaveGuild', {}),
    acceptInvite: async (from) => (await send('acceptAdventurer', { from })) === true,
    declineInvite: (from) => void send('declineAdventurer', { from }),
    leaveParty: () => void send('leaveParty', {}),
    kick: (key) => void send('kick', { key }),
  };
}
