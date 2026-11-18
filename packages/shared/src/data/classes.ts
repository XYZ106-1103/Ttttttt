/**
 * Job (class) definitions. Data-driven so new jobs are added here without touching systems code:
 * skills reference their job id, weapons reference a weapon type, and auto stat allocation
 * follows `primaryStat` / `secondaryStat`.
 */
import type { StatKey } from '../entities/stats';
import type { WeaponType } from './items';

export interface JobDef {
  readonly id: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  /** Main damage stat (auto allocation puts 4 of every 5 points here). */
  readonly primaryStat: StatKey;
  readonly secondaryStat: StatKey;
  /** Weapon types this job's skills are built around. */
  readonly weapons: readonly WeaponType[];
  /** Max HP / MP multipliers. */
  readonly hpMul: number;
  readonly mpMul: number;
  /** 0 = starting job, 1 = first advancement, ... */
  readonly tier: number;
  /** Job this one advances from; `null` for the starting job. */
  readonly advancesFrom: string | null;
  /** Level required to advance into this job. */
  readonly advanceLevel: number;
  /** UI accent color. */
  readonly color: string;
}

const defs: JobDef[] = [
  {
    id: 'novice',
    nameKey: 'job.novice',
    descriptionKey: 'job.novice.desc',
    primaryStat: 'str',
    secondaryStat: 'dex',
    weapons: ['sword', 'staff', 'bow', 'dagger'],
    hpMul: 1,
    mpMul: 1,
    tier: 0,
    advancesFrom: null,
    advanceLevel: 1,
    color: '#c9c3b5',
  },
  {
    id: 'warrior',
    nameKey: 'job.warrior',
    descriptionKey: 'job.warrior.desc',
    primaryStat: 'str',
    secondaryStat: 'dex',
    weapons: ['sword'],
    hpMul: 1.3,
    mpMul: 0.8,
    tier: 1,
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#e0644f',
  },
  {
    id: 'mage',
    nameKey: 'job.mage',
    descriptionKey: 'job.mage.desc',
    primaryStat: 'int',
    secondaryStat: 'luk',
    weapons: ['staff'],
    hpMul: 0.85,
    mpMul: 1.6,
    tier: 1,
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#6f8cf0',
  },
  {
    id: 'archer',
    nameKey: 'job.archer',
    descriptionKey: 'job.archer.desc',
    primaryStat: 'dex',
    secondaryStat: 'str',
    weapons: ['bow'],
    hpMul: 1.0,
    mpMul: 1.0,
    tier: 1,
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#72c36a',
  },
  {
    id: 'rogue',
    nameKey: 'job.rogue',
    descriptionKey: 'job.rogue.desc',
    primaryStat: 'luk',
    secondaryStat: 'dex',
    weapons: ['dagger'],
    hpMul: 1.05,
    mpMul: 1.0,
    tier: 1,
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#b07ce0',
  },
];

export const JOB_DEFS: readonly JobDef[] = defs;

const byId = new Map(defs.map((d) => [d.id, d]));

export function findJobDef(id: string): JobDef | undefined {
  return byId.get(id);
}

/** The job and every job it advanced from (skills of ancestors stay usable). */
export function jobLineage(id: string): string[] {
  const out: string[] = [];
  let cur = byId.get(id);
  while (cur && !out.includes(cur.id)) {
    out.push(cur.id);
    cur = cur.advancesFrom ? byId.get(cur.advancesFrom) : undefined;
  }
  return out;
}

/** Jobs reachable from `id` by one advancement. */
export function nextJobs(id: string): JobDef[] {
  return defs.filter((d) => d.advancesFrom === id);
}

export function getJobDef(id: string): JobDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown job: ${id}`);
  return def;
}
