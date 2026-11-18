/**
 * Derived combat stats. One function turns progression + job + gear + modifiers into the numbers
 * the damage formula uses — players and AI adventurers (PHASE 4) share it exactly.
 */
import type { JobDef } from '../data/classes';
import type { StatBonus, WeaponStats } from '../data/items';
import type { ModKey, Mods } from '../data/statuses';
import { UNARMED_ATTACK, WEAPON_PROFILES } from '../data/weapons';
import { type BaseStats, type CharacterProgress, deriveStats, STAT_KEYS } from '../entities/stats';
import { clamp } from '../math/scalar';

export interface CombatStats {
  readonly maxHp: number;
  readonly maxMp: number;
  /** Physical attack power. */
  readonly attack: number;
  /** Magic attack power. */
  readonly magic: number;
  readonly defense: number;
  /** 0..1 */
  readonly critRate: number;
  /** Bonus multiplier on crits (0.5 = ×1.5). */
  readonly critDamage: number;
  /** Multipliers (1 = normal). */
  readonly moveSpeed: number;
  readonly attackSpeed: number;
  readonly jump: number;
  readonly damageTaken: number;
  /** Per second. */
  readonly hpRegen: number;
  readonly mpRegen: number;
  /** Final base stats including gear. */
  readonly totals: BaseStats;
}

export interface StatSources {
  readonly progress: Pick<CharacterProgress, 'level' | 'stats'>;
  readonly job: JobDef;
  /** Held weapon, if any. */
  readonly weapon: WeaponStats | null;
  /** Bonuses of every equipped armor piece / accessory (and the weapon's own bonus). */
  readonly gear: readonly StatBonus[];
  /** Summed passive skill + status modifiers. */
  readonly mods: Mods;
}

export function addMods(into: Record<string, number>, mods: Mods | undefined, scale = 1): void {
  if (!mods) return;
  for (const k of Object.keys(mods) as ModKey[]) into[k] = (into[k] ?? 0) + (mods[k] ?? 0) * scale;
}

type GearTotals = { -readonly [K in keyof StatBonus]-?: number };

function sumGear(gear: readonly StatBonus[]): GearTotals {
  const out: GearTotals = {
    str: 0,
    dex: 0,
    int: 0,
    vit: 0,
    luk: 0,
    attack: 0,
    magic: 0,
    defense: 0,
    maxHp: 0,
    maxMp: 0,
    critRate: 0,
    critDamage: 0,
    moveSpeed: 0,
    mpRegen: 0,
  };
  for (const g of gear) {
    for (const k of Object.keys(out) as (keyof StatBonus)[]) out[k] += g[k] ?? 0;
  }
  return out;
}

export function computeCombatStats(src: StatSources): CombatStats {
  const { progress, job, weapon, mods } = src;
  const gear = sumGear(weapon?.bonus ? [...src.gear, weapon.bonus] : src.gear);
  const totals = {} as Record<keyof BaseStats, number>;
  for (const k of STAT_KEYS) totals[k] = progress.stats[k] + gear[k];
  const mod = (k: ModKey): number => mods[k] ?? 0;
  const base = deriveStats({ level: progress.level, stats: totals });

  const profile = weapon ? WEAPON_PROFILES[weapon.type] : null;
  const primary = profile ? totals[profile.primary] : totals[job.primaryStat];
  const secondary = profile ? totals[profile.secondary] : totals[job.secondaryStat];
  const physicalBase = profile
    ? profile.power === 'attack'
      ? (weapon?.attack ?? 0)
      : UNARMED_ATTACK
    : UNARMED_ATTACK;
  const magicBase = profile?.power === 'magic' ? (weapon?.attack ?? 0) : UNARMED_ATTACK;
  const attack =
    (physicalBase + gear.attack) * (1 + (primary * 4 + secondary) / 100) * (1 + mod('attackPct'));
  const magic =
    (magicBase + gear.magic) * (1 + (totals.int * 4 + totals.luk) / 100) * (1 + mod('magicPct'));

  return {
    maxHp: Math.round((base.maxHp * job.hpMul + gear.maxHp) * (1 + mod('maxHpPct'))),
    maxMp: Math.round((base.maxMp * job.mpMul + gear.maxMp) * (1 + mod('maxMpPct'))),
    attack,
    magic,
    defense: (gear.defense + totals.vit * 0.5 + progress.level * 0.4) * (1 + mod('defensePct')),
    critRate: clamp(
      0.05 + totals.luk * 0.003 + totals.dex * 0.001 + gear.critRate + mod('critRate'),
      0,
      1,
    ),
    critDamage: 0.5 + gear.critDamage + mod('critDamage'),
    moveSpeed: Math.max(0.2, 1 + gear.moveSpeed + mod('moveSpeedPct')),
    attackSpeed: Math.max(0.3, (weapon?.speed ?? 1) * (1 + mod('attackSpeedPct'))),
    jump: Math.max(0.5, 1 + mod('jumpPct')),
    damageTaken: Math.max(0.1, 1 + mod('damageTakenPct')),
    hpRegen: 0.5 + totals.vit * 0.08 + mod('hpRegen'),
    mpRegen: 0.6 + totals.int * 0.06 + gear.mpRegen + mod('mpRegen'),
    totals,
  };
}

/** Stats for a monster from its data (no gear or progression). */
export function monsterCombatStats(def: {
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
}): CombatStats {
  return {
    maxHp: def.hp,
    maxMp: 0,
    attack: def.attack,
    magic: def.attack,
    defense: def.defense,
    critRate: 0,
    critDamage: 0.5,
    moveSpeed: 1,
    attackSpeed: 1,
    jump: 1,
    damageTaken: 1,
    hpRegen: 0,
    mpRegen: 0,
    totals: { str: 0, dex: 0, int: 0, vit: 0, luk: 0 },
  };
}
