import { MAX_TILE_ID, TILE_DEFS, type TileCollision, type TileDef } from '../data/tiles';

/** Numeric collision codes for hot loops (physics, lighting). */
export const COLLISION_NONE = 0;
export const COLLISION_SOLID = 1;
export const COLLISION_PLATFORM = 2;
export type CollisionCode = 0 | 1 | 2;

function collisionCode(c: TileCollision): CollisionCode {
  return c === 'solid' ? COLLISION_SOLID : c === 'platform' ? COLLISION_PLATFORM : COLLISION_NONE;
}

/**
 * Fast lookup tables derived from the data-driven tile definitions.
 * Everything that runs per tile per frame should read from these arrays, not from TileDef objects.
 */
export class TileRegistry {
  readonly defs: readonly (TileDef | undefined)[];
  readonly collision = new Uint8Array(MAX_TILE_ID);
  readonly lightPass = new Float32Array(MAX_TILE_ID);
  /** Merge group index per tile id (0 = none). */
  readonly mergeGroup = new Uint8Array(MAX_TILE_ID);
  private readonly byKey = new Map<string, TileDef>();

  constructor(defs: readonly TileDef[] = TILE_DEFS) {
    const table: (TileDef | undefined)[] = new Array(MAX_TILE_ID).fill(undefined);
    const groups = new Map<string, number>([['none', 0]]);
    for (const def of defs) {
      if (def.id < 0 || def.id >= MAX_TILE_ID) throw new Error(`Tile id out of range: ${def.id}`);
      if (table[def.id]) throw new Error(`Duplicate tile id: ${def.id}`);
      if (this.byKey.has(def.key)) throw new Error(`Duplicate tile key: ${def.key}`);
      table[def.id] = def;
      this.byKey.set(def.key, def);
      this.collision[def.id] = collisionCode(def.collision);
      this.lightPass[def.id] = def.lightPass;
      if (!groups.has(def.mergeGroup)) groups.set(def.mergeGroup, groups.size);
      this.mergeGroup[def.id] = groups.get(def.mergeGroup) ?? 0;
    }
    // Unknown ids behave like air for light and collision.
    for (let i = 0; i < MAX_TILE_ID; i++) if (!table[i]) this.lightPass[i] = 1;
    this.defs = table;
  }

  get(id: number): TileDef | undefined {
    return this.defs[id];
  }

  byKeyOrThrow(key: string): TileDef {
    const def = this.byKey.get(key);
    if (!def) throw new Error(`Unknown tile key: ${key}`);
    return def;
  }

  idOf(key: string): number {
    return this.byKeyOrThrow(key).id;
  }

  /** True when two tiles should render as one connected mass (no outline between them). */
  connects(a: number, b: number): boolean {
    if (a === 0 || b === 0) return false;
    const ga = this.mergeGroup[a] ?? 0;
    return ga !== 0 && ga === this.mergeGroup[b];
  }
}

/** Shared default registry instance. */
export const tileRegistry = new TileRegistry();

/** Convenience tile id constants resolved from data. */
export const TILE = {
  air: 0,
  dirt: tileRegistry.idOf('dirt'),
  grass: tileRegistry.idOf('grass'),
  stone: tileRegistry.idOf('stone'),
  woodPlatform: tileRegistry.idOf('wood_platform'),
  woodPlanks: tileRegistry.idOf('wood_planks'),
  mossyStone: tileRegistry.idOf('mossy_stone'),
  dirtWall: tileRegistry.idOf('dirt_wall'),
  stoneWall: tileRegistry.idOf('stone_wall'),
  woodBeam: tileRegistry.idOf('wood_beam'),
} as const;
