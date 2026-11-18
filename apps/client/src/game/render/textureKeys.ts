/**
 * Central texture/animation naming contract. Procedural generators and (future) hand-drawn
 * atlases must both register under these keys and frame names.
 */
export const TEX = {
  tiles: 'tiles',
  items: 'items',
  objects: 'objects',
  fx: 'fx',
  glow: 'fx_glow',
  shadow: 'fx_shadow',
  sun: 'sky_sun',
  moon: 'sky_moon',
  stars: 'sky_stars',
  sky: 'sky_gradient',
  lightmap: 'lightmap',
  monsters: 'monsters',
  combat: 'combat_fx',
} as const;

export function monsterAnimKey(id: string, anim: string): string {
  return `mon:${id}:${anim}`;
}

export function combatAnimKey(name: string): string {
  return `cfx:${name}`;
}

export const CLOUD_VARIANTS = 4;

export function cloudKey(i: number): string {
  return `sky_cloud_${i}`;
}

export function characterKey(id: string): string {
  return `char_${id}`;
}

export function characterAnimKey(id: string, anim: string): string {
  return `${characterKey(id)}:${anim}`;
}

/** Body sheet without the front arm (used while an item is being used). */
export function characterNoArmKey(id: string): string {
  return `char_${id}_noarm`;
}

export function characterNoArmAnimKey(id: string, anim: string): string {
  return `${characterNoArmKey(id)}:${anim}`;
}

/** Front-arm frames at discrete angles. */
export function characterArmKey(id: string): string {
  return `char_${id}_arm`;
}

export function objectAnimKey(objectKey: string, variant: number): string {
  return `obj:${objectKey}_${variant}`;
}
