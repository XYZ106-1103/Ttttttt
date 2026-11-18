/** The damage formula. Pure and deterministic given the random source. */
import { clamp } from '../math/scalar';

export interface DamageInput {
  /** Attack or magic power of the attacker. */
  readonly power: number;
  /** Combined multiplier (skill % × hit weight). */
  readonly multiplier: number;
  readonly attackerLevel: number;
  readonly targetLevel: number;
  readonly targetDefense: number;
  readonly targetDamageTaken: number;
  /** 0..1 */
  readonly critRate: number;
  readonly critDamage: number;
  /** Bonus multiplier against a staggered/vulnerable target. */
  readonly vulnerable?: number;
}

export interface DamageRoll {
  readonly amount: number;
  readonly crit: boolean;
}

/** Defense mitigation: 100 defense halves damage, never reaches zero. */
export function mitigation(defense: number): number {
  return 100 / (100 + Math.max(0, defense));
}

/** Fighting stronger enemies is less effective (−4% per level, down to 40%). */
export function levelFactor(attackerLevel: number, targetLevel: number): number {
  const diff = targetLevel - attackerLevel;
  return diff > 0 ? clamp(1 - 0.04 * diff, 0.4, 1) : 1;
}

export function rollDamage(i: DamageInput, random: () => number): DamageRoll {
  const variance = 0.9 + random() * 0.2;
  const crit = random() < clamp(i.critRate, 0, 1);
  let amount =
    i.power *
    i.multiplier *
    variance *
    mitigation(i.targetDefense) *
    levelFactor(i.attackerLevel, i.targetLevel) *
    i.targetDamageTaken *
    (i.vulnerable ?? 1);
  if (crit) amount *= 1 + i.critDamage;
  return { amount: Math.max(1, Math.round(amount)), crit };
}

/** Experience granted for a kill, reduced when the killer out-levels the monster. */
export function expForKill(baseExp: number, killerLevel: number, monsterLevel: number): number {
  const over = killerLevel - monsterLevel - 5;
  const k = over > 0 ? Math.max(0.1, 1 - 0.1 * over) : 1;
  return Math.max(1, Math.round(baseExp * k));
}
