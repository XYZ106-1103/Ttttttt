/**
 * Hand-authored layout of the starting area ("시작의 언덕"), expressed relative to the spawn column
 * and the spawn ground height. The procedural generator blends these shapes into natural terrain.
 *
 * Coordinates: x in tiles relative to spawn; heights in tiles relative to spawn ground, where
 * NEGATIVE means HIGHER (screen y grows downward).
 */

export interface TerrainShape {
  readonly from: number;
  readonly to: number;
  readonly height: number;
  /** Blend distance (tiles) outside [from, to] on each side. 0 makes a sheer cliff. */
  readonly blendLeft: number;
  readonly blendRight: number;
}

export interface PlatformSpec {
  readonly from: number;
  readonly to: number;
  readonly height: number;
}

export interface IslandSpec {
  readonly from: number;
  readonly to: number;
  /** Height of the grass row. */
  readonly height: number;
  readonly depth: number;
}

/** A support post from `top` (relative height) down to the ground below. */
export interface PostSpec {
  readonly x: number;
  readonly top: number;
}

export interface PropSpec {
  readonly key: string;
  readonly x: number;
}

export interface StartZoneLayout {
  readonly shapes: readonly TerrainShape[];
  readonly platforms: readonly PlatformSpec[];
  readonly islands: readonly IslandSpec[];
  readonly posts: readonly PostSpec[];
  readonly props: readonly PropSpec[];
  /** Ranges (relative x) where trees must not spawn. */
  readonly treeExclusions: readonly (readonly [number, number])[];
  /** Total half-width of the designed zone; random features are not planned inside it. */
  readonly radius: number;
}

export const START_ZONE: StartZoneLayout = {
  shapes: [
    // Flat campsite meadow around spawn.
    { from: -24, to: 24, height: 0, blendLeft: 4, blendRight: 10 },
    // Lower western meadow under the floating islands.
    { from: -84, to: -30, height: 2, blendLeft: 28, blendRight: 5 },
    // Eastern plateau with the lookout, ending in a sheer cliff.
    { from: 40, to: 74, height: -8, blendLeft: 12, blendRight: 0 },
    // Valley below the cliff.
    { from: 75, to: 104, height: 6, blendLeft: 0, blendRight: 26 },
  ],
  platforms: [
    // Stepping stones up to the floating islands (west).
    { from: -35, to: -31, height: -2 },
    { from: -42, to: -38, height: -6 },
    { from: -58, to: -55, height: -14 },
    // Lookout tower on the plateau (east).
    { from: 50, to: 54, height: -12 },
    { from: 54, to: 58, height: -16 },
    { from: 49, to: 53, height: -20 },
    { from: 48, to: 60, height: -24 },
    // Ledges climbing the cliff face from the valley.
    { from: 75, to: 79, height: 2 },
    { from: 78, to: 81, height: -2 },
    { from: 75, to: 78, height: -5 },
  ],
  islands: [
    { from: -52, to: -43, height: -10, depth: 5 },
    { from: -71, to: -61, height: -18, depth: 6 },
  ],
  posts: [
    { x: -34, top: -1 },
    { x: -32, top: -1 },
    { x: -41, top: -5 },
    { x: -39, top: -5 },
    { x: 49, top: -23 },
    { x: 59, top: -23 },
    { x: 78, top: 3 },
    { x: 80, top: -1 },
  ],
  props: [
    { key: 'campfire', x: 5 },
    { key: 'signpost', x: -4 },
    // The village square (PHASE 5): see data/npcs.ts for who stands where.
    { key: 'guild_banner', x: -23 },
    { key: 'shop_stall', x: -17 },
    { key: 'merchant_stall', x: -11 },
    { key: 'merchant_stall', x: 10 },
    { key: 'exchange_board', x: 15 },
    { key: 'merchant_stall', x: 23 },
  ],
  treeExclusions: [
    [-28, 27],
    [46, 62],
    [72, 83],
  ],
  radius: 120,
};
