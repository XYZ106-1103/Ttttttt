/**
 * Monster definitions. Behaviour comes from the `ai` brain; every tuning number lives here so
 * new monsters are mostly data. `params` keys are documented in monsters/brains.ts.
 */
export type MonsterAi = 'hopper' | 'charger' | 'flyer' | 'caster' | 'golem';
export type SpawnZone = 'surface' | 'underground' | 'deep';

export interface LootEntry {
  readonly item: string;
  readonly chance: number;
  readonly min: number;
  readonly max: number;
}

export interface SpawnRule {
  readonly zones: readonly SpawnZone[];
  readonly time: 'any' | 'day' | 'night';
  readonly weight: number;
}

export interface MonsterDef {
  readonly id: string;
  readonly nameKey: string;
  readonly level: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly exp: number;
  readonly width: number;
  readonly height: number;
  readonly ai: MonsterAi;
  /** Ground speed or flight speed (px/s). */
  readonly speed: number;
  /** Jump velocity for ground monsters (px/s). */
  readonly jump: number;
  /** Contact damage as a multiple of attack (0 = harmless to touch). */
  readonly contact: number;
  /** 0..1, 1 = immune to knockback and hit stun. */
  readonly knockbackResist: number;
  /** Tiles. */
  readonly aggroRange: number;
  readonly flying?: boolean;
  /** Passes through terrain. */
  readonly ghost?: boolean;
  readonly boss?: boolean;
  readonly immune?: readonly string[];
  readonly light?: readonly [number, number, number];
  readonly drops: readonly LootEntry[];
  /** Gold coins dropped on death: [min, max]. */
  readonly gold: readonly [number, number];
  readonly spawn: SpawnRule | null;
  readonly params?: Readonly<Record<string, number>>;
}

const m = (d: Omit<MonsterDef, 'nameKey'>): MonsterDef => ({ ...d, nameKey: `monster.${d.id}` });

export const MONSTER_DEFS: readonly MonsterDef[] = [
  m({
    id: 'dew_slime',
    level: 1,
    hp: 40,
    attack: 8,
    defense: 0,
    exp: 6,
    width: 18,
    height: 13,
    ai: 'hopper',
    speed: 80,
    jump: 360,
    contact: 1,
    knockbackResist: 0,
    aggroRange: 9,
    gold: [1, 3],
    drops: [
      { item: 'slime_gel', chance: 0.7, min: 1, max: 2 },
      { item: 'healing_potion', chance: 0.04, min: 1, max: 1 },
    ],
    spawn: { zones: ['surface'], time: 'any', weight: 10 },
    params: { hopMin: 0.7, hopMax: 1.6, chaseHop: 0.55 },
  }),
  m({
    id: 'thornback',
    level: 3,
    hp: 85,
    attack: 13,
    defense: 5,
    exp: 14,
    width: 26,
    height: 16,
    ai: 'charger',
    speed: 42,
    jump: 0,
    contact: 1,
    knockbackResist: 0.2,
    aggroRange: 10,
    gold: [2, 5],
    drops: [{ item: 'beetle_shell', chance: 0.6, min: 1, max: 2 }],
    spawn: { zones: ['surface'], time: 'any', weight: 6 },
    params: {
      chargeSpeed: 240,
      windup: 0.6,
      chargeTime: 1.3,
      daze: 1.1,
      cooldown: 1.6,
      chargeContact: 1.6,
    },
  }),
  m({
    id: 'cave_slime',
    level: 5,
    hp: 140,
    attack: 17,
    defense: 8,
    exp: 22,
    width: 20,
    height: 14,
    ai: 'hopper',
    speed: 90,
    jump: 410,
    contact: 1,
    knockbackResist: 0.1,
    aggroRange: 10,
    gold: [3, 7],
    drops: [
      { item: 'slime_gel', chance: 0.8, min: 1, max: 3 },
      { item: 'healing_potion', chance: 0.05, min: 1, max: 1 },
      { item: 'mana_potion', chance: 0.05, min: 1, max: 1 },
    ],
    spawn: { zones: ['underground'], time: 'any', weight: 8 },
    params: { hopMin: 0.6, hopMax: 1.3, chaseHop: 0.45 },
  }),
  m({
    id: 'cave_bat',
    level: 7,
    hp: 110,
    attack: 20,
    defense: 3,
    exp: 28,
    width: 18,
    height: 12,
    ai: 'flyer',
    speed: 120,
    jump: 0,
    contact: 1,
    knockbackResist: 0.1,
    aggroRange: 12,
    flying: true,
    gold: [4, 8],
    drops: [{ item: 'bat_wing', chance: 0.55, min: 1, max: 2 }],
    spawn: { zones: ['underground', 'deep'], time: 'any', weight: 7 },
    params: { orbit: 54, swoopSpeed: 300, swoopEvery: 2.2, swoopTime: 0.55 },
  }),
  m({
    id: 'wisp',
    level: 10,
    hp: 230,
    attack: 27,
    defense: 10,
    exp: 48,
    width: 16,
    height: 18,
    ai: 'caster',
    speed: 70,
    jump: 0,
    contact: 0.6,
    knockbackResist: 0.3,
    aggroRange: 15,
    flying: true,
    ghost: true,
    light: [0.35, 0.62, 1.35],
    gold: [7, 14],
    drops: [
      { item: 'wisp_ember', chance: 0.6, min: 1, max: 2 },
      { item: 'mana_potion', chance: 0.06, min: 1, max: 1 },
    ],
    spawn: { zones: ['surface', 'deep'], time: 'night', weight: 5 },
    params: { keepMin: 90, keepMax: 150, castEvery: 2.6, windup: 0.6, blink: 70 },
  }),
  m({
    id: 'corestone_golem',
    level: 15,
    hp: 6000,
    attack: 42,
    defense: 25,
    exp: 1500,
    width: 50,
    height: 68,
    ai: 'golem',
    speed: 55,
    jump: 0,
    contact: 0.8,
    knockbackResist: 1,
    aggroRange: 40,
    boss: true,
    immune: ['stun', 'freeze'],
    light: [1.2, 0.62, 0.3],
    gold: [200, 300],
    drops: [
      { item: 'corestone', chance: 1, min: 3, max: 5 },
      { item: 'iron_ore', chance: 1, min: 8, max: 14 },
      { item: 'healing_potion', chance: 1, min: 3, max: 5 },
    ],
    spawn: null,
    params: {
      enrageAt: 0.5,
      slamDamage: 1.6,
      waveDamage: 1,
      boulderDamage: 1.1,
      chargeSpeed: 270,
      chargeDamage: 1.4,
      quakeDamage: 1.2,
    },
  }),
];

const byId = new Map(MONSTER_DEFS.map((d) => [d.id, d]));

export function getMonsterDef(id: string): MonsterDef | undefined {
  return byId.get(id);
}

export function requireMonsterDef(id: string): MonsterDef {
  const d = byId.get(id);
  if (!d) throw new Error(`Unknown monster: ${id}`);
  return d;
}
