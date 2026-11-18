/**
 * Named regions of the overworld, expressed relative to the world spawn column so they stay valid
 * if the world width changes. Used for the minimap header and region-entry banners.
 *
 * PHASE 2 replaces this with biome-driven regions produced by the world generator.
 */
export interface RegionDef {
  readonly id: string;
  readonly nameKey: string;
  /** Inclusive start, exclusive end, in tiles relative to spawn X. */
  readonly fromX: number;
  readonly toX: number;
}

export const REGION_DEFS: readonly RegionDef[] = [
  { id: 'windswept_meadow', nameKey: 'region.windswept_meadow', fromX: -100000, toX: -34 },
  { id: 'starting_hill', nameKey: 'region.starting_hill', fromX: -34, toX: 34 },
  { id: 'blue_ridge', nameKey: 'region.blue_ridge', fromX: 34, toX: 100000 },
];

/** The world (zone) name shown above region names. */
export const ZONE_NAME_KEY = 'zone.verdant_highlands';

export function regionAt(tileX: number, spawnX: number): RegionDef {
  const rel = tileX - spawnX;
  for (const r of REGION_DEFS) {
    if (rel >= r.fromX && rel < r.toX) return r;
  }
  return REGION_DEFS[REGION_DEFS.length - 1] as RegionDef;
}
