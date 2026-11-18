/** Monster entity: a Combatant with a motor, a brain state and presentation hints. */
import type { Combatant } from '../combat/CombatWorld';
import { monsterCombatStats } from '../combat/stats';
import { StatusSet } from '../combat/status';
import type { MonsterDef } from '../data/monsters';
import { DEFAULT_MOVEMENT, type MovementConfig } from '../data/movement';
import { createMotorState, type MotorState } from '../physics/CharacterMotor';

/**
 * Presentation state of a monster (drives animation selection). Brains set it; renderers read it.
 * Generic states: idle, move, air, windup, attack, recover, hurt, dead. Brains may add their own.
 */
export type MonsterAnim = string;

export interface BrainState {
  mode: string;
  /** Countdown used by the current mode (s). */
  timer: number;
  /** Generic direction / angle memory. */
  dir: number;
  /** Anchor point for wandering flyers. */
  homeX: number;
  homeY: number;
  /** Mode-specific scratch values. */
  ax: number;
  ay: number;
  /** Boss phase (0 = normal, 1 = enraged). */
  phase: number;
  /** Pattern counter (boss). */
  count: number;
}

export interface Monster extends Combatant {
  readonly def: MonsterDef;
  readonly motor: MotorState;
  readonly movement: MovementConfig;
  prevX: number;
  prevY: number;
  readonly brain: BrainState;
  anim: MonsterAnim;
  animTime: number;
  /** Seconds since death (corpse fade), -1 while alive. */
  deadTime: number;
  /** Seconds spent far from every player (despawn). */
  farTime: number;
  /** Damage dealt by players (kill credit / exp share later). */
  readonly damageBy: Map<number, number>;
  /** Visual seed (variation). */
  readonly seed: number;
  /** Current contact damage multiplier (brains raise it while charging). */
  contact: number;
  /** Character that claimed this monster (first hit) — kill credit and loot priority. */
  ownerId: number | null;
  ownerUntil: number;
  /** Character the brain is currently after. */
  targetId: number | null;
}

/** How long a claim lasts without being refreshed by the owner's hits (s). */
export const CLAIM_TIME = 10;

/** Claim a monster for a character if it is free (or the claim expired). */
export function claimMonster(m: Monster, characterId: number, now: number): void {
  if (m.ownerId === null || m.ownerId === characterId || now > m.ownerUntil) {
    m.ownerId = characterId;
    m.ownerUntil = now + CLAIM_TIME;
  }
}

/** True if another character holds a live claim on this monster. */
export function claimedByOther(m: Monster, characterId: number, now: number): boolean {
  return m.ownerId !== null && m.ownerId !== characterId && now <= m.ownerUntil;
}

export function monsterMovement(def: MonsterDef): MovementConfig {
  return {
    ...DEFAULT_MOVEMENT,
    bodyWidth: def.width,
    bodyHeight: def.height,
    runSpeed: def.speed,
    groundAccel: 900,
    groundDecel: 650,
    turnAccel: 1400,
    airAccel: 500,
    airDecel: 120,
    jumpVelocity: def.jump,
    jumpCutMul: 1,
    apexGravityMul: 1,
    coyoteTime: 0,
    jumpBuffer: 0.05,
    stepHeight: def.width >= 40 ? 16 : 8,
  };
}

export function createMonster(
  id: number,
  def: MonsterDef,
  x: number,
  y: number,
  seed: number,
): Monster {
  const movement = monsterMovement(def);
  const motor = createMotorState(x, y, movement);
  const stats = monsterCombatStats(def);
  return {
    id,
    team: 'monster',
    kind: 'monster',
    body: motor,
    motor,
    movement,
    def,
    hp: def.hp,
    mp: 0,
    alive: true,
    level: def.level,
    stats,
    statuses: new StatusSet(),
    invulnUntil: 0,
    perfectUntil: 0,
    staggerUntil: 0,
    knockbackResist: def.knockbackResist,
    hurtIframes: 0,
    immune: new Set(def.immune ?? []),
    vulnerable: 1,
    lastHitAt: -10,
    facing: 1,
    prevX: x,
    prevY: y,
    brain: {
      mode: 'idle',
      timer: 0.5,
      dir: 1,
      homeX: x,
      homeY: y,
      ax: 0,
      ay: 0,
      phase: 0,
      count: 0,
    },
    anim: 'idle',
    animTime: 0,
    deadTime: -1,
    farTime: 0,
    damageBy: new Map(),
    seed,
    contact: def.contact,
    ownerId: null,
    ownerUntil: 0,
    targetId: null,
  };
}

export function setAnim(m: Monster, anim: MonsterAnim): void {
  if (m.anim !== anim) {
    m.anim = anim;
    m.animTime = 0;
  }
}
