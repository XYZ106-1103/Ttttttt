/**
 * Combat controller for one character: basic attack combos, air/plunge attacks, bow charging,
 * skills, dodging and dashes. It turns a per-tick CombatIntent into hit windows / projectiles in
 * the CombatWorld plus movement overrides for the motor. Players use it now; AI adventurers
 * (PHASE 4) feed it intents from their brains, so both fight by exactly the same rules.
 */
import { TILE_SIZE } from '../constants';
import type { WeaponStats } from '../data/items';
import { getSkillDef, scaled, type SkillDef } from '../data/skills';
import {
  type PowerType,
  UNARMED_ACTION,
  WEAPON_PROFILES,
  type WeaponProfile,
} from '../data/weapons';
import { isRegionSolid, type CollisionGrid } from '../physics/TileCollider';
import { COLLISION_NONE } from '../world/TileRegistry';
import type { ActionDef, ActionEventDef, ShapeDef } from './actions';
import type { AttackPower, CombatWorld, Combatant, HitWindow } from './CombatWorld';

export interface CombatIntent {
  /** Attack button went down this tick. */
  readonly attackPressed: boolean;
  readonly attackHeld: boolean;
  /** Aim point (world px). */
  readonly aimX: number;
  readonly aimY: number;
  /** Skill requested this tick. */
  readonly skill: string | null;
  readonly dodge: boolean;
  /** Horizontal input (-1..1), used for the dodge direction. */
  readonly moveX: number;
}

export const IDLE_COMBAT_INTENT: CombatIntent = {
  attackPressed: false,
  attackHeld: false,
  aimX: 0,
  aimY: 0,
  skill: null,
  dodge: false,
  moveX: 0,
};

export type CastFail =
  | 'not_learned'
  | 'cooldown'
  | 'no_mp'
  | 'wrong_weapon'
  | 'busy'
  | 'stunned'
  | 'passive'
  | 'unknown';

export interface ActorContext {
  readonly self: Combatant;
  readonly combat: CombatWorld;
  readonly grid: CollisionGrid;
  /** Held weapon usable by this character (null = unarmed or holding a non-weapon). */
  readonly weapon: WeaponStats | null;
  /** True when the attack button attacks (weapon or empty hand), false for tools/blocks. */
  readonly canAttack: boolean;
  readonly skillLevel: (id: string) => number;
  readonly now: number;
  readonly dt: number;
}

/** Movement adjustments for this tick, applied by the caller to the motor input. */
export interface MotorOverride {
  moveMul: number;
  gravityMul: number;
  /** Forced velocity (dashes). */
  vx: number | null;
  vy: number | null;
  /** Facing locked by the running action. */
  facing: 1 | -1 | null;
  /** Jumping is disabled (rooted actions, dashes). */
  noJump: boolean;
}

export type ActorEvent =
  | {
      readonly type: 'action';
      readonly action: ActionDef;
      readonly aim: number;
      readonly facing: 1 | -1;
      readonly skill: string | null;
      readonly speed: number;
    }
  | { readonly type: 'dodge'; readonly dir: number }
  | { readonly type: 'castFail'; readonly skill: string; readonly reason: CastFail }
  | { readonly type: 'charge'; readonly ready: boolean }
  | {
      readonly type: 'teleport';
      readonly fromX: number;
      readonly fromY: number;
      readonly toX: number;
      readonly toY: number;
    };

interface RunningAction {
  readonly def: ActionDef;
  t: number;
  readonly speed: number;
  next: number;
  readonly aim: number;
  readonly facing: 1 | -1;
  readonly attack: AttackPower;
  readonly skill: SkillDef | null;
  readonly skillLevel: number;
  readonly kind: 'basic' | 'skill';
}

interface DashState {
  vx: number;
  vy: number;
  until: number;
  readonly untilGround: boolean;
  window: HitWindow | null;
}

export const DODGE_TIME = 0.26;
export const DODGE_SPEED = 430;
export const DODGE_IFRAMES = 0.3;
export const DODGE_COOLDOWN = 0.55;
export const PERFECT_WINDOW = 0.18;
const ATTACK_BUFFER = 0.25;
const SKILL_BUFFER = 0.2;
const DODGE_BUFFER = 0.15;

