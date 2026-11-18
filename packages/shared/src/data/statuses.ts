/**
 * Status effects (buffs and debuffs). Modifiers are per unit of magnitude: a status applied with
 * magnitude 20 and `attackPct: 0.01` grants +20% attack. Damage-over-time scales with the power
 * of whoever applied it.
 */
export type ModKey =
  | 'attackPct'
  | 'magicPct'
  | 'defensePct'
  | 'critRate'
  | 'critDamage'
  | 'moveSpeedPct'
  | 'attackSpeedPct'
  | 'jumpPct'
  | 'damageTakenPct'
  | 'maxHpPct'
  | 'maxMpPct'
  | 'hpRegen'
  | 'mpRegen';

export type Mods = Partial<Record<ModKey, number>>;

export interface StatusDef {
  readonly id: string;
  readonly nameKey: string;
  readonly kind: 'buff' | 'debuff';
  readonly mods?: Mods;
  /** Damage per tick = source power × powerRatio × magnitude. */
  readonly dot?: { readonly interval: number; readonly powerRatio: number };
  /** Heal per tick = max HP × maxHpRatio × magnitude. */
  readonly hot?: { readonly interval: number; readonly maxHpRatio: number };
  /** Prevents moving and acting. */
  readonly stun?: boolean;
  readonly color: string;
  /** Upper bound on any applied duration (s). */
  readonly maxDuration: number;
}

const s = (d: Omit<StatusDef, 'nameKey'>): StatusDef => ({ ...d, nameKey: `status.${d.id}` });

export const STATUS_DEFS: readonly StatusDef[] = [
  s({
    id: 'poison',
    kind: 'debuff',
    dot: { interval: 1, powerRatio: 0.2 },
    color: '#7bd35a',
    maxDuration: 10,
  }),
  s({
    id: 'burn',
    kind: 'debuff',
    dot: { interval: 0.5, powerRatio: 0.12 },
    color: '#ff8a3d',
    maxDuration: 6,
  }),
  s({ id: 'slow', kind: 'debuff', mods: { moveSpeedPct: -0.4 }, color: '#7fb8ff', maxDuration: 6 }),
  s({ id: 'freeze', kind: 'debuff', stun: true, color: '#a8e6ff', maxDuration: 2.5 }),
  s({ id: 'stun', kind: 'debuff', stun: true, color: '#ffe066', maxDuration: 3 }),
  s({ id: 'weaken', kind: 'debuff', mods: { attackPct: -0.2 }, color: '#a0a0a0', maxDuration: 8 }),
  s({ id: 'rage', kind: 'buff', mods: { attackPct: 0.01 }, color: '#ff5a4a', maxDuration: 120 }),
  s({
    id: 'focus',
    kind: 'buff',
    mods: { critRate: 0.01, critDamage: 0.01 },
    color: '#ffd84a',
    maxDuration: 120,
  }),
  s({
    id: 'haste',
    kind: 'buff',
    mods: { moveSpeedPct: 0.01, jumpPct: 0.004 },
    color: '#8affc0',
    maxDuration: 120,
  }),
  s({
    id: 'second_wind',
    kind: 'buff',
    hot: { interval: 0.5, maxHpRatio: 0.03 },
    color: '#9df07a',
    maxDuration: 10,
  }),
  s({ id: 'perfect_focus', kind: 'buff', mods: { critRate: 1 }, color: '#ffffff', maxDuration: 3 }),
];

const byId = new Map(STATUS_DEFS.map((d) => [d.id, d]));

export function getStatusDef(id: string): StatusDef | undefined {
  return byId.get(id);
}
