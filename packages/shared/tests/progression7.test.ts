import { describe, expect, it } from 'vitest';
import {
  Character,
  dailyBounties,
  DEFAULT_MOVEMENT,
  ENHANCE_STONE,
  Inventory,
  itemRegistry,
  NPC_DEFS,
  QUEST_DEFS,
  SIM_DT,
  STORY_QUESTS,
  TILE_SIZE,
  WorldSim,
} from '../src';

const makeSim = () =>
  new WorldSim({ seed: 77, worldId: 'p7', adventurers: 0, monsters: false, warmUp: false });

function stand(sim: WorldSim, c: Character, npcId: string): void {
  const def = NPC_DEFS.find((n) => n.id === npcId);
  if (!def) throw new Error(npcId);
  const tx = sim.world.generator.spawnTileX + def.x + 1;
  c.motor.x = tx * TILE_SIZE + 8;
  c.motor.y = sim.world.surfaceY(tx) * TILE_SIZE;
  for (let i = 0; i < 10; i++) sim.tick(SIM_DT);
}

function slotOf(inv: Inventory, itemId: string): number {
  for (let i = 0; i < inv.size; i++) if (inv.get(i)?.itemId === itemId) return i;
  return -1;
}

describe('enhancement', () => {
  it('keeps the level on the item through moves, equipping, saves and loads', () => {
    const inv = new Inventory();
    inv.add('iron_helmet', 1);
    inv.setPlus(0, 4);
    expect(inv.get(0)?.plus).toBe(4);
    inv.move(0, 7);
    expect(inv.get(7)?.plus).toBe(4);
    inv.click(7, 'left');
    expect(inv.cursor?.plus).toBe(4);
    inv.click(3, 'left');
    expect(inv.get(3)?.plus).toBe(4);
    const copy = new Inventory();
    copy.load(JSON.parse(JSON.stringify(inv.toJSON())));
    expect(copy.get(3)).toEqual({ itemId: 'iron_helmet', count: 1, plus: 4 });
    // Untrusted saves are clamped; materials never carry a level.
    copy.load({
      slots: [
        { itemId: 'iron_helmet', count: 1, plus: 99 },
        { itemId: 'wood', count: 5, plus: 3 },
      ],
      cursor: null,
    });
    expect(copy.get(0)?.plus).toBe(10);
    expect(copy.get(1)?.plus).toBeUndefined();

    const c = new Character(1, 'player', 'tester', 0, 0, DEFAULT_MOVEMENT);
    c.level = 20;
    c.progress = { ...c.progress, level: 20 };
    c.inventory.add('iron_armor', 1);
    const at = slotOf(c.inventory, 'iron_armor');
    c.inventory.setPlus(at, 6);
    const base = c.computeStats(0).defense;
    expect(c.equipment.equipFrom(c.inventory, at, 20)).toBeNull();
    expect(c.equipment.get('body')?.plus).toBe(6);
    const boosted = c.computeStats(0).defense;
    expect(boosted).toBeGreaterThan(base);
    const snap = JSON.parse(JSON.stringify(c.exportSnapshot()));
    const d = new Character(2, 'player', 'copy', 0, 0, DEFAULT_MOVEMENT);
    d.importSnapshot(snap);
    expect(d.equipment.get('body')?.plus).toBe(6);
    expect(d.equipment.unequip(d.inventory, 'body')).toBeNull();
    expect(d.inventory.get(slotOf(d.inventory, 'iron_armor'))?.plus).toBe(6);
  });

  it('enhanced weapons hit harder', () => {
    const c = new Character(1, 'player', 'tester', 0, 0, DEFAULT_MOVEMENT);
    c.inventory.replaceAt(0, { itemId: 'training_sword', count: 1 });
    c.selectedSlot = 0;
    const a0 = c.heldWeapon()?.attack ?? 0;
    c.inventory.setPlus(0, 10);
    expect(c.heldWeapon()?.attack).toBeGreaterThan(a0);
  });

  it('enhanced items are bound: not sold, listed or traded by id', () => {
    const sim = makeSim();
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    p.inventory.add('iron_sword', 1);
    const at = slotOf(p.inventory, 'iron_sword');
    p.inventory.setPlus(at, 2);
    expect(p.inventory.count('iron_sword')).toBe(0);
    stand(sim, p, 'shopkeeper');
    const r = slot.town.shopSell('shopkeeper', at, 1);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('bound');
    expect(p.inventory.get(at)?.plus).toBe(2);
  });

  it('the blacksmith charges gold and stones, and levels go up or (from +5) down', () => {
    const sim = makeSim();
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    p.inventory.add('copper_helmet', 1);
    const at = slotOf(p.inventory, 'copper_helmet');
    stand(sim, p, 'registrar');
    expect(slot.town.enhance(at)).toEqual({ ok: false, reason: 'too_far' });
    stand(sim, p, 'blacksmith');
    expect(slot.town.enhance(at)).toEqual({ ok: false, reason: 'no_gold' });
    p.gold = 1_000_000;
    expect(slot.town.enhance(at)).toEqual({ ok: false, reason: 'no_stones' });
    p.inventory.add(ENHANCE_STONE, 5000);
    const r = slot.town.enhance(at);
    expect(r.ok && r.outcome).toBe('success'); // +0 → +1 always succeeds
    expect(p.inventory.get(at)?.plus).toBe(1);
    let drops = 0;
    let tries = 0;
    while ((p.inventory.get(at)?.plus ?? 0) < 10 && tries < 3000) {
      const before = p.inventory.get(at)?.plus ?? 0;
      const e = slot.town.enhance(at);
      tries++;
      if (!e.ok) throw new Error(e.reason);
      if (e.outcome === 'drop') {
        drops++;
        expect(e.plus).toBe(before - 1);
        expect(before).toBeGreaterThanOrEqual(5);
      }
      if (e.outcome === 'fail') expect(e.plus).toBe(before);
    }
    expect(p.inventory.get(at)?.plus).toBe(10);
    expect(drops).toBeGreaterThan(0);
    expect(slot.town.enhance(at)).toEqual({ ok: false, reason: 'max' });
    expect(slot.town.enhance(slotOf(p.inventory, ENHANCE_STONE))).toEqual({
      ok: false,
      reason: 'not_gear',
    });
    expect(slot.events.notices.some((n) => n.kind === 'enhanced')).toBe(true);
  });
});

