import { describe, expect, it } from 'vitest';
import { IDLE_INPUT, seedFromString, SIM_DT } from '@world/shared';
import { MemorySaveStore } from '../persistence/SaveStore';
import { GameSimulation } from './GameSimulation';

const SEED = seedFromString('PROJECT-WORLD');
const make = (save?: ConstructorParameters<typeof GameSimulation>[0]['save']) =>
  new GameSimulation({ seed: SEED, worldId: 'test', playerName: 'tester', save, adventurers: 0 });

function settle(
  sim: GameSimulation,
  seconds: number,
  use: { tx: number; ty: number } | null = null,
): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) sim.tick(SIM_DT, IDLE_INPUT, use);
}

describe('GameSimulation sandbox loop', () => {
  it('starts with the starting kit in the hotbar', () => {
    const sim = make();
    expect(sim.player.inventory.get(0)?.itemId).toBe('worn_pickaxe');
    expect(sim.player.inventory.get(1)?.itemId).toBe('worn_axe');
    expect(sim.player.inventory.count('torch')).toBe(10);
  });

  it('mines with held input, spawns a drop and magnet-collects it', () => {
    const sim = make();
    settle(sim, 0.5);
    const tx = Math.floor(sim.player.motor.x / 16) + 2;
    const ty = Math.round(sim.player.motor.y / 16);
    expect(sim.world.getFg(tx, ty)).not.toBe(0);
    settle(sim, 1.2, { tx, ty });
    expect(sim.world.getFg(tx, ty)).toBe(0);
    settle(sim, 2);
    expect(sim.drops.length).toBe(0);
    expect(sim.player.inventory.count('dirt')).toBe(1);
    expect(sim.events.pickups.some((p) => p.itemId === 'dirt')).toBe(true);
  });

  it('round-trips world changes and the player through a save store', async () => {
    const store = new MemorySaveStore(true);
    const a = make();
    settle(a, 0.5);
    const tx = Math.floor(a.player.motor.x / 16) - 3;
    const ty = Math.round(a.player.motor.y / 16);
    settle(a, 1.2, { tx, ty });
    settle(a, 2);
    a.selectSlot(3);
    a.explored.add(42);
    await store.saveChunks('test', a.world.collectDirty());
    await store.saveState('test', a.exportMeta(SEED), a.exportPlayer());

    const b = make(await store.load('test'));
    expect(b.world.getFg(tx, ty)).toBe(0);
    expect(b.player.inventory.count('dirt')).toBe(a.player.inventory.count('dirt'));
    expect(b.player.selectedSlot).toBe(3);
    expect(b.explored.has(42)).toBe(true);
    expect(Math.abs(b.player.motor.x - a.player.motor.x)).toBeLessThan(1);
  });

  it('crafts through the simulation and returns the cursor stack', () => {
    const sim = make();
    sim.player.inventory.add('wood', 2);
    expect(sim.craft('wood_planks', 2).crafted).toBe(2);
    expect(sim.player.inventory.count('wood_planks')).toBe(4);
    sim.clickInventory(0, 'left');
    expect(sim.player.inventory.cursor?.itemId).toBe('worn_pickaxe');
    sim.returnCursor();
    expect(sim.player.inventory.cursor).toBeNull();
    expect(sim.player.inventory.count('worn_pickaxe')).toBe(1);
  });
});

