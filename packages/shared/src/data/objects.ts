/**
 * World object definitions: non-tile things that live on the map (trees, plants, props, light
 * sources). Objects are anchored to the tile they stand in (bottom-center).
 *
 * PHASE 2 will add hit points / drops (logging, harvesting) to these definitions.
 */

export interface ObjectLight {
  /** Linear RGB light color, 0..2 (values above 1 over-brighten). */
  readonly color: readonly [number, number, number];
  /** Flicker amplitude 0..1 (campfires, torches). */
  readonly flicker: number;
}

export type ObjectDepth = 'back' | 'front';

export interface WorldObjectDef {
  readonly key: string;
  readonly nameKey: string;
  /** Number of visual variants the art pipeline must provide. */
  readonly variants: number;
  /** Render behind (back) or in front of (front) characters. */
  readonly depth: ObjectDepth;
  /** Whether the sprite sways in the wind. */
  readonly sways: boolean;
  readonly light?: ObjectLight;
}

const defs: WorldObjectDef[] = [
  { key: 'tree_oak', nameKey: 'object.tree_oak', variants: 4, depth: 'back', sways: false },
  { key: 'tree_pine', nameKey: 'object.tree_pine', variants: 3, depth: 'back', sways: false },
  { key: 'bush', nameKey: 'object.bush', variants: 3, depth: 'back', sways: false },
  { key: 'grass_tuft', nameKey: 'object.grass_tuft', variants: 4, depth: 'back', sways: true },
  { key: 'tall_grass', nameKey: 'object.tall_grass', variants: 3, depth: 'front', sways: true },
  { key: 'flower', nameKey: 'object.flower', variants: 5, depth: 'back', sways: true },
  { key: 'rock', nameKey: 'object.rock', variants: 3, depth: 'back', sways: false },
  { key: 'mushroom', nameKey: 'object.mushroom', variants: 2, depth: 'back', sways: false },
  {
    key: 'campfire',
    nameKey: 'object.campfire',
    variants: 1,
    depth: 'back',
    sways: false,
    light: { color: [1.7, 1.05, 0.55], flicker: 0.18 },
  },
  { key: 'signpost', nameKey: 'object.signpost', variants: 1, depth: 'back', sways: false },
];

export const OBJECT_DEFS: readonly WorldObjectDef[] = defs;

const byKey = new Map(defs.map((d) => [d.key, d]));

export function getObjectDef(key: string): WorldObjectDef {
  const def = byKey.get(key);
  if (!def) throw new Error(`Unknown world object: ${key}`);
  return def;
}
