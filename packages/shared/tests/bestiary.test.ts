import { describe, expect, it } from 'vitest';
import {
  biomeAt,
  DEFAULT_OVERWORLD,
  ITEM_DEFS,
  itemRegistry,
  MONSTER_DEFS,
  OverworldGenerator,
  pickSpawn,
  RECIPE_DEFS,
  Rng,
  seedFromString,
  SIM_DT,
  TILE,
  TILE_SIZE,
  World,
  WorldSim,
} from '../src';

const SEED = seedFromString('bestiary-test');

describe('biome bestiary', () => {
  const world = new World(new OverworldGenerator({ seed: SEED, ...DEFAULT_OVERWORLD }));
  const sx = world.generator.spawnTileX;

  /** Monster ids that spawn on the surface around a column. */
  function surfaceSpawns(tx: number, night = false): Set<string> {
    const rng = new Rng(tx);
    const ids = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const pick = pickSpawn({
        world,
        night,
        x: tx * TILE_SIZE,
        y: world.surfaceY(tx) * TILE_SIZE,
        safeFrom: sx - 34,
        safeTo: sx + 34,
        rng,
        torchTile: TILE.torch,
      });
      if (pick) ids.add(pick.def.id);
    }
    return ids;
  }

  it('spawns biome monsters only in their biomes', () => {
    const tundra = surfaceSpawns(sx - 700);
    expect(tundra.has('frost_slime') || tundra.has('snow_wolf')).toBe(true);
    expect(tundra.has('dew_slime')).toBe(false);
    const volcano = surfaceSpawns(sx + 680);
    expect([...volcano].some((id) => ['magma_slime', 'ash_crawler', 'fire_imp'].includes(id))).toBe(
      true,
    );
    expect(volcano.has('thornback')).toBe(false);
    const meadow = surfaceSpawns(sx - 200);
    for (const id of meadow) expect(['dew_slime', 'thornback']).toContain(id);
  });

  it('every spawn rule names real biomes and every drop is a real item', () => {
    for (const d of MONSTER_DEFS) {
      for (const b of d.spawn?.biomes ?? []) {
        let seen = false;
        for (let x = -1000; x < 1000 && !seen; x += 8) seen = biomeAt(sx + x, sx).id === b;
        expect(seen, `${d.id} biome ${b}`).toBe(true);
      }
      for (const l of d.drops)
        expect(itemRegistry.get(l.item), `${d.id} drop ${l.item}`).toBeTruthy();
    }
  });

  it('every gear tier is craftable from materials that exist', () => {
    const recipeOut = new Set(RECIPE_DEFS.map((r) => r.output.item));
    for (const key of ['silver', 'frostite', 'magmite', 'crystal'])
      for (const kind of ['sword', 'staff', 'bow', 'dagger', 'helmet', 'armor', 'greaves'])
        expect(recipeOut.has(`${key}_${kind}`), `${key}_${kind}`).toBe(true);
    for (const r of RECIPE_DEFS)
      for (const i of [r.output, ...r.inputs])
        expect(itemRegistry.get(i.item), `${r.id}: ${i.item}`).toBeTruthy();
    // Every non-block item that is not a starter or drop can be obtained some way.
    const dropped = new Set(MONSTER_DEFS.flatMap((d) => d.drops.map((l) => l.item)));
    for (const def of ITEM_DEFS) {
      if (def.kind === 'material' && !def.id.endsWith('_ore') && def.id !== 'crystal_shard')
        expect(
          dropped.has(def.id) ||
            recipeOut.has(def.id) ||
            ['wood', 'fiber', 'wildflower', 'mushroom'].includes(def.id),
          def.id,
        ).toBe(true);
    }
  });
});

describe('biome bosses', () => {
  const makeSim = () =>
    new WorldSim({ seed: SEED, worldId: 'boss', adventurers: 0, monsters: false, warmUp: false });

  function standAt(
    sim: WorldSim,
    p: ReturnType<WorldSim['addPlayer']>['character'],
    tx: number,
  ): void {
    p.motor.x = tx * TILE_SIZE + 8;
    p.motor.y = sim.world.surfaceY(tx) * TILE_SIZE;
    p.motor.vx = 0;
    p.motor.vy = 0;
  }

  it('sigils only work in their own region', () => {
    const sim = makeSim();
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    p.inventory.add('frost_sigil', 1);
    const idx = () => {
      for (let i = 0; i < p.inventory.size; i++)
        if (p.inventory.get(i)?.itemId === 'frost_sigil') return i;
      return -1;
    };
    expect(sim.consume('p', idx())).toBe(false);
    expect(
      slot.events.notices.some((n) => n.kind === 'consumeFail' && n.reason === 'wrong_biome'),
    ).toBe(true);
    standAt(sim, p, sim.world.generator.spawnTileX - 640);
    for (let i = 0; i < 5; i++) sim.tick(SIM_DT);
    expect(sim.consume('p', idx())).toBe(true);
    expect(sim.monsters.bossActive?.def.id).toBe('frost_giant');
  });

  it.each([
    ['frost_giant', -640, ['ice_chunk', 'frost_wave', 'icicle']],
    ['magma_tyrant', 650, ['magma_ball', 'lava_wave', 'meteor']],
  ] as const)('%s fights with its own projectiles', (id, rel, shots) => {
    const sim = makeSim();
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    standAt(sim, p, sim.world.generator.spawnTileX + rel);
    const boss = sim.monsters.spawn(id, p.motor.x + 150, p.motor.y);
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 40 && seen.size < 2; i++) {
      p.hp = p.stats.maxHp;
      sim.tick(SIM_DT);
      for (const pr of sim.combat.projectiles) seen.add(pr.def.id);
    }
    expect(boss.def.boss).toBe(true);
    expect([...seen].some((s) => (shots as readonly string[]).includes(s))).toBe(true);
    expect(seen.has('boulder') || seen.has('shockwave')).toBe(false);
  });
});
