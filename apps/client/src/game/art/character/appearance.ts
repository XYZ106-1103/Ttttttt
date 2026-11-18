import { Rng } from '@world/shared';

/**
 * Appearance descriptor — the data that makes every character (player or AI adventurer) look
 * unique. The CharacterComposer turns it into a full animated sprite sheet at runtime, so
 * hundreds of distinct AI adventurers cost no hand-drawn assets.
 */
export type HairStyleId = 'spiky' | 'messy' | 'bob' | 'long' | 'ponytail';

export const HAIR_STYLES: readonly HairStyleId[] = ['spiky', 'messy', 'bob', 'long', 'ponytail'];

export interface Appearance {
  readonly skin: string;
  readonly hair: string;
  readonly hairStyle: HairStyleId;
  readonly eyes: string;
  readonly top: string;
  readonly accent: string;
  readonly pants: string;
  readonly boots: string;
  /** Scarf color, or null for none. */
  readonly scarf: string | null;
}

export const SKIN_TONES = ['#ffe0c4', '#f6cfa8', '#e8b48a', '#c98d62', '#9c6644', '#71462e'];
export const HAIR_COLORS = [
  '#3a2a24',
  '#6b4430',
  '#a8693b',
  '#e0b25a',
  '#f2e2b8',
  '#c74a3a',
  '#4a5f9c',
  '#2f2d3a',
  '#8a6fc4',
  '#e6e8ee',
];
export const EYE_COLORS = ['#3f6fd1', '#3c9a62', '#8a5a2e', '#b04a6a', '#6a4ab0', '#2a2a3a'];
export const CLOTH_COLORS = [
  '#3f7d5a',
  '#2f5f8f',
  '#8f3f3f',
  '#7a5a9a',
  '#b0823a',
  '#3a6a6f',
  '#5a5a66',
  '#a35a2a',
];
export const PANTS_COLORS = ['#5a4636', '#3d4456', '#4a3a2e', '#2f3a3a', '#6a5a4a'];
export const BOOT_COLORS = ['#3a2a22', '#4a3326', '#2a2a30', '#5a3d2a'];

/** The player's default look: a green-tunic wanderer with a red scarf. */
export const PLAYER_APPEARANCE: Appearance = {
  skin: '#f6cfa8',
  hair: '#6b4430',
  hairStyle: 'spiky',
  eyes: '#3f6fd1',
  top: '#3f7d5a',
  accent: '#d8b46a',
  pants: '#5a4636',
  boots: '#3a2a22',
  scarf: '#d2453c',
};

/** Deterministic random appearance (used for AI adventurers in PHASE 4). */
export function randomAppearance(seed: number): Appearance {
  const r = new Rng(seed);
  return {
    skin: r.pick(SKIN_TONES),
    hair: r.pick(HAIR_COLORS),
    hairStyle: r.pick(HAIR_STYLES),
    eyes: r.pick(EYE_COLORS),
    top: r.pick(CLOTH_COLORS),
    accent: r.pick(['#d8b46a', '#c9c3b5', '#b87a4a', '#8fb0c9']),
    pants: r.pick(PANTS_COLORS),
    boots: r.pick(BOOT_COLORS),
    scarf: r.chance(0.35) ? r.pick(['#d2453c', '#e0a030', '#3c7ad2', '#f0f0f0']) : null,
  };
}
