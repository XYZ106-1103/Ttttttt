/**
 * Monster definitions. Behaviour comes from the `ai` brain; every tuning number lives here so
 * new monsters are mostly data. `params` keys are documented in monsters/brains.ts.
 */
export type MonsterAi = 'hopper' | 'charger' | 'flyer' | 'caster' | 'golem';
import type { BiomeId } from './biomes';

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
  /** Biomes (by column) where it spawns; omitted = everywhere. */
  readonly biomes?: readonly BiomeId[];
  /** Minimum depth below the surface (tiles). */
  readonly minDepth?: number;
}

/** Projectile ids a boss brain throws, in place of the Corestone Golem's rocks. */
export interface BossProjectiles {
  /** Lobbed in barrages. */
  readonly boulder?: string;
  /** Rolled along the ground from slams. */
  readonly wave?: string;
  /** Dropped from above in the enraged quake. */
  readonly rain?: string;
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
  /** Status every hit of this monster may inflict (contact, projectiles, slams). */
  readonly hitStatus?: { readonly id: string; readonly chance: number; readonly duration: number };
  /** Caster projectile (defaults to wisp fire). */
  readonly shot?: string;
  readonly projectiles?: BossProjectiles;
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
    spawn: { zones: ['surface'], time: 'any', weight: 10, biomes: ['meadow', 'village', 'forest'] },
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
    spawn: { zones: ['surface'], time: 'any', weight: 6, biomes: ['meadow', 'village', 'forest'] },
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
    spawn: {
      zones: ['surface', 'deep'],
      time: 'night',
      weight: 5,
      biomes: ['meadow', 'village', 'forest', 'mountains'],
    },
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

