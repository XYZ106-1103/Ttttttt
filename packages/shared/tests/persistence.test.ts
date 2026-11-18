import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  DEFAULT_OVERWORLD,
  OverworldGenerator,
  rleDecode,
  rleEncode,
  seedFromString,
  TILE,
  tileToChunk,
  World,
} from '../src';

const gen = () =>
  new OverworldGenerator({ seed: seedFromString('PROJECT-WORLD'), ...DEFAULT_OVERWORLD });

describe('RLE', () => {
  it('round-trips and compresses terrain', () => {
    const a = new Uint16Array(1024);
    a.fill(3, 200, 900);
    a[500] = 7;
    const enc = rleEncode(a);
    expect(enc.length).toBeLessThan(20);
    const b = new Uint16Array(1024);
    expect(rleDecode(enc, b)).toBe(true);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('rejects malformed data', () => {
    const out = new Uint16Array(4);
    expect(rleDecode([1, 3], out)).toBe(false);
    expect(rleDecode([1, -4, 0, 8], out)).toBe(false);
    expect(rleDecode([1], out)).toBe(false);
  });
});

describe('World persistence', () => {
  it('saves modified chunks and restores them in a fresh world', () => {
    const a = new World(gen());
    const x = a.generator.spawnTileX + 3;
    const y = a.surfaceY(x) - 2;
    a.setTile(x, y, 'fg', TILE.stoneBricks);
    a.setTile(x, a.surfaceY(x) + 1, 'fg', 0);
    const saved = a.collectDirty();
    expect(saved.length).toBeGreaterThan(0);
    expect(a.collectDirty()).toEqual([]); // nothing new

    const b = new World(gen());
    b.loadPersisted(JSON.parse(JSON.stringify(saved)));
    expect(b.getFg(x, y)).toBe(TILE.stoneBricks);
    expect(b.getFg(x, b.surfaceY(x) + 1)).toBe(0);
  });

  it('persists removed objects', () => {
    const a = new World(gen());
    const sx = a.generator.spawnTileX;
    const cy = tileToChunk(a.surfaceY(sx) - 1);
    const obj = a.objectsInChunk(tileToChunk(sx), cy)[0]!;
    expect(a.removeObject(obj)).toBe(true);
    const saved = a.collectDirty();
    const b = new World(gen());
    b.loadPersisted(saved);
    expect(b.objectsInChunk(tileToChunk(sx), cy).some((o) => o.id === obj.id)).toBe(false);
  });

  it('evicts far chunks and restores modified data on demand', () => {
    const w = new World(gen());
    const x = w.generator.spawnTileX;
    const y = w.surfaceY(x) - 2;
    w.setTile(x, y, 'fg', TILE.woodPlanks);
    for (let cx = 0; cx < w.widthChunks; cx += 4) w.getChunk(cx, tileToChunk(y));
    const before = w.chunkCount;
    const evicted = w.evictOutside(0, 0, 0, 0);
    expect(evicted).toBe(before - (w.peekChunk(0, 0) ? 1 : 0));
    expect(w.peekChunk(tileToChunk(x), tileToChunk(y))).toBeUndefined();
    expect(w.getFg(x, y)).toBe(TILE.woodPlanks);
  });

  it('bumps neighbor render versions when a border tile changes', () => {
    const w = new World(gen());
    const cx = tileToChunk(w.generator.spawnTileX);
    const cy = tileToChunk(w.surfaceY(w.generator.spawnTileX));
    const right = w.getChunk(cx + 1, cy)!;
    const v = right.version;
    w.setTile((cx + 1) * CHUNK_SIZE - 1, cy * CHUNK_SIZE + 5, 'fg', TILE.stone);
    expect(right.version).toBe(v + 1);
    expect(right.modified).toBe(false);
  });
});

describe('underground generation', () => {
  it('has caves and both ores below the surface', () => {
    const w = new World(gen());
    let air = 0;
    let copper = 0;
    let iron = 0;
    let total = 0;
    for (let x = 200; x < 1800; x += 3) {
      const s = w.surfaceY(x);
      for (let y = s + 14; y < Math.min(w.heightTiles - 1, s + 200); y += 2) {
        const t = w.getFg(x, y);
        total++;
        if (t === 0) air++;
        if (t === TILE.copperOre) copper++;
        if (t === TILE.ironOre) iron++;
      }
    }
    expect(air / total).toBeGreaterThan(0.04);
    expect(air / total).toBeLessThan(0.35);
    expect(copper / total).toBeGreaterThan(0.005);
    expect(iron / total).toBeGreaterThan(0.002);
  });

  it('keeps the starting campsite surface intact (no cave holes near spawn)', () => {
    const w = new World(gen());
    const sx = w.generator.spawnTileX;
    for (let x = sx - 20; x <= sx + 20; x++) {
      const s = w.surfaceY(x);
      for (let y = s; y < s + 10; y++) expect(w.getFg(x, y)).not.toBe(0);
    }
  });
});
