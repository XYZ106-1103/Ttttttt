/**
 * Projectile definitions. Projectiles are simulated by the CombatWorld; `visual` names the
 * renderer sprite/effect so art can be swapped without touching combat code.
 */
export interface ProjectileDef {
  readonly id: string;
  /** Launch speed (px/s). */
  readonly speed: number;
  /** Downward acceleration (px/s²). */
  readonly gravity: number;
  readonly radius: number;
  readonly lifetime: number;
  /** Extra targets pierced after the first hit. */
  readonly pierce: number;
  readonly tileCollide: boolean;
  /** Turn rate toward the nearest enemy (rad/s). */
  readonly homing?: number;
  /** Explodes on impact or expiry, damaging everything in the radius. */
  readonly explode?: { readonly radius: number; readonly damage: number };
  /** Travels along the ground surface (shockwaves). */
  readonly groundHug?: boolean;
  readonly light?: readonly [number, number, number];
  readonly visual: string;
}

const p = (d: ProjectileDef): ProjectileDef => d;

export const PROJECTILE_DEFS: readonly ProjectileDef[] = [
  p({
    id: 'arrow',
    speed: 560,
    gravity: 300,
    radius: 3,
    lifetime: 1.6,
    pierce: 0,
    tileCollide: true,
    visual: 'arrow',
  }),
  p({
    id: 'arrow_charged',
    speed: 780,
    gravity: 120,
    radius: 4,
    lifetime: 1.6,
    pierce: 3,
    tileCollide: true,
    visual: 'arrow_charged',
    light: [0.5, 0.45, 0.25],
  }),
  p({
    id: 'arrow_pierce',
    speed: 760,
    gravity: 0,
    radius: 4,
    lifetime: 1.2,
    pierce: 8,
    tileCollide: true,
    visual: 'arrow_charged',
    light: [0.5, 0.45, 0.25],
  }),
  p({
    id: 'pebble',
    speed: 400,
    gravity: 650,
    radius: 3,
    lifetime: 1.6,
    pierce: 0,
    tileCollide: true,
    visual: 'pebble',
  }),
  p({
    id: 'magic_bolt',
    speed: 430,
    gravity: 0,
    radius: 4,
    lifetime: 1.1,
    pierce: 0,
    tileCollide: true,
    visual: 'magic_bolt',
    light: [0.55, 0.65, 1.5],
  }),
  p({
    id: 'arcane_bolt',
    speed: 520,
    gravity: 0,
    radius: 5,
    lifetime: 1.1,
    pierce: 1,
    tileCollide: true,
    visual: 'arcane_bolt',
    light: [0.8, 0.5, 1.6],
  }),
  p({
    id: 'fireball',
    speed: 330,
    gravity: 0,
    radius: 5,
    lifetime: 1.4,
    pierce: 0,
    tileCollide: true,
    visual: 'fireball',
    explode: { radius: 36, damage: 1 },
    light: [1.7, 0.8, 0.3],
  }),
  p({
    id: 'kunai',
    speed: 620,
    gravity: 80,
    radius: 3,
    lifetime: 1,
    pierce: 0,
    tileCollide: true,
    visual: 'kunai',
  }),
  p({
    id: 'wisp_fire',
    speed: 140,
    gravity: 0,
    radius: 5,
    lifetime: 4.5,
    pierce: 0,
    tileCollide: true,
    homing: 1.5,
    visual: 'wisp_fire',
    light: [0.35, 0.65, 1.4],
  }),
  p({
    id: 'boulder',
    speed: 300,
    gravity: 900,
    radius: 9,
    lifetime: 3,
    pierce: 0,
    tileCollide: true,
    visual: 'boulder',
    explode: { radius: 22, damage: 0.6 },
  }),
  p({
    id: 'shockwave',
    speed: 250,
    gravity: 0,
    radius: 8,
    lifetime: 1.8,
    pierce: 99,
    tileCollide: true,
    groundHug: true,
    visual: 'shockwave',
    light: [0.9, 0.5, 0.25],
  }),
  p({
    id: 'stalactite',
    speed: 0,
    gravity: 1100,
    radius: 7,
    lifetime: 3,
    pierce: 0,
    tileCollide: true,
    visual: 'stalactite',
    explode: { radius: 18, damage: 0.5 },
  }),

  // Biome monsters and bosses.
  p({
    id: 'ice_shard',
    speed: 200,
    gravity: 0,
    radius: 5,
    lifetime: 4,
    pierce: 0,
    tileCollide: true,
    homing: 1.2,
    visual: 'ice_shard',
    light: [0.45, 0.8, 1.3],
  }),
  p({
    id: 'imp_fireball',
    speed: 210,
    gravity: 0,
    radius: 5,
    lifetime: 3.5,
    pierce: 0,
    tileCollide: true,
    homing: 1,
    visual: 'fireball',
    explode: { radius: 28, damage: 0.8 },
    light: [1.6, 0.75, 0.3],
  }),
  p({
    id: 'ice_chunk',
    speed: 300,
    gravity: 900,
    radius: 9,
    lifetime: 3,
    pierce: 0,
    tileCollide: true,
    visual: 'ice_chunk',
    explode: { radius: 24, damage: 0.6 },
    light: [0.3, 0.5, 0.8],
  }),
  p({
    id: 'frost_wave',
    speed: 250,
    gravity: 0,
    radius: 8,
    lifetime: 1.9,
    pierce: 99,
    tileCollide: true,
    groundHug: true,
    visual: 'frost_wave',
    light: [0.45, 0.75, 1.2],
  }),
  p({
    id: 'icicle',
    speed: 0,
    gravity: 1100,
    radius: 7,
    lifetime: 3,
    pierce: 0,
    tileCollide: true,
    visual: 'icicle',
    explode: { radius: 18, damage: 0.5 },
  }),
  p({
    id: 'magma_ball',
    speed: 300,
    gravity: 900,
    radius: 9,
    lifetime: 3,
    pierce: 0,
    tileCollide: true,
    visual: 'magma_ball',
    explode: { radius: 30, damage: 0.7 },
    light: [1.5, 0.6, 0.2],
  }),
  p({
    id: 'lava_wave',
    speed: 260,
    gravity: 0,
    radius: 9,
    lifetime: 2,
    pierce: 99,
    tileCollide: true,
    groundHug: true,
    visual: 'lava_wave',
    light: [1.5, 0.6, 0.2],
  }),
  p({
    id: 'meteor',
    speed: 0,
    gravity: 1100,
    radius: 8,
    lifetime: 3,
    pierce: 0,
    tileCollide: true,
    visual: 'meteor',
    explode: { radius: 26, damage: 0.6 },
    light: [1.4, 0.6, 0.25],
  }),
];

const byId = new Map(PROJECTILE_DEFS.map((d) => [d.id, d]));

export function getProjectileDef(id: string): ProjectileDef {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown projectile: ${id}`);
  return d;
}
