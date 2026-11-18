/**
 * Character progression model: base stats, derived stats and the experience curve.
 * Shared between players and AI adventurers so both progress by exactly the same rules.
 */

export type StatKey = 'str' | 'dex' | 'int' | 'vit' | 'luk';

export const STAT_KEYS: readonly StatKey[] = ['str', 'dex', 'int', 'vit', 'luk'];

export type BaseStats = Record<StatKey, number>;

export interface CharacterProgress {
  readonly level: number;
  /** Experience accumulated toward the next level. */
  readonly exp: number;
  readonly stats: BaseStats;
  readonly statPoints: number;
  readonly skillPoints: number;
}

export interface DerivedStats {
  readonly maxHp: number;
  readonly maxMp: number;
}

export const MAX_LEVEL = 200;
export const STAT_POINTS_PER_LEVEL = 5;
export const SKILL_POINTS_PER_LEVEL = 3;

export const STARTING_STATS: Readonly<BaseStats> = { str: 5, dex: 5, int: 5, vit: 5, luk: 5 };

/** Experience required to go from `level` to `level + 1`. Monotonic, gentle early, steep late. */
export function expToNextLevel(level: number): number {
  if (level >= MAX_LEVEL) return Infinity;
  const l = Math.max(1, Math.floor(level));
  return Math.round(15 * Math.pow(l, 1.85) + 10 * l);
}

export function deriveStats(progress: Pick<CharacterProgress, 'level' | 'stats'>): DerivedStats {
  const { level, stats } = progress;
  return {
    maxHp: Math.round(50 + stats.vit * 10 + (level - 1) * 14 + stats.str * 2),
    maxMp: Math.round(20 + stats.int * 8 + (level - 1) * 6),
  };
}

export function createStartingProgress(): CharacterProgress {
  return { level: 1, exp: 0, stats: { ...STARTING_STATS }, statPoints: 0, skillPoints: 0 };
}

/**
 * Apply gained experience, handling multiple level-ups. Pure function: callers (server in PHASE 6)
 * own validation of where the experience came from.
 */
export function grantExperience(progress: CharacterProgress, amount: number): CharacterProgress {
  if (!Number.isFinite(amount) || amount <= 0) return progress;
  let { level, exp, statPoints, skillPoints } = progress;
  exp += amount;
  while (level < MAX_LEVEL && exp >= expToNextLevel(level)) {
    exp -= expToNextLevel(level);
    level += 1;
    statPoints += STAT_POINTS_PER_LEVEL;
    skillPoints += SKILL_POINTS_PER_LEVEL;
  }
  if (level >= MAX_LEVEL) exp = 0;
  return { ...progress, level, exp, statPoints, skillPoints };
}