export class ActorCombat {
  action: RunningAction | null = null;
  dash: DashState | null = null;
  comboIndex = -1;
  comboUntil = -1;
  dodgeUntil = -1;
  dodgeDir = 1;
  dodgeCooldownUntil = 0;
  airDodgeUsed = false;
  /** Time the bow started charging (NaN = not charging). */
  chargeStart = Number.NaN;
  private chargeReadySent = false;
  private attackBufferedAt = -10;
  private dodgeBufferedAt = -10;
  private bufferedSkill: { id: string; at: number } | null = null;
  readonly cooldowns = new Map<string, number>();
  readonly events: ActorEvent[] = [];

  get busy(): boolean {
    return this.action !== null || this.dash !== null;
  }

  get dodging(): boolean {
    return this.dodgeUntil > 0;
  }

  cooldownLeft(skillId: string, now: number): number {
    return Math.max(0, (this.cooldowns.get(skillId) ?? 0) - now);
  }

  /** Cancel everything (death, respawn, teleport). */
  reset(combat?: CombatWorld): void {
    if (this.dash?.window && combat) combat.closeWindow(this.dash.window);
    this.action = null;
    this.dash = null;
    this.dodgeUntil = -1;
    this.chargeStart = Number.NaN;
    this.attackBufferedAt = -10;
    this.dodgeBufferedAt = -10;
    this.bufferedSkill = null;
  }

  private canCancel(): boolean {
    const a = this.action;
    if (!a) return this.dash === null;
    if (this.dash) return false;
    return a.def.cancelAt !== undefined && a.t >= a.def.cancelAt;
  }

  private power(self: Combatant, type: PowerType): number {
    return type === 'magic' ? self.stats.magic : self.stats.attack;
  }

  /** Validate a skill cast without side effects. */
  checkCast(ctx: ActorContext, skillId: string): CastFail | null {
    const def = getSkillDef(skillId);
    if (!def) return 'unknown';
    if (def.type === 'passive') return 'passive';
    const level = ctx.skillLevel(skillId);
    if (level <= 0) return 'not_learned';
    if (!ctx.self.alive || ctx.self.statuses.stunned(ctx.now)) return 'stunned';
    if (this.cooldownLeft(skillId, ctx.now) > 0) return 'cooldown';
    if (def.weapon && ctx.weapon?.type !== def.weapon) return 'wrong_weapon';
    if (ctx.self.mp + 1e-6 < Math.max(0, Math.round(scaled(def.mp, level)))) return 'no_mp';
    if (!this.canCancel()) return 'busy';
    return null;
  }

