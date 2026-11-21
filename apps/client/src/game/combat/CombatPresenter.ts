import type Phaser from 'phaser';
import {
  type ActionDef,
  type CombatEvent,
  getJobDef,
  getSkillDef,
  type MonsterEvent,
  scaled,
  type ActorEvent,
} from '@world/shared';
import { getQuestDef, itemRegistry } from '@world/shared';
import { t } from '../../i18n';
import { pushChat, showToast, type Stores } from '../../app/stores';
import type { CameraController } from '../camera/CameraController';
import type { CharacterView, CombatLook } from '../entities/CharacterView';
import { CombatFx, type SlashKind } from '../fx/CombatFx';
import { DamageNumbers } from '../render/DamageNumbers';
import type { PointLight } from '../render/LightGrid';
import { nameOf, socialParams, spokenText } from '../social/socialText';
import { AdventurerRenderer } from '../render/AdventurerRenderer';
import { MonsterRenderer } from '../render/MonsterRenderer';
import { ProjectileRenderer } from '../render/ProjectileRenderer';
import type { ClientSim } from '../sim/ClientSim';
import type { SimNotice } from '../sim/GameSimulation';
import { PeerRenderer } from '../render/PeerRenderer';

const MONSTER_COLOR: Record<string, number> = {
  dew_slime: 0x6fd890,
  cave_slime: 0x7c84f0,
  thornback: 0x3f6b4f,
  cave_bat: 0x5d4b72,
  wisp: 0x5fa8ff,
  corestone_golem: 0x6b7182,
};

const STATUS_COLOR: Record<string, string> = {
  poison: '#9df07a',
  burn: '#ffb27a',
  slow: '#a8c8ff',
  freeze: '#bfeaff',
  stun: '#ffe066',
  weaken: '#c0c0c0',
};

interface ScheduledSlash {
  at: number;
  kind: SlashKind;
  aim: number;
  tint: number;
  reverse: boolean;
}

function hex(c: string): number {
  return parseInt(c.slice(1), 16);
}

/**
 * Turns simulation combat events into everything the player sees and hears about combat:
 * monster/projectile sprites, weapon trails, damage numbers, hitstop, screen shake, level-up
 * pillars, telegraphs, toasts and the combat HUD store. No game rules live here.
 */
/** Display name of a quest from its id (bounty titles name their target). */
function questName(id: string): string {
  const def = getQuestDef(id);
  if (!def) return id;
  const o = def.objectives[0];
  const target =
    o?.kind === 'kill'
      ? t(`monster.${o.target}`)
      : o?.kind === 'collect'
        ? t(itemRegistry.get(o.item)?.nameKey ?? o.item)
        : '';
  return t(def.nameKey, { target });
}

export class CombatPresenter {
  readonly monsters: MonsterRenderer;
  readonly adventurers: AdventurerRenderer;
  readonly peers: PeerRenderer;
  private readonly projectiles: ProjectileRenderer;
  private readonly numbers: DamageNumbers;
  readonly fx: CombatFx;
  private readonly slashes: ScheduledSlash[] = [];
  private readonly zonesSeen = new Set<number>();
  private afterimageTimer = 0;
  private statusTimer = 0;
  private publishTimer = 0;
  private hitFlash = 0;
  private levelUps = 0;
  private lastToastAt = -10;
  private readonly lights: PointLight[] = [];

  constructor(
    scene: Phaser.Scene,
    worldLayer: Phaser.GameObjects.Layer,
    overlayLayer: Phaser.GameObjects.Layer,
    labelLayer: Phaser.GameObjects.Layer,
    private readonly sim: ClientSim,
    private readonly view: CharacterView,
    private readonly camera: CameraController,
    private readonly stores: Stores,
  ) {
    this.monsters = new MonsterRenderer(scene, worldLayer, overlayLayer);
    this.projectiles = new ProjectileRenderer(scene, worldLayer, overlayLayer);
    this.numbers = new DamageNumbers(scene, overlayLayer);
    this.fx = new CombatFx(scene, worldLayer, overlayLayer, labelLayer);
    this.adventurers = new AdventurerRenderer(scene, worldLayer, labelLayer, sim.world, this.fx, {
      name: (a) => nameOf(sim, a.key),
      line: (a, line, params) => spokenText(sim, a.key, line, params),
      params: (params) => socialParams(sim, params),
      partyMate: (a) => sim.society.parties.same(sim.selfKey, a.key),
    });
    this.peers = new PeerRenderer(scene, worldLayer, labelLayer, sim.world, this.fx, (k) =>
      sim.society.parties.same(sim.selfKey, k),
    );
  }

