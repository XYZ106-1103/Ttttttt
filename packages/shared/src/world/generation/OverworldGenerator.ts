import { CHUNK_SIZE } from '../../constants';
import { getObjectDef } from '../../data/objects';
import { fbm1D, fbm2D, valueNoise1D } from '../../math/noise';
import { deriveSeed, hash1f, hash2, hash2f, Rng } from '../../math/rng';
import { clamp, lerp, smoothstep } from '../../math/scalar';
import type { Chunk } from '../Chunk';
import { localIndex } from '../coords';
import { TILE } from '../TileRegistry';
import type { TileReader, WorldGenerator, WorldObject } from '../types';
import { IslandStamp, PlatformStamp, PostStamp, ShaftStamp, type TileStamp } from './stamps';
import { START_ZONE, type StartZoneLayout, type TerrainShape } from './startZone';

export interface OverworldConfig {
  readonly seed: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** Mean row of the natural ground surface. */
  readonly surfaceBase: number;
  readonly startZone?: StartZoneLayout;
}

export const DEFAULT_OVERWORLD: Omit<OverworldConfig, 'seed'> = {
  widthTiles: 2048,
  heightTiles: 512,
  surfaceBase: 192,
};

/** Tiles of air required above a tree's anchor tile. */
const TREE_CLEARANCE = 7;
const TREE_CELL = 7;

/**
 * PHASE 1 overworld generator: a single temperate biome ("Verdant Highlands") with rolling hills,
 * layered dirt/stone, a hand-designed starting zone, floating islands and decorative flora.
 *
 * PHASE 2 extends this with biomes, caves, ores, liquids and dungeons.
 */
export class OverworldGenerator implements WorldGenerator {
  readonly seed: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly spawnTileX: number;
  readonly spawnGroundY: number;

  private readonly surface: Int16Array;
  private readonly dirtDepth: Int8Array;
  private readonly stamps: TileStamp[] = [];
  private readonly props = new Map<number, string>();
  private readonly treeExclusions: (readonly [number, number])[];
  private readonly zone: StartZoneLayout;
  private readonly seeds: {
    terrainA: number;
    terrainB: number;
    terrainC: number;
    strata: number;
    blobs: number;
    features: number;
    flora: number;
    cave: number;
    cavern: number;
    copper: number;
    iron: number;
  };

  constructor(config: OverworldConfig) {
    this.seed = config.seed >>> 0;
    this.widthTiles = config.widthTiles;
    this.heightTiles = config.heightTiles;
    this.zone = config.startZone ?? START_ZONE;
    this.seeds = {
      terrainA: deriveSeed(this.seed, 'terrain.large'),
      terrainB: deriveSeed(this.seed, 'terrain.hills'),
      terrainC: deriveSeed(this.seed, 'terrain.detail'),
      strata: deriveSeed(this.seed, 'strata'),
      blobs: deriveSeed(this.seed, 'blobs'),
      features: deriveSeed(this.seed, 'features'),
      flora: deriveSeed(this.seed, 'flora'),
      cave: deriveSeed(this.seed, 'caves.tunnels'),
      cavern: deriveSeed(this.seed, 'caves.caverns'),
      copper: deriveSeed(this.seed, 'ore.copper'),
      iron: deriveSeed(this.seed, 'ore.iron'),
    };
    this.spawnTileX = Math.floor(this.widthTiles / 2);

    const base = config.surfaceBase;
    const natural = (x: number): number => {
      const large = fbm1D(x / 230, this.seeds.terrainA, { octaves: 3 }) * 30;
      const hills = fbm1D(x / 64, this.seeds.terrainB, { octaves: 3 }) * 10;
      const detail = valueNoise1D(x / 9, this.seeds.terrainC) * 1.4;
      return base - large - hills - detail;
    };

    // Ground height under spawn: average natural height so the meadow sits naturally.
    let acc = 0;
    for (let dx = -12; dx <= 12; dx++) acc += natural(this.spawnTileX + dx);
    this.spawnGroundY = Math.round(acc / 25);

    this.surface = new Int16Array(this.widthTiles);
    this.dirtDepth = new Int8Array(this.widthTiles);
    const margin = 8;
    for (let x = 0; x < this.widthTiles; x++) {
      let h = natural(x);
      for (const shape of this.zone.shapes) h = this.applyShape(h, x, shape);
      this.surface[x] = clamp(Math.round(h), 40, this.heightTiles - 64);
      this.dirtDepth[x] = 9 + Math.round(fbm1D(x / 40, this.seeds.strata, { octaves: 2 }) * 4);
      // Raise the world rim so the edges read as natural walls rather than an abrupt void.
      if (x < margin || x >= this.widthTiles - margin) this.surface[x] = (this.surface[x] ?? 0) - 6;
    }

    this.treeExclusions = this.zone.treeExclusions.map(
      ([a, b]) => [a + this.spawnTileX, b + this.spawnTileX] as const,
    );
    this.planStartZone();
    this.planRandomFeatures();
  }