  update(ctx: ActorContext, intent: CombatIntent): MotorOverride {
    const { self, now, dt } = ctx;
    const body = self.body;
    const out: MotorOverride = {
      moveMul: 1,
      gravityMul: 1,
      vx: null,
      vy: null,
      facing: null,
      noJump: false,
    };
    if (!self.alive) {
      this.reset(ctx.combat);
      out.moveMul = 0;
      out.noJump = true;
      return out;
    }
    if (body.grounded) this.airDodgeUsed = false;
    const stunned = self.statuses.stunned(now);
    const staggered = now < self.staggerUntil;

    // Being hit interrupts whatever we were doing.
    if ((stunned || staggered) && (this.action || this.dash)) this.interrupt(ctx);
    if (stunned) {
      out.moveMul = 0;
      out.noJump = true;
      this.chargeStart = Number.NaN;
      return out;
    }

    // --- Dodge (buffered briefly so a press during an attack's commit frames still counts) ---
    if (this.dodgeUntil > 0 && now >= this.dodgeUntil) this.dodgeUntil = -1;
    if (intent.dodge) this.dodgeBufferedAt = now;
    if (
      now - this.dodgeBufferedAt <= DODGE_BUFFER &&
      this.dodgeUntil < 0 &&
      now >= this.dodgeCooldownUntil &&
      (body.grounded || !this.airDodgeUsed) &&
      !staggered &&
      this.canCancel()
    ) {
      this.dodgeBufferedAt = -10;
      this.interrupt(ctx);
      this.dodgeDir = intent.moveX !== 0 ? Math.sign(intent.moveX) : self.facing;
      this.dodgeUntil = now + DODGE_TIME;
      this.dodgeCooldownUntil = now + DODGE_COOLDOWN;
      self.invulnUntil = Math.max(self.invulnUntil, now + DODGE_IFRAMES);
      self.perfectUntil = now + PERFECT_WINDOW;
      if (!body.grounded) this.airDodgeUsed = true;
      this.chargeStart = Number.NaN;
      this.events.push({ type: 'dodge', dir: this.dodgeDir });
    }
    if (this.dodgeUntil > 0) {
      out.vx = this.dodgeDir * DODGE_SPEED * self.stats.moveSpeed;
      out.vy = 0;
      out.gravityMul = 0;
      out.facing = this.dodgeDir > 0 ? 1 : -1;
      out.noJump = true;
      return out;
    }

    // --- Input buffering --------------------------------------------------------------------
    if (intent.attackPressed) this.attackBufferedAt = now;
    if (intent.skill) this.bufferedSkill = { id: intent.skill, at: now };
    const profile = ctx.weapon ? WEAPON_PROFILES[ctx.weapon.type] : null;
    const aim = Math.atan2(intent.aimY - (body.y - body.height / 2), intent.aimX - body.x);
    const aimFacing: 1 | -1 = intent.aimX >= body.x ? 1 : -1;

    // --- Skills -----------------------------------------------------------------------------
    if (this.bufferedSkill) {
      const req = this.bufferedSkill;
      const fail = this.checkCast(ctx, req.id);
      if (fail === null) {
        this.bufferedSkill = null;
        this.castSkill(ctx, req.id, aim, aimFacing);
      } else if (fail !== 'busy' || now - req.at > SKILL_BUFFER) {
        this.bufferedSkill = null;
        this.events.push({ type: 'castFail', skill: req.id, reason: fail });
      }
    }

    // --- Basic attacks ----------------------------------------------------------------------
    if (ctx.canAttack && !staggered) {
      if (profile?.charged) this.updateCharge(ctx, intent, profile, aim, aimFacing);
      else {
        const wants = now - this.attackBufferedAt <= ATTACK_BUFFER || intent.attackHeld;
        const free = !this.action || (this.action.kind === 'basic' && this.canCancel());
        if (wants && free && !this.dash) {
          this.attackBufferedAt = -10;
          this.startBasic(ctx, profile, aim, aimFacing);
        }
      }
    } else {
      this.chargeStart = Number.NaN;
    }

    // --- Running action ---------------------------------------------------------------------
    const a = this.action;
    if (a) {
      a.t += dt * a.speed;
      const events = a.def.events;
      while (a.next < events.length && (events[a.next] as ActionEventDef).at <= a.t + 1e-9) {
        this.fire(ctx, a, events[a.next] as ActionEventDef);
        a.next++;
      }
      out.moveMul = a.def.moveMul;
      out.facing = a.facing;
      if (a.def.moveMul < 0.3) out.noJump = true;
      if (!body.grounded && a.def.airGravity !== undefined && body.vy > -60)
        out.gravityMul = a.def.airGravity;
      if (a.t >= a.def.duration && !this.dash) {
        if (a.kind === 'basic') this.comboUntil = now + (profile?.comboWindow ?? 0);
        this.action = null;
      }
    }

    // --- Dash -------------------------------------------------------------------------------
    const d = this.dash;
    if (d) {
      const landed = d.window?.landed && d.untilGround;
      if (now >= d.until || (d.untilGround && body.grounded) || landed) {
        this.endDash(ctx);
        if (this.action && (d.untilGround || this.action.t >= this.action.def.duration))
          this.action = null;
      } else {
        out.vx = d.vx;
        out.vy = d.vy;
        out.gravityMul = 0;
        out.noJump = true;
        if (d.window) {
          d.window.facing = d.vx >= 0 ? 1 : -1;
        }
      }
    }
    return out;
  }

  private interrupt(ctx: ActorContext): void {
    this.endDash(ctx);
    this.action = null;
    this.comboIndex = -1;
  }

