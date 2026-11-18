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
];

const byId = new Map(PROJECTILE_DEFS.map((d) => [d.id, d]));

export function getProjectileDef(id: string): ProjectileDef {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown projectile: ${id}`);
  return d;
}