  /** Accent color for the player's weapon trails. */
  private trailTint(skill: string | null): number {
    if (skill) {
      const def = getSkillDef(skill);
      if (def) return hex(def.icon.color);
    }
    const job = getJobDef(this.sim.player.jobId);
    return job.id === 'novice' ? 0xe8f0ff : hex(job.color);
  }

  /** Player combat look for the character view this frame. */
  look(): CombatLook {
    const p = this.sim.player;
    const now = this.sim.time;
    const w = p.heldWeapon();
    return {
      dead: !p.alive,
      hurt: now < p.staggerUntil,
      dodging: p.combat.dodgeUntil > now,
      charging: w?.type === 'bow' && !Number.isNaN(p.combat.chargeStart),
      blink:
        p.alive && now < p.invulnUntil && now - p.lastHitAt < 1.2 && p.combat.dodgeUntil <= now,
    };
  }

  /** Consume this frame's simulation events. */
  consume(zoom: number): void {
    const ev = this.sim.events;
    this.fx.setZoom(zoom);
    for (const e of ev.actor) this.onActor(e);
    for (const e of ev.combat) this.onCombat(e);
    for (const e of ev.monster) this.onMonster(e);
    for (const lvl of ev.levelUps) this.onLevelUp(lvl);
    for (const x of ev.exp) this.fx.label(x.x, x.y - 6, `+${x.amount} EXP`, '#d8b8ff', 11, 1.2);
    for (const n of ev.notices) this.onNotice(n);
    const now = this.sim.time;
    const dir = this.sim.adventurers;
    for (const { id, event } of ev.aiActor) {
      const a = dir.byCharacter(id);
      if (a) this.adventurers.onAction(a, event, now);
    }
    for (const { id, out } of ev.aiUses) {
      const a = dir.byCharacter(id);
      if (a) this.adventurers.onUse(a, out, now);
    }
    for (const { id } of ev.aiLevelUps) {
      const a = dir.byCharacter(id);
      if (a && a.tier === 'active') this.adventurers.onLevelUp(a);
    }
    for (const e of ev.ai) {
      const a = dir.byKey(e.key);
      if (!a) continue;
      if (e.type === 'job')
        pushChat(
          this.stores,
          'notice',
          t('adv.jobChat', { name: a.profile.name.ko, job: t(`job.${e.jobId}`) }),
        );
    }
    const peer = (id: number) => this.sim.peers().find((x) => x.id === id);
    for (const { id, event } of ev.peerActor) {
      const pl = peer(id);
      if (pl) this.peers.onAction(pl, event, now);
    }
    for (const { id, out } of ev.peerUses) {
      const pl = peer(id);
      if (pl) this.peers.onUse(pl, out, now);
    }
    for (const { id } of ev.peerLevelUps) {
      const pl = peer(id);
      if (pl) this.peers.onLevelUp(pl);
    }
    ev.peerActor.length = 0;
    ev.peerUses.length = 0;
    ev.peerLevelUps.length = 0;
    ev.aiActor.length = 0;
    ev.aiUses.length = 0;
    ev.aiLevelUps.length = 0;
    ev.ai.length = 0;
    ev.actor.length = 0;
    ev.combat.length = 0;
    ev.monster.length = 0;
    ev.levelUps.length = 0;
    ev.exp.length = 0;
    ev.notices.length = 0;
    // New lingering zones (arrow rain).
    for (const z of this.sim.combat.zones) {
      if (this.zonesSeen.has(z.id)) continue;
      this.zonesSeen.add(z.id);
      if (z.visual === 'arrow_rain')
        this.fx.arrowRain(z.x, z.y + z.radius * 0.4, z.radius, z.start, z.until);
    }
    if (this.zonesSeen.size > 200) this.zonesSeen.clear();
  }

  /** Own attack/skill animations started (diagnostics: prediction tests). */
  actionsShown = 0;
  /** performance.now() of the latest one. */
  lastActionAt = 0;

