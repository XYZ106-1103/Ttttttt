import type Phaser from 'phaser';
import type { Monster } from '@world/shared';
import { monsterAnimKey, TEX } from './textureKeys';
import { monsterSheetInfo } from './textures';

interface MonsterSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly glow: Phaser.GameObjects.Image | null;
  readonly bar: Phaser.GameObjects.Graphics;
  readonly stars: Phaser.GameObjects.Image[];
  readonly alert: Phaser.GameObjects.Image;
  anim: string;
  flashUntil: number;
  freezeUntil: number;
  barUntil: number;
  alertUntil: number;
  shake: number;
  shownHp: number;
}

const STATUS_TINT: Record<string, number> = {
  poison: 0xa8f08a,
  burn: 0xffb27a,
  slow: 0xa8c8ff,
  freeze: 0xbfeaff,
};

/**
 * Sprites for monsters: animation from the brain's `anim`, hit flash, hitstop shake, HP bar,
 * telegraph "!" and stun stars. Emissive monsters (wisps) render unlit with a glow.
 */
export class MonsterRenderer {
  private readonly views = new Map<number, MonsterSprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly overlayLayer: Phaser.GameObjects.Layer,
  ) {}

  get count(): number {
    return this.views.size;
  }

  private create(m: Monster): MonsterSprite {
    const info = monsterSheetInfo(m.def.id);
    const sprite = this.scene.make.sprite({ x: 0, y: 0, key: TEX.monsters }, false);
    if (info) sprite.setOrigin(info.footX / info.width, info.footY / info.height);
    sprite.setDepth(m.def.boss ? 18 : 19);
    const emissive = info?.emissive ?? false;
    let glow: Phaser.GameObjects.Image | null = null;
    if (emissive || m.def.light) {
      glow = this.scene.make.image({ x: 0, y: 0, key: TEX.glow }, false);
      const [r, g, b] = m.def.light ?? [1, 1, 1];
      const max = Math.max(r, g, b, 0.001);
      glow
        .setTint(
          ((Math.round((r / max) * 255) << 16) |
            (Math.round((g / max) * 255) << 8) |
            Math.round((b / max) * 255)) >>>
            0,
        )
        .setBlendMode('ADD')
        .setAlpha(0.5)
        .setScale(m.def.boss ? 2.4 : 0.9)
        .setDepth(17);
      this.overlayLayer.add(glow);
    }
    (emissive ? this.overlayLayer : this.worldLayer).add(sprite);
    const bar = this.scene.make.graphics({}, false).setDepth(40);
    this.overlayLayer.add(bar);
    const alert = this.scene.make.image({ x: 0, y: 0, key: TEX.combat, frame: 'alert' }, false);
    alert.setOrigin(0.5, 1).setDepth(41).setVisible(false);
    this.overlayLayer.add(alert);
    const stars: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < 3; i++) {
      const s = this.scene.make.image({ x: 0, y: 0, key: TEX.combat, frame: 'star' }, false);
      s.setDepth(41).setVisible(false);
      this.overlayLayer.add(s);
      stars.push(s);
    }
    return {
      sprite,
      glow,
      bar,
      stars,
      alert,
      anim: '',
      flashUntil: 0,
      freezeUntil: 0,
      barUntil: 0,
      alertUntil: 0,
      shake: 0,
      shownHp: m.hp,
    };
  }

  /** A hit landed: white flash, hitstop freeze and HP bar. */
  hit(id: number, now: number, hitstop: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.flashUntil = now + 0.07;
    v.freezeUntil = now + hitstop;
    v.shake = Math.max(v.shake, hitstop > 0.06 ? 2 : 1);
    v.barUntil = now + 4;
  }

  telegraph(id: number, now: number): void {
    const v = this.views.get(id);
    if (v) v.alertUntil = now + 0.55;
  }

  /** World position of a monster's head (for effects), if rendered. */
  headOf(id: number): { x: number; y: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    return { x: v.sprite.x, y: v.sprite.y - v.sprite.displayHeight * v.sprite.originY };
  }

  update(monsters: readonly Monster[], alpha: number, now: number, dt: number): void {
    const alive = new Set<number>();
    for (const m of monsters) {
      alive.add(m.id);
      let v = this.views.get(m.id);
      if (!v) {
        v = this.create(m);
        this.views.set(m.id, v);
      }
      const info = monsterSheetInfo(m.def.id);
      let anim = info?.anims.has(m.anim) ? m.anim : 'idle';
      if (!info?.anims.has(anim)) anim = info?.anims.has('fly') ? 'fly' : 'idle';
      if (v.anim !== anim) {
        v.anim = anim;
        v.sprite.play(monsterAnimKey(m.def.id, anim), true);
      }
      const frozen = now < v.freezeUntil;
      if (frozen && !v.sprite.anims.isPaused) v.sprite.anims.pause();
      else if (!frozen && v.sprite.anims.isPaused) v.sprite.anims.resume();

      const x = m.prevX + (m.motor.x - m.prevX) * alpha;
      const y = m.prevY + (m.motor.y - m.prevY) * alpha;
      v.shake = Math.max(0, v.shake - dt * 14);
      const shakeX = frozen ? (Math.floor(now * 60) % 2 === 0 ? 1 : -1) * Math.ceil(v.shake) : 0;
      const windup = m.anim === 'windup' || m.anim.endsWith('_windup');
      const tremble = windup ? (Math.floor(now * 40) % 2 === 0 ? 0.5 : -0.5) : 0;
      v.sprite.setPosition(Math.round((x + shakeX + tremble) * 2) / 2, Math.round(y * 2) / 2);
      v.sprite.setFlipX(m.facing < 0);

      // Tint: hit flash > status color > none.
      if (now < v.flashUntil) v.sprite.setTintFill(0xffffff);
      else {
        let tint: number | null = null;
        for (const s of m.statuses.all) {
          if (s.until > now && STATUS_TINT[s.def.id] !== undefined)
            tint = STATUS_TINT[s.def.id] ?? null;
        }
        if (m.vulnerable > 1 && Math.floor(now * 8) % 2 === 0) tint = 0xffd0a0;
        if (tint !== null) v.sprite.setTint(tint);
        else v.sprite.clearTint();
      }
      const fade = m.alive ? 1 : Math.max(0, 1 - Math.max(0, m.deadTime - 0.45) / 0.6);
      v.sprite.setAlpha(fade);

      const top = y - (info ? info.footY : m.motor.height);
      if (v.glow) {
        v.glow.setPosition(x, y - m.motor.height / 2).setAlpha((m.def.boss ? 0.35 : 0.55) * fade);
      }
      // Telegraph "!".
      v.alert.setVisible(m.alive && now < v.alertUntil);
      if (v.alert.visible)
        v.alert.setPosition(x, top - 2 - Math.sin((v.alertUntil - now) * 20) * 1.5);
      // Stun stars orbiting the head.
      const stunned =
        m.alive && (m.statuses.stunned(now) || m.anim === 'daze' || m.anim === 'stunned');
      v.stars.forEach((s, i) => {
        s.setVisible(stunned);
        if (!stunned) return;
        const a = now * 5 + (i * Math.PI * 2) / 3;
        s.setPosition(x + Math.cos(a) * (m.motor.width * 0.45 + 3), top + 2 + Math.sin(a) * 2);
      });
      // HP bar (hidden for bosses: the HUD shows theirs).
      v.shownHp += (m.hp - v.shownHp) * Math.min(1, dt * 6);
      v.bar.clear();
      if (!m.def.boss && m.alive && now < v.barUntil) {
        const w = Math.max(16, Math.round(m.motor.width * 1.1));
        const bx = Math.round(x - w / 2);
        const by = Math.round(top - 5);
        const k = Math.max(0, m.hp / m.stats.maxHp);
        const lag = Math.max(0, v.shownHp / m.stats.maxHp);
        v.bar.fillStyle(0x140c18, 0.85).fillRect(bx - 1, by - 1, w + 2, 4);
        v.bar.fillStyle(0xffe0a0, 0.9).fillRect(bx, by, Math.round(w * lag), 2);
        v.bar.fillStyle(k > 0.3 ? 0xe0444a : 0xff8a3d, 1).fillRect(bx, by, Math.round(w * k), 2);
      }
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      this.destroyView(v);
      this.views.delete(id);
    }
  }

  private destroyView(v: MonsterSprite): void {
    v.sprite.destroy();
    v.glow?.destroy();
    v.bar.destroy();
    v.alert.destroy();
    for (const s of v.stars) s.destroy();
  }

  destroy(): void {
    for (const v of this.views.values()) this.destroyView(v);
    this.views.clear();
  }
}
