/**
 * One simulation tick for a Character driven by an intent. The local player's input and an AI
 * adventurer's brain both produce a CharacterIntent; this function applies it with the shared
 * movement, combat and sandbox rules — so AI can never do anything a player cannot.
 */
import type { ActorEvent, CastFail } from '../combat/ActorCombat';
import type { CombatWorld } from '../combat/CombatWorld';
import type { MovementConfig } from '../data/movement';
import { getSkillDef } from '../data/skills';
import { type MotorInput, stepMotor } from '../physics/CharacterMotor';
import {
  applyItemUse,
  type InteractionContext,
  type UseFailReason,
  type UseOutcome,
} from '../sandbox/interaction';
import { itemRegistry } from '../sandbox/ItemRegistry';
import type { World } from '../world/World';
import type { Character } from './Character';

/** Combat input for one tick (mouse + keyboard, or an AI brain). */
export interface ActionIntent {
  readonly attackPressed: boolean;
  readonly attackHeld: boolean;
  readonly aimX: number;
  readonly aimY: number;
  /** Skill bar slot pressed this tick (0..3). */
  readonly skillSlot: number | null;
  readonly dodge: boolean;
  readonly quickHeal: boolean;
  readonly quickMana: boolean;
}

export const IDLE_ACTION: ActionIntent = {
  attackPressed: false,
  attackHeld: false,
  aimX: 0,
  aimY: 0,
  skillSlot: null,
  dodge: false,
  quickHeal: false,
  quickMana: false,
};

export interface UseIntent {
  readonly tx: number;
  readonly ty: number;
}

export interface CharacterIntent {
  readonly move: MotorInput;
  readonly use: UseIntent | null;
  readonly action: ActionIntent;
}

export interface CharacterEnv {
  readonly world: World;
  readonly combat: CombatWorld;
  readonly movement: MovementConfig;
  readonly interaction: InteractionContext;
  readonly now: number;
  readonly dt: number;
}

export type HeldMode = 'weapon' | 'consumable' | 'sandbox';

export interface CharacterStepOut {
  uses: UseOutcome[];
  failed: UseFailReason | null;
  actor: ActorEvent[];
  castFails: { skill: string; reason: CastFail }[];
  /** Attack pressed with a weapon above the character's level. */
  weaponLevel: number | null;
  /** Inventory slot whose consumable should be used (caller applies summons etc.). */
  consume: number | null;
  quick: 'heal' | 'mana' | null;
}

export function newStepOut(): CharacterStepOut {
  return {
    uses: [],
    failed: null,
    actor: [],
    castFails: [],
    weaponLevel: null,
    consume: null,
    quick: null,
  };
}

export function heldMode(c: Character): HeldMode {
  const st = c.inventory.get(c.selectedSlot);
  const def = st ? itemRegistry.get(st.itemId) : undefined;
  if (def?.weapon) return 'weapon';
  if (def?.consumable) return 'consumable';
  return 'sandbox';
}

