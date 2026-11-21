/**
 * Biomes of the overworld, laid out west → east relative to the spawn column:
 *
 *   sea | coast | frost plains | windswept meadow | village | blue ridge | granite peaks |
 *   ember wastes (volcano) | coast | sea
 *
 * Each biome decides surface shape and materials (world generation), which monsters spawn,
 * the weather, the music and the sky tint. The ranges around the village are unchanged from the
 * original single-biome world, so existing saves near the spawn still line up.
 */
export type BiomeId =
  'ocean' | 'beach' | 'tundra' | 'meadow' | 'village' | 'forest' | 'mountains' | 'volcano';

export type Weather = 'none' | 'snow' | 'ash';

export interface BiomeDef {
  readonly id: BiomeId;
  /** Region shown on the minimap and in banners. */
  readonly region: string;
  readonly nameKey: string;
  /** Inclusive start, exclusive end, in tiles relative to spawn X. */
  readonly fromX: number;
  readonly toX: number;
  readonly weather: Weather;
  /** Sky/background tint (linear multipliers) and how strongly it applies (0..1). */
  readonly tint: readonly [number, number, number, number];
}

const b = (d: Omit<BiomeDef, 'nameKey'>): BiomeDef => ({ ...d, nameKey: `region.${d.region}` });

export const BIOME_DEFS: readonly BiomeDef[] = [
  b({
    id: 'ocean',
    region: 'west_sea',
    fromX: -100000,
    toX: -900,
    weather: 'none',
    tint: [0.85, 0.95, 1.1, 0.25],
  }),
  b({
    id: 'beach',
    region: 'west_coast',
    fromX: -900,
    toX: -868,
    weather: 'none',
    tint: [1, 1, 1, 0],
  }),
  b({
    id: 'tundra',
    region: 'frost_plains',
    fromX: -868,
    toX: -560,
    weather: 'snow',
    tint: [0.86, 0.94, 1.12, 0.45],
  }),
  b({
    id: 'meadow',
    region: 'windswept_meadow',
    fromX: -560,
    toX: -34,
    weather: 'none',
    tint: [1, 1, 1, 0],
  }),
  b({
    id: 'village',
    region: 'starting_hill',
    fromX: -34,
    toX: 34,
    weather: 'none',
    tint: [1, 1, 1, 0],
  }),
  b({
    id: 'forest',
    region: 'blue_ridge',
    fromX: 34,
    toX: 330,
    weather: 'none',
    tint: [1, 1, 1, 0],
  }),
  b({
    id: 'mountains',
    region: 'granite_peaks',
    fromX: 330,
    toX: 600,
    weather: 'none',
    tint: [0.92, 0.96, 1.06, 0.25],
  }),
  b({
    id: 'volcano',
    region: 'ember_wastes',
    fromX: 600,
    toX: 878,
    weather: 'ash',
    tint: [1.15, 0.72, 0.6, 0.55],
  }),
  b({
    id: 'beach',
    region: 'east_coast',
    fromX: 878,
    toX: 910,
    weather: 'none',
    tint: [1, 1, 1, 0],
  }),
  b({
    id: 'ocean',
    region: 'east_sea',
    fromX: 910,
    toX: 100000,
    weather: 'none',
    tint: [0.85, 0.95, 1.1, 0.25],
  }),
];

/** Rows below the base surface where the sea surface lies. */
export const SEA_LEVEL_OFFSET = 4;

/** Where (relative to spawn) the landmarks are. */
export const LANDMARKS = {
  /** Centre of the volcano cone. */
  volcano: 740,
  /** Lakes: [centre, width, depth]. */
  lakes: [
    [-300, 26, 6],
    [205, 46, 9],
  ] as readonly (readonly [number, number, number])[],
  /** The frozen lake in the frost plains. */
  frozenLake: [-720, 40, 8] as const,
} as const;

export function biomeAt(tileX: number, spawnX: number): BiomeDef {
  const rel = tileX - spawnX;
  for (const d of BIOME_DEFS) if (rel >= d.fromX && rel < d.toX) return d;
  return BIOME_DEFS[BIOME_DEFS.length - 1] as BiomeDef;
}

/**
 * How far into a biome a column is (0 at its edges, 1 once `blend` tiles inside), for smooth
 * transitions of terrain shape between biomes.
 */
export function biomeWeight(tileX: number, spawnX: number, id: BiomeId, blend = 24): number {
  const rel = tileX - spawnX;
  let w = 0;
  for (const d of BIOME_DEFS) {
    if (d.id !== id) continue;
    const inside = Math.min(rel - d.fromX, d.toX - rel);
    if (inside <= -blend) continue;
    w = Math.max(w, Math.max(0, Math.min(1, (inside + blend) / (2 * blend))));
  }
  return w;
}
