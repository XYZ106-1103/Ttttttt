import { describe, expect, it } from 'vitest';
import {
  biomeAt,
  createMotorState,
  DEFAULT_MOVEMENT,
  DEFAULT_OVERWORLD,
  LANDMARKS,
  OverworldGenerator,
  seedFromString,
  SIM_DT,
  stepMotor,
  TILE,
  TILE_SIZE,
  World,
  WorldSim,
} from '../src';

const SEED = seedFromString('biomes-test');
const makeWorld = () => new World(new OverworldGenerator({ seed: SEED, ...DEFAULT_OVERWORLD }));

describe('biomes', () => {
  it('lays out seas, frost plains, the village, peaks and the volcano around the spawn', () => {
    const w = makeWorld();
    const sx = w.generator.spawnTileX;
    expect(biomeAt(sx, sx).id).toBe('village');
    expect(biomeAt(sx - 700, sx).id).toBe('tundra');
    expect(biomeAt(sx + 450, sx).id).toBe('mountains');
    expect(biomeAt(sx + LANDMARKS.volcano, sx).id).toBe('volcano');
    expect(biomeAt(5, sx).id).toBe('ocean');
    expect(biomeAt(w.widthTiles - 5, sx).id).toBe('ocean');
    // The seas hold water above a sandy bed.
    const gen = w.generator as OverworldGenerator;
    const x = 20;
    expect(w.getFg(x, gen.seaLevel)).toBe(TILE.water);
    expect(w.getFg(x, w.surfaceY(x))).toBe(TILE.sand);
    // Snow covers the frost plains; the crater holds lava; peaks rise far above the village.
    const tx = sx - 640;
    expect(w.getFg(tx, w.surfaceY(tx))).toBe(TILE.snow);
    const vc = sx + LANDMARKS.volcano;
    let lava = 0;
    for (let y = w.surfaceY(vc) - 12; y < w.surfaceY(vc); y++)
      if (w.getFg(vc, y) === TILE.lava) lava++;
    expect(lava).toBeGreaterThan(0);
    let peak = Infinity;
    for (let px = sx + 340; px < sx + 590; px++) peak = Math.min(peak, w.surfaceY(px));
    expect(w.surfaceY(sx) - peak).toBeGreaterThan(40);
  });

  it('keeps the terrain around the spawn as it was (existing saves line up)', () => {
    const w = makeWorld();
    const sx = w.generator.spawnTileX;
    for (let x = sx - 30; x <= sx + 30; x++) expect(w.getFg(x, w.surfaceY(x))).toBe(TILE.grass);
  });
});

describe('liquids', () => {
  it('water falls into a hole dug below it and lava meeting water turns to obsidian', () => {
    const w = makeWorld();
    const gen = w.generator as OverworldGenerator;
    const x = 30;
    const bed = w.surfaceY(x);
    expect(w.getFg(x, bed - 1)).toBe(TILE.water);
    w.setTile(x, bed, 'fg', 0); // dig the seabed
    for (let i = 0; i < 20; i++) w.stepLiquids();
    expect(w.getFg(x, bed)).toBe(TILE.water);
    // Lava placed next to water hardens.
    const y = gen.seaLevel + 1;
    w.setTile(x + 1, y, 'fg', TILE.lava);
    for (let i = 0; i < 5; i++) w.stepLiquids();
    expect([w.getFg(x + 1, y), w.getFg(x, y)]).toContain(TILE.obsidian);
  });

  it('leaves untouched lakes and seas alone', () => {
    const w = makeWorld();
    w.getFg(20, 200);
    expect(w.activeLiquids).toBe(0);
    expect(w.stepLiquids()).toBe(0);
  });

  it('bodies swim: slow sinking in water, rising while jump is held', () => {
    const w = makeWorld();
    const gen = w.generator as OverworldGenerator;
    const x = 20 * TILE_SIZE + 8;
    const m = createMotorState(x, (gen.seaLevel + 6) * TILE_SIZE, DEFAULT_MOVEMENT);
    const idle = { moveX: 0, jumpHeld: false, jumpPressed: false, down: false };
    for (let i = 0; i < 30; i++) stepMotor(m, idle, w, DEFAULT_MOVEMENT, SIM_DT);
    expect(m.liquid).toBe(1);
    expect(m.vy).toBeLessThanOrEqual(80);
    const y0 = m.y;
    for (let i = 0; i < 30; i++)
      stepMotor(m, { ...idle, jumpHeld: true }, w, DEFAULT_MOVEMENT, SIM_DT);
    expect(m.y).toBeLessThan(y0);
  });

  it('lava burns players who walk into it', () => {
    const sim = new WorldSim({
      seed: SEED,
      worldId: 'lava',
      adventurers: 0,
      monsters: false,
      warmUp: false,
    });
    const slot = sim.addPlayer('p', 'tester');
    const p = slot.character;
    const vc = sim.world.generator.spawnTileX + LANDMARKS.volcano;
    let ly = -1;
    for (let y = sim.world.surfaceY(vc) - 14; y < sim.world.surfaceY(vc); y++)
      if (sim.world.getFg(vc, y) === TILE.lava) {
        ly = y;
        break;
      }
    expect(ly).toBeGreaterThan(0);
    p.motor.x = vc * TILE_SIZE + 8;
    p.motor.y = (ly + 2) * TILE_SIZE;
    const hp0 = p.hp;
    for (let i = 0; i < 90; i++) sim.tick(SIM_DT);
    expect(p.hp).toBeLessThan(hp0);
    expect(p.statuses.all.some((s) => s.def.id === 'burn') || !p.alive).toBe(true);
  });
});
