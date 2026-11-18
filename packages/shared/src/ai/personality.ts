/**
 * AI adventurer identity: names, personality traits, archetype, preferences and hidden skill.
 * Everything is generated deterministically from a seed, so a world always has the same people.
 */
import { clamp } from '../math/scalar';
import type { Rng } from '../math/rng';

export const TRAITS = [
  'curiosity',
  'aggression',
  'sociability',
  'greed',
  'courage',
  'caution',
  'competitiveness',
  'friendliness',
] as const;
export type Trait = (typeof TRAITS)[number];
export type Personality = Readonly<Record<Trait, number>>;

/** Life style that shapes goals: hunters level and fight, artisans gather and craft, explorers roam. */
export type Archetype = 'hunter' | 'artisan' | 'explorer';
export const ARCHETYPES: readonly Archetype[] = ['hunter', 'artisan', 'explorer'];

/** Speech tone derived from personality (picks bark wording). */
export type Tone = 'warm' | 'proud' | 'shy' | 'gruff' | 'calm';

const bell = (rng: Rng): number => (rng.next() + rng.next() + rng.next()) / 3;

export function generatePersonality(rng: Rng): Personality {
  const raw: Record<Trait, number> = {
    curiosity: bell(rng),
    aggression: bell(rng),
    sociability: bell(rng),
    greed: bell(rng),
    courage: bell(rng),
    caution: bell(rng),
    competitiveness: bell(rng),
    friendliness: bell(rng),
  };
  // Correlations so people feel coherent: brave folks are less cautious, social folks friendlier…
  const c = (v: number) => clamp(v, 0.02, 0.98);
  const stretch = (v: number) => c(0.5 + (v - 0.5) * 1.9);
  return {
    curiosity: stretch(raw.curiosity),
    aggression: stretch(raw.aggression * 0.7 + raw.courage * 0.3),
    sociability: stretch(raw.sociability),
    greed: stretch(raw.greed * 0.75 + raw.competitiveness * 0.25),
    courage: stretch(raw.courage),
    caution: stretch(raw.caution * 0.6 + (1 - raw.courage) * 0.4),
    competitiveness: stretch(raw.competitiveness),
    friendliness: stretch(raw.friendliness * 0.65 + raw.sociability * 0.35),
  };
}

export function pickArchetype(p: Personality, rng: Rng): Archetype {
  const scores: [Archetype, number][] = [
    ['hunter', p.aggression * 0.45 + p.courage * 0.3 + p.competitiveness * 0.25],
    ['artisan', p.greed * 0.35 + p.caution * 0.35 + (1 - p.aggression) * 0.3],
    ['explorer', p.curiosity * 0.6 + p.courage * 0.25 + p.sociability * 0.15],
  ];
  let best = scores[0] ?? ['hunter', 0];
  for (const s of scores) {
    const v = s[1] + rng.range(-0.08, 0.08);
    if (v > best[1]) best = [s[0], v];
  }
  return best[0];
}

/** Job an adventurer will advance into at level 10. */
export function preferredJob(p: Personality, rng: Rng): string {
  const scores: [string, number][] = [
    ['warrior', p.courage * 0.5 + p.aggression * 0.5],
    ['mage', p.curiosity * 0.55 + p.caution * 0.45],
    ['archer', p.caution * 0.5 + p.competitiveness * 0.5],
    ['rogue', p.greed * 0.45 + p.aggression * 0.3 + (1 - p.caution) * 0.25],
  ];
  let best = scores[0] ?? ['warrior', 0];
  for (const s of scores) {
    const v = s[1] + rng.range(-0.12, 0.12);
    if (v > best[1]) best = [s[0], v];
  }
  return best[0];
}

export function toneOf(p: Personality): Tone {
  if (p.friendliness > 0.65) return 'warm';
  if (p.competitiveness > 0.65 && p.friendliness < 0.6) return 'proud';
  if (p.aggression > 0.62 && p.friendliness < 0.45) return 'gruff';
  if (p.sociability < 0.35) return 'shy';
  return 'calm';
}

/** HP fraction below which the adventurer disengages. */
export function fleeThreshold(p: Personality): number {
  return clamp(0.12 + p.caution * 0.35 - p.courage * 0.12, 0.1, 0.45);
}

/** HP fraction below which a potion is used in combat. */
export function potionThreshold(p: Personality): number {
  return clamp(0.3 + p.caution * 0.25, 0.3, 0.55);
}

// --- Names ------------------------------------------------------------------------------------

const FIRST: readonly [string, string][] = [
  ['하', 'Ha'],
  ['윤', 'Yun'],
  ['서', 'Seo'],
  ['도', 'Do'],
  ['아', 'A'],
  ['리', 'Ri'],
  ['라', 'Ra'],
  ['미', 'Mi'],
  ['세', 'Se'],
  ['유', 'Yu'],
  ['다', 'Da'],
  ['소', 'So'],
  ['주', 'Ju'],
  ['나', 'Na'],
  ['태', 'Tae'],
  ['은', 'Eun'],
  ['온', 'On'],
  ['새', 'Sae'],
  ['별', 'Byeol'],
  ['로', 'Ro'],
  ['가', 'Ga'],
  ['재', 'Jae'],
  ['루', 'Ru'],
  ['시', 'Si'],
  ['해', 'Hae'],
  ['연', 'Yeon'],
  ['지', 'Ji'],
  ['무', 'Mu'],
  ['단', 'Dan'],
  ['솔', 'Sol'],
  ['휘', 'Hwi'],
  ['율', 'Yul'],
];
const SECOND: readonly [string, string][] = [
  ['린', 'rin'],
  ['온', 'on'],
  ['아', 'a'],
  ['율', 'yul'],
  ['하', 'ha'],
  ['서', 'seo'],
  ['윤', 'yun'],
  ['진', 'jin'],
  ['결', 'gyeol'],
  ['별', 'byeol'],
  ['담', 'dam'],
  ['우', 'u'],
  ['호', 'ho'],
  ['라', 'ra'],
  ['니', 'ni'],
  ['솔', 'sol'],
  ['겸', 'gyeom'],
  ['한', 'han'],
  ['빈', 'bin'],
  ['도', 'do'],
  ['슬', 'seul'],
  ['랑', 'rang'],
  ['후', 'hu'],
  ['늘', 'neul'],
  ['람', 'ram'],
];

export interface GeneratedName {
  readonly ko: string;
  readonly en: string;
}

export function generateName(rng: Rng, taken: ReadonlySet<string>): GeneratedName {
  for (let attempt = 0; attempt < 200; attempt++) {
    const a = rng.pick(FIRST);
    const b = rng.pick(SECOND);
    if (a[0] === b[0]) continue;
    const ko = a[0] + b[0];
    if (taken.has(ko)) continue;
    return { ko, en: a[1] + b[1] };
  }
  const n = taken.size + 1;
  return { ko: `모험가${n}`, en: `Adventurer${n}` };
}
