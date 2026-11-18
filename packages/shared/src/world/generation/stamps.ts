import { hash1f, Rng } from '../../math/rng';
import { TILE } from '../TileRegistry';

/**
 * A stamp writes hand-designed or procedurally planned features (floating islands, platforms,
 * structures) into chunks. Stamps are planned once per world from the seed and applied per chunk,
 * so features crossing chunk borders generate identically regardless of chunk order.
 */
export interface TileStamp {
  /** Inclusive tile bounding box. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Returns the fg tile to write at (tx, ty), or -1 to leave the tile untouched. */
  sampleFg(tx: number, ty: number): number;
  /** Optional background (wall) layer; -1 leaves the tile untouched. */
  sampleBg?(tx: number, ty: number): number;
}

/** A vertical wooden support post in the background layer (non-colliding). */
export class PostStamp implements TileStamp {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;

  constructor(x: number, top: number, bottom: number) {
    this.x0 = x;
    this.x1 = x;
    this.y0 = Math.min(top, bottom);
    this.y1 = Math.max(top, bottom);
  }

  sampleFg(): number {
    return -1;
  }

  sampleBg(tx: number, ty: number): number {
    return tx === this.x0 && ty >= this.y0 && ty <= this.y1 ? TILE.woodBeam : -1;
  }
}

/** A horizontal run of one-way wooden platform tiles. */
export class PlatformStamp implements TileStamp {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;

  constructor(x0: number, x1: number, y: number) {
    this.x0 = Math.min(x0, x1);
    this.x1 = Math.max(x0, x1);
    this.y0 = y;
    this.y1 = y;
  }

  sampleFg(tx: number, ty: number): number {
    return ty === this.y0 && tx >= this.x0 && tx <= this.x1 ? TILE.woodPlatform : -1;
  }
}

/**
 * A floating island: flat grassy top, dirt body, tapering rocky underside.
 * `top` is the row of the grass surface.
 */
export class IslandStamp implements TileStamp {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  private readonly depth: Int16Array;
  private readonly topOffset: Int8Array;

  constructor(x0: number, x1: number, top: number, maxDepth: number, seed: number) {
    this.x0 = Math.min(x0, x1);
    this.x1 = Math.max(x0, x1);
    const width = this.x1 - this.x0 + 1;
    this.depth = new Int16Array(width);
    this.topOffset = new Int8Array(width);
    const rng = new Rng(seed);
    const half = (width - 1) / 2;
    let deepest = 0;
    for (let i = 0; i < width; i++) {
      const u = half === 0 ? 0 : (i - half) / (half + 0.5);
      // Inverted-cone underside: full depth in the middle, tapering to a thin lip at the edges.
      const taper = 1 - Math.pow(Math.abs(u), 1.4);
      const jag = (hash1f(i, seed) - 0.5) * 2;
      const d = Math.max(1, Math.round(maxDepth * 1.25 * taper + jag));
      this.depth[i] = d;
      deepest = Math.max(deepest, d);
      // Slightly rounded shoulders on the outermost columns.
      this.topOffset[i] = i === 0 || i === width - 1 ? (rng.chance(0.6) ? 1 : 0) : 0;
    }
    this.y0 = top;
    this.y1 = top + deepest;
  }

  sampleFg(tx: number, ty: number): number {
    if (tx < this.x0 || tx > this.x1) return -1;
    const i = tx - this.x0;
    const top = this.y0 + (this.topOffset[i] ?? 0);
    const d = this.depth[i] ?? 0;
    const rel = ty - top;
    if (rel < 0 || rel > d) return -1;
    if (rel === 0) return TILE.grass;
    if (rel <= Math.min(2, d)) return TILE.dirt;
    return rel >= d - 1 && (tx + ty) % 3 === 0 ? TILE.mossyStone : TILE.stone;
  }
}
