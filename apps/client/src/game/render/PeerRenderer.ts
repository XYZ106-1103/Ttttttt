import type Phaser from 'phaser';
import {
  type ActorEvent,
  getJobDef,
  type Player,
  TILE_SIZE,
  type UseOutcome,
  type World,
} from '@world/shared';
import { appearanceFromLook, lookTextureId } from '../art/character/appearance';
import { CharacterView, type CombatLook } from '../entities/CharacterView';
import { createFrameEvents, resetFrameEvents } from '../entities/FrameEvents';
import type { CombatFx } from '../fx/CombatFx';
import { CharacterTextureQueue } from './CharacterTextureQueue';

interface PeerSprite {
  readonly view: CharacterView;
  wasGrounded: boolean;
}

/**
 * Other players in online play: the same CharacterView the local player and adventurers use,
 * with their chosen look, name tag (party members in green), held item and actions.
 */
export class PeerRenderer {
  private readonly views = new Map<string, PeerSprite>();
  private readonly frameEvents = createFrameEvents();
  private readonly textures: CharacterTextureQueue;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly labelLayer: Phaser.GameObjects.Layer,
    private readonly world: World,
    private readonly fx: CombatFx,
    private readonly partyMate: (key: string) => boolean,
  ) {
    this.textures = new CharacterTextureQueue(scene);
  }

  get count(): number {
    return this.views.size;
  }

  /** Name-tag views (for crowd stacking with adventurers). */
  get tagViews(): CharacterView[] {
    return [...this.views.values()].map((s) => s.view);
  }

  onAction(p: Player, e: ActorEvent, now: number): void {
    const v = this.views.get(p.key);
    if (!v || e.type !== 'action') return;
    const dur = e.action.duration / e.speed;
    v.view.triggerAction(e.action.anim, e.aim, Math.max(0.12, dur * 0.85), now);
    const anim = e.action.anim;
    const kind =
      anim === 'slam'
        ? 'slam'
        : anim === 'spin'
          ? 'spin'
          : anim === 'thrust'
            ? 'thrust'
            : anim === 'swing' || anim === 'swing_up'
              ? 'slash'
              : null;
    if (kind) {
      const job = getJobDef(p.jobId);
      const tint = job.id === 'novice' ? 0xe8f0ff : parseInt(job.color.slice(1), 16);
      const m = p.motor;
      this.fx.slash(kind, m.x, m.y - m.height / 2, e.aim, tint, anim === 'swing_up');
    }
  }

  onUse(p: Player, out: UseOutcome, now: number): void {
    const v = this.views.get(p.key);
    if (!v) return;
    v.view.triggerUse(out.action === 'place' ? 'place' : 'swing', 0.24, now);
    const color = out.hitObject
      ? out.hitObject.key.startsWith('tree_')
        ? 0x8c5d3c
        : 0x62b552
      : parseInt(
          (
            this.world.tiles.get(out.brokenTile ?? this.world.getFg(out.tx, out.ty))?.mapColor ??
            '#888888'
          ).slice(1),
          16,
        );
    this.fx.debrisBurst(
      out.tx * TILE_SIZE + TILE_SIZE / 2,
      out.ty * TILE_SIZE + TILE_SIZE / 2,
      color,
      out.broke ? 8 : 3,
    );
  }

  onLevelUp(p: Player): void {
    this.fx.pillar(p.motor.x, p.motor.y);
  }

  update(
    peers: readonly Player[],
    look: (key: string) => number,
    alpha: number,
    now: number,
    dt: number,
    zoom: number,
  ): void {
    const seen = new Set<string>();
    this.textures.flush();
    for (const p of peers) {
      const texId = lookTextureId(look(p.key));
      if (!this.textures.has(texId)) {
        this.textures.request(texId, appearanceFromLook(look(p.key)));
        continue;
      }
      seen.add(p.key);
      let s = this.views.get(p.key);
      if (!s) {
        const view = new CharacterView(
          this.scene,
          this.worldLayer,
          this.labelLayer,
          texId,
          p.name,
          this.world,
        );
        s = { view, wasGrounded: p.motor.grounded };
        this.views.set(p.key, s);
      }
      const m = p.motor;
      const x = p.prevX + (m.x - p.prevX) * alpha;
      const y = p.prevY + (m.y - p.prevY) * alpha;
      const ev = this.frameEvents;
      resetFrameEvents(ev);
      if (!s.wasGrounded && m.grounded) {
        ev.landed = true;
        ev.landingSpeed = Math.max(0, m.vy);
      } else if (s.wasGrounded && !m.grounded && m.vy < -80) ev.jumped = true;
      s.wasGrounded = m.grounded;
      const job = getJobDef(p.jobId);
      s.view.setName(`Lv.${p.level} ${p.name}`);
      s.view.setTagColor(
        this.partyMate(p.key) ? '#8df08a' : job.id === 'novice' ? '#bfe2ff' : job.color,
      );
      s.view.setHeldItem(p.inventory.get(p.selectedSlot)?.itemId ?? null);
      const lookState: CombatLook = {
        dead: !p.alive,
        hurt: now < p.staggerUntil,
        dodging: p.combat.dodgeUntil > now,
        charging: p.heldWeapon()?.type === 'bow' && !Number.isNaN(p.combat.chargeStart),
        blink: p.alive && now < p.invulnUntil,
      };
      s.view.update(dt, x, y, m, ev, Math.sign(m.vx), zoom, null, now, false, lookState);
    }
    for (const [key, s] of this.views) {
      if (seen.has(key)) continue;
      s.view.destroy();
      this.views.delete(key);
    }
  }

  /** Player under a world point (right-click inspection). */
  pick(peers: readonly Player[], wx: number, wy: number): Player | null {
    for (const p of peers) {
      const m = p.motor;
      if (Math.abs(wx - m.x) < 18 && wy < m.y + 6 && wy > m.y - m.height - 12) return p;
    }
    return null;
  }

  destroy(): void {
    this.textures.destroy();
    for (const s of this.views.values()) s.view.destroy();
    this.views.clear();
  }
}
