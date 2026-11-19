import { describe, expect, it } from 'vitest';
import { IDLE_INPUT, NPC_DEFS, seedFromString, SIM_DT, TILE_SIZE } from '@world/shared';
import { MemorySaveStore } from '../persistence/SaveStore';
import { GameSimulation } from './GameSimulation';

const SEED = seedFromString('PROJECT-WORLD');

function makeSim(worldId: string, adventurers = 0): GameSimulation {
  return new GameSimulation({
    seed: SEED,
    worldId,
    playerName: 'tester',
    adventurers,
    warmUp: false,
    monsters: false,
  });
}

function settle(sim: GameSimulation, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) sim.tick(SIM_DT, IDLE_INPUT);
}

/** Put the player next to an NPC (by id). */
function goTo(sim: GameSimulation, npcId: string): void {
  const def = NPC_DEFS.find((n) => n.id === npcId);
  if (!def) throw new Error(npcId);
  const tx = sim.world.generator.spawnTileX + def.x + 2;
  const ok = sim.placePlayer(tx * TILE_SIZE + 8, sim.world.surfaceY(tx) * TILE_SIZE);
  expect(ok).toBe(true);
  settle(sim, 0.3);
}

describe('town services', () => {
  it('shop trades only in person, with gold leaving and entering through the ledger', () => {
    const sim = makeSim('shop');
    settle(sim, 0.3);
    sim.player.gold = 200;
    // Spawn is not next to the shop counter.
    expect(sim.town.shopBuy('shopkeeper', 'healing_potion', 1)).toEqual({
      ok: false,
      reason: 'too_far',
    });
    goTo(sim, 'shopkeeper');
    const potions = sim.player.inventory.count('healing_potion');
    const r = sim.town.shopBuy('shopkeeper', 'healing_potion', 2);
    expect(r.ok).toBe(true);
    expect(sim.player.inventory.count('healing_potion')).toBe(potions + 2);
    expect(sim.player.gold).toBeLessThan(200);
    sim.player.inventory.add('slime_gel', 10);
    const slot = [...Array(40).keys()].find(
      (i) => sim.player.inventory.get(i)?.itemId === 'slime_gel',
    );
    const before = sim.player.gold;
    expect(sim.town.shopSell('shopkeeper', slot ?? -1, 10).ok).toBe(true);
    expect(sim.player.gold).toBeGreaterThan(before);
    expect(sim.economy.ledger.destroyed).toBeGreaterThan(0);
    expect(sim.economy.ledger.created).toBeGreaterThan(0);
  });

  it('lists on the exchange; an adventurer buys; the player collects the proceeds', () => {
    const sim = makeSim('exchange', 3);
    settle(sim, 0.3);
    goTo(sim, 'clerk');
    sim.player.inventory.add('iron_ore', 5);
    const slot = [...Array(40).keys()].find(
      (i) => sim.player.inventory.get(i)?.itemId === 'iron_ore',
    );
    const r = sim.town.marketList(slot ?? -1, 5, 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sim.player.inventory.count('iron_ore')).toBe(0);
    const buyer = sim.adventurers.all[0];
    if (!buyer) return;
    buyer.character.gold = 1000;
    expect(sim.economy.market.buy(buyer.character, r.listing.id, 5, sim.time).ok).toBe(true);
    settle(sim, 1.2);
    expect(sim.events.sales.length).toBeGreaterThan(0);
    const got = sim.town.marketCollect();
    expect(got?.gold).toBe(95);
    expect(sim.player.gold).toBe(95);
  });

  it('kills drop gold coins the player picks up', () => {
    const sim = makeSim('coins');
    settle(sim, 0.5);
    expect(sim.devSpawn('dew_slime')).toBe(true);
    const m = sim.monsters.monsters[0];
    if (!m) return;
    m.damageBy.set(sim.player.id, 50);
    m.motor.x = sim.player.motor.x + 10;
    sim.combat.kill(m, sim.player.id);
    settle(sim, 3);
    expect(sim.player.gold).toBeGreaterThan(0);
    expect(sim.events.pickups.some((p) => p.itemId === 'gold')).toBe(true);
    expect(sim.player.gold).toBe(sim.economy.ledger.created);
  });

  it('talks with adventurers, forms a party that shares kill experience, and founds a guild', () => {
    const sim = makeSim('party', 30);
    settle(sim, 1);
    const a = sim.adventurers.active.find((x) => sim.town.talkable(x.key));
    expect(a).toBeDefined();
    if (!a) return;
    expect(sim.town.talk(a.key)?.line).toMatch(/^p\.hello\./);
    // A friend says yes.
    a.memory.relation('player').affinity = 0.8;
    const reply = sim.town.ask(a.key, 'party');
    expect(reply?.accepted).toBe(true);
    expect(sim.society.parties.same('player', a.key)).toBe(true);
    // Shared experience for a kill near both.
    expect(sim.devSpawn('dew_slime')).toBe(true);
    const m = sim.monsters.monsters[0];
    if (!m) return;
    a.character.motor.x = sim.player.motor.x + 20;
    const exp0 = a.character.progress.exp + a.character.level * 1e5;
    m.damageBy.set(sim.player.id, 50);
    sim.combat.kill(m, sim.player.id);
    settle(sim, SIM_DT * 2);
    expect(a.character.progress.exp + a.character.level * 1e5).toBeGreaterThan(exp0);
    // Guild founding at the registrar (level and gold requirements apply).
    goTo(sim, 'registrar');
    sim.devSetLevel(8);
    sim.player.gold = 600;
    const g = sim.town.foundGuild();
    expect(g.ok).toBe(true);
    expect(sim.player.gold).toBe(100);
    expect(sim.society.guilds.of('player')).not.toBeNull();
  });

  it('remembers a boss fought together with the player', () => {
    const sim = makeSim('raid', 30);
    settle(sim, 1);
    const a = sim.adventurers.active[0];
    if (!a) return;
    expect(sim.devSpawn('corestone_golem')).toBe(true);
    const boss = sim.monsters.monsters.find((m) => m.def.boss);
    if (!boss) return;
    boss.damageBy.set(sim.player.id, boss.stats.maxHp * 0.5);
    boss.damageBy.set(a.character.id, boss.stats.maxHp * 0.5);
    sim.combat.kill(boss, sim.player.id);
    settle(sim, SIM_DT * 2);
    expect(a.memory.relation('player').raids).toBe(1);
    expect(a.memory.events.some((e) => e.kind === 'raid' && e.subject === 'player')).toBe(true);
    expect(sim.events.news.some((n) => n.kind === 'boss_slain')).toBe(true);
  });

  it('saves gold, the market and society, and restores them', async () => {
    const store = new MemorySaveStore(true);
    const sim = makeSim('save', 30);
    settle(sim, 0.5);
    goTo(sim, 'clerk');
    sim.player.gold = 777;
    sim.player.inventory.add('copper_sword', 1);
    const slot = [...Array(40).keys()].find(
      (i) => sim.player.inventory.get(i)?.itemId === 'copper_sword',
    );
    expect(sim.town.marketList(slot ?? -1, 1, 150).ok).toBe(true);
    goTo(sim, 'registrar');
    sim.devSetLevel(9);
    sim.player.gold += 500;
    expect(sim.town.foundGuild().ok).toBe(true);
    await store.saveState(
      'save',
      sim.exportMeta(SEED),
      sim.exportPlayer(),
      sim.exportAdventurers(),
      sim.exportSociety(),
    );
    const bundle = await store.load('save');
    const again = new GameSimulation({
      seed: SEED,
      worldId: 'save',
      playerName: 'tester',
      adventurers: 30,
      monsters: false,
      save: { ...bundle, meta: bundle.meta ? { ...bundle.meta, savedAt: Date.now() } : null },
    });
    expect(again.player.gold).toBe(777);
    expect(again.economy.market.bySeller('player')).toHaveLength(1);
    expect(again.society.guilds.of('player')?.members).toContain('player');
  });
});
