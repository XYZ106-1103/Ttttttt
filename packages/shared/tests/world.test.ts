import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  COLLISION_PLATFORM,
  COLLISION_SOLID,
  DEFAULT_OVERWORLD,
  OverworldGenerator,
  START_ZONE,
  TILE,
  World,
  regionAt,
  seedFromString,
  tileToChunk,
  tileToLocal,
} from '../src';

function makeWorld(seed = seedFromString('PROJECT-WORLD')) {
  return new World(new OverworldGenerator({ seed, ...DEFAULT_OVERWORLD }));
}

describe('coords', () => {
  it('maps negative tiles to the right chunk and local index', () => {
    expect(tileToChunk(-1)).toBe(-1);
    expect(tileToLocal(-1)).toBe(CHUNK_SIZE - 1);
    expect(tileToChunk(CHUNK_SIZE)).toBe(1);
    expect(tileToLocal(CHUNK_SIZE + 3)).toBe(3);
  });
});

describe('World + OverworldGenerator', () => {
  it('generates identical chunks for the same seed regardless of access order', () => {
    const a = makeWorld();
    const b = makeWorld();
    const sx = tileToChunk(a.generator.spawnTileX);
    const sy = tileToChunk(a.surfaceY(a.generator.spawnTileX));
    const order = [
      [sx, sy],
      [sx + 1, sy],
      [sx - 1, sy + 1],
      [sx + 3, sy - 1],
    ] as const;
    for (const [cx, cy] of order) a.getChunk(cx, cy);
    for (const [cx, cy] of [...order].reverse()) b.getChunk(cx, cy);
    for (const [cx, cy] of order) {
      expect(Array.from(a.getChunk(cx, cy)!.fg)).toEqual(Array.from(b.getChunk(cx, cy)!.fg));
      expect(a.objectsInChunk(cx, cy)).toEqual(b.objectsInChunk(cx, cy));
    }
  });

  it('produces different terrain for different seeds', () => {
    const a = makeWorld(1);
    const b = makeWorld(2);
    let diff = 0;
    for (let x = 0; x < a.widthTiles; x += 16) if (a.surfaceY(x) !== b.surfaceY(x)) diff++;
    expect(diff).toBeGreaterThan(10);
  });

  it('places grass only where it is exposed to air', () => {
    const w = makeWorld();
    const x0 = w.generator.spawnTileX - 150;
    for (let x = x0; x < x0 + 300; x++) {
      const s = w.surfaceY(x);
      for (let y = s - 30; y < s + 20; y++) {
        if (w.getFg(x, y) === TILE.grass) expect(w.getFg(x, y - 1)).not.toBe(TILE.dirt);
      }
    }
  });

  it('has a flat, open campsite at spawn with solid ground underfoot', () => {
    const w = makeWorld();
    const sx = w.generator.spawnTileX;
    const s = w.surfaceY(sx);
    for (let dx = -20; dx <= 20; dx++) expect(w.surfaceY(sx + dx)).toBe(s);
    const spawn = w.spawnPoint();
    expect(spawn.y).toBe(s * 16);
    expect(w.collisionAt(sx, s)).toBe(COLLISION_SOLID);
    for (let k = 1; k <= 4; k++) expect(w.collisionAt(sx, s - k)).toBe(0);
  });

  it('builds the start-zone platforms and islands', () => {
    const w = makeWorld();
    const gen = w.generator as OverworldGenerator;
    const sx = gen.spawnTileX;
    const gy = gen.spawnGroundY;
    for (const p of START_ZONE.platforms) {
      const mid = sx + Math.round((p.from + p.to) / 2);
      expect(w.collisionAt(mid, gy + p.height)).toBe(COLLISION_PLATFORM);
    }
    for (const isl of START_ZONE.islands) {
      const mid = sx + Math.round((isl.from + isl.to) / 2);
      expect(w.getFg(mid, gy + isl.height)).toBe(TILE.grass);
    }
  });

  it('generates flora and the campfire around spawn', () => {
    const w = makeWorld();
    const sx = w.generator.spawnTileX;
    const sy = w.surfaceY(sx);
    const keys = new Set<string>();
    for (let cx = tileToChunk(sx) - 3; cx <= tileToChunk(sx) + 3; cx++) {
      for (const o of w.objectsInChunk(cx, tileToChunk(sy - 1))) keys.add(o.key);
    }
    expect(keys.has('campfire')).toBe(true);
    expect(keys.has('grass_tuft')).toBe(true);
    expect([...keys].some((k) => k.startsWith('tree_'))).toBe(true);
  });

  it('treats world edges as solid and the sky as open', () => {
    const w = makeWorld();
    expect(w.collisionAt(-1, 100)).toBe(COLLISION_SOLID);
    expect(w.collisionAt(w.widthTiles, 100)).toBe(COLLISION_SOLID);
    expect(w.collisionAt(10, -5)).toBe(0);
  });

  it('emits change events and bumps chunk version on setTile', () => {
    const w = makeWorld();
    const sx = w.generator.spawnTileX;
    const sy = w.surfaceY(sx) - 3;
    const chunk = w.getChunk(tileToChunk(sx), tileToChunk(sy))!;
    const v = chunk.version;
    let events = 0;
    w.onTileChange(() => events++);
    expect(w.setTile(sx, sy, 'fg', TILE.dirt)).toBe(true);
    expect(w.getFg(sx, sy)).toBe(TILE.dirt);
    expect(chunk.version).toBe(v + 1);
    expect(chunk.modified).toBe(true);
    expect(events).toBe(1);
    expect(() => w.setTile(sx, sy, 'fg', TILE.dirtWall)).toThrow();
  });

  it('resolves regions relative to spawn', () => {
    expect(regionAt(1000, 1000).id).toBe('starting_hill');
    expect(regionAt(900, 1000).id).toBe('windswept_meadow');
    expect(regionAt(1100, 1000).id).toBe('blue_ridge');
  });
});
