/**
 * Central texture/animation naming contract. Procedural generators and (future) hand-drawn
 * atlases must both register under these keys and frame names.
 */
export const TEX = {
  tiles: 'tiles',
  objects: 'objects',
  fx: 'fx',
  glow: 'fx_glow',
  shadow: 'fx_shadow',
  sun: 'sky_sun',
  moon: 'sky_moon',
  stars: 'sky_stars',
  sky: 'sky_gradient',
  lightmap: 'lightmap',
} as const;

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

export function objectAnimKey(objectKey: string, variant: number): string {
  return `obj:${objectKey}_${variant}`;
}
