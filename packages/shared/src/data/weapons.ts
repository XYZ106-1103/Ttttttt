/**
 * Weapon-type combat profiles: the basic attack moveset of every weapon type.
 * Individual weapons (items.ts) only provide numbers (attack, speed); the moves live here.
 */
import type { ActionDef } from '../combat/actions';
import type { StatKey } from '../entities/stats';
import type { WeaponType } from './items';

export type PowerType = 'attack' | 'magic';

export interface WeaponProfile {
  readonly type: WeaponType;
  /** Ground combo, cycled while the attack button is pressed in rhythm. */
  readonly combo: readonly ActionDef[];
  /** Seconds after an attack ends during which the next press continues the combo. */
  readonly comboWindow: number;
  readonly air: ActionDef;
  /** Downward strike when attacking in the air while aiming down. */
  readonly plunge?: ActionDef;
  /** Hold-and-release attack (bows). */
  readonly charged?: { readonly minHold: number; readonly action: ActionDef };
  readonly power: PowerType;
  /** Stats that scale this weapon type's damage (primary ×4 + secondary). */
  readonly primary: StatKey;
  readonly secondary: StatKey;
}

const plunge = (damage: number): ActionDef => ({
  id: 'plunge',
  duration: 1.2,
  moveMul: 0.2,
  anim: 'dash',
  events: [
    {
      kind: 'dash',
      at: 0.04,
      duration: 1.1,
      speed: 560,
      dir: 'down',
      untilGround: true,
      bounce: 380,
      hit: {
        shape: { type: 'box', w: 26, h: 22, forward: 0, up: -18 },
        damage,
        knockback: 90,
        lift: 40,
        hitstop: 0.06,
        stun: 0.35,
        maxTargets: 1,
      },
    },
  ],
});

