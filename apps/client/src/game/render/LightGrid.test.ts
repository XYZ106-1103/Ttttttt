import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERWORLD, OverworldGenerator, seedFromString, World } from '@world/shared';
import { LIGHT_RANGE, LightGrid } from './LightGrid';

function world() {
  return new World(
    new OverworldGenerator({ seed: seedFromString('PROJECT-WORLD'), ...DEFAULT_OVERWORLD }),
  );
}

describe('LightGrid', () => {
  it('lights open sky with ambient and fades with depth into terrain', () => {
    const w = world();
    const sx = w.generator.spawnTileX;
    const sy = w.surfaceY(sx);
    const g = new LightGrid();
    g.resize(20, 30);
    g.compute(w, sx - 10, sy - 10, [1, 1, 1], []);
    const sky = g.sample(sx, sy - 5);
    const surface = g.sample(sx, sy);
    const deep = g.sample(sx, sy + 12);
    expect(sky[0]).toBeCloseTo(1, 5);
    expect(surface[0]).toBeLessThan(1);
    expect(surface[0]).toBeGreaterThan(0.6);
    expect(deep[0]).toBeLessThan(surface[0] * 0.1);
  });

  it('spreads colored point light that decays with distance', () => {
    const w = world();
    const sx = w.generator.spawnTileX;
    const sy = w.surfaceY(sx);
    const g = new LightGrid();
    g.resize(30, 30);
    g.compute(w, sx - 15, sy - 15, [0, 0, 0], [{ tx: sx, ty: sy - 1, r: 1.6, g: 1, b: 0.5 }]);
    const at = g.sample(sx, sy - 1);
    const near = g.sample(sx + 2, sy - 1);
    const far = g.sample(sx + 10, sy - 1);
    expect(at[0]).toBeCloseTo(1.6, 5);
    expect(near[0]).toBeLessThan(at[0]);
    expect(far[0]).toBeLessThan(near[0]);
    expect(near[0]).toBeGreaterThan(near[2]);
  });

  it('encodes into RGBA bytes within the light range', () => {
    const g = new LightGrid();
    g.resize(2, 1);
    g.r[0] = LIGHT_RANGE;
    g.g[0] = 1;
    const out = new Uint8ClampedArray(8);
    g.encode(out);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(128);
    expect(out[3]).toBe(255);
  });
});