describe('GameSimulation combat loop', () => {
  const swordSlot = (sim: GameSimulation) =>
    [...Array(10).keys()].find((i) => sim.player.inventory.get(i)?.itemId === 'training_sword') ??
    -1;

  function fight(sim: GameSimulation, seconds: number, aimAt: () => { x: number; y: number }) {
    for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
      const a = aimAt();
      sim.tick(SIM_DT, IDLE_INPUT, null, {
        attackPressed: i % 6 === 0,
        attackHeld: true,
        aimX: a.x,
        aimY: a.y,
        skillSlot: null,
        dodge: false,
        quickHeal: false,
        quickMana: false,
      });
    }
  }

  it('kills a monster with the starter sword for experience and loot', () => {
    const sim = make();
    sim.monstersEnabled = false;
    settle(sim, 0.5);
    sim.selectSlot(swordSlot(sim));
    expect(sim.heldMode()).toBe('weapon');
    expect(sim.devSpawn('dew_slime')).toBe(true);
    const slime = sim.monsters.monsters[0];
    expect(slime).toBeDefined();
    if (!slime) return;
    slime.motor.x = sim.player.motor.x + 24;
    slime.motor.y = sim.player.motor.y;
    slime.hp = 10;
    fight(sim, 2, () => ({ x: slime.motor.x, y: slime.motor.y - 6 }));
    expect(slime.alive).toBe(false);
    expect(sim.player.progress.exp + (sim.player.level - 1) * 1000).toBeGreaterThan(0);
    expect(sim.events.exp.length).toBe(1);
    expect(sim.events.combat.some((e) => e.type === 'damage' && e.targetId === slime.id)).toBe(
      true,
    );
  });

  it('levels up with full heal and points, advances jobs and casts skills', () => {
    const sim = make();
    sim.monstersEnabled = false;
    settle(sim, 0.3);
    sim.player.hp = 5;
    sim.devSetLevel(10);
    expect(sim.player.level).toBe(10);
    expect(sim.player.hp).toBe(sim.player.stats.maxHp);
    expect(sim.player.progress.statPoints).toBe(45);
    expect(sim.advanceJob('nope')).toBe(false);
    expect(sim.advanceJob('warrior')).toBe(true);
    expect(sim.player.inventory.count('copper_sword')).toBe(1);
    expect(sim.learnSkill('warrior_power_strike')).toBeNull();
    sim.setSkillSlot(0, 'warrior_power_strike');
    const mp = sim.player.mp;
    sim.tick(SIM_DT, IDLE_INPUT, null, { ...idle(), skillSlot: 0 });
    // The skill auto-swapped to a sword from the hotbar and spent MP.
    expect(sim.heldMode()).toBe('weapon');
    expect(sim.player.mp).toBeLessThan(mp);
    expect(
      sim.events.actor.some((e) => e.type === 'action' && e.skill === 'warrior_power_strike'),
    ).toBe(true);
  });

  it('skills deal multiplied damage to monsters in their hit shape', () => {
    const sim = make();
    sim.monstersEnabled = false;
    settle(sim, 0.3);
    sim.devSetLevel(10);
    sim.advanceJob('warrior');
    sim.learnSkill('warrior_power_strike');
    sim.setSkillSlot(0, 'warrior_power_strike');
    expect(sim.devSpawn('dew_slime')).toBe(true);
    const m = sim.monsters.monsters[0];
    if (!m) return;
    m.hp = 5000;
    m.stats = { ...m.stats, maxHp: 5000 };
    m.motor.x = sim.player.motor.x + 26;
    m.motor.y = sim.player.motor.y;
    m.motor.vx = 0;
    const aim = { aimX: m.motor.x, aimY: m.motor.y - 6 };
    sim.tick(SIM_DT, IDLE_INPUT, null, { ...idle(), ...aim, skillSlot: 0 });
    for (let i = 0; i < 40; i++) sim.tick(SIM_DT, IDLE_INPUT, null, { ...idle(), ...aim });
    const hits = sim.events.combat.filter((e) => e.type === 'damage' && e.targetId === m.id);
    expect(hits.length).toBe(1);
    const dmg = hits[0]?.type === 'damage' ? hits[0].amount : 0;
    // 230% of attack (± variance, crits allowed).
    expect(dmg).toBeGreaterThan(sim.player.stats.attack * 2.3 * 0.85);
  });

  it('monsters hurt the player (the first spawned monster never shares the player id)', () => {
    const sim = make();
    sim.monstersEnabled = false;
    settle(sim, 0.3);
    expect(sim.devSpawn('corestone_golem')).toBe(true);
    const boss = sim.monsters.monsters[0];
    expect(boss?.id).not.toBe(sim.player.id);
    expect(sim.combat.combatants.get(sim.player.id)).toBe(sim.player);
    settle(sim, 12);
    expect(sim.events.combat.some((e) => e.type === 'damage' && e.targetId === sim.player.id)).toBe(
      true,
    );
    expect(sim.player.hp < sim.player.stats.maxHp || !sim.player.alive).toBe(true);
  });

  it('dies, loses a little experience and respawns after the timer', () => {
    const sim = make();
    sim.monstersEnabled = false;
    settle(sim, 0.3);
    sim.devSetLevel(3);
    sim.player.gainExp(50);
    const exp = sim.player.progress.exp;
    sim.combat.kill(sim.player, -1);
    settle(sim, SIM_DT * 2);
    expect(sim.player.alive).toBe(false);
    expect(sim.player.progress.exp).toBeLessThan(exp);
    expect(sim.requestRespawn()).toBe(false);
    settle(sim, 5.1);
    expect(sim.requestRespawn()).toBe(true);
    expect(sim.player.alive).toBe(true);
    expect(sim.player.hp).toBe(sim.player.stats.maxHp);
  });

  it('drinks potions with a shared cooldown', () => {
    const sim = make();
    settle(sim, 0.3);
    sim.player.hp = 20;
    expect(sim.quickUse('heal')).toBe(true);
    expect(sim.player.hp).toBeGreaterThan(90);
    expect(sim.player.inventory.count('healing_potion')).toBe(4);
    expect(sim.quickUse('heal')).toBe(false);
    expect(
      sim.events.notices.some((n) => n.kind === 'consumeFail' && n.reason === 'cooldown'),
    ).toBe(true);
  });

  it('saves progression, skills and equipment; migrates v1 saves with the starter weapon', async () => {
    const store = new MemorySaveStore(true);
    const sim = make();
    sim.monstersEnabled = false;
    settle(sim, 0.3);
    sim.devSetLevel(12);
    sim.advanceJob('archer');
    sim.learnSkill('archer_double_shot');
    sim.setSkillSlot(1, 'archer_double_shot');
    sim.player.inventory.add('traveler_hood', 1);
    const idx =
      [...Array(40).keys()].find((i) => sim.player.inventory.get(i)?.itemId === 'traveler_hood') ??
      -1;
    expect(sim.player.equipFromInventory(idx)).toBeNull();
    await store.saveState('test', sim.exportMeta(SEED), sim.exportPlayer());
    const loaded = make(await store.load('test'));
    expect(loaded.player.level).toBe(12);
    expect(loaded.player.jobId).toBe('archer');
    expect(loaded.player.skills.archer_double_shot).toBe(1);
    expect(loaded.player.skillBar[1]).toBe('archer_double_shot');
    expect(loaded.player.equipment.get('head')?.itemId).toBe('traveler_hood');

    const v1 = {
      ...sim.exportPlayer(),
      v: 1,
      level: undefined,
      jobId: undefined,
      skills: undefined,
    };
    v1.inventory = { slots: [{ itemId: 'worn_pickaxe', count: 1 }], cursor: null };
    const old = make({ meta: null, player: v1, chunks: [] });
    expect(old.player.level).toBe(1);
    expect(old.player.jobId).toBe('novice');
    expect(old.player.inventory.count('training_sword')).toBe(1);
  });
});

