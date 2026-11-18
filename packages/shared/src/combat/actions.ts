/**
 * Data model for timed combat actions (basic attacks, skills, monster attacks share it).
 * An action is a timeline: events fire when the action's clock crosses their `at` time.
 * Times are in seconds at attack speed 1 and are scaled by the actor's attack speed.
 */

/** Hit shape, relative to the actor. Angles are radians. */
export type ShapeDef =
  /** Sector around the body center, oriented along the aim direction. */
  | { readonly type: 'arc'; readonly radius: number; readonly halfAngle: number }
  /** Axis-aligned box placed `forward` px in front of the body center (along facing). */
  | {
      readonly type: 'box';
      readonly w: number;
      readonly h: number;
      readonly forward: number;
      readonly up?: number;
    }
  /** Circle around the body center (optionally pushed forward along facing). */
  | { readonly type: 'circle'; readonly radius: number; readonly forward?: number };

export interface StatusApply {
  readonly id: string;
  /** 0..1 */
  readonly chance: number;
  readonly duration: number;
}

/** Everything needed to resolve one hit against one target. */
export interface HitSpec {
  /** Damage multiplier relative to the action's damage (1 = 100%). */
  readonly damage: number;
  /** Horizontal knockback speed (px/s) before the target's resistance. */
  readonly knockback: number;
  /** Upward launch speed (px/s). */
  readonly lift?: number;
  readonly status?: StatusApply;
  /** Presentation: freeze-frame length on impact (s). */
  readonly hitstop?: number;
  /** Extra crit chance for this hit (0..1). */
  readonly critBonus?: number;
  /** Seconds the target's AI is interrupted (monsters). */
  readonly stun?: number;
}

export interface HitEventDef extends HitSpec {
  readonly kind: 'hit';
  readonly at: number;
  /** Active window end; defaults to a single-tick window. */
  readonly until?: number;
  readonly shape: ShapeDef;
  /** Max targets hit by this window. */
  readonly maxTargets?: number;
  /** Re-hit the same target every `interval` seconds while the window is active. */
  readonly interval?: number;
  /** Bounce the attacker upward on hit (plunge/pogo attacks). */
  readonly bounce?: number;
}

export interface ProjectileEventDef extends HitSpec {
  readonly kind: 'projectile';
  readonly at: number;
  readonly projectile: string;
  readonly count?: number;
  /** Total fan angle for multiple projectiles (radians). */
  readonly spread?: number;
  /** Extra vertical offset of the spawn point (px, negative = up). */
  readonly offsetY?: number;
}

export interface DashEventDef {
  readonly kind: 'dash';
  readonly at: number;
  readonly duration: number;
  readonly speed: number;
  readonly dir: 'aim' | 'facing' | 'back' | 'down';
  /** Invulnerability frames from the dash start (s). */
  readonly iframes?: number;
  /** Hits dealt along the dash path. */
  readonly hit?: HitSpec & { readonly shape: ShapeDef; readonly maxTargets?: number };
  /** Ends when the actor lands (plunge). */
  readonly untilGround?: boolean;
  readonly bounce?: number;
}

export interface TeleportEventDef {
  readonly kind: 'teleport';
  readonly at: number;
  /** Max distance toward the aim point (px). */
  readonly distance: number;
  readonly iframes?: number;
}

export interface BuffEventDef {
  readonly kind: 'buff';
  readonly at: number;
  readonly status: string;
}

export interface ZoneEventDef extends HitSpec {
  readonly kind: 'zone';
  readonly at: number;
  readonly where: 'aim' | 'self';
  /** Max distance of an aimed zone from the actor (px). */
  readonly range?: number;
  readonly radius: number;
  readonly duration: number;
  readonly interval: number;
  /** Presentation id (arrow rain, frost ring...). */
  readonly visual: string;
  readonly delay?: number;
}

export type ActionEventDef =
  HitEventDef | ProjectileEventDef | DashEventDef | TeleportEventDef | BuffEventDef | ZoneEventDef;

/** Presentation hint for the character view (arm motion + effect). */
export type ActionAnim =
  'swing' | 'swing_up' | 'thrust' | 'cast' | 'shoot' | 'spin' | 'slam' | 'raise' | 'dash';

export interface ActionDef {
  readonly id: string;
  readonly duration: number;
  /** Horizontal control multiplier while the action runs (0 = rooted). */
  readonly moveMul: number;
  readonly anim: ActionAnim;
  /** After this time the action may be cancelled by a dodge or the next combo hit. */
  readonly cancelAt?: number;
  /** Gravity multiplier while the action runs in the air (air attacks hang briefly). */
  readonly airGravity?: number;
  readonly events: readonly ActionEventDef[];
}