export function stepCharacter(
  env: CharacterEnv,
  c: Character,
  intent: CharacterIntent,
  out: CharacterStepOut,
): void {
  const { now, dt, world } = env;
  const action = intent.action;
  const input = intent.move;
  c.prevX = c.motor.x;
  c.prevY = c.motor.y;
  if (!c.alive) return;

  // Skill keys auto-swap to a matching weapon from the hotbar.
  let skill: string | null = null;
  if (action.skillSlot !== null) {
    skill = c.skillBar[action.skillSlot] ?? null;
    const def = skill ? getSkillDef(skill) : undefined;
    if (def?.weapon && c.usableWeapon()?.type !== def.weapon) {
      const slot = c.findHotbarWeapon(def.weapon);
      if (slot >= 0) {
        c.select(slot);
        c.refreshStats(now);
      }
    }
  }
  if (action.quickHeal) out.quick = 'heal';
  else if (action.quickMana) out.quick = 'mana';

  const mode = heldMode(c);
  const weapon = c.usableWeapon();
  if (mode === 'weapon' && !weapon && action.attackPressed)
    out.weaponLevel = c.heldWeapon()?.reqLevel ?? 1;
  if (mode === 'consumable' && action.attackPressed) out.consume = c.selectedSlot;

  const override = c.combat.update(
    {
      self: c,
      combat: env.combat,
      grid: world,
      weapon,
      canAttack: mode === 'weapon' && weapon !== null,
      skillLevel: (id) => c.skillLevel(id),
      now,
      dt,
    },
    {
      attackPressed: action.attackPressed,
      attackHeld: action.attackHeld,
      aimX: action.aimX,
      aimY: action.aimY,
      skill,
      dodge: action.dodge,
      moveX: input.moveX,
    },
  );
  for (const e of c.combat.events) {
    out.actor.push(e);
    if (e.type === 'castFail') out.castFails.push({ skill: e.skill, reason: e.reason });
  }
  c.combat.events.length = 0;

  const staggered = now < c.staggerUntil;
  const m = c.motor;
  if (override.vx !== null) m.vx = override.vx;
  if (override.vy !== null) m.vy = override.vy;
  const dashing = override.vx !== null;
  const moveX = dashing
    ? Math.sign(override.vx ?? 0)
    : staggered
      ? 0
      : input.moveX * override.moveMul;
  stepMotor(
    m,
    {
      moveX,
      jumpHeld: input.jumpHeld && !override.noJump,
      jumpPressed: input.jumpPressed && !override.noJump && !staggered,
      down: input.down,
      speedMul: dashing ? Math.abs(override.vx ?? 0) / env.movement.runSpeed : c.stats.moveSpeed,
      jumpMul: c.stats.jump,
      gravityMul: override.gravityMul,
    },
    world,
    env.movement,
    dt,
  );
  if (override.facing) m.facing = override.facing;
  c.facing = m.facing;

  if (intent.use && mode === 'sandbox') {
    const actor = {
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      inventory: c.inventory,
      progress: c.hit,
      nextUseAt: c.nextUseAt,
    };
    const res = applyItemUse(
      env.interaction,
      actor,
      c.selectedSlot,
      intent.use.tx,
      intent.use.ty,
      now,
    );
    c.hit = actor.progress;
    c.nextUseAt = actor.nextUseAt;
    if (res.ok) out.uses.push(res);
    else if (
      res.reason &&
      res.reason !== 'cooldown' &&
      res.reason !== 'nothing' &&
      res.reason !== 'out_of_reach'
    )
      out.failed = res.reason;
  }
  if (m.y > world.heightPixels + 64) env.combat.kill(c, -1);
}

/** Seconds without taking damage before out-of-combat regeneration kicks in. */
export const OUT_OF_COMBAT = 5;

export function regenCharacter(c: Character, now: number, dt: number): void {
  if (!c.alive) return;
  const calm = now - c.lastHitAt > OUT_OF_COMBAT;
  c.hp = Math.min(c.stats.maxHp, c.hp + c.stats.hpRegen * (calm ? 4 : 0.5) * dt);
  c.mp = Math.min(c.stats.maxMp, c.mp + c.stats.mpRegen * (calm ? 2 : 1) * dt);
}

export type DrinkResult = 'ok' | 'cooldown' | 'none';

/** Drink a healing/mana consumable from an inventory slot (shared potion cooldown). */
export function drinkPotion(
  c: Character,
  index: number,
  combat: CombatWorld,
  now: number,
): DrinkResult {
  const st = c.inventory.get(index);
  const cons = st ? itemRegistry.get(st.itemId)?.consumable : undefined;
  if (!st || !cons || !(cons.heal || cons.mana) || !c.alive) return 'none';
  if (now < c.potionCooldownUntil) return 'cooldown';
  if (cons.heal) combat.heal(c, cons.heal);
  if (cons.mana) combat.heal(c, cons.mana, true);
  c.potionCooldownUntil = now + cons.cooldown;
  c.inventory.removeAt(index, 1);
  return 'ok';
}

/** Slot of the strongest potion of a kind anywhere in the inventory, or -1. */
export function bestPotion(c: Character, kind: 'heal' | 'mana'): number {
  let best = -1;
  let bestValue = 0;
  for (let i = 0; i < c.inventory.size; i++) {
    const st = c.inventory.get(i);
    const cons = st ? itemRegistry.get(st.itemId)?.consumable : undefined;
    const v = kind === 'heal' ? (cons?.heal ?? 0) : (cons?.mana ?? 0);
    if (v > bestValue) {
      best = i;
      bestValue = v;
    }
  }
  return best;
}
