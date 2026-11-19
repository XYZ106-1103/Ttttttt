import { describe, expect, it } from 'vitest';
import {
  Adventurer,
  AdventurerDirector,
  type BrainEnv,
  CombatWorld,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  generateProfile,
  housekeeping,
  Memory,
  MonsterManager,
  OverworldGenerator,
  planItem,
  scoreActions,
  seedFromString,
  TRAITS,
  World,
} from '../src';

const SEED = seedFromString('PROJECT-WORLD');
const world = new World(new OverworldGenerator({ seed: SEED, ...DEFAULT_OVERWORLD }));
const sx = world.generator.spawnTileX;

function env(
  combat: CombatWorld,
  monsters: MonsterManager,
  nav: AdventurerDirector['nav'],
  player = null,
): BrainEnv {
  return {
    world,
    nav,
    combat,
    monsters: monsters.monsters,
    drops: [],
    player,
    now: 100,
    dt: 1 / 60,
    safeFrom: sx - 34,
    safeTo: sx + 34,
    night: false,
    pathBudget: 2,
    events: [],
  };
}

describe('adventurer identity', () => {
  it('generates deterministic, unique people with coherent traits', () => {
    const taken = new Set<string>();
    const a = Array.from({ length: 30 }, (_, i) => generateProfile(SEED, i, sx, taken));
    const again = generateProfile(SEED, 3, sx, new Set());
    expect(again.personality).toEqual(a[3]?.personality);
    expect(new Set(a.map((p) => p.name.ko)).size).toBe(30);
    for (const p of a) for (const t of TRAITS) expect(p.personality[t]).toBeGreaterThan(0);
    expect(new Set(a.map((p) => p.archetype)).size).toBeGreaterThan(1);
    expect(new Set(a.map((p) => p.preferredJob)).size).toBeGreaterThan(2);
    expect(a.every((p) => Math.abs(p.homeX - sx) <= 26)).toBe(true);
  });
});

describe('planning and memory', () => {
  it('plans crafting chains down to raw materials and where to get them', () => {
    const none = planItem(() => 0, 'copper_sword', 1);
    const kinds = new Map(none.needs.map((n) => [n.itemId, n.source.kind]));
    expect(kinds.get('copper_ore')).toBe('tile');
    expect(kinds.get('wood')).toBe('object');
    const inv: Record<string, number> = { copper_ore: 12, wood: 3 };
    const ready = planItem((id) => inv[id] ?? 0, 'copper_sword', 1);
    expect(ready.needs).toEqual([]);
    expect(ready.craftable.map((r) => r.id)).toEqual(['copper_sword']);
    const potions = planItem(() => 0, 'healing_potion', 2);
    expect(potions.needs.find((n) => n.itemId === 'slime_gel')?.source.kind).toBe('monster');
  });

  it('remembers important things longer, tracks danger and relationships, and round-trips', () => {
    const m = new Memory();
    m.add({ t: 0, kind: 'died', x: 500, importance: 0.85 });
    m.add({ t: 0, kind: 'crafted', detail: 'torch', importance: 0.2 });
    m.add({ t: 3000, kind: 'met', subject: 'player', importance: 0.5 });
    expect(m.recall(3600, 1)[0]?.kind).toBe('died');
    expect(m.dangerNear(510, 3600)).toBeGreaterThan(0.5);
    expect(m.dangerNear(900, 3600)).toBe(0);
    m.adjust('player', 0.4);
    const copy = new Memory();
    copy.load(JSON.parse(JSON.stringify(m.toJSON())));
    expect(copy.events.length).toBe(3);
    expect(copy.relation('player').affinity).toBeCloseTo(0.4);
  });
});