  private endDash(ctx: ActorContext): void {
    if (!this.dash) return;
    if (this.dash.window) ctx.combat.closeWindow(this.dash.window);
    this.dash = null;
  }

  private updateCharge(
    ctx: ActorContext,
    intent: CombatIntent,
    profile: WeaponProfile,
    aim: number,
    facing: 1 | -1,
  ): void {
    const charged = profile.charged;
    if (!charged) return;
    const now = ctx.now;
    const free = !this.action || (this.action.kind === 'basic' && this.canCancel());
    if (Number.isNaN(this.chargeStart)) {
      if (intent.attackHeld && free && !this.dash) {
        this.chargeStart = now;
        this.chargeReadySent = false;
      }
      return;
    }
    const held = now - this.chargeStart;
    if (intent.attackHeld) {
      if (!this.chargeReadySent && held >= charged.minHold) {
        this.chargeReadySent = true;
        this.events.push({ type: 'charge', ready: true });
      }
      return;
    }
    // Released: fire a quick or a charged shot.
    this.chargeStart = Number.NaN;
    this.attackBufferedAt = -10;
    if (!free || this.dash) return;
    const def =
      held >= charged.minHold
        ? charged.action
        : ctx.self.body.grounded
          ? profile.combo[0]
          : profile.air;
    if (def) this.start(ctx, def, aim, facing, 'basic', null, 0, profile.power, 1);
  }

  private startBasic(
    ctx: ActorContext,
    profile: WeaponProfile | null,
    aim: number,
    facing: 1 | -1,
  ): void {
    const body = ctx.self.body;
    if (!profile) {
      this.start(ctx, UNARMED_ACTION, aim, facing, 'basic', null, 0, 'attack', 1);
      return;
    }
    let def: ActionDef | undefined;
    if (!body.grounded) {
      const down = Math.abs(aim - Math.PI / 2) < 0.75;
      def = down && profile.plunge ? profile.plunge : profile.air;
      this.comboIndex = -1;
    } else {
      this.comboIndex =
        ctx.now <= this.comboUntil || this.action
          ? (this.comboIndex + 1) % profile.combo.length
          : 0;
      def = profile.combo[this.comboIndex];
    }
    if (def) this.start(ctx, def, aim, facing, 'basic', null, 0, profile.power, 1);
  }

  private castSkill(ctx: ActorContext, skillId: string, aim: number, facing: 1 | -1): void {
    const def = getSkillDef(skillId);
    if (!def?.action) return;
    const level = ctx.skillLevel(skillId);
    ctx.self.mp = Math.max(0, ctx.self.mp - Math.max(0, Math.round(scaled(def.mp, level))));
    this.cooldowns.set(skillId, ctx.now + Math.max(0, scaled(def.cooldown, level)));
    this.interrupt(ctx);
    this.chargeStart = Number.NaN;
    this.start(
      ctx,
      def.action,
      aim,
      facing,
      'skill',
      def,
      level,
      def.power,
      scaled(def.damage, level) / 100,
    );
  }

  private start(
    ctx: ActorContext,
    def: ActionDef,
    aim: number,
    facing: 1 | -1,
    kind: 'basic' | 'skill',
    skill: SkillDef | null,
    skillLevel: number,
    powerType: PowerType,
    multiplier: number,
  ): void {
    const self = ctx.self;
    const speed = kind === 'basic' ? self.stats.attackSpeed : 1;
    this.endDash(ctx);
    this.action = {
      def,
      t: 0,
      speed,
      next: 0,
      aim,
      facing,
      attack: { owner: self, power: this.power(self, powerType), multiplier, tag: def.id },
      skill,
      skillLevel,
      kind,
    };
    self.facing = facing;
    this.events.push({ type: 'action', action: def, aim, facing, skill: skill?.id ?? null, speed });
  }

