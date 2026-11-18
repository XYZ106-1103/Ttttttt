/**
 * A playable character: a Combatant plus progression, inventory, equipment and skills.
 * The local player and every AI adventurer are Characters — they obey exactly the same rules,
 * and every mutation goes through validated shared code (PHASE 6 runs it on the server).
 */
import { ActorCombat } from '../combat/ActorCombat';
import type { Combatant } from '../combat/CombatWorld';
import {
  allocateStat,
  autoAllocate,
  checkAdvance,
  learnSkill,
  type LearnFail,
  passiveMods,
  sanitizeSkillBook,
} from '../combat/progression';
import { type CombatStats, computeCombatStats } from '../combat/stats';
import { StatusSet } from '../combat/status';
import { findJobDef, getJobDef } from '../data/classes';
import { STARTING_ITEMS, type WeaponStats } from '../data/items';
import type { MovementConfig } from '../data/movement';
import {
  type BaseStats,
  type CharacterProgress,
  createStartingProgress,
  grantExperience,
  MAX_LEVEL,
  STARTING_STATS,
  STAT_KEYS,
  type StatKey,
} from '../entities/stats';
import { createMotorState, type MotorState } from '../physics/CharacterMotor';
import { type EquipFail, Equipment, type EquipmentData } from '../sandbox/Equipment';
import type { HitProgress } from '../sandbox/interaction';
import { HOTBAR_SIZE, Inventory, type InventoryData } from '../sandbox/Inventory';
import { itemRegistry } from '../sandbox/ItemRegistry';

export const SKILL_BAR_SIZE = 4;
/** Invulnerability after taking a hit (s). */
export const HURT_IFRAMES = 0.75;

export type CharacterKind = 'player' | 'adventurer';

/** Persistent part of a character (saves, network snapshots). */
export interface CharacterSnapshot {
  readonly level?: number;
  readonly exp?: number;
  readonly jobId?: string;
  readonly stats?: BaseStats;
  readonly statPoints?: number;
  readonly skillPoints?: number;
  readonly skills?: Readonly<Record<string, number>>;
  readonly skillBar?: readonly (string | null)[];
  readonly equipment?: EquipmentData;
  readonly hp?: number;
  readonly mp?: number;
  readonly inventory?: InventoryData;
  readonly selectedSlot?: number;
}

