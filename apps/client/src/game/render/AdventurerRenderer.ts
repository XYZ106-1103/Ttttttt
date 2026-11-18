import type Phaser from 'phaser';
import {
  type ActorEvent,
  type Adventurer,
  getJobDef,
  heldMode,
  TILE_SIZE,
  toneOf,
  type UseOutcome,
  type World,
} from '@world/shared';
import { t } from '../../i18n';
import { randomAppearance } from '../art/character/appearance';
import { CharacterView, type CombatLook } from '../entities/CharacterView';
import { createFrameEvents, resetFrameEvents } from '../entities/FrameEvents';
import type { CombatFx } from '../fx/CombatFx';
import { CharacterTextureQueue } from './CharacterTextureQueue';

interface AdventurerSprite {
  readonly view: CharacterView;
  readonly bubble: Phaser.GameObjects.Text;
  bubbleKey: string;
}

/**
 * Renders active AI adventurers with the same CharacterView the player uses: procedural
 * appearance (composed lazily, one per frame), name tag with level and job color, held item,
 * weapon motions and speech bubbles.
 */
export class AdventurerRenderer {
  private readonly views = new Map<string, AdventurerSprite>();
  private readonly frameEvents = createFrameEvents();
  private readonly textures: CharacterTextureQueue;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly labelLayer: Phaser.GameObjects.Layer,
    private readonly world: World,
    private readonly fx: CombatFx,
  ) {
    this.textures = new CharacterTextureQueue(scene);
  }

  get count(): number {
    return this.views.size;
  }

  private create(a: Adventurer): AdventurerSprite {
    const view = new CharacterView(
      this.scene,
      this.worldLayer,
      this.labelLayer,
      a.key,
      a.profile.name.ko,
      this.world,
    );
    const bubble = this.scene.make.text(
      {
        x: 0,
        y: 0,
        text: '',
        style: {
          fontFamily: 'Galmuri11, monospace',
          fontSize: '12px',
          color: '#1a1424',
          backgroundColor: 'rgba(255,248,232,0.94)',
          padding: { left: 5, right: 5, top: 3, bottom: 3 },
          wordWrap: { width: 220 },
        },
      },
      false,
    );
    bubble.setOrigin(0.5, 1).setDepth(55).setVisible(false);
    this.labelLayer.add(bubble);
    return { view, bubble, bubbleKey: '' };
  }

  /** Character view of an active adventurer (for effects), if it is being rendered. */
  viewOf(key: string): CharacterView | undefined {
    return this.views.get(key)?.view;
  }

  onAction(a: Adventurer, e: ActorEvent, now: number): void {
    const v = this.views.get(a.key);
    if (!v || e.type !== 'action') return;
    const dur = e.action.duration / e.speed;
    v.view.triggerAction(e.action.anim, e.aim, Math.max(0.12, dur * 0.85), now);
    const kind =
      e.action.anim === 'slam'
        ? 'slam'
        : e.action.anim === 'spin'
          ? 'spin'
          : e.action.anim === 'thrust'
            ? 'thrust'
            : e.action.anim === 'swing' || e.action.anim === 'swing_up'
              ? 'slash'
              : null;
    if (kind) {
      const c = a.character;
      const job = getJobDef(c.jobId);
      const tint = job.id === 'novice' ? 0xd8e0f0 : parseInt(job.color.slice(1), 16);
      this.fx.slash(
        kind,
        c.motor.x,
        c.motor.y - c.motor.height / 2,
        e.aim,
        tint,
        e.action.anim === 'swing_up',
      );
    }
  }

  onUse(a: Adventurer, out: UseOutcome, now: number): void {
    const v = this.views.get(a.key);
    if (!v) return;
    v.view.triggerUse(out.action === 'place' ? 'place' : 'swing', 0.24, now);
    const cx = out.tx * TILE_SIZE + TILE_SIZE / 2;
    const cy = out.ty * TILE_SIZE + TILE_SIZE / 2;
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
    this.fx.debrisBurst(cx, cy, color, out.broke ? 8 : 3);
  }

  onLevelUp(a: Adventurer): void {
    const c = a.character;
    this.fx.pillar(c.motor.x, c.motor.y);
  }

  update(
    active: readonly Adventurer[],
    alpha: number,
    now: number,
    dt: number,
    zoom: number,
  ): void {
    const seen = new Set<string>();
    this.textures.flush();
    for (const a of active) {
      const c = a.character;
      if (!this.textures.has(a.key)) {
        this.textures.request(a.key, randomAppearance(a.profile.appearanceSeed));
        continue;
      }
      seen.add(a.key);
      let s = this.views.get(a.key);
      if (!s) {
        s = this.create(a);
        this.views.set(a.key, s);
      }
      const m = c.motor;
      const x = c.prevX + (m.x - c.prevX) * alpha;
      const y = c.prevY + (m.y - c.prevY) * alpha;
      const ev = this.frameEvents;
      resetFrameEvents(ev);
      ev.jumped = a.fx.jumped;
      ev.landed = a.fx.landed;
      ev.landingSpeed = a.fx.landingSpeed;
      ev.stepped = a.fx.stepped;
      a.fx.jumped = false;
      a.fx.landed = false;
      a.fx.landingSpeed = 0;
      a.fx.stepped = 0;
      const job = getJobDef(c.jobId);
      s.view.setName(`Lv.${c.level} ${a.profile.name.ko}`);
      s.view.setTagColor(job.id === 'novice' ? '#e8e2d4' : job.color);
      const held = c.inventory.get(c.selectedSlot)?.itemId ?? null;
      s.view.setHeldItem(held);
      const look: CombatLook = {
        dead: !c.alive,
        hurt: now < c.staggerUntil,
        dodging: c.combat.dodgeUntil > now,
        charging: c.heldWeapon()?.type === 'bow' && !Number.isNaN(c.combat.chargeStart),
        blink: false,
      };
      const working = a.action === 'fight' || a.action === 'mine' || a.action === 'gather';
      const aim =
        working && heldMode(c) !== 'consumable'
          ? {
              x: a.targetTile ? a.targetTile.tx * TILE_SIZE + 8 : m.x + m.facing * 30,
              y: a.targetTile ? a.targetTile.ty * TILE_SIZE + 8 : m.y - 22,
            }
          : null;
      s.view.update(dt, x, y, m, ev, Math.sign(m.vx), zoom, aim, now, false, look);
      // Speech bubble.
      const bark = a.bark && now < a.bark.until ? a.bark : null;
      if (bark) {
        const key = `${bark.key}:${bark.until}`;
        if (s.bubbleKey !== key) {
          s.bubbleKey = key;
          const params: Record<string, string | number> = { ...(bark.params ?? {}) };
          if (typeof params.job === 'string') params.job = t(`job.${params.job}`);
          params.name = a.profile.name.ko;
          s.bubble.setText(t(`bark.${toneOf(a.profile.personality)}.${bark.key}`, params));
        }
        const anchor = s.view.tagAnchor;
        s.bubble.setVisible(true).setPosition(anchor.x, Math.round((y - 50) * zoom));
      } else s.bubble.setVisible(false);
    }
    for (const [key, s] of this.views) {
      if (seen.has(key)) continue;
      s.view.destroy();
      s.bubble.destroy();
      this.views.delete(key);
    }
  }

  /** Adventurer under a world point (right-click inspection). */
  pick(active: readonly Adventurer[], wx: number, wy: number): Adventurer | null {
    for (const a of active) {
      const m = a.character.motor;
      if (Math.abs(wx - m.x) < 18 && wy < m.y + 6 && wy > m.y - m.height - 12) return a;
    }
    return null;
  }

  destroy(): void {
    this.textures.destroy();
    for (const s of this.views.values()) {
      s.view.destroy();
      s.bubble.destroy();
    }
    this.views.clear();
  }
}