  private fire(ctx: ActorContext, a: RunningAction, ev: ActionEventDef): void {
    const { self, combat, now } = ctx;
    const body = self.body;
    const cx = body.x;
    const cy = body.y - body.height / 2;
    switch (ev.kind) {
      case 'hit': {
        const len = Math.max(1 / 60, ((ev.until ?? ev.at) - ev.at) / a.speed);
        combat.openWindow(a.attack, ev.shape, ev, {
          until: now + len,
          interval: ev.interval ? ev.interval / a.speed : 0,
          maxTargets: ev.maxTargets,
          aim: a.aim,
          facing: a.facing,
          bounce: ev.bounce,
        });
        break;
      }
      case 'projectile': {
        const n = Math.max(1, ev.count ?? 1);
        const spread = ev.spread ?? 0;
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1);
          const ang = a.aim + off;
          combat.spawnProjectile(
            a.attack,
            ev.projectile,
            cx + Math.cos(a.aim) * 10,
            cy - 4 + (ev.offsetY ?? 0) + Math.sin(a.aim) * 10,
            ang,
            ev,
          );
        }
        break;
      }
      case 'dash': {
        let ang: number;
        if (ev.dir === 'aim') ang = a.aim;
        else if (ev.dir === 'down') ang = Math.PI / 2;
        else ang = (ev.dir === 'back' ? -a.facing : a.facing) > 0 ? 0 : Math.PI;
        const speed = ev.speed * (ev.dir === 'down' ? 1 : self.stats.moveSpeed);
        let window: HitWindow | null = null;
        if (ev.hit) {
          const shape: ShapeDef = ev.hit.shape;
          window = combat.openWindow(a.attack, shape, ev.hit, {
            until: now + ev.duration + 0.05,
            maxTargets: ev.hit.maxTargets,
            aim: ang,
            facing: Math.cos(ang) >= 0 ? 1 : -1,
            bounce: ev.bounce,
          });
        }
        if (ev.iframes) self.invulnUntil = Math.max(self.invulnUntil, now + ev.iframes);
        this.dash = {
          vx: Math.abs(Math.cos(ang)) < 1e-6 ? 0 : Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          until: now + ev.duration,
          untilGround: ev.untilGround ?? false,
          window,
        };
        break;
      }
      case 'teleport': {
        const dist =
          ev.distance <= 1 && a.skill?.value ? scaled(a.skill.value, a.skillLevel) : ev.distance;
        this.teleport(ctx, a.aim, dist);
        if (ev.iframes) self.invulnUntil = Math.max(self.invulnUntil, now + ev.iframes);
        break;
      }
      case 'buff': {
        const skill = a.skill;
        const duration = skill ? scaled(skill.duration, a.skillLevel) : 5;
        const magnitude = skill?.value ? scaled(skill.value, a.skillLevel) : 1;
        self.statuses.apply(ev.status, now, duration, { magnitude, sourceId: self.id });
        break;
      }
      case 'zone': {
        let zx = cx;
        let zy = body.y;
        if (ev.where === 'aim') {
          const range = ev.range ?? 200;
          const dx = Math.cos(a.aim) * range;
          zx = cx + Math.max(-range, Math.min(range, dx));
          zy = this.groundBelow(ctx.grid, zx, cy - 40) ?? cy;
        }
        combat.spawnZone(a.attack, zx, zy - ev.radius * 0.4, ev, now);
        break;
      }
    }
  }

  private groundBelow(grid: CollisionGrid, x: number, y: number): number | null {
    const tx = Math.floor(x / TILE_SIZE);
    const ty0 = Math.floor(y / TILE_SIZE);
    for (let ty = ty0; ty < ty0 + 14; ty++) {
      if (grid.collisionAt(tx, ty) !== COLLISION_NONE) return ty * TILE_SIZE;
    }
    return null;
  }

  /** Move toward the aim direction as far as `dist`, landing on the farthest free spot. */
  private teleport(ctx: ActorContext, aim: number, dist: number): void {
    const b = ctx.self.body;
    const fromX = b.x;
    const fromY = b.y;
    const half = b.width / 2;
    for (let d = dist; d >= 0; d -= 4) {
      const x = fromX + Math.cos(aim) * d;
      const y = fromY + Math.sin(aim) * d;
      if (!isRegionSolid(ctx.grid, x - half, y - b.height, x + half, y)) {
        b.x = x;
        b.y = y;
        b.vx = 0;
        b.vy = 0;
        b.grounded = false;
        this.events.push({ type: 'teleport', fromX, fromY, toX: x, toY: y });
        return;
      }
    }
  }
}
