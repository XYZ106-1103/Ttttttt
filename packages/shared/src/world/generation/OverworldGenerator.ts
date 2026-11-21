import { CHUNK_SIZE } from '../../constants';
import {
  BIOME_DEFS,
  type BiomeId,
  biomeAt,
  biomeWeight,
  LANDMARKS,
  SEA_LEVEL_OFFSET,
} from '../../data/biomes';
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

const BIOME_INDEX: readonly BiomeId[] = [
  'ocean',
  'beach',
  'tundra',
  'meadow',
  'village',
  'forest',
  'mountains',
  'volcano',
];
/** Rows below the surface. */
const depth0 = (ty: number, s: number): number => ty - s;
const LIQ_NONE = 0;
const LIQ_WATER = 1;
const LIQ_LAVA = 2;
/** Water whose top row is frozen into ice. */
const LIQ_FROZEN = 3;

/**
 * Overworld generator. Rolling hills with layered dirt/stone, caves and ore veins, shaped per
 * biome (see data/biomes): seas and sandy coasts at both edges, snowy frost plains with a frozen
 * lake, the temperate meadow/village/forest (with lakes), tall granite peaks with snow caps, and
 * a volcano with a lava crater over ash and basalt. A hand-designed starting zone, floating
 * islands and flora sit on top. Deterministic per seed: server and clients agree on every tile.
 */
export class OverworldGenerator implements WorldGenerator {
  readonly seed: number;
  readonly widthTiles: number;
  readonly heightTiles: number;
  readonly spawnTileX: number;
  readonly spawnGroundY: number;

  private readonly surface: Int16Array;
  private readonly dirtDepth: Int8Array;
  /** Biome index per column (BIOME_INDEX). */
  private readonly biome: Uint8Array;
  /** First liquid row per column (-1 = none) and which liquid. */
  private readonly liquidTop: Int16Array;
  private readonly liquidKind: Uint8Array;
  readonly seaLevel: number;
  private readonly base: number;
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
    silver: number;
    gold: number;
    frostite: number;
    magmite: number;
    crystal: number;
    peaks: number;
    tundra: number;
    lava: number;
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
      silver: deriveSeed(this.seed, 'ore.silver'),
      gold: deriveSeed(this.seed, 'ore.gold'),
      frostite: deriveSeed(this.seed, 'ore.frostite'),
      magmite: deriveSeed(this.seed, 'ore.magmite'),
      crystal: deriveSeed(this.seed, 'ore.crystal'),
      peaks: deriveSeed(this.seed, 'terrain.peaks'),
      tundra: deriveSeed(this.seed, 'terrain.tundra'),
      lava: deriveSeed(this.seed, 'lava.pools'),
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

    this.base = base;
    this.seaLevel = base + SEA_LEVEL_OFFSET;
    this.surface = new Int16Array(this.widthTiles);
    this.dirtDepth = new Int8Array(this.widthTiles);
    this.biome = new Uint8Array(this.widthTiles);
    this.liquidTop = new Int16Array(this.widthTiles).fill(-1);
    this.liquidKind = new Uint8Array(this.widthTiles);
    for (let x = 0; x < this.widthTiles; x++) {
      let h = this.shapeBiomes(x, natural(x));
      for (const shape of this.zone.shapes) h = this.applyShape(h, x, shape);
      this.surface[x] = clamp(Math.round(h), 40, this.heightTiles - 64);
      this.dirtDepth[x] = 9 + Math.round(fbm1D(x / 40, this.seeds.strata, { octaves: 2 }) * 4);
      this.biome[x] = BIOME_INDEX.indexOf(biomeAt(x, this.spawnTileX).id);
    }
    this.planWaters();