  private onActor(e: ActorEvent): void {
    const p = this.sim.player;
    const now = this.sim.time;
    const m = p.motor;
    switch (e.type) {
      case 'action': {
        this.actionsShown++;
        this.lastActionAt = performance.now();
        const dur = e.action.duration / e.speed;
        this.view.triggerAction(e.action.anim, e.aim, Math.max(0.12, dur * 0.85), now);
        this.scheduleTrails(e.action, e.aim, e.speed, e.skill);
        const cx = m.x;
        const cy = m.y - m.height / 2;
        if (e.action.id === 'mage_frost_nova') this.fx.frost(cx, cy, 68);
        else if (e.action.anim === 'raise') {
          this.fx.ring(cx, cy, 1.5, this.trailTint(e.skill));
          this.fx.motesAt(cx, m.y - 8, this.trailTint(e.skill), 14, 10);
        } else if (e.action.anim === 'cast')
          this.fx.motesAt(
            cx + Math.cos(e.aim) * 14,
            cy + Math.sin(e.aim) * 14,
            this.trailTint(e.skill),
            4,
            3,
          );
        if (e.action.anim === 'dash') this.afterimageTimer = 0;
        break;
      }
      case 'dodge':
        this.afterimageTimer = 0;
        this.fx.debrisBurst(m.x, m.y - 2, 0xc8b89a, 5);
        break;
      case 'charge':
        this.fx.ring(m.x + Math.cos(0) * 0, m.y - m.height / 2, 0.8, 0xfff2b0);
        break;
      case 'teleport':
        this.fx.ring(e.fromX, e.fromY - m.height / 2, 1.2, 0x8fb0ff);
        this.fx.ring(e.toX, e.toY - m.height / 2, 1.2, 0x8fb0ff);
        this.fx.motesAt(e.fromX, e.fromY - m.height / 2, 0x8fb0ff, 10, 8);
        break;
      case 'castFail':
        break;
    }
  }

  /** Weapon trails timed to the action's hit windows (data-driven visuals). */
  private scheduleTrails(
    action: ActionDef,
    aim: number,
    speed: number,
    skill: string | null,
  ): void {
    const now = this.sim.time;
    const tint = this.trailTint(skill);
    const kind: SlashKind | null =
      action.anim === 'slam'
        ? 'slam'
        : action.anim === 'spin'
          ? 'spin'
          : action.anim === 'thrust'
            ? 'thrust'
            : action.anim === 'swing' || action.anim === 'swing_up'
              ? 'slash'
              : null;
    if (!kind) return;
    for (const ev of action.events) {
      if (ev.kind !== 'hit') continue;
      const start = now + ev.at / speed;
      const end = now + (ev.until ?? ev.at) / speed;
      const step = ev.interval ? ev.interval / speed : Infinity;
      for (let at = start; at <= end + 1e-6; at += step) {
        this.slashes.push({ at, kind, aim, tint, reverse: action.anim === 'swing_up' });
        if (!Number.isFinite(step)) break;
      }
    }
  }