function finite(n: unknown, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export class Character implements Combatant {
  readonly team = 'player' as const;
  readonly body: MotorState;
  readonly motor: MotorState;
  readonly statuses = new StatusSet();
  readonly immune: ReadonlySet<string> = new Set();
  readonly inventory = new Inventory();
  readonly equipment = new Equipment();
  readonly combat = new ActorCombat();

  name: string;
  jobId = 'novice';
  progress: CharacterProgress = createStartingProgress();
  skills: Record<string, number> = {};
  skillBar: (string | null)[] = new Array<string | null>(SKILL_BAR_SIZE).fill(null);
  selectedSlot = 0;
  hit: HitProgress | null = null;
  nextUseAt = 0;
  prevX: number;
  prevY: number;
  potionCooldownUntil = 0;
  respawnAt = 0;
  /** Bumps whenever progression/skills/job change (UI change detection). */
  version = 0;

  hp: number;
  mp: number;
  alive = true;
  level = 1;
  stats: CombatStats;
  invulnUntil = 0;
  perfectUntil = 0;
  staggerUntil = 0;
  knockbackResist = 0;
  hurtIframes = HURT_IFRAMES;
  vulnerable = 1;
  lastHitAt = -10;
  facing: 1 | -1 = 1;

  constructor(
    readonly id: number,
    readonly kind: CharacterKind,
    name: string,
    x: number,
    y: number,
    movement: MovementConfig,
  ) {
    this.name = name;
    this.motor = createMotorState(x, y, movement);
    this.body = this.motor;
    this.prevX = x;
    this.prevY = y;
    this.stats = this.computeStats(0);
    this.hp = this.stats.maxHp;
    this.mp = this.stats.maxMp;
  }

  /** Weapon in the selected hotbar slot, if any (regardless of level requirement). */
  heldWeapon(): WeaponStats | null {
    const st = this.inventory.get(this.selectedSlot);
    return (st && itemRegistry.get(st.itemId)?.weapon) ?? null;
  }

  /** Held weapon if the character meets its level requirement. */
  usableWeapon(): WeaponStats | null {
    const w = this.heldWeapon();
    return w && this.level >= w.reqLevel ? w : null;
  }

  computeStats(now: number): CombatStats {
    const mods: Record<string, number> = { ...passiveMods(this.skills, this.jobId) };
    for (const [k, v] of Object.entries(this.statuses.mods(now)))
      mods[k] = (mods[k] ?? 0) + (v ?? 0);
    return computeCombatStats({
      progress: this.progress,
      job: getJobDef(this.jobId),
      weapon: this.usableWeapon(),
      gear: this.equipment.bonuses(),
      mods,
    });
  }

  refreshStats(now: number): void {
    this.stats = this.computeStats(now);
    this.hp = Math.min(this.hp, this.stats.maxHp);
    this.mp = Math.min(this.mp, this.stats.maxMp);
  }

  skillLevel(id: string): number {
    return this.skills[id] ?? 0;
  }

  /** Grant experience; returns the number of levels gained. */
  gainExp(amount: number): number {
    const before = this.progress.level;
    this.progress = grantExperience(this.progress, amount);
    const gained = this.progress.level - before;
    this.level = this.progress.level;
    this.version++;
    return gained;
  }

  /** Lose a fraction of the current level's progress (death penalty). Never de-levels. */
  loseExp(amount: number): void {
    if (amount <= 0) return;
    this.progress = { ...this.progress, exp: Math.max(0, this.progress.exp - Math.round(amount)) };
    this.version++;
  }

  allocate(stat: StatKey, amount = 1): boolean {
    const r = allocateStat(this.progress, stat, amount);
    if (!r.ok) return false;
    this.progress = r.progress;
    this.version++;
    return true;
  }

  autoAllocate(): boolean {
    if (this.progress.statPoints <= 0) return false;
    this.progress = autoAllocate(this.progress, getJobDef(this.jobId));
    this.version++;
    return true;
  }

  learn(skillId: string): LearnFail | null {
    const r = learnSkill(this.skills, skillId, this.jobId, this.progress);
    if (!r.ok) return r.reason;
    this.skills = { ...r.book };
    this.progress = r.progress;
    this.version++;
    return null;
  }

  advance(jobId: string): boolean {
    if (checkAdvance(this.jobId, jobId, this.level) !== null) return false;
    this.jobId = jobId;
    this.version++;
    return true;
  }

  setSkillSlot(slot: number, skillId: string | null): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= SKILL_BAR_SIZE) return;
    if (skillId !== null && this.skillLevel(skillId) <= 0) return;
    // A skill lives in at most one slot.
    if (skillId) this.skillBar = this.skillBar.map((s) => (s === skillId ? null : s));
    this.skillBar[slot] = skillId;
    this.skillBar = [...this.skillBar];
    this.version++;
  }

  equipFromInventory(index: number): EquipFail | null {
    return this.equipment.equipFrom(this.inventory, index, this.level);
  }

  /** Hotbar slot holding a usable weapon of `type`, or -1. */
  findHotbarWeapon(type: string): number {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const st = this.inventory.get(i);
      const w = st ? itemRegistry.get(st.itemId)?.weapon : undefined;
      if (w && w.type === type && w.reqLevel <= this.level) return i;
    }
    return -1;
  }

  /** Select a hotbar slot (clears mining progress and bow charge). */
  select(i: number): void {
    if (Number.isInteger(i) && i >= 0 && i < HOTBAR_SIZE && i !== this.selectedSlot) {
      this.selectedSlot = i;
      this.hit = null;
      this.combat.chargeStart = Number.NaN;
    }
  }

  giveStartingItems(): void {
    for (const s of STARTING_ITEMS) this.inventory.add(s.item, s.count);
  }

  // --- Snapshots ----------------------------------------------------------------------------

  exportSnapshot(): Required<CharacterSnapshot> {
    return {
      level: this.progress.level,
      exp: this.progress.exp,
      jobId: this.jobId,
      stats: this.progress.stats,
      statPoints: this.progress.statPoints,
      skillPoints: this.progress.skillPoints,
      skills: this.skills,
      skillBar: this.skillBar,
      equipment: this.equipment.toJSON(),
      hp: Math.round(this.hp),
      mp: Math.round(this.mp),
      inventory: this.inventory.toJSON(),
      selectedSlot: this.selectedSlot,
    };
  }

  /**
   * Load a snapshot, sanitizing everything (saves are untrusted input).
   * `legacy` snapshots predate combat: missing starter items are handed out once.
   */
  importSnapshot(p: CharacterSnapshot, legacy = false): void {
    this.inventory.load(p.inventory);
    this.selectedSlot = Math.max(
      0,
      Math.min(HOTBAR_SIZE - 1, Math.floor(finite(p.selectedSlot, 0))),
    );
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(finite(p.level, 1))));
    const stats = { ...STARTING_STATS } as Record<StatKey, number>;
    for (const k of STAT_KEYS)
      stats[k] = Math.max(1, Math.min(9999, Math.floor(finite(p.stats?.[k], STARTING_STATS[k]))));
    this.progress = {
      level,
      exp: Math.max(0, Math.floor(finite(p.exp, 0))),
      stats: stats as BaseStats,
      statPoints: Math.max(0, Math.floor(finite(p.statPoints, 0))),
      skillPoints: Math.max(0, Math.floor(finite(p.skillPoints, 0))),
    };
    this.level = level;
    const job = typeof p.jobId === 'string' ? findJobDef(p.jobId) : undefined;
    this.jobId = job && level >= job.advanceLevel ? job.id : 'novice';
    this.skills = sanitizeSkillBook(p.skills, this.jobId);
    const bar = Array.isArray(p.skillBar) ? p.skillBar : [];
    this.skillBar = new Array<string | null>(SKILL_BAR_SIZE).fill(null).map((_, i) => {
      const id = bar[i];
      return typeof id === 'string' && (this.skills[id] ?? 0) > 0 ? id : null;
    });
    this.equipment.load(p.equipment);
    if (legacy) {
      for (const s of STARTING_ITEMS) {
        if (this.inventory.count(s.item) === 0) this.inventory.add(s.item, s.count);
      }
    }
    this.refreshStats(0);
    this.hp = Math.max(1, Math.min(this.stats.maxHp, finite(p.hp, this.stats.maxHp)));
    this.mp = Math.max(0, Math.min(this.stats.maxMp, finite(p.mp, this.stats.maxMp)));
    this.version++;
  }
}
