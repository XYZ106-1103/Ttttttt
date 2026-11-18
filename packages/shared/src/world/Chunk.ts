import { CHUNK_SIZE } from '../constants';

export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;

/**
 * A CHUNK_SIZE × CHUNK_SIZE block of tiles. Data only — no rendering, no generation logic —
 * so it can be serialized as-is for persistence (PHASE 2) and network sync (PHASE 6).
 */
export class Chunk {
  readonly cx: number;
  readonly cy: number;
  /** Foreground tile ids (terrain, platforms). Row-major, index = ly * CHUNK_SIZE + lx. */
  readonly fg: Uint16Array;
  /** Background wall ids. */
  readonly bg: Uint16Array;
  /** Incremented on every modification; renderers compare against it to know when to redraw. */
  version = 0;
  /** True once the chunk differs from what the generator would produce (needs saving). */
  modified = false;

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
    this.fg = new Uint16Array(CHUNK_AREA);
    this.bg = new Uint16Array(CHUNK_AREA);
  }
}