  private onCombat(e: CombatEvent): void {
    const p = this.sim.player;
    const now = this.sim.time;
    switch (e.type) {
      case 'damage': {
        const isPlayer = e.targetId === p.id;
        const isAdventurer =
          !isPlayer &&
          (this.sim.adventurers.byCharacter(e.targetId) !== undefined ||
            this.sim.peers().some((x) => x.id === e.targetId));
        const style =
          isPlayer || isAdventurer ? 'hurt' : e.source === 'dot' ? 'dot' : e.crit ? 'crit' : 'dmg';
        this.numbers.spawn(e.amount, e.x, e.y - 2, style, String(e.targetId));
        if (isPlayer) {
          this.hitFlash++;
          this.camera.shake(e.amount > p.stats.maxHp * 0.15 ? 3 : 1.6, 0.16);
          if (e.source !== 'dot')
            this.fx.spark(p.motor.x, p.motor.y - p.motor.height / 2, false, 0xff7aa8);
        } else if (isAdventurer) {
          if (e.source !== 'dot') this.fx.spark(e.x, e.y + 14, false, 0xff9ab8);
        } else {
          this.monsters.hit(e.targetId, now, e.hitstop);
          if (e.source !== 'dot') {
            const head = this.monsters.headOf(e.targetId);
            const y = head ? (head.y + e.y) / 2 + 6 : e.y + 6;
            this.fx.spark(e.x - e.dirX * 4, y, e.crit, e.crit ? 0xff8a3d : 0xffe08a);
          }
          if (e.attackerId === p.id && e.hitstop > 0) {
            this.view.freeze(now + e.hitstop);
            if (e.crit || e.hitstop >= 0.08) this.camera.shake(e.crit ? 1.6 : 1, 0.1);
          }
        }
        break;
      }
      case 'heal':
        this.numbers.spawn(e.amount, e.x, e.y - 4, e.mana ? 'mana' : 'heal', `h${e.targetId}`);
        break;
      case 'death': {
        if (e.targetId === p.id) break;
        const mon = this.sim.monsters.monsters.find((m) => m.id === e.targetId);
        const color = MONSTER_COLOR[mon?.def.id ?? ''] ?? 0xffffff;
        this.fx.debrisBurst(e.x, e.y, color, mon?.def.boss ? 40 : 12);
        this.fx.motesAt(e.x, e.y, 0xfff2c0, mon?.def.boss ? 30 : 6, mon?.def.boss ? 24 : 6);
        if (mon?.def.boss) {
          this.fx.explosion(e.x, e.y, 60);
          this.camera.shake(5, 0.6);
        }
        break;
      }
      case 'dodge':
        if (e.perfect) {
          this.fx.label(e.x, e.y - 22, t('combat.perfect'), '#fff6c0', 13, 1.2);
          this.fx.ring(e.x, e.y, 2, 0xfff2b0);
          this.fx.afterimage(this.view.snapshot(), 0xfff2b0, 0.5);
        }
        break;
      case 'status': {
        const color = STATUS_COLOR[e.status];
        if (!color) break;
        const target =
          e.targetId === p.id ? p : this.sim.monsters.monsters.find((m) => m.id === e.targetId);
        if (target)
          this.fx.label(
            target.body.x,
            target.body.y - target.body.height - 10,
            t(`status.${e.status}`),
            color,
            10,
            0.9,
          );
        break;
      }
      case 'bounce':
        this.fx.ring(p.motor.x, p.motor.y, 1, 0xffffff);
        break;
      case 'explode':
        if (e.visual === 'fireball' || e.visual === 'magma_ball' || e.visual === 'meteor')
          this.fx.explosion(e.x, e.y, e.radius);
        else {
          const icy = e.visual === 'ice_chunk' || e.visual === 'icicle';
          this.fx.debrisBurst(e.x, e.y, icy ? 0xc8f0ff : 0x6b7182, 14);
          this.camera.shake(1.4, 0.12);
        }
        break;
      case 'projectileEnd':
        if (e.hitTile && (e.visual === 'arrow' || e.visual === 'arrow_charged')) {
          const pr = this.sim.combat.projectiles.find((x) => x.id === e.id);
          this.fx.stuckArrow(e.x, e.y, pr ? Math.atan2(pr.vy, pr.vx) : 0);
        } else if (e.hitTile) this.fx.debrisBurst(e.x, e.y, 0xc8c0b0, 4);
        break;
    }
  }

  private onMonster(e: MonsterEvent): void {
    const now = this.sim.time;
    switch (e.type) {
      case 'telegraph':
        this.monsters.telegraph(e.id, now);
        break;
      case 'impact':
        this.camera.shake(2 + e.power * 3, 0.15 + e.power * 0.15);
        this.fx.debrisBurst(e.x, e.y, 0x8a7a68, Math.round(8 + e.power * 10));
        break;
      case 'phase': {
        const mon = this.sim.monsters.monsters.find((m) => m.id === e.id);
        if (mon) {
          this.fx.label(
            mon.motor.x,
            mon.motor.y - mon.motor.height - 16,
            t('combat.enraged'),
            '#ff7a5a',
            14,
            1.6,
          );
          this.fx.ring(mon.motor.x, mon.motor.y - mon.motor.height / 2, 3, 0xff7a3a);
        }
        this.camera.shake(4, 0.5);
        break;
      }
      case 'blink':
        this.fx.ring(e.fromX, e.fromY - 9, 0.8, 0x6f9cff);
        this.fx.ring(e.toX, e.toY - 9, 0.8, 0x6f9cff);
        break;
      case 'marker':
        this.fx.marker(e.x, e.y, e.delay);
        break;
    }
  }

  private onLevelUp(level: number): void {
    const m = this.sim.player.motor;
    this.levelUps++;
    this.fx.pillar(m.x, m.y);
    this.fx.label(m.x, m.y - m.height - 14, 'LEVEL UP!', '#ffe08a', 15, 1.8);
    pushChat(this.stores, 'notice', t('combat.levelUpChat', { level }));
  }

