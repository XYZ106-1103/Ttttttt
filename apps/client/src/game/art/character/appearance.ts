import { Rng } from '@world/shared';

/**
 * Character appearance: outfit-driven so every adventurer (player or AI) gets a distinct silhouette,
 * not only a palette swap.
 */
export type Garment = 'longcoat' | 'jacket' | 'cloak';
export type Headwear = 'none' | 'goggles' | 'hood';
export type ScarfStyle = 'long' | 'short' | 'mask' | 'none';
export type HairStyle = 'messy' | 'swept' | 'long' | 'tied' | 'short';

export interface Appearance {
  readonly skin: string;
  readonly hair: string;
  readonly hairStyle: HairStyle;
  readonly eyes: string;
  readonly garment: Garment;
  readonly garmentColor: string;
  readonly inner: string;
  readonly accent: string;
  readonly pants: string;
  readonly boots: string;
  readonly headwear: Headwear;
  readonly scarf: ScarfStyle;
  readonly scarfColor: string;
  /** Short cape over the shoulders, or null. */
  readonly capelet: string | null;
  /** Rim-light tint (the environment light catching the silhouette edge). */
  readonly rim: string;
}

/** Concept A — 방랑자: long coat and a long crimson scarf. */
export const PRESET_WANDERER: Appearance = {
  skin: '#f0c6a2',
  hair: '#2b2333',
  hairStyle: 'messy',
  eyes: '#e9a640',
  garment: 'longcoat',
  garmentColor: '#2f3754',
  inner: '#d8cdb4',
  accent: '#b8873e',
  pants: '#3a3940',
  boots: '#2a211f',
  headwear: 'none',
  scarf: 'long',
  scarfColor: '#d4343c',
  capelet: null,
  rim: '#ffd59a',
};

/** Concept B — 탐험가: cropped jacket, goggles, satchel and a short cape. */
export const PRESET_EXPLORER: Appearance = {
  skin: '#e8b48c',
  hair: '#a5532c',
  hairStyle: 'swept',
  eyes: '#3f7fd8',
  garment: 'jacket',
  garmentColor: '#55663a',
  inner: '#e2d4b0',
  accent: '#8a5a2e',
  pants: '#2f3b54',
  boots: '#4a3426',
  headwear: 'goggles',
  scarf: 'short',
  scarfColor: '#e2a12e',
  capelet: '#8e3b2a',
  rim: '#bfe8ff',
};

/** Concept C — 그림자 순례자: hooded poncho with a face mask; only the eyes catch the light. */
export const PRESET_PILGRIM: Appearance = {
  skin: '#d8a580',
  hair: '#1f1c24',
  hairStyle: 'short',
  eyes: '#ffd86a',
  garment: 'cloak',
  garmentColor: '#24424c',
  inner: '#c6b088',
  accent: '#6e5a3a',
  pants: '#2e2a30',
  boots: '#261d1c',
  headwear: 'hood',
  scarf: 'mask',
  scarfColor: '#8c2f38',
  capelet: null,
  rim: '#9ff0e0',
};

export const APPEARANCE_PRESETS = [PRESET_WANDERER, PRESET_EXPLORER, PRESET_PILGRIM] as const;

/** The player's look (approved design: concept A — 방랑자). */
export const PLAYER_APPEARANCE: Appearance = PRESET_WANDERER;

const SKINS = ['#ffe0c4', '#f0c6a2', '#e3ad86', '#c48a62', '#9a6646', '#6e452f'];
const HAIRS = [
  '#2b2333',
  '#5a3826',
  '#a5532c',
  '#d9b25e',
  '#ece0c2',
  '#b8423a',
  '#465c9c',
  '#7a5fb8',
  '#d8dce6',
];
const GARMENTS = [
  '#2f3754',
  '#55663a',
  '#24424c',
  '#5a2f34',
  '#4a3f5e',
  '#6b5a3a',
  '#3a4a5a',
  '#2e2e34',
];
const INNERS = ['#d8cdb4', '#e2d4b0', '#b9c4cf', '#c6b088'];
const ACCENTS = ['#b8873e', '#8a5a2e', '#c9c3b5', '#6e5a3a'];
const SCARVES = ['#d4343c', '#e2a12e', '#3c7ad2', '#ece6da', '#5aa060', '#8c2f38'];
const RIMS = ['#ffd59a', '#bfe8ff', '#9ff0e0', '#ffc2d6'];

/** Deterministic random appearance for AI adventurers (PHASE 4). */
export function randomAppearance(seed: number): Appearance {
  const r = new Rng(seed);
  const garment = r.pick<Garment>(['longcoat', 'jacket', 'cloak']);
  const headwear: Headwear =
    garment === 'cloak' && r.chance(0.6) ? 'hood' : r.chance(0.25) ? 'goggles' : 'none';
  return {
    skin: r.pick(SKINS),
    hair: r.pick(HAIRS),
    hairStyle: r.pick<HairStyle>(['messy', 'swept', 'long', 'tied', 'short']),
    eyes: r.pick(['#3f7fd8', '#3c9a62', '#8a5a2e', '#e9a640', '#6a4ab0']),
    garment,
    garmentColor: r.pick(GARMENTS),
    inner: r.pick(INNERS),
    accent: r.pick(ACCENTS),
    pants: r.pick(['#3a3940', '#2f3b54', '#4a3a2e', '#2e2a30']),
    boots: r.pick(['#2a211f', '#4a3426', '#261d1c', '#33302e']),
    headwear,
    scarf: headwear === 'hood' ? 'mask' : r.pick<ScarfStyle>(['long', 'short', 'none', 'long']),
    scarfColor: r.pick(SCARVES),
    capelet:
      garment === 'jacket' && r.chance(0.5) ? r.pick(['#8e3b2a', '#3a4a6a', '#5a5a32']) : null,
    rim: r.pick(RIMS),
  };
}
