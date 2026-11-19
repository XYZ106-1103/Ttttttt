import { describe, expect, it } from 'vitest';
import {
  Adventurer,
  AdventurerDirector,
  CombatWorld,
  compatibility,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  Economy,
  generateProfile,
  GUILD_FOUND_COST,
  Ledger,
  newRelation,
  OverworldGenerator,
  PartySystem,
  planConversation,
  relationLabel,
  Rng,
  seedFromString,
  Society,
  type SocialCtx,
  World,
  GuildSystem,
  type Trader,
  Inventory,
} from '../src';

const SEED = seedFromString('PROJECT-WORLD');
const world = new World(new OverworldGenerator({ seed: SEED, ...DEFAULT_OVERWORLD }));
const sx = world.generator.spawnTileX;

function makeDirector(
  count: number,
  extra: Partial<ConstructorParameters<typeof AdventurerDirector>[3]> = {},
) {
  return new AdventurerDirector(world, new CombatWorld(world, 1), DEFAULT_MOVEMENT, {
    count,
    seed: SEED,
    homeCenter: sx,
    safeFrom: sx - 34,
    safeTo: sx + 34,
    marketX: sx + 4,
    stallXs: [sx - 8, sx - 5, sx + 10, sx + 13],
    ...extra,
  });
}

describe('relations', () => {
  it('labels relations and rates personality compatibility symmetrically', () => {
    const r = newRelation();
    expect(relationLabel(undefined)).toBe('stranger');
    expect(relationLabel(r)).toBe('stranger');
    r.met = 1;
    expect(relationLabel(r)).toBe('acquaintance');
    r.affinity = 0.4;
    expect(relationLabel(r)).toBe('friend');
    r.affinity = 0.8;
    expect(relationLabel(r)).toBe('close_friend');
    r.affinity = -0.3;
    expect(relationLabel(r)).toBe('rival');
    r.affinity = -0.7;
    expect(relationLabel(r)).toBe('enemy');
    const taken = new Set<string>();
    const ps = Array.from(
      { length: 12 },
      (_, i) => generateProfile(SEED, i, sx, taken).personality,
    );
    for (const a of ps)
      for (const b of ps) {
        const c = compatibility(a, b);
        expect(c).toBeGreaterThanOrEqual(-1);
        expect(c).toBeLessThanOrEqual(1);
        expect(c).toBeCloseTo(compatibility(b, a), 10);
      }
  });
});

describe('parties', () => {
  it('forms, caps at four, hands over leadership and survives a save round trip', () => {
    const ps = new PartySystem();
    const p = ps.create('player', 'hunt', 0);
    expect(p).not.toBeNull();
    if (!p) return;
    for (const k of ['adv-01', 'adv-02', 'adv-03']) expect(ps.join(p.id, k)).toBe(true);
    expect(ps.join(p.id, 'adv-04')).toBe(false);
    expect(ps.same('adv-01', 'player')).toBe(true);
    expect(ps.same('adv-04', 'player')).toBe(false);
    ps.leave('player');
    expect(ps.of('adv-01')?.leader).toBe('adv-01');
    const copy = new PartySystem();
    copy.load(JSON.parse(JSON.stringify(ps.toJSON())), () => true);
    expect(copy.of('adv-02')?.members).toHaveLength(3);
    // Open-ended parties stay open-ended after loading.
    expect(copy.of('adv-02')?.until).toBe(Infinity);
    copy.expire(1e9);
    expect(copy.of('adv-02')).not.toBeNull();
    const timed = new PartySystem();
    const t = timed.create('a', 'hunt', 0, 100);
    if (t) timed.join(t.id, 'b');
    timed.expire(150);
    expect(timed.of('b')).toBeNull();
  });
});

describe('guilds', () => {
  it('charges the founding cost (a gold sink) and enforces requirements', () => {
    const gs = new GuildSystem();
    const ledger = new Ledger();
    const rng = new Rng(3);
    const poor: Trader & { level: number } = {
      key: 'a',
      name: 'a',
      inventory: new Inventory(),
      gold: 100,
      level: 20,
    };
    expect(gs.found(poor, rng, 0, ledger)).toEqual({ ok: false, reason: 'no_gold' });
    const low = { ...poor, key: 'b', gold: 9999, level: 3 };
    expect(gs.found(low, rng, 0, ledger)).toEqual({ ok: false, reason: 'level' });
    const ok = { ...poor, key: 'c', gold: 600, level: 9 };
    const r = gs.found(ok, rng, 0, ledger);
    expect(r.ok).toBe(true);
    expect(ok.gold).toBe(600 - GUILD_FOUND_COST);
    expect(ledger.destroyed).toBe(GUILD_FOUND_COST);
    if (!r.ok) return;
    expect(gs.join(r.guild.id, 'd', 1)).toBeNull();
    expect(gs.join(r.guild.id, 'd', 1)).toBe('in_guild');
    gs.leave('c', 2);
    expect(gs.of('d')?.leader).toBe('d');
    expect(r.guild.name.ko.length).toBeGreaterThan(2);
  });
});