describe('quests', () => {
  it('every quest references real monsters, items and chapters', () => {
    for (const q of QUEST_DEFS) {
      if (q.prereq) expect(STORY_QUESTS.some((s) => s.id === q.prereq)).toBe(true);
      for (const it of q.reward.items) expect(itemRegistry.get(it.item), it.item).toBeTruthy();
      for (const o of q.objectives) {
        if (o.kind === 'collect' || o.kind === 'craft')
          expect(itemRegistry.get(o.item)).toBeTruthy();
      }
    }
  });

  it('runs the first chapters: accept at the guide, track kills/crafts/enhance, turn in for rewards', () => {
    const sim = makeSim();
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    expect(slot.town.acceptQuest('first_steps')).toEqual({ ok: false, reason: 'too_far' });
    stand(sim, p, 'guide');
    expect(p.quests.available('p', p.level, sim.clock.day)[0]?.id).toBe('first_steps');
    expect(slot.town.acceptQuest('beetle_trouble')).toEqual({ ok: false, reason: 'locked' });
    expect(slot.town.acceptQuest('first_steps')).toEqual({ ok: true });
    expect(slot.town.turnInQuest('first_steps')).toEqual({ ok: false, reason: 'incomplete' });
    for (let i = 0; i < 5; i++) {
      const m = sim.monsters.spawn('dew_slime', p.motor.x + 30, p.motor.y);
      m.damageBy.set(p.id, m.stats.maxHp);
      sim.combat.kill(m, p.id);
      sim.tick(SIM_DT);
    }
    const gold0 = p.gold;
    const exp0 = p.progress.exp + p.level * 1e6;
    expect(slot.town.turnInQuest('first_steps')).toEqual({ ok: true });
    expect(p.gold).toBe(gold0 + 30);
    expect(p.progress.exp + p.level * 1e6).toBeGreaterThan(exp0);
    expect(p.quests.isDone('first_steps')).toBe(true);
    expect(slot.events.notices.some((n) => n.kind === 'questDone')).toBe(true);
    // Chapter 2: crafting counts.
    p.level = 5;
    p.progress = { ...p.progress, level: 5 };
    expect(slot.town.acceptQuest('tools_of_the_trade')).toEqual({ ok: true });
    p.inventory.add('copper_ore', 10);
    p.inventory.add('wood', 4);
    expect(sim.craft('p', 'copper_pickaxe').ok).toBe(true);
    expect(slot.town.turnInQuest('tools_of_the_trade')).toEqual({ ok: true });
    // The save keeps the log.
    const d = new Character(9, 'player', 'copy', 0, 0, DEFAULT_MOVEMENT);
    d.importSnapshot(JSON.parse(JSON.stringify(p.exportSnapshot())));
    expect(d.quests.isDone('tools_of_the_trade')).toBe(true);
  });

  it('reach objectives complete by standing in the biome; bounties repeat daily', () => {
    const sim = makeSim();
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    p.level = 30;
    p.progress = { ...p.progress, level: 30 };
    stand(sim, p, 'guide');
    const bounty = dailyBounties('p', sim.clock.day, 30)[0];
    expect(bounty).toBeTruthy();
    if (!bounty) return;
    expect(slot.town.acceptQuest(bounty.id)).toEqual({ ok: true });
    const o = bounty.objectives[0];
    if (o?.kind === 'kill') {
      for (let i = 0; i < o.count; i++) {
        const m = sim.monsters.spawn(o.target, p.motor.x + 40, p.motor.y);
        m.damageBy.set(p.id, m.stats.maxHp);
        sim.combat.kill(m, p.id);
        sim.tick(SIM_DT);
      }
    } else if (o?.kind === 'collect') p.inventory.add(o.item, o.count);
    expect(slot.town.turnInQuest(bounty.id)).toEqual({ ok: true });
    expect(slot.town.acceptQuest(bounty.id)).toEqual({ ok: false, reason: 'not_offered' });
    // Story "reach": walk to the frost plains.
    p.quests.load({
      done: [
        'first_steps',
        'tools_of_the_trade',
        'beetle_trouble',
        'sharpen_up',
        'into_the_dark',
        'heart_of_stone',
      ],
      active: [],
      bounties: {},
    });
    expect(slot.town.acceptQuest('cold_frontier')).toEqual({ ok: true });
    const tx = sim.world.generator.spawnTileX - 640;
    p.motor.x = tx * TILE_SIZE + 8;
    p.motor.y = sim.world.surfaceY(tx) * TILE_SIZE;
    for (let i = 0; i < 40; i++) sim.tick(SIM_DT);
    expect(p.quests.active.find((q) => q.id === 'cold_frontier')?.progress[0]).toBe(1);
  });
});