  private onNotice(n: SimNotice): void {
    const now = this.sim.time;
    const toast = (text: string): void => {
      if (now - this.lastToastAt < 0.6) return;
      this.lastToastAt = now;
      showToast(this.stores, text);
    };
    switch (n.kind) {
      case 'castFail':
        toast(t(`cast.${n.reason}`));
        break;
      case 'consumeFail':
        toast(t(`consume.${n.reason}`));
        break;
      case 'weaponLevel':
        toast(t('combat.weaponLevel', { level: n.level }));
        break;
      case 'jobChanged': {
        const job = getJobDef(n.jobId);
        pushChat(this.stores, 'notice', t('job.advancedChat', { job: t(job.nameKey) }));
        const m = this.sim.player.motor;
        this.fx.pillar(m.x, m.y);
        this.fx.ring(m.x, m.y - 22, 3, hex(job.color));
        break;
      }
      case 'died':
        pushChat(
          this.stores,
          'system',
          n.expLost > 0 ? t('combat.diedChat', { exp: n.expLost }) : t('combat.diedChatSafe'),
        );
        break;
      case 'respawned':
        pushChat(this.stores, 'system', t('combat.respawnedChat'));
        break;
      case 'bossSpawned':
        pushChat(
          this.stores,
          'notice',
          t('combat.bossSpawned', { name: t(`monster.${n.monsterId}`) }),
        );
        this.camera.shake(3, 0.8);
        break;
      case 'bossDefeated':
        pushChat(
          this.stores,
          'notice',
          t('combat.bossDefeated', { name: t(`monster.${n.monsterId}`) }),
        );
        break;
      case 'consumed':
        break;
      case 'questDone':
        pushChat(this.stores, 'notice', t('quest.doneChat', { name: questName(n.questId) }));
        break;
      case 'enhanced': {
        const item = t(itemRegistry.get(n.itemId)?.nameKey ?? n.itemId);
        pushChat(this.stores, 'system', t(`notice.enhanced.${n.outcome}`, { item, plus: n.plus }));
        if (n.outcome === 'success') {
          const m = this.sim.player.motor;
          this.fx.ring(m.x, m.y - 22, 2, 0xffd25a);
        }
        break;
      }
    }
  }

