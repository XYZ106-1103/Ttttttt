/**
 * Visual recipes for tiles, keyed by the tile `key` from @world/shared tile data.
 * Gameplay data stays in shared; only look-and-feel lives here.
 *
 * To replace procedural tiles with hand-drawn art later, provide an atlas with the same frame
 * layout (see TilesetGenerator) and skip generation for that key.
 */
export type TileStyle =
  | 'soil'
  | 'grass'
  | 'stone'
  | 'mossy'
  | 'ore'
  | 'bricks'
  | 'torch'
  | 'platform'
  | 'planks'
  | 'wall'
  | 'beam'
  | 'snow'
  | 'ice'
  | 'liquid';

export interface TileRecipe {
  readonly style: TileStyle;
  /** Ramp from darkest to lightest. */
  readonly ramp: readonly string[];
  readonly outline: string;
  /** Secondary ramp (grass blades, moss). */
  readonly accent?: readonly string[];
  /** Opacity for liquids (0..255). */
  readonly alpha?: number;
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
  copper_ore: {
    style: 'ore',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#4a2210', '#a4532a', '#d9803f', '#f6b871'],
  },
  iron_ore: {
    style: 'ore',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#2e3240', '#8790a6', '#c3cbda', '#f2f5fa'],
  },
  stone_bricks: {
    style: 'bricks',
    ramp: ['#33363f', '#4f5463', '#686e7e', '#848a9a', '#a3a9b7'],
    outline: '#1b1d25',
  },
  torch: {
    style: 'torch',
    ramp: ['#3e2618', '#5c3a22', '#7e5232', '#a06c42', '#c48d5a'],
    outline: '#24150e',
    accent: ['#c7381f', '#f06a24', '#f9a63a', '#ffd86a', '#fff6c8'],
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
  snow: {
    style: 'snow',
    ramp: ['#9fb4cc', '#c4d4e6', '#dde8f4', '#eef4fb', '#ffffff'],
    outline: '#6f86a3',
  },
  ice: {
    style: 'ice',
    ramp: ['#4a86b8', '#6aa6d4', '#8ec4e8', '#b4dcf4', '#e2f4ff'],
    outline: '#2f5e88',
  },
  sand: {
    style: 'soil',
    ramp: ['#a88a52', '#c4a466', '#d9bd7d', '#e9d394', '#f6e6b3'],
    outline: '#7a6236',
  },
  sandstone: {
    style: 'stone',
    ramp: ['#8a6a3e', '#a8844f', '#c09a5e', '#d4b072', '#e6c88c'],
    outline: '#5a4426',
  },
  ash: {
    style: 'soil',
    ramp: ['#2e2a2c', '#3e393b', '#4e484a', '#615a5c', '#776f71'],
    outline: '#1a1718',
  },
  basalt: {
    style: 'stone',
    ramp: ['#1e1a1e', '#2a2529', '#363036', '#443d44', '#544b54'],
    outline: '#100d10',
  },
  obsidian: {
    style: 'stone',
    ramp: ['#120c1c', '#1c1430', '#281c44', '#382a5c', '#5a4a8a'],
    outline: '#08050c',
  },
  water: {
    style: 'liquid',
    ramp: ['#1f4e9a', '#2a62b4', '#3a76c8', '#5a96dc', '#a8d4f4'],
    outline: '#16386e',
    alpha: 168,
  },
  lava: {
    style: 'liquid',
    ramp: ['#9a2a08', '#c8400c', '#f06a1a', '#ff9a3a', '#ffe08a'],
    outline: '#5a1404',
    alpha: 248,
  },
  silver_ore: {
    style: 'ore',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#4a5260', '#a8b4c4', '#dfe6f0', '#ffffff'],
  },
  gold_ore: {
    style: 'ore',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#5a3a08', '#c8901c', '#f2c84b', '#fff2a8'],
  },
  frostite_ore: {
    style: 'ore',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#1a3a5a', '#3a9ad4', '#6fd4ff', '#d4f6ff'],
  },
  magmite_ore: {
    style: 'ore',
    ramp: ['#1e1a1e', '#2a2529', '#363036', '#443d44', '#544b54'],
    outline: '#100d10',
    accent: ['#5a1a08', '#c84a14', '#ff7a3a', '#ffd08a'],
  },
  crystal_ore: {
    style: 'ore',
    ramp: ['#33384a', '#474e62', '#5b6378', '#727b90', '#8f98ab'],
    outline: '#1e2130',
    accent: ['#3a1a5a', '#8a4ad4', '#c58cff', '#f4e0ff'],
  },
};
