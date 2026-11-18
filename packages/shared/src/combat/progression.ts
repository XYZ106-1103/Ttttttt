/**
 * Character growth rules: stat allocation, job advancement and skill learning. Pure functions over
 * plain data so the server (PHASE 6) and AI adventurers (PHASE 4) apply exactly the same checks.
 */
import { findJobDef, getJobDef, type JobDef, jobLineage } from '../data/classes';
import { getSkillDef, type SkillDef, SKILL_DEFS } from '../data/skills';
import type { Mods } from '../data/statuses';
import { type CharacterProgress, type StatKey, STAT_KEYS } from '../entities/stats';
import { addMods } from './stats';

/** Learned skill levels by skill id. */
export type SkillBook = Readonly<Record<string, number>>;

export type AllocateFail = 'no_points' | 'invalid';
export type AdvanceFail = 'unknown_job' | 'not_next' | 'level';
export type LearnFail =
  'unknown' | 'wrong_job' | 'level' | 'prereq' | 'max' | 'no_points' | 'passive_locked';

export function allocateStat(
  p: CharacterProgress,
  stat: StatKey,
  amount = 1,
): { ok: true; progress: CharacterProgress } | { ok: false; reason: AllocateFail } {
  if (!STAT_KEYS.includes(stat) || !Number.isInteger(amount) || amount <= 0)
    return { ok: false, reason: 'invalid' };
  if (p.statPoints < amount) return { ok: false, reason: 'no_points' };
  return {
    ok: true,
    progress: {
      ...p,
      statPoints: p.statPoints - amount,
      stats: { ...p.stats, [stat]: p.stats[stat] + amount },
    },
  };
}

/** Spend all stat points 4:1 on the job's primary and secondary stats. Deterministic. */
export function autoAllocate(p: CharacterProgress, job: JobDef): CharacterProgress {
  let stats = { ...p.stats };
  let points = p.statPoints;
  while (points > 0) {
    // Keep the secondary stat at roughly a quarter of the primary.
    const key: StatKey =
      stats[job.secondaryStat] * 4 < stats[job.primaryStat] ? job.secondaryStat : job.primaryStat;
    stats = { ...stats, [key]: stats[key] + 1 };
    points--;
  }
  return { ...p, stats, statPoints: 0 };
}

export function checkAdvance(
  currentJob: string,
  targetJob: string,
  level: number,
): AdvanceFail | null {
  const target = findJobDef(targetJob);
  if (!target) return 'unknown_job';
  if (target.advancesFrom !== currentJob) return 'not_next';
  if (level < target.advanceLevel) return 'level';
  return null;
}

/** Skills usable by a job: its own and every ancestor job's. */
export function skillsForJob(jobId: string): SkillDef[] {
  const lineage = jobLineage(jobId);
  return SKILL_DEFS.filter((s) => lineage.includes(s.job));
}

export function checkLearn(
  book: SkillBook,
  skillId: string,
  jobId: string,
  progress: Pick<CharacterProgress, 'level' | 'skillPoints'>,
): LearnFail | null {
  const def = getSkillDef(skillId);
  if (!def) return 'unknown';
  if (!jobLineage(jobId).includes(def.job)) return 'wrong_job';
  const cur = book[skillId] ?? 0;
  if (cur >= def.maxLevel) return 'max';
  if (progress.level < def.reqLevel) return 'level';
  if (def.prereq && (book[def.prereq.skill] ?? 0) < def.prereq.level) return 'prereq';
  if (progress.skillPoints <= 0) return 'no_points';
  return null;
}

export function learnSkill(
  book: SkillBook,
  skillId: string,
  jobId: string,
  progress: CharacterProgress,
): { ok: true; book: SkillBook; progress: CharacterProgress } | { ok: false; reason: LearnFail } {
  const fail = checkLearn(book, skillId, jobId, progress);
  if (fail) return { ok: false, reason: fail };
  return {
    ok: true,
    book: { ...book, [skillId]: (book[skillId] ?? 0) + 1 },
    progress: { ...progress, skillPoints: progress.skillPoints - 1 },
  };
}

/** Summed passive modifiers of learned passive skills usable by the job. */
export function passiveMods(book: SkillBook, jobId: string): Mods {
  const lineage = jobLineage(jobId);
  const out: Record<string, number> = {};
  for (const [id, level] of Object.entries(book)) {
    const def = getSkillDef(id);
    if (!def || def.type !== 'passive' || level <= 0 || !lineage.includes(def.job)) continue;
    addMods(out, def.passive, level);
  }
  return out;
}

/** Drop unknown skills and clamp levels (never trust saves). */
export function sanitizeSkillBook(raw: unknown, jobId: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  const lineage = jobLineage(jobId);
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = getSkillDef(id);
    const n = Math.floor(Number(v));
    if (!def || !lineage.includes(def.job) || !Number.isFinite(n) || n <= 0) continue;
    out[id] = Math.min(n, def.maxLevel);
  }
  return out;
}

/** Total skill points a character of `level` has earned (validates saved point totals). */
export function earnedSkillPoints(level: number, perLevel: number): number {
  return Math.max(0, level - 1) * perLevel;
}

export { getJobDef };
