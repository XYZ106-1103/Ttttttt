import { CHUNK_SIZE } from '../constants';

export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;

/**
 * A CHUNK_SIZE × CHUNK_SIZE block of tiles. Data only — no rendering, no generation logic —
 * so it can be serialized as-is for persistence and network sync (PHASE 6).
 */
export class Chunk {
  readonly cx: number;
  readonly cy: number;
  /** Foreground tile ids (terrain, platforms). Row-major, index = ly * CHUNK_SIZE + lx. */
  readonly fg: Uint16Array;
  /** Background wall ids. */
  readonly bg: Uint16Array;
  /**
   * Render version: incremented whenever this chunk *or a neighbor's border tile* changes, so
   * renderers can rebake autotile masks that depend on neighbors.
   */
  version = 0;
  /** True once the tiles differ from what the generator would produce (must be persisted). */
  modified = false;

  constructor(cx: number, cy: number) {
    this.cx = cx;
    this.cy = cy;
    this.fg = new Uint16Array(CHUNK_AREA);
    this.bg = new Uint16Array(CHUNK_AREA);
  }
}