export const WEAPON_PROFILES: Readonly<Record<WeaponType, WeaponProfile>> = {
  sword: {
    type: 'sword',
    power: 'attack',
    primary: 'str',
    secondary: 'dex',
    comboWindow: 0.38,
    combo: [
      {
        id: 'sword_1',
        duration: 0.36,
        moveMul: 0.45,
        anim: 'swing',
        cancelAt: 0.22,
        events: [
          {
            kind: 'hit',
            at: 0.07,
            until: 0.15,
            shape: { type: 'arc', radius: 36, halfAngle: 1.15 },
            damage: 1,
            knockback: 150,
            lift: 70,
            hitstop: 0.05,
            stun: 0.28,
            maxTargets: 4,
          },
        ],
      },
      {
        id: 'sword_2',
        duration: 0.36,
        moveMul: 0.45,
        anim: 'swing_up',
        cancelAt: 0.22,
        events: [
          {
            kind: 'hit',
            at: 0.07,
            until: 0.15,
            shape: { type: 'arc', radius: 36, halfAngle: 1.15 },
            damage: 1.1,
            knockback: 160,
            lift: 110,
            hitstop: 0.05,
            stun: 0.28,
            maxTargets: 4,
          },
        ],
      },
      {
        id: 'sword_3',
        duration: 0.5,
        moveMul: 0.25,
        anim: 'slam',
        cancelAt: 0.34,
        events: [
          {
            kind: 'hit',
            at: 0.15,
            until: 0.25,
            shape: { type: 'arc', radius: 40, halfAngle: 1.35 },
            damage: 1.55,
            knockback: 280,
            lift: 150,
            hitstop: 0.09,
            stun: 0.45,
            critBonus: 0.1,
            maxTargets: 5,
          },
        ],
      },
    ],
    air: {
      id: 'sword_air',
      duration: 0.34,
      moveMul: 0.9,
      anim: 'spin',
      airGravity: 0.35,
      cancelAt: 0.24,
      events: [
        {
          kind: 'hit',
          at: 0.05,
          until: 0.2,
          shape: { type: 'circle', radius: 32 },
          damage: 0.95,
          knockback: 130,
          lift: 60,
          hitstop: 0.04,
          stun: 0.25,
          maxTargets: 4,
        },
      ],
    },
    plunge: plunge(1.45),
  },
  dagger: {
    type: 'dagger',
    power: 'attack',
    primary: 'luk',
    secondary: 'dex',
    comboWindow: 0.3,
    combo: [
      {
        id: 'dagger_1',
        duration: 0.22,
        moveMul: 0.7,
        anim: 'thrust',
        cancelAt: 0.13,
        events: [
          {
            kind: 'hit',
            at: 0.04,
            until: 0.1,
            shape: { type: 'arc', radius: 30, halfAngle: 0.55 },
            damage: 0.8,
            knockback: 70,
            hitstop: 0.03,
            stun: 0.18,
            critBonus: 0.1,
            maxTargets: 2,
          },
        ],
      },
      {
        id: 'dagger_2',
        duration: 0.26,
        moveMul: 0.7,
        anim: 'thrust',
        cancelAt: 0.15,
        events: [
          {
            kind: 'hit',
            at: 0.05,
            until: 0.11,
            shape: { type: 'arc', radius: 32, halfAngle: 0.6 },
            damage: 0.95,
            knockback: 120,
            lift: 40,
            hitstop: 0.04,
            stun: 0.22,
            critBonus: 0.1,
            maxTargets: 2,
          },
        ],
      },
    ],
    air: {
      id: 'dagger_air',
      duration: 0.24,
      moveMul: 0.95,
      anim: 'thrust',
      airGravity: 0.5,
      cancelAt: 0.14,
      events: [
        {
          kind: 'hit',
          at: 0.04,
          until: 0.11,
          shape: { type: 'arc', radius: 30, halfAngle: 0.6 },
          damage: 0.85,
          knockback: 80,
          hitstop: 0.03,
          stun: 0.18,
          critBonus: 0.1,
          maxTargets: 2,
        },
      ],
    },
    plunge: plunge(1.2),
  },
  bow: {
    type: 'bow',
    power: 'attack',
    primary: 'dex',
    secondary: 'str',
    comboWindow: 0,
    combo: [
      {
        id: 'bow_shot',
        duration: 0.42,
        moveMul: 0.65,
        anim: 'shoot',
        cancelAt: 0.24,
        events: [
          {
            kind: 'projectile',
            at: 0.1,
            projectile: 'arrow',
            damage: 1,
            knockback: 90,
            hitstop: 0.02,
            stun: 0.2,
          },
        ],
      },
    ],
    air: {
      id: 'bow_air',
      duration: 0.4,
      moveMul: 0.9,
      anim: 'shoot',
      airGravity: 0.4,
      cancelAt: 0.22,
      events: [
        {
          kind: 'projectile',
          at: 0.1,
          projectile: 'arrow',
          damage: 1,
          knockback: 90,
          hitstop: 0.02,
          stun: 0.2,
        },
      ],
    },
    charged: {
      minHold: 0.55,
      action: {
        id: 'bow_charged',
        duration: 0.4,
        moveMul: 0.5,
        anim: 'shoot',
        cancelAt: 0.2,
        events: [
          {
            kind: 'projectile',
            at: 0.04,
            projectile: 'arrow_charged',
            damage: 2.3,
            knockback: 240,
            lift: 60,
            hitstop: 0.06,
            stun: 0.4,
            critBonus: 0.15,
          },
        ],
      },
    },
  },
  staff: {
    type: 'staff',
    power: 'magic',
    primary: 'int',
    secondary: 'luk',
    comboWindow: 0,
    combo: [
      {
        id: 'staff_bolt',
        duration: 0.52,
        moveMul: 0.5,
        anim: 'cast',
        cancelAt: 0.32,
        events: [
          {
            kind: 'projectile',
            at: 0.16,
            projectile: 'magic_bolt',
            damage: 1,
            knockback: 90,
            hitstop: 0.03,
            stun: 0.22,
          },
        ],
      },
    ],
    air: {
      id: 'staff_air',
      duration: 0.5,
      moveMul: 0.9,
      anim: 'cast',
      airGravity: 0.45,
      cancelAt: 0.3,
      events: [
        {
          kind: 'projectile',
          at: 0.16,
          projectile: 'magic_bolt',
          damage: 1,
          knockback: 90,
          hitstop: 0.03,
          stun: 0.22,
        },
      ],
    },
  },
};

/** Bare-hand attack used when no weapon is held. */
export const UNARMED_ACTION: ActionDef = {
  id: 'punch',
  duration: 0.3,
  moveMul: 0.6,
  anim: 'thrust',
  cancelAt: 0.18,
  events: [
    {
      kind: 'hit',
      at: 0.06,
      until: 0.12,
      shape: { type: 'arc', radius: 22, halfAngle: 0.7 },
      damage: 1,
      knockback: 90,
      hitstop: 0.03,
      stun: 0.2,
      maxTargets: 1,
    },
  ],
};

/** Attack value of bare hands. */
export const UNARMED_ATTACK = 4;