describe('conversations', () => {
  it('plans a conversation whose trade outcome goes through a validated trade', () => {
    const taken = new Set<string>();
    const pa = generateProfile(SEED, 0, sx, taken);
    const pb = generateProfile(SEED, 1, sx, taken);
    // A greedy seller and a buyer who needs iron for an iron sword.
    const seller = new Adventurer(
      {
        ...pa,
        archetype: 'merchant',
        personality: { ...pa.personality, greed: 0.9, sociability: 0.2 },
      },
      1,
      0,
      0,
      DEFAULT_MOVEMENT,
    );
    const buyer = new Adventurer(
      { ...pb, personality: { ...pb.personality, sociability: 0.2 } },
      2,
      0,
      0,
      DEFAULT_MOVEMENT,
    );
    seller.character.inventory.add('iron_ore', 30);
    buyer.character.gold = 5000;
    buyer.character.progress = { ...buyer.character.progress, level: 12 };
    buyer.character.level = 12;
    buyer.goal = { kind: 'item', itemId: 'iron_sword', count: 1, since: 0 };
    const society = new Society();
    const economy = new Economy();
    const ctx: SocialCtx = {
      society,
      economy,
      now: 10,
      night: false,
      rng: new Rng(5),
      byKey: (k) => (k === seller.key ? seller : k === buyer.key ? buyer : undefined),
      levelOf: () => 1,
      events: [],
    };
    let traded = false;
    for (let i = 0; i < 20 && !traded; i++) {
      const lines = planConversation(seller, buyer, ctx);
      expect(lines[0]?.line).toMatch(/^hello\./);
      expect(lines.at(-1)?.line).toMatch(/^bye\./);
      for (const l of lines) l.apply?.();
      traded = ctx.events.some((e) => e.type === 'trade');
      seller.memory.relation(buyer.key).lastTalk = -1e9;
    }
    expect(traded).toBe(true);
    const e = ctx.events.find((x) => x.type === 'trade');
    if (e?.type !== 'trade') return;
    expect(buyer.character.inventory.count('iron_ore')).toBe(e.count);
    expect(seller.character.gold).toBe(e.count * e.price);
    expect(buyer.character.gold).toBe(5000 - e.count * e.price);
    expect(seller.memory.relation(buyer.key).trades).toBe(1);
    expect(buyer.memory.relation(seller.key).talks).toBeGreaterThan(0);
  });
});

describe('living world (background simulation)', () => {
  it('two hours off-screen: trade, friendships, guilds, parties — and no gold from nowhere', () => {
    const d = makeDirector(30);
    expect(d.all.filter((a) => a.profile.archetype === 'merchant')).toHaveLength(3);
    d.catchUp(2 * 3600, 0);
    const eco = d.economy;
    const wallets = d.all.reduce((n, a) => n + a.character.gold, 0) + eco.market.mailGold();
    expect(wallets).toBe(eco.ledger.created - eco.ledger.destroyed);
    expect(eco.ledger.flows.market_fee ?? 0).toBeGreaterThan(0);
    expect(eco.market.all.length).toBeGreaterThan(0);
    expect(d.society.guilds.all.length).toBeGreaterThan(0);
    const friendships = d.all.reduce(
      (n, a) => n + [...a.memory.relations.values()].filter((r) => r.affinity >= 0.3).length,
      0,
    );
    expect(friendships).toBeGreaterThan(0);
    const talks = d.all.reduce(
      (n, a) => n + [...a.memory.relations.values()].reduce((m, r) => m + r.talks, 0),
      0,
    );
    expect(talks).toBeGreaterThan(50);
    expect(d.society.news.latest.some((n) => n.kind === 'guild_founded')).toBe(true);
    // Every adventurer made progress.
    expect(Math.min(...d.all.map((a) => a.character.level))).toBeGreaterThan(3);
    // Saves round-trip the society.
    const s2 = new Society();
    s2.load(JSON.parse(JSON.stringify(d.society.toJSON())), (k) => !!d.byKey(k));
    expect(s2.guilds.all.length).toBe(d.society.guilds.all.length);
  });

  it('scales to hundreds of adventurers in the background', () => {
    const d = makeDirector(300);
    const t0 = Date.now();
    // One minute of real-time background ticks at 60 Hz with the player far away.
    d.updateTiers(5 * 16, 40 * 16, 0, true);
    for (let i = 0; i < 3600; i++) d.stepAbstract(1 / 60, i / 60, false);
    const ms = Date.now() - t0;
    expect(d.active).toHaveLength(0);
    // ~0.5 ms per tick budget on average for 300 background adventurers (generous for CI).
    expect(ms / 3600).toBeLessThan(0.5);
  });
});