  // --- PHASE 7: biome monsters ----------------------------------------------------------------
  m({
    id: 'shore_crab',
    level: 8,
    hp: 180,
    attack: 22,
    defense: 12,
    exp: 34,
    width: 24,
    height: 14,
    ai: 'charger',
    speed: 46,
    jump: 0,
    contact: 1,
    knockbackResist: 0.3,
    aggroRange: 9,
    gold: [4, 9],
    drops: [
      { item: 'crab_shell', chance: 0.65, min: 1, max: 2 },
      { item: 'sand', chance: 0.4, min: 2, max: 5 },
    ],
    spawn: { zones: ['surface'], time: 'any', weight: 9, biomes: ['beach'] },
    params: {
      chargeSpeed: 230,
      windup: 0.5,
      chargeTime: 1,
      daze: 1,
      cooldown: 1.4,
      chargeContact: 1.5,
    },
  }),
  m({
    id: 'frost_slime',
    level: 14,
    hp: 360,
    attack: 34,
    defense: 14,
    exp: 70,
    width: 20,
    height: 14,
    ai: 'hopper',
    speed: 85,
    jump: 380,
    contact: 1,
    knockbackResist: 0.1,
    aggroRange: 10,
    immune: ['freeze', 'slow'],
    gold: [6, 12],
    drops: [
      { item: 'ice_gel', chance: 0.75, min: 1, max: 3 },
      { item: 'healing_potion', chance: 0.06, min: 1, max: 1 },
    ],
    spawn: { zones: ['surface', 'underground'], time: 'any', weight: 9, biomes: ['tundra'] },
    params: { hopMin: 0.6, hopMax: 1.4, chaseHop: 0.5 },
    hitStatus: { id: 'slow', chance: 0.3, duration: 2 },
  }),
  m({
    id: 'snow_wolf',
    level: 16,
    hp: 420,
    attack: 40,
    defense: 15,
    exp: 85,
    width: 30,
    height: 18,
    ai: 'charger',
    speed: 72,
    jump: 0,
    contact: 1,
    knockbackResist: 0.2,
    aggroRange: 13,
    immune: ['slow'],
    gold: [7, 14],
    drops: [{ item: 'frost_fang', chance: 0.6, min: 1, max: 2 }],
    spawn: { zones: ['surface'], time: 'any', weight: 6, biomes: ['tundra'] },
    params: {
      chargeSpeed: 320,
      windup: 0.45,
      chargeTime: 1.1,
      daze: 0.8,
      cooldown: 1.2,
      chargeContact: 1.5,
    },
  }),
  m({
    id: 'crag_harpy',
    level: 20,
    hp: 520,
    attack: 48,
    defense: 18,
    exp: 110,
    width: 22,
    height: 18,
    ai: 'flyer',
    speed: 135,
    jump: 0,
    contact: 1,
    knockbackResist: 0.15,
    aggroRange: 14,
    flying: true,
    gold: [9, 17],
    drops: [
      { item: 'harpy_feather', chance: 0.6, min: 1, max: 2 },
      { item: 'silver_ore', chance: 0.25, min: 1, max: 3 },
    ],
    spawn: { zones: ['surface'], time: 'any', weight: 8, biomes: ['mountains'] },
    params: { orbit: 64, swoopSpeed: 340, swoopEvery: 2, swoopTime: 0.6 },
  }),
  m({
    id: 'ice_wisp',
    level: 22,
    hp: 600,
    attack: 52,
    defense: 20,
    exp: 130,
    width: 16,
    height: 18,
    ai: 'caster',
    speed: 72,
    jump: 0,
    contact: 0.6,
    knockbackResist: 0.3,
    aggroRange: 16,
    flying: true,
    ghost: true,
    immune: ['freeze', 'slow'],
    light: [0.5, 0.85, 1.4],
    gold: [10, 18],
    drops: [
      { item: 'ice_gel', chance: 0.5, min: 1, max: 2 },
      { item: 'frostite_ore', chance: 0.2, min: 1, max: 2 },
      { item: 'mana_potion', chance: 0.08, min: 1, max: 1 },
    ],
    spawn: { zones: ['surface'], time: 'night', weight: 5, biomes: ['tundra', 'mountains'] },
    params: { keepMin: 100, keepMax: 160, castEvery: 2.4, windup: 0.55, blink: 70 },
    shot: 'ice_shard',
    hitStatus: { id: 'slow', chance: 0.6, duration: 2.5 },
  }),
  m({
    id: 'magma_slime',
    level: 26,
    hp: 760,
    attack: 60,
    defense: 24,
    exp: 160,
    width: 22,
    height: 15,
    ai: 'hopper',
    speed: 90,
    jump: 420,
    contact: 1,
    knockbackResist: 0.15,
    aggroRange: 11,
    immune: ['burn'],
    light: [1.3, 0.55, 0.2],
    gold: [12, 22],
    drops: [
      { item: 'magma_core', chance: 0.55, min: 1, max: 2 },
      { item: 'healing_potion', chance: 0.07, min: 1, max: 1 },
    ],
    spawn: { zones: ['surface', 'underground'], time: 'any', weight: 9, biomes: ['volcano'] },
    params: { hopMin: 0.5, hopMax: 1.2, chaseHop: 0.45 },
    hitStatus: { id: 'burn', chance: 0.3, duration: 3 },
  }),
  m({
    id: 'ash_crawler',
    level: 27,
    hp: 900,
    attack: 62,
    defense: 30,
    exp: 175,
    width: 30,
    height: 17,
    ai: 'charger',
    speed: 48,
    jump: 0,
    contact: 1,
    knockbackResist: 0.4,
    aggroRange: 11,
    immune: ['burn'],
    gold: [12, 24],
    drops: [
      { item: 'ash_carapace', chance: 0.6, min: 1, max: 2 },
      { item: 'magmite_ore', chance: 0.2, min: 1, max: 2 },
    ],
    spawn: { zones: ['surface'], time: 'any', weight: 6, biomes: ['volcano'] },
    params: {
      chargeSpeed: 260,
      windup: 0.55,
      chargeTime: 1.3,
      daze: 1,
      cooldown: 1.5,
      chargeContact: 1.7,
    },
  }),
  m({
    id: 'fire_imp',
    level: 28,
    hp: 720,
    attack: 66,
    defense: 22,
    exp: 185,
    width: 16,
    height: 20,
    ai: 'caster',
    speed: 80,
    jump: 0,
    contact: 0.6,
    knockbackResist: 0.3,
    aggroRange: 16,
    flying: true,
    immune: ['burn'],
    light: [1.4, 0.6, 0.25],
    gold: [14, 26],
    drops: [
      { item: 'imp_horn', chance: 0.55, min: 1, max: 2 },
      { item: 'mana_potion', chance: 0.08, min: 1, max: 1 },
    ],
    spawn: { zones: ['surface'], time: 'any', weight: 5, biomes: ['volcano'] },
    params: { keepMin: 90, keepMax: 150, castEvery: 2.6, windup: 0.6, blink: 80 },
    shot: 'imp_fireball',
    hitStatus: { id: 'burn', chance: 0.5, duration: 3 },
  }),
  m({
    id: 'crystal_bat',
    level: 34,
    hp: 1000,
    attack: 78,
    defense: 30,
    exp: 240,
    width: 20,
    height: 13,
    ai: 'flyer',
    speed: 140,
    jump: 0,
    contact: 1,
    knockbackResist: 0.2,
    aggroRange: 14,
    flying: true,
    light: [0.8, 0.5, 1.3],
    gold: [16, 30],
    drops: [
      { item: 'crystal_shard', chance: 0.35, min: 1, max: 2 },
      { item: 'bat_wing', chance: 0.6, min: 1, max: 3 },
    ],
    spawn: { zones: ['deep'], time: 'any', weight: 6, minDepth: 110 },
    params: { orbit: 58, swoopSpeed: 360, swoopEvery: 1.9, swoopTime: 0.55 },
  }),

