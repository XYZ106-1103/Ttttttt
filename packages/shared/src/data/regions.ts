/**
 * Named regions of the overworld (one per biome stretch), relative to the world spawn column so
 * they stay valid if the world width changes. Used for the minimap header and region banners.
 */
import { BIOME_DEFS, type BiomeId } from './biomes';

export interface RegionDef {
  readonly id: string;
  readonly nameKey: string;
  readonly biome: BiomeId;
  /** Inclusive start, exclusive end, in tiles relative to spawn X. */
  readonly fromX: number;
  readonly toX: number;
}

export const REGION_DEFS: readonly RegionDef[] = BIOME_DEFS.map((d) => ({
  id: d.region,
  nameKey: d.nameKey,
  biome: d.id,
  fromX: d.fromX,
  toX: d.toX,
}));

/** The world (zone) name shown above region names. */
export const ZONE_NAME_KEY = 'zone.verdant_highlands';

export function regionAt(tileX: number, spawnX: number): RegionDef {
  const rel = tileX - spawnX;
  for (const r of REGION_DEFS) {
    if (rel >= r.fromX && rel < r.toX) return r;
  }
  return REGION_DEFS[REGION_DEFS.length - 1] as RegionDef;
}