  /** Per-frame visuals. */
  update(dt: number, alpha: number, zoom = 2): void {
    const now = this.sim.time;
    const p = this.sim.player;
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i] as ScheduledSlash;
      if (now < s.at) continue;
      this.slashes.splice(i, 1);
      if (!p.alive) continue;
      const v = this.view.pos;
      this.fx.slash(s.kind, v.x, v.y - p.motor.height / 2, s.aim, s.tint, s.reverse);
    }
    // Afterimages while dodging or dashing.
    const dashing = p.combat.dodgeUntil > now || p.combat.dash !== null;
    if (dashing) {
      this.afterimageTimer -= dt;
      if (this.afterimageTimer <= 0) {
        this.afterimageTimer = 0.035;
        this.fx.afterimage(this.view.snapshot(), p.combat.dash ? this.trailTint(null) : 0xc8d8ff);
      }
    }
    // Status particles.
    this.statusTimer -= dt;
    if (this.statusTimer <= 0) {
      this.statusTimer = 0.18;
      const emit = (
        x: number,
        y: number,
        ids: readonly { def: { id: string }; until: number }[],
      ): void => {
        for (const s of ids) {
          if (s.until <= now) continue;
          if (s.def.id === 'poison') this.fx.motesAt(x, y, 0x9df07a, 1, 5);
          else if (s.def.id === 'burn') this.fx.motesAt(x, y, 0xffa060, 1, 5);
          else if (s.def.id === 'freeze' || s.def.id === 'slow')
            this.fx.motesAt(x, y, 0xd8f4ff, 1, 5);
          else if (s.def.id === 'rage') this.fx.motesAt(x, y + 10, 0xff6a5a, 1, 6);
          else if (s.def.id === 'haste') this.fx.motesAt(x, y + 14, 0x8affc0, 1, 6);
          else if (s.def.id === 'focus' || s.def.id === 'perfect_focus')
            this.fx.motesAt(x, y, 0xffe9a8, 1, 6);
          else if (s.def.id === 'second_wind') this.fx.motesAt(x, y + 10, 0x9df07a, 1, 6);
        }
      };
      for (const m of this.sim.monsters.monsters)
        if (m.alive) emit(m.motor.x, m.motor.y - m.motor.height / 2, m.statuses.all);
      if (p.alive) emit(p.motor.x, p.motor.y - p.motor.height / 2, p.statuses.all);
    }
    this.monsters.update(this.sim.monsters.monsters, alpha, now, dt);
    this.projectiles.update(this.sim.combat.projectiles, dt);
    this.peers.update(this.sim.peers(), (k) => this.sim.peerLook(k), alpha, now, dt, zoom);
    this.adventurers.update(this.sim.adventurers.active, alpha, now, dt, zoom, [
      ...this.peers.tagViews,
      this.view,
    ]);
    this.numbers.update(dt);
    this.fx.update(dt, now);
  }

  /** Light sources from glowing monsters and projectiles. */
  collectLights(out: PointLight[]): void {
    this.lights.length = 0;
    const now = this.sim.time;
    for (const m of this.sim.monsters.monsters) {
      if (!m.alive || !m.def.light) continue;
      const [r, g, b] = m.def.light;
      const k = 0.85 + 0.15 * Math.sin(now * 9 + m.seed);
      out.push({
        tx: Math.floor(m.motor.x / 16),
        ty: Math.floor((m.motor.y - m.motor.height / 2) / 16),
        r: r * k,
        g: g * k,
        b: b * k,
      });
    }
    for (const pr of this.sim.combat.projectiles) {
      if (!pr.alive || !pr.def.light) continue;
      const [r, g, b] = pr.def.light;
      out.push({ tx: Math.floor(pr.x / 16), ty: Math.floor(pr.y / 16), r, g, b });
    }
  }

  /** Throttled HUD state (skill cooldowns, buffs, boss bar, death). */
  publish(dt: number, force = false): void {
    this.publishTimer -= dt;
    if (this.publishTimer > 0 && !force) return;
    this.publishTimer = 0.1;
    const p = this.sim.player;
    const now = this.sim.time;
    const ac = p.combat;
    const skillBar = p.skillBar.map((id) => {
      if (!id) return { id: null, cooldown: 0, cooldownMax: 1, mpCost: 0, usable: false };
      const def = getSkillDef(id);
      const level = p.skillLevel(id);
      const mp = def ? Math.max(0, Math.round(scaled(def.mp, level))) : 0;
      const cdMax = def ? Math.max(0.01, scaled(def.cooldown, level)) : 1;
      return {
        id,
        cooldown: ac.cooldownLeft(id, now),
        cooldownMax: cdMax,
        mpCost: mp,
        usable: p.alive && p.mp >= mp && level > 0,
      };
    });
    const buffs = p.statuses.all
      .filter((s) => s.until > now)
      .map((s) => ({ id: s.def.id, left: s.until - now, total: s.duration, kind: s.def.kind }));
    const boss = this.sim.monsters.bossActive;
    const inv = p.inventory;
    const w = p.heldWeapon();
    const charge =
      w?.type === 'bow' && !Number.isNaN(ac.chargeStart)
        ? Math.min(1, (now - ac.chargeStart) / 0.55)
        : 0;
    this.stores.combat.set({
      skillBar,
      dodge: Math.max(0, Math.min(1, (ac.dodgeCooldownUntil - now) / 0.55)),
      potion: Math.max(0, p.potionCooldownUntil - now),
      potionMax: 4,
      healPotions: inv.count('healing_potion'),
      manaPotions: inv.count('mana_potion'),
      buffs,
      boss: boss
        ? {
            id: boss.id,
            nameKey: boss.def.nameKey,
            level: boss.def.level,
            hp: boss.hp,
            maxHp: boss.stats.maxHp,
            phase: boss.brain.phase,
          }
        : null,
      dead: !p.alive,
      respawnIn: Math.max(0, p.respawnAt - now),
      charge,
      hitFlash: this.hitFlash,
      levelUp: this.levelUps,
      lastLevel: p.level,
    });
  }

  destroy(): void {
    this.monsters.destroy();
    this.adventurers.destroy();
    this.peers.destroy();
    this.projectiles.destroy();
    this.numbers.destroy();
    this.fx.destroy();
  }
}
