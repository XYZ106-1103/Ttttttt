/**
 * Job (class) definitions. Data-driven so new jobs are added here without touching systems code.
 *
 * PHASE 1 status: only the data model exists and the starting job (`novice`) is used for display.
 * Combat styles, skills and job advancement are PHASE 3.
 */
import type { StatKey } from '../entities/stats';

export interface JobDef {
  readonly id: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  /** Stat that scales this job's damage (PHASE 3). */
  readonly primaryStat: StatKey;
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
    advancesFrom: null,
    advanceLevel: 1,
    color: '#c9c3b5',
  },
  {
    id: 'warrior',
    nameKey: 'job.warrior',
    descriptionKey: 'job.warrior.desc',
    primaryStat: 'str',
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#e0644f',
  },
  {
    id: 'mage',
    nameKey: 'job.mage',
    descriptionKey: 'job.mage.desc',
    primaryStat: 'int',
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#6f8cf0',
  },
  {
    id: 'archer',
    nameKey: 'job.archer',
    descriptionKey: 'job.archer.desc',
    primaryStat: 'dex',
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#72c36a',
  },
  {
    id: 'rogue',
    nameKey: 'job.rogue',
    descriptionKey: 'job.rogue.desc',
    primaryStat: 'luk',
    advancesFrom: 'novice',
    advanceLevel: 10,
    color: '#b07ce0',
  },
];

export const JOB_DEFS: readonly JobDef[] = defs;

const byId = new Map(defs.map((d) => [d.id, d]));

export function getJobDef(id: string): JobDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown job: ${id}`);
  return def;
}
