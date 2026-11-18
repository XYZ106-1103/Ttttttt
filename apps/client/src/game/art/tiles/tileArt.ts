/**
 * Visual recipes for tiles, keyed by the tile `key` from @world/shared tile data.
 * Gameplay data stays in shared; only look-and-feel lives here.
 *
 * To replace procedural tiles with hand-drawn art later, provide an atlas with the same frame
 * layout (see TilesetGenerator) and skip generation for that key.
 */
export type TileStyle =
  'soil' | 'grass' | 'stone' | 'mossy' | 'platform' | 'planks' | 'wall' | 'beam';

export interface TileRecipe {
  readonly style: TileStyle;
  /** Ramp from darkest to lightest. */
  readonly ramp: readonly string[];
  readonly outline: string;
  /** Secondary ramp (grass blades, moss). */
  readonly accent?: readonly string[];
}

export const TILE_RECIPES: Readonly<Record<string, TileRecipe>> = {
  dirt: {
    style: 'soil',
    ramp: ['#4a2c1e', '#62392a', '#7a4a32', '#93603e', '#ad7a4f'],
    outline: '#2e1a14',
  },
  grass: {
    style: 'grass',
    ramp: ['#4a2c1e', '#62392a', '#7a4a32', '#93603e', '#ad7a4f'],
    outline: '#2e1a14',
    accent: ['#1f4a2e', '#2f6b3a', '#43904a', '#62b552', '#9ad66a'],
  },
  stone: {
    style: 'stone',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
  },
  mossy_stone: {
    style: 'mossy',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#2a4a32', '#3d6a42', '#5a8f4e', '#7db35e'],
  },
  wood_platform: {
    style: 'platform',
    ramp: ['#3e2618', '#5c3a22', '#7e5232', '#a06c42', '#c48d5a'],
    outline: '#24150e',
  },
  wood_planks: {
    style: 'planks',
    ramp: ['#3e2618', '#5c3a22', '#7e5232', '#a06c42', '#c48d5a'],
    outline: '#24150e',
  },
  dirt_wall: {
    style: 'wall',
    ramp: ['#24160f', '#2f1d14', '#3a2419', '#452c1f', '#4f3324'],
    outline: '#160d09',
  },
  wood_beam: {
    style: 'beam',
    ramp: ['#3e2618', '#5c3a22', '#7e5232', '#a06c42', '#c48d5a'],
    outline: '#24150e',
  },
  stone_wall: {
    style: 'wall',
    ramp: ['#1a1d27', '#222633', '#2a2f3e', '#333949', '#3c4354'],
    outline: '#10121a',
  },
};
