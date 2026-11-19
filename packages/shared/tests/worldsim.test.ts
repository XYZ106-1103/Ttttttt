import { describe, expect, it } from 'vitest';
import { IDLE_ACTION, IDLE_INPUT, seedFromString, SIM_DT, TILE_SIZE, WorldSim } from '../src';

const SEED = seedFromString('PROJECT-WORLD');

function sim(adventurers = 0): WorldSim {
  return new WorldSim({ seed: SEED, worldId: 'mp', adventurers, warmUp: false, monsters: false });
}

function run(s: WorldSim, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) s.tick(SIM_DT);
}

describe('multi-player world simulation', () => {
  it('hosts several players with their own intents, events and saves', () => {
    const s = sim();
    const a = s.addPlayer('pc:1', 'Alice');
    const b = s.addPlayer('pc:2', 'Bob');
    expect(s.playerSlots).toHaveLength(2);
    expect(a.character.id).not.toBe(b.character.id);
    run(s, 0.5);
    const ax = a.character.motor.x;
    const bx = b.character.motor.x;
    // Alice runs right, Bob stays.
    a.intent = { move: { ...IDLE_INPUT, moveX: 1 }, use: null, action: IDLE_ACTION };
    run(s, 1);
    expect(a.character.motor.x).toBeGreaterThan(ax + 50);
    expect(Math.abs(b.character.motor.x - bx)).toBeLessThan(1);
    // Saves are per player; leaving and coming back restores position and inventory.
    a.character.inventory.add('iron_ore', 7);
    const save = s.removePlayer('pc:1');
    expect(save).not.toBeNull();
    expect(s.playerOf('pc:1')).toBeUndefined();
    expect(s.combat.combatants.has(a.character.id)).toBe(false);
    const again = s.addPlayer('pc:1', 'Alice', save);
    expect(again.character.inventory.count('iron_ore')).toBe(7);
    expect(Math.abs(again.character.motor.x - a.character.motor.x)).toBeLessThan(1);
  });

  it('keeps adventurers active around every player', () => {
    const s = sim(30);
    const a = s.addPlayer('pc:1', 'Alice');
    const b = s.addPlayer('pc:2', 'Bob');
    // Bob goes far away.
    const tx = s.world.generator.spawnTileX + 260;
    expect(s.placePlayer('pc:2', tx * TILE_SIZE + 8, (s.world.surfaceY(tx) - 1) * TILE_SIZE)).toBe(
      true,
    );
    run(s, 2);
    const near = (x: number) =>
      s.adventurers.active.filter((adv) => Math.abs(adv.character.motor.x - x) < 76 * TILE_SIZE);
    expect(near(a.character.motor.x).length).toBeGreaterThan(0);
    // Everyone simulated in full is near one of the players.
    for (const adv of s.adventurers.active) {
      const d = Math.min(
        Math.abs(adv.character.motor.x - a.character.motor.x),
        Math.abs(adv.character.motor.x - b.character.motor.x),
      );
      expect(d / TILE_SIZE).toBeLessThan(80);
    }
  });

  it('shares kill experience between partied players', () => {
    const s = sim();
    const a = s.addPlayer('pc:1', 'Alice');
    const b = s.addPlayer('pc:2', 'Bob');
    run(s, 0.3);
    const party = s.society.parties.create('pc:1', 'hunt', s.time);
    expect(party).not.toBeNull();
    if (!party) return;
    expect(s.society.parties.join(party.id, 'pc:2')).toBe(true);
    expect(s.devSpawn('pc:1', 'dew_slime')).toBe(true);
    const m = s.monsters.monsters[0];
    if (!m) return;
    m.damageBy.set(a.character.id, 50);
    s.combat.kill(m, a.character.id);
    run(s, SIM_DT * 2);
    expect(a.events.exp.length).toBe(1);
    expect(b.events.exp.length).toBe(1);
    // Party bonus: each gets (1 + 0.2) / 2 of the solo amount.
    expect(b.events.exp[0]?.amount).toBe(a.events.exp[0]?.amount);
  });

  it('gives every boss fighter credit and remembers the raid with each player', () => {
    const s = sim(30);
    const a = s.addPlayer('pc:1', 'Alice');
    const b = s.addPlayer('pc:2', 'Bob');
    run(s, 1);
    const adv = s.adventurers.active[0];
    expect(s.devSpawn('pc:1', 'corestone_golem')).toBe(true);
    const boss = s.monsters.monsters.find((m) => m.def.boss);
    if (!boss || !adv) return;
    boss.damageBy.set(a.character.id, boss.stats.maxHp * 0.3);
    boss.damageBy.set(b.character.id, boss.stats.maxHp * 0.3);
    boss.damageBy.set(adv.character.id, boss.stats.maxHp * 0.4);
    s.combat.kill(boss, a.character.id);
    run(s, SIM_DT * 2);
    expect(a.events.exp.length).toBe(1);
    expect(b.events.exp.length).toBe(1);
    expect(adv.memory.relation('pc:1').raids).toBe(1);
    expect(adv.memory.relation('pc:2').raids).toBe(1);
  });

  it('keeps per-player town services separate', () => {
    const s = sim(30);
    const a = s.addPlayer('pc:1', 'Alice');
    s.addPlayer('pc:2', 'Bob');
    run(s, 1);
    const adv = s.adventurers.active.find((x) => a.town.talkable(x.key));
    if (!adv) return;
    adv.memory.relation('pc:1').affinity = 0.9;
    expect(a.town.ask(adv.key, 'party')?.accepted).toBe(true);
    expect(s.society.parties.same('pc:1', adv.key)).toBe(true);
    expect(s.society.parties.same('pc:2', adv.key)).toBe(false);
    expect(adv.memory.relations.has('pc:2')).toBe(false);
  });
});