  // --- PHASE 7: biome bosses (golem brain with their own projectiles) -----------------------
  m({
    id: 'frost_giant',
    level: 24,
    hp: 14000,
    attack: 58,
    defense: 32,
    exp: 3500,
    width: 54,
    height: 72,
    ai: 'golem',
    speed: 60,
    jump: 0,
    contact: 0.8,
    knockbackResist: 1,
    aggroRange: 42,
    boss: true,
    immune: ['stun', 'freeze', 'slow'],
    light: [0.55, 0.85, 1.3],
    gold: [400, 600],
    drops: [
      { item: 'frost_core', chance: 1, min: 3, max: 5 },
      { item: 'frostite_ore', chance: 1, min: 10, max: 16 },
      { item: 'healing_potion', chance: 1, min: 4, max: 6 },
    ],
    spawn: null,
    params: {
      enrageAt: 0.5,
      slamDamage: 1.6,
      waveDamage: 1,
      boulderDamage: 1.1,
      chargeSpeed: 290,
      chargeDamage: 1.4,
      quakeDamage: 1.2,
    },
    hitStatus: { id: 'slow', chance: 0.5, duration: 3 },
    projectiles: { boulder: 'ice_chunk', wave: 'frost_wave', rain: 'icicle' },
  }),
  m({
    id: 'magma_tyrant',
    level: 32,
    hp: 22000,
    attack: 74,
    defense: 40,
    exp: 6000,
    width: 56,
    height: 74,
    ai: 'golem',
    speed: 62,
    jump: 0,
    contact: 0.9,
    knockbackResist: 1,
    aggroRange: 44,
    boss: true,
    immune: ['stun', 'freeze', 'burn'],
    light: [1.5, 0.6, 0.25],
    gold: [700, 1000],
    drops: [
      { item: 'tyrant_scale', chance: 1, min: 3, max: 5 },
      { item: 'magmite_ore', chance: 1, min: 12, max: 18 },
      { item: 'crystal_shard', chance: 1, min: 2, max: 4 },
      { item: 'healing_potion', chance: 1, min: 4, max: 6 },
    ],
    spawn: null,
    params: {
      enrageAt: 0.55,
      slamDamage: 1.7,
      waveDamage: 1.1,
      boulderDamage: 1.2,
      chargeSpeed: 300,
      chargeDamage: 1.5,
      quakeDamage: 1.3,
    },
    hitStatus: { id: 'burn', chance: 0.5, duration: 4 },
    projectiles: { boulder: 'magma_ball', wave: 'lava_wave', rain: 'meteor' },
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