    this.treeExclusions = this.zone.treeExclusions.map(
      ([a, b]) => [a + this.spawnTileX, b + this.spawnTileX] as const,
    );
    this.planStartZone();
    this.planRandomFeatures();
  }

  /** Biome of a column. */
  biomeOf(tileX: number): BiomeId {
    const x = clamp(Math.floor(tileX), 0, this.widthTiles - 1);
    return BIOME_INDEX[this.biome[x] ?? 3] ?? 'meadow';
  }

  /** Terrain height reshaped by the biomes (rows: smaller is higher). */
  private shapeBiomes(x: number, h: number): number {
    const sx = this.spawnTileX;
    const rel = x - sx;
    const wm = biomeWeight(x, sx, 'mountains', 40);
    if (wm > 0) {
      const ridge = 1 - Math.abs(fbm1D(x / 38, this.seeds.peaks, { octaves: 3 }));
      h -= wm * (16 + ridge * ridge * 64);
    }
    const wt = biomeWeight(x, sx, 'tundra', 30);
    if (wt > 0) h -= wt * (5 + fbm1D(x / 26, this.seeds.tundra, { octaves: 2 }) * 9);
    const wv = biomeWeight(x, sx, 'volcano', 30);
    if (wv > 0) {
      h -= wv * 4;
      const d = Math.abs(rel - LANDMARKS.volcano);
      if (d < 72) {
        let cone = (1 - d / 72) ** 1.35 * 78;
        if (d < 10) cone -= (1 - d / 10) * 20; // the crater
        h -= cone * wv;
      }
    }
    // Coasts slope down into the seas at both edges.
    const west = BIOME_DEFS.find((d) => d.region === 'west_coast');
    const east = BIOME_DEFS.find((d) => d.region === 'east_coast');
    const into = Math.max(west ? west.toX - rel : -1, east ? rel - east.fromX : -1);
    if (into > 0) {
      const seabed =
        this.seaLevel + 2 + Math.min(20, into * 0.35) + fbm1D(x / 20, this.seeds.terrainC) * 2;
      h = lerp(h, seabed, smoothstep(0, 40, into));
    }
    return h;
  }

  /** Seas, lakes, the frozen lake and the crater's lava: which rows of which columns hold liquid. */
  private planWaters(): void {
    const sx = this.spawnTileX;
    const fill = (x: number, top: number, kind: number): void => {
      if (x < 0 || x >= this.widthTiles) return;
      if ((this.surface[x] ?? 0) > top) {
        this.liquidTop[x] = top;
        this.liquidKind[x] = kind;
      }
    };
    // Seas.
    for (let x = 0; x < this.widthTiles; x++) {
      const id = this.biomeOf(x);
      if (id === 'ocean' || id === 'beach') fill(x, this.seaLevel, LIQ_WATER);
    }
    // Lakes: carve a bowl, fill to the lower rim.
    const lake = (c: number, w: number, depth: number, kind: number): void => {
      const half = Math.floor(w / 2);
      const L = sx + c - half;
      const R = sx + c + half;
      const top = Math.max(this.surface[L - 1] ?? 0, this.surface[R + 1] ?? 0);
      for (let x = L; x <= R; x++) {
        const u = (x - (sx + c)) / half;
        const bottom = top + Math.max(1, Math.round(depth * (1 - u * u)));
        this.surface[x] = Math.max(this.surface[x] ?? 0, bottom);
        fill(x, top, kind);
      }
    };
    for (const [c, w, d] of LANDMARKS.lakes) lake(c, w, d, LIQ_WATER);
    const [fc, fw, fd] = LANDMARKS.frozenLake;
    lake(fc, fw, fd, LIQ_FROZEN);
    // Volcano crater: a bowl carved below the lower rim, filled with lava up to just under it.
    const vc = sx + LANDMARKS.volcano;
    const rim = Math.max(this.surface[vc - 11] ?? 0, this.surface[vc + 11] ?? 0);
    for (let x = vc - 10; x <= vc + 10; x++) {
      const u = (x - vc) / 10;
      this.surface[x] = Math.max(this.surface[x] ?? 0, rim + 3 + Math.round(5 * (1 - u * u)));
      fill(x, rim + 1, LIQ_LAVA);
    }
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
      const featureBiome = this.biomeOf(cx);
      if (featureBiome === 'ocean' || featureBiome === 'beach') continue;
      if (Math.abs(cx - this.spawnTileX - LANDMARKS.volcano) < 80) continue;
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
      const biome = BIOME_INDEX[this.biome[tx] ?? 3] ?? 'meadow';
      const liqTop = this.liquidTop[tx] ?? -1;
      const liqKind = this.liquidKind[tx] ?? LIQ_NONE;
      const steep = Math.abs((this.surface[tx + 1] ?? s) - (this.surface[tx - 1] ?? s)) > 3;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        const ty = ty0 + ly;
        const i = localIndex(lx, ly);
        if (ty < s) {
          if (liqTop >= 0 && ty >= liqTop) {
            fg[i] =
              liqKind === LIQ_LAVA
                ? TILE.lava
                : liqKind === LIQ_FROZEN && ty === liqTop
                  ? TILE.ice
                  : TILE.water;
          }
          continue;
        }
        // Underground, biome materials blend along a ragged border instead of a straight line.
        const jitter =
          depth0(ty, s) > 3
            ? Math.round(fbm2D(tx / 18, ty / 18, this.seeds.strata + 5, { octaves: 2 }) * 14)
            : 0;
        const matBiome =
          jitter === 0
            ? biome
            : (BIOME_INDEX[this.biome[clamp(tx + jitter, 0, this.widthTiles - 1)] ?? 3] ?? biome);
        let tile = this.material(matBiome, tx, ty, s, dirtBottom, steep);
        const depth = ty - s;
        tile = this.ore(biome, tile, tx, ty, depth);
        // Caves: thin worm tunnels (ridged noise) and large caverns deeper down.
        const caveTop = Math.abs(tx - this.spawnTileX) < this.zone.radius ? 24 : 12;
        if (depth > caveTop) {
          const widen = clamp((depth - caveTop) / 160, 0, 1) * 0.025;
          const n = fbm2D(tx / 46, ty / 26, this.seeds.cave, { octaves: 2 });
          const tunnel = Math.abs(n) < 0.05 + widen;
          const cavern =
            depth > 48 && fbm2D(tx / 52, ty / 30, this.seeds.cavern, { octaves: 2 }) > 0.58;
          if (tunnel || cavern) {
            // Under the volcano the low parts of caves hold lava.
            tile =
              biome === 'volcano' &&
              depth > 40 &&
              fbm2D(tx / 24, ty / 10, this.seeds.lava, { octaves: 2 }) > 0.22
                ? TILE.lava
                : 0;
          }
        }
        fg[i] = tile;
        if (ty >= s + 3) {
          const shallow = ty < dirtBottom;
          bg[i] =
            shallow && biome !== 'volcano' && biome !== 'mountains'
              ? TILE.dirtWall
              : TILE.stoneWall;
        }
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

  /** Terrain material of a solid tile, by biome and depth. */
  private material(
    biome: BiomeId,
    tx: number,
    ty: number,
    s: number,
    dirtBottom: number,
    steep: boolean,
  ): number {
    const blob = (sx: number, sy: number, seed: number, t: number): boolean =>
      fbm2D(tx / sx, ty / sy, seed, { octaves: 2 }) > t;
    const deepStone = (): number => {
      const edge = fbm2D(tx / 6, ty / 6, this.seeds.strata, { octaves: 2 });
      if (ty < dirtBottom + 2 && edge > 0.1) return TILE.dirt;
      if (fbm2D(tx / 14, ty / 11, this.seeds.blobs + 99, { octaves: 2 }) < -0.48) return TILE.dirt;
      return TILE.stone;
    };
    switch (biome) {
      case 'ocean':
      case 'beach':
        if (ty < s + 5) return TILE.sand;
        if (ty < dirtBottom + 2) return TILE.sandstone;
        return TILE.stone;
      case 'tundra':
        if (ty <= s + 3) return TILE.snow;
        if (ty < dirtBottom) return blob(9, 9, this.seeds.blobs, 0.42) ? TILE.stone : TILE.dirt;
        if (blob(11, 7, this.seeds.tundra + 7, 0.45)) return TILE.ice;
        return deepStone();
      case 'mountains': {
        const high = s < this.base - 34;
        if (ty === s) return high ? TILE.snow : steep ? TILE.stone : TILE.grass;
        if (high && ty === s + 1 && !steep) return TILE.snow;
        if (ty < s + 3 && !steep && !high) return TILE.dirt;
        return deepStone();
      }
      case 'volcano':
        if (ty < s + 4) return TILE.ash;
        if (blob(10, 8, this.seeds.blobs + 31, 0.5)) return TILE.obsidian;
        return TILE.basalt;
      default:
        if (ty === s) return TILE.grass;
        if (ty < dirtBottom) return blob(9, 9, this.seeds.blobs, 0.42) ? TILE.stone : TILE.dirt;
        return deepStone();
    }
  }

  /** Ore veins replacing rock (and some dirt) by depth and biome. */
  private ore(biome: BiomeId, tile: number, tx: number, ty: number, depth: number): number {
    const rock = tile === TILE.stone || tile === TILE.basalt || tile === TILE.sandstone;
    const vein = (scale: number, seed: number, t: number): boolean =>
      fbm2D(tx / scale, ty / scale, seed, { octaves: 2 }) > t;
    if (depth > 6 && (rock || (tile === TILE.dirt && depth > 10)) && biome !== 'volcano') {
      if (vein(4.2, this.seeds.copper, 0.44)) return TILE.copperOre;
    }
    if (!rock) return tile;
    if (depth > 30 && biome !== 'volcano' && vein(3.8, this.seeds.iron, 0.5)) return TILE.ironOre;
    if (depth > 45 && vein(3.4, this.seeds.silver, 0.56)) return TILE.silverOre;
    if (depth > 70 && vein(3.2, this.seeds.gold, 0.6)) return TILE.goldOre;
    if (
      depth > 30 &&
      (biome === 'tundra' || biome === 'mountains') &&
      vein(3.6, this.seeds.frostite, 0.55)
    )
      return TILE.frostiteOre;
    if (depth > 26 && biome === 'volcano' && vein(3.6, this.seeds.magmite, 0.52))
      return TILE.magmiteOre;
    if (depth > 110 && vein(3, this.seeds.crystal, 0.62)) return TILE.crystalOre;
    return tile;
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
        if (!this.isTreeTop(tiles, tx, ty + 1)) continue;
        if (!this.isTreeTop(tiles, tx - 1, ty + 1) || !this.isTreeTop(tiles, tx + 1, ty + 1))
          continue;
        let clear = true;
        for (let k = 1; k <= TREE_CLEARANCE && clear; k++) {
          for (let dx = -1; dx <= 1; dx++) if (tiles.getFg(tx + dx, ty - k) !== 0) clear = false;
        }
        if (!clear) continue;
        const snowy = tiles.getFg(tx, ty + 1) === TILE.snow;
        const pine = snowy || hash2f(tx, 7, seed) < 0.3;
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
        if (treeColumns.has(tx)) continue;
        if (tiles.getFg(tx, ty) !== 0) continue;
        if (!this.isGrassTop(tiles, tx, ty + 1)) {
          // Bare biomes (snow, sand, ash) get the odd rock.
          const top = tiles.getFg(tx, ty + 1);
          const bare = top === TILE.snow || top === TILE.sand || top === TILE.ash;
          if (bare && tiles.getFg(tx, ty) === 0 && hash2f(tx, ty, seed + 3) < 0.04)
            out.push(this.makeObject('rock', tx, ty));
          continue;
        }
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

  private isTreeTop(tiles: TileReader, tx: number, ty: number): boolean {
    const t = tiles.getFg(tx, ty);
    return (t === TILE.grass || t === TILE.snow) && tiles.getFg(tx, ty - 1) === 0;
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