function idle() {
  return {
    attackPressed: false,
    attackHeld: false,
    aimX: 0,
    aimY: 0,
    skillSlot: null,
    dodge: false,
    quickHeal: false,
    quickMana: false,
  };
}

describe('GameSimulation with AI adventurers', () => {
  it('runs a living population: active near the player, progressing, without errors', () => {
    const sim = new GameSimulation({ seed: SEED, worldId: 'ai', playerName: 'tester' });
    const levels0 = sim.adventurers.all.reduce((n, a) => n + a.character.level, 0);
    // The new-world warm-up already put people to work.
    expect(levels0).toBeGreaterThan(30);
    for (let i = 0; i < 60 * 60; i++) sim.tick(SIM_DT, IDLE_INPUT);
    const active = sim.adventurers.active;
    expect(active.length).toBeGreaterThan(0);
    expect(active.length).toBeLessThanOrEqual(14);
    // Everyone near the player is rendered (active), never simulated invisibly on screen.
    const px = sim.player.motor.x;
    for (const a of sim.adventurers.all) {
      if (a.tier === 'abstract')
        expect(Math.abs(a.character.motor.x - px) / 16).toBeGreaterThanOrEqual(30);
    }
    const levels1 = sim.adventurers.all.reduce((n, a) => n + a.character.level, 0);
    expect(levels1).toBeGreaterThan(30);
    expect(levels1).toBeGreaterThanOrEqual(levels0);
    // Active adventurers are real combatants.
    for (const a of active)
      if (a.character.alive) expect(sim.combat.combatants.get(a.character.id)).toBe(a.character);
  });

  it('credits kills to the adventurer who claimed the monster, not the player', () => {
    const sim = new GameSimulation({
      seed: SEED,
      worldId: 'ai2',
      playerName: 'tester',
      monsters: false,
      warmUp: false,
    });
    settle(sim, 0.5);
    const a = sim.adventurers.active[0];
    expect(a).toBeDefined();
    if (!a) return;
    expect(sim.devSpawn('dew_slime')).toBe(true);
    const m = sim.monsters.monsters[0];
    if (!m) return;
    m.hp = 1;
    m.ownerId = a.character.id;
    m.ownerUntil = sim.time + 10;
    m.damageBy.set(a.character.id, 10);
    const exp0 = a.character.progress.exp + a.character.level * 1000;
    const pexp0 = sim.player.progress.exp;
    sim.combat.kill(m, a.character.id);
    settle(sim, SIM_DT * 2);
    expect(a.character.progress.exp + a.character.level * 1000).toBeGreaterThan(exp0);
    expect(sim.player.progress.exp).toBe(pexp0);
  });

  it('saves and restores adventurers with their goals and memories', async () => {
    const store = new MemorySaveStore(true);
    const sim = new GameSimulation({ seed: SEED, worldId: 'ai3', playerName: 'tester' });
    settle(sim, 5);
    const a = sim.adventurers.all[3];
    a?.memory.add({ t: sim.time, kind: 'helped_by', subject: 'player', importance: 0.7 });
    await store.saveState('ai3', sim.exportMeta(SEED), sim.exportPlayer(), sim.exportAdventurers());
    const bundle = await store.load('ai3');
    const again = new GameSimulation({
      seed: SEED,
      worldId: 'ai3',
      playerName: 'tester',
      save: { ...bundle, meta: bundle.meta ? { ...bundle.meta, savedAt: Date.now() } : null },
    });
    const b = again.adventurers.byKey(a?.key ?? '');
    expect(b?.character.level).toBe(a?.character.level);
    expect(b?.memory.events.some((e) => e.kind === 'helped_by')).toBe(true);
    expect(b?.goal?.kind).toBe(a?.goal?.kind);
  });
});