describe('brain', () => {
  it('advances its job at level 10, learns skills, fills the skill bar and keeps tools in the hotbar', () => {
    const combat = new CombatWorld(world, 1);
    const a = new Adventurer(
      generateProfile(SEED, 5, sx, new Set()),
      combat.newId(),
      sx * 16,
      world.surfaceY(sx) * 16,
      DEFAULT_MOVEMENT,
    );
    a.character.gainExp(5000);
    const events: never[] = [];
    housekeeping(a, 10, events, world.widthTiles);
    expect(a.character.level).toBeGreaterThanOrEqual(10);
    expect(a.character.jobId).toBe(a.profile.preferredJob);
    expect(a.character.progress.statPoints).toBe(0);
    expect(Object.keys(a.character.skills).length).toBeGreaterThan(1);
    expect(a.character.skillBar.some((s) => s !== null)).toBe(true);
    expect(a.character.inventory.get(1)?.itemId).toBe('worn_pickaxe');
    expect(a.character.inventory.get(2)?.itemId).toBe('worn_axe');
    expect(a.goal).not.toBeNull();
  });

  it('weighs fleeing by caution and HP, and prefers fighting a nearby monster when healthy', () => {
    const combat = new CombatWorld(world, 1);
    const monsters = new MonsterManager(world, combat, 2);
    const director = new AdventurerDirector(world, combat, DEFAULT_MOVEMENT, {
      count: 0,
      seed: SEED,
      homeCenter: sx,
      safeFrom: sx - 34,
      safeTo: sx + 34,
    });
    const x = (sx + 60) * 16;
    const y = world.surfaceY(sx + 60) * 16;
    const a = new Adventurer(
      generateProfile(SEED, 1, sx, new Set()),
      combat.newId(),
      x,
      y,
      DEFAULT_MOVEMENT,
    );
    combat.add(a.character);
    const slime = monsters.spawn('dew_slime', x + 40, y - 10);
    slime.targetId = a.character.id;
    const e = env(combat, monsters, director.nav);
    const healthy = scoreActions(a, e);
    expect(healthy.fight).toBeGreaterThan(healthy.wander);
    expect(healthy.flee).toBe(0);
    a.character.hp = 1;
    const hurt = scoreActions(a, e);
    expect(hurt.flee).toBeGreaterThan(hurt.fight);
  });
});

describe('director', () => {
  it('promotes nearby adventurers (capped) and demotes far ones', () => {
    const combat = new CombatWorld(world, 1);
    const d = new AdventurerDirector(world, combat, DEFAULT_MOVEMENT, {
      count: 20,
      seed: SEED,
      homeCenter: sx,
      safeFrom: sx - 34,
      safeTo: sx + 34,
      maxActive: 6,
    });
    d.updateTiers([{ x: sx * 16, y: world.surfaceY(sx) * 16 }], 0, true);
    expect(d.active.length).toBe(6);
    for (const a of d.active) expect(combat.combatants.has(a.character.id)).toBe(true);
    d.updateTiers([{ x: (sx + 400) * 16, y: world.surfaceY(sx + 400) * 16 }], 1, true);
    expect(d.active.length).toBe(0);
    expect([...combat.combatants.values()].filter((c) => c.kind === 'adventurer').length).toBe(0);
  });

  it('progresses off-screen adventurers with the same rules and survives a save round-trip', () => {
    const combat = new CombatWorld(world, 1);
    const d = new AdventurerDirector(world, combat, DEFAULT_MOVEMENT, {
      count: 6,
      seed: SEED,
      homeCenter: sx,
      safeFrom: sx - 34,
      safeTo: sx + 34,
    });
    const before = d.all.map((a) => a.character.progress.exp + a.character.level * 1e6);
    d.catchUp(45 * 60, 45 * 60);
    const after = d.all.map((a) => a.character.progress.exp + a.character.level * 1e6);
    expect(after.some((v, i) => v > (before[i] ?? 0))).toBe(true);
    expect(d.all.some((a) => a.character.level > 1)).toBe(true);
    const saved = JSON.parse(JSON.stringify(d.toJSON()));
    const d2 = new AdventurerDirector(world, new CombatWorld(world, 1), DEFAULT_MOVEMENT, {
      count: 6,
      seed: SEED,
      homeCenter: sx,
      safeFrom: sx - 34,
      safeTo: sx + 34,
    });
    d2.load(saved);
    expect(d2.all.map((a) => a.character.level)).toEqual(d.all.map((a) => a.character.level));
    expect(d2.all.map((a) => a.goal?.kind)).toEqual(d.all.map((a) => a.goal?.kind));
  });
});