  surfaceY(tileX: number): number {
    const x = clamp(Math.floor(tileX), 0, this.widthTiles - 1);
    return this.surface[x] ?? 0;
  }

  private applyShape(h: number, x: number, s: TerrainShape): number {
    const rel = x - this.spawnTileX;
    let w = 0;
    if (rel >= s.from && rel <= s.to) w = 1;
    else if (rel < s.from && s.blendLeft > 0) w = smoothstep(s.from - s.blendLeft, s.from, rel);
    else if (rel > s.to && s.blendRight > 0) w = 1 - smoothstep(s.to, s.to + s.blendRight, rel);
    if (w <= 0) return h;
    // Shapes are relative to the spawn ground height (computed before shapes apply).
    const target = this.spawnGroundY + s.height;
    return lerp(h, target, w);
  }

  private planStartZone(): void {
    const sx = this.spawnTileX;
    const gy = this.spawnGroundY;
    for (const p of this.zone.platforms) {
      this.stamps.push(new PlatformStamp(sx + p.from, sx + p.to, gy + p.height));
    }
    this.zone.islands.forEach((isl, i) => {
      this.stamps.push(
        new IslandStamp(
          sx + isl.from,
          sx + isl.to,
          gy + isl.height,
          isl.depth,
          deriveSeed(this.seed, `start.island.${i}`),
        ),
      );
    });
    for (const post of this.zone.posts) {
      const x = sx + post.x;
      this.stamps.push(new PostStamp(x, gy + post.top, this.surfaceY(x) - 1));
    }
    for (const prop of this.zone.props) {
      const x = sx + prop.x;
      const y = this.surfaceY(x) - 1;
      this.props.set(y * this.widthTiles + x, prop.key);
    }
  }

  /** Sparse procedural features outside the start zone: floating islands and old platforms. */
  private planRandomFeatures(): void {
    const segment = 56;
    const rng = new Rng(this.seeds.features);
    for (let x0 = 24; x0 + segment < this.widthTiles - 24; x0 += segment) {
      const roll = rng.next();
      const cx = x0 + rng.int(8, segment - 8);
      if (Math.abs(cx - this.spawnTileX) < this.zone.radius) continue;
      const ground = this.minSurface(cx - 8, cx + 8);
      if (roll < 0.38) {
        const w = rng.int(7, 13);
        const top = ground - rng.int(11, 17);
        const isl = new IslandStamp(
          cx - (w >> 1),
          cx + (w >> 1),
          top,
          rng.int(4, 7),
          rng.nextU32(),
        );
        this.stamps.push(isl);
        // A stepping platform so islands are reachable on foot.
        const side = rng.sign();
        const px = cx + side * ((w >> 1) + 3);
        this.stamps.push(new PlatformStamp(px - 2, px + 2, top + 5));
      } else if (roll < 0.6) {
        const w = rng.int(5, 9);
        const y = ground - rng.int(4, 6);
        this.stamps.push(new PlatformStamp(cx - (w >> 1), cx + (w >> 1), y));
      }
      // Natural cave entrances.
      if (rng.chance(0.3)) {
        const sx = x0 + rng.int(4, segment - 4);
        if (Math.abs(sx - this.spawnTileX) > this.zone.radius * 0.6) {
          this.stamps.push(new ShaftStamp(sx, this.surfaceY(sx), rng.int(24, 46), rng.nextU32()));
        }
      }
    }
  }

