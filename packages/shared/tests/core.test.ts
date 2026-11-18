import { describe, expect, it } from 'vitest';
import {
  createStartingProgress,
  deriveStats,
  expToNextLevel,
  fbm1D,
  fbm2D,
  getJobDef,
  grantExperience,
  periodicFbm1D,
  Rng,
  seedFromString,
  WorldClock,
} from '../src';

describe('Rng', () => {
  it('is deterministic per seed and stays in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() covers the inclusive range', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it('hashes strings stably', () => {
    expect(seedFromString('PROJECT-WORLD')).toBe(seedFromString('PROJECT-WORLD'));
    expect(seedFromString('a')).not.toBe(seedFromString('b'));
  });
});

describe('noise', () => {
  it('stays within [-1, 1] and is deterministic', () => {
    for (let i = 0; i < 2000; i++) {
      const v = fbm2D(i * 0.37, i * 0.11, 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.0001);
      expect(fbm1D(i * 0.1, 3)).toBe(fbm1D(i * 0.1, 3));
    }
  });

  it('periodic noise tiles seamlessly', () => {
    for (let x = 0; x < 64; x += 0.5) {
      expect(periodicFbm1D(x, 64, 9)).toBeCloseTo(periodicFbm1D(x + 64, 64, 9), 9);
    }
  });
});

describe('WorldClock', () => {
  it('wraps days and reports phases', () => {
    const c = new WorldClock({ dayLengthSeconds: 240, startHour: 23 });
    expect(c.phase).toBe('night');
    c.advance(20); // +2h
    expect(c.hour).toBe(1);
    expect(c.day).toBe(1);
    c.setTime(12);
    expect(c.phase).toBe('day');
    expect(c.daylight).toBe(1);
    c.setTime(0);
    expect(c.daylight).toBe(0);
    expect(c.format()).toBe('00:00');
  });
});

describe('stats', () => {
  it('has a monotonic experience curve', () => {
    for (let l = 1; l < 199; l++) expect(expToNextLevel(l + 1)).toBeGreaterThan(expToNextLevel(l));
  });

  it('levels up across multiple thresholds and grants points', () => {
    const p = createStartingProgress();
    const gained = grantExperience(p, expToNextLevel(1) + expToNextLevel(2) + 1);
    expect(gained.level).toBe(3);
    expect(gained.exp).toBe(1);
    expect(gained.statPoints).toBe(10);
    expect(grantExperience(p, -50)).toBe(p);
    expect(grantExperience(p, Number.NaN)).toBe(p);
  });

  it('derives HP/MP from stats', () => {
    const d = deriveStats(createStartingProgress());
    expect(d.maxHp).toBeGreaterThan(0);
    expect(d.maxMp).toBeGreaterThan(0);
  });

  it('defines the four starting jobs advancing from novice', () => {
    for (const id of ['warrior', 'mage', 'archer', 'rogue']) {
      expect(getJobDef(id).advancesFrom).toBe('novice');
    }
  });
});