  private minSurface(x0: number, x1: number): number {
    let m = Infinity;
    for (let x = x0; x <= x1; x++) m = Math.min(m, this.surfaceY(x));
    return m;
  }

  generateChunk(chunk: Chunk): void {
    const tx0 = chunk.cx * CHUNK_SIZE;
    const ty0 = chunk.cy * CHUNK_SIZE;
    const { fg, bg } = chunk;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = tx0 + lx;
      const s = this.surface[tx] ?? 0;
      const dirtBottom = s + (this.dirtDepth[tx] ?? 9);
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const ty = ty0 + ly;
        const i = localIndex(lx, ly);
        if (ty < s) continue;
        let tile: number;
        if (ty === s) {
          tile = TILE.grass;
        } else if (ty < dirtBottom) {
          // Dirt band with occasional stone boulders.
          tile =
            fbm2D(tx / 9, ty / 9, this.seeds.blobs, { octaves: 2 }) > 0.42 ? TILE.stone : TILE.dirt;
        } else {
          // Stone layer with dirt pockets; slightly irregular boundary.
          const edge = fbm2D(tx / 6, ty / 6, this.seeds.strata, { octaves: 2 });
          if (ty < dirtBottom + 2 && edge > 0.1) tile = TILE.dirt;
          else if (fbm2D(tx / 14, ty / 11, this.seeds.blobs + 99, { octaves: 2 }) < -0.48)
            tile = TILE.dirt;
          else tile = TILE.stone;
        }
        const depth = ty - s;
        // Ore veins.
        if (depth > 6 && (tile === TILE.stone || (tile === TILE.dirt && depth > 10))) {
          if (fbm2D(tx / 4.2, ty / 4.2, this.seeds.copper, { octaves: 2 }) > 0.44)
            tile = TILE.copperOre;
        }
        if (depth > 30 && tile === TILE.stone) {
          if (fbm2D(tx / 3.8, ty / 3.8, this.seeds.iron, { octaves: 2 }) > 0.5) tile = TILE.ironOre;
        }
        // Caves: thin worm tunnels (ridged noise) and large caverns deeper down.
        const caveTop = Math.abs(tx - this.spawnTileX) < this.zone.radius ? 24 : 12;
        if (depth > caveTop) {
          const widen = clamp((depth - caveTop) / 160, 0, 1) * 0.025;
          const n = fbm2D(tx / 46, ty / 26, this.seeds.cave, { octaves: 2 });
          const tunnel = Math.abs(n) < 0.05 + widen;
          const cavern =
            depth > 48 && fbm2D(tx / 52, ty / 30, this.seeds.cavern, { octaves: 2 }) > 0.58;
          if (tunnel || cavern) tile = 0;
        }
        fg[i] = tile;
        if (ty >= s + 3) bg[i] = ty < dirtBottom ? TILE.dirtWall : TILE.stoneWall;
      }
    }

    // Apply planned features overlapping this chunk.
    const tx1 = tx0 + CHUNK_SIZE - 1;
    const ty1 = ty0 + CHUNK_SIZE - 1;
    for (const stamp of this.stamps) {
      if (stamp.x1 < tx0 || stamp.x0 > tx1 || stamp.y1 < ty0 || stamp.y0 > ty1) continue;
      const ax = Math.max(stamp.x0, tx0);
      const bx = Math.min(stamp.x1, tx1);
      const ay = Math.max(stamp.y0, ty0);
      const by = Math.min(stamp.y1, ty1);
      for (let ty = ay; ty <= by; ty++) {
        for (let tx = ax; tx <= bx; tx++) {
          const i = localIndex(tx - tx0, ty - ty0);
          const b = stamp.sampleBg ? stamp.sampleBg(tx, ty) : -1;
          if (b >= 0) bg[i] = b;
          const t = stamp.sampleFg(tx, ty);
          if (t < 0) continue;
          // Platforms never overwrite terrain.
          if (t === TILE.woodPlatform && fg[i] !== 0) continue;
          fg[i] = t;
        }
      }
    }
  }

  generateObjects(cx: number, cy: number, tiles: TileReader): WorldObject[] {
    const out: WorldObject[] = [];
    const tx0 = cx * CHUNK_SIZE;
    const ty0 = cy * CHUNK_SIZE;
    const seed = this.seeds.flora;
    const treeColumns = new Set<number>();

    // Pass 1: trees (need flat ground and vertical clearance).
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = tx0 + lx;
      if (!this.isTreeCandidate(tx)) continue;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const ty = ty0 + ly;
        if (!this.isGrassTop(tiles, tx, ty + 1)) continue;
        if (!this.isGrassTop(tiles, tx - 1, ty + 1) || !this.isGrassTop(tiles, tx + 1, ty + 1))
          continue;
        let clear = true;
        for (let k = 1; k <= TREE_CLEARANCE && clear; k++) {
          for (let dx = -1; dx <= 1; dx++) if (tiles.getFg(tx + dx, ty - k) !== 0) clear = false;
        }
        if (!clear) continue;
        const pine = hash2f(tx, 7, seed) < 0.3;
        const key = pine ? 'tree_pine' : 'tree_oak';
        out.push(this.makeObject(key, tx, ty));
        treeColumns.add(tx);
      }
    }

    // Pass 2: props from the layout, then small flora.
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const tx = tx0 + lx;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const ty = ty0 + ly;
        const prop = this.props.get(ty * this.widthTiles + tx);
        if (prop) {
          out.push(this.makeObject(prop, tx, ty));
          continue;
        }
        if (treeColumns.has(tx) || !this.isGrassTop(tiles, tx, ty + 1)) continue;
        if (tiles.getFg(tx, ty) !== 0) continue;
        if (this.nearProp(tx, ty)) continue;
        const r = hash2f(tx, ty, seed);
        const nearTree = treeColumns.has(tx - 1) || treeColumns.has(tx + 1);
        let key: string | null = null;
        if (r < 0.05 && !nearTree) key = 'bush';
        else if (r < 0.15) key = 'flower';
        else if (r < 0.185) key = 'rock';
        else if (r < 0.2 && nearTree) key = 'mushroom';
        else if (r < 0.66) key = 'grass_tuft';
        else if (r < 0.76) key = 'tall_grass';
        if (key) out.push(this.makeObject(key, tx, ty));
      }
    }
    return out;
  }

  private makeObject(key: string, tx: number, ty: number): WorldObject {
    const def = getObjectDef(key);
    const h = hash2(tx, ty, this.seeds.flora ^ 0x5bd1e995);
    return {
      id: ty * this.widthTiles + tx,
      key,
      variant: h % def.variants,
      tx,
      ty,
      seed: h,
    };
  }

  private isGrassTop(tiles: TileReader, tx: number, ty: number): boolean {
    return tiles.getFg(tx, ty) === TILE.grass && tiles.getFg(tx, ty - 1) === 0;
  }

  private isTreeCandidate(tx: number): boolean {
    for (const [a, b] of this.treeExclusions) if (tx >= a && tx <= b) return false;
    const cell = Math.floor(tx / TREE_CELL);
    const pick = cell * TREE_CELL + Math.floor(hash1f(cell, this.seeds.flora) * TREE_CELL);
    return tx === pick && hash1f(cell + 7777, this.seeds.flora) < 0.62;
  }

  private nearProp(tx: number, ty: number): boolean {
    for (let dx = -1; dx <= 1; dx++)
      if (this.props.has(ty * this.widthTiles + tx + dx)) return true;
    return false;
  }
}
