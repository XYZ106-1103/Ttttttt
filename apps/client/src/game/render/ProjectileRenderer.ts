import type Phaser from 'phaser';
import type { Projectile } from '@world/shared';
import { combatAnimKey, TEX } from './textureKeys';

interface Visual {
  readonly frame?: string;
  readonly anim?: string;
  readonly rotate: 'velocity' | 'spin' | 'none' | 'flip';
  readonly glow: boolean;
}

const VISUALS: Record<string, Visual> = {
  arrow: { frame: 'arrow', rotate: 'velocity', glow: false },
  arrow_charged: { frame: 'arrow_charged', rotate: 'velocity', glow: true },
  pebble: { frame: 'pebble', rotate: 'spin', glow: false },
  kunai: { frame: 'kunai', rotate: 'velocity', glow: false },
  boulder: { frame: 'boulder', rotate: 'spin', glow: false },
  stalactite: { frame: 'stalactite', rotate: 'none', glow: false },
  magic_bolt: { anim: 'magic_bolt', rotate: 'none', glow: true },
  arcane_bolt: { anim: 'arcane_bolt', rotate: 'none', glow: true },
  fireball: { anim: 'fireball', rotate: 'velocity', glow: true },
  wisp_fire: { anim: 'wisp_fire', rotate: 'none', glow: true },
  shockwave: { anim: 'shockwave', rotate: 'flip', glow: true },
  ice_shard: { anim: 'ice_shard', rotate: 'none', glow: true },
  ice_chunk: { frame: 'ice_chunk', rotate: 'spin', glow: false },
  icicle: { frame: 'icicle', rotate: 'none', glow: false },
  frost_wave: { anim: 'frost_wave', rotate: 'flip', glow: true },
  magma_ball: { frame: 'magma_ball', rotate: 'spin', glow: true },
  meteor: { frame: 'meteor', rotate: 'none', glow: true },
  lava_wave: { anim: 'lava_wave', rotate: 'flip', glow: true },
};

interface ProjectileSprite {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly glow: Phaser.GameObjects.Image | null;
  readonly visual: Visual;
}

/** Sprites for live projectiles. Glowing ones render unlit (overlay) with an additive halo. */
export class ProjectileRenderer {
  private readonly views = new Map<number, ProjectileSprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly overlayLayer: Phaser.GameObjects.Layer,
  ) {}

  update(projectiles: readonly Projectile[], dt: number): void {
    const alive = new Set<number>();
    for (const p of projectiles) {
      if (!p.alive) continue;
      alive.add(p.id);
      let v = this.views.get(p.id);
      if (!v) {
        const visual = VISUALS[p.def.visual] ?? { frame: 'pebble', rotate: 'none', glow: false };
        const sprite = this.scene.make.sprite(
          { x: p.x, y: p.y, key: TEX.combat, frame: visual.frame ?? `${visual.anim}_0` },
          false,
        );
        if (p.def.groundHug) sprite.setOrigin(0.5, 1);
        sprite.setDepth(24);
        if (visual.anim) sprite.play(combatAnimKey(visual.anim));
        let glow: Phaser.GameObjects.Image | null = null;
        if (visual.glow && p.def.light) {
          const [r, g, b] = p.def.light;
          const max = Math.max(r, g, b, 0.001);
          glow = this.scene.make.image({ x: p.x, y: p.y, key: TEX.glow }, false);
          glow
            .setTint(
              ((Math.round((r / max) * 255) << 16) |
                (Math.round((g / max) * 255) << 8) |
                Math.round((b / max) * 255)) >>>
                0,
            )
            .setBlendMode('ADD')
            .setAlpha(0.55)
            .setScale(0.5)
            .setDepth(23);
          this.overlayLayer.add(glow);
        }
        (visual.glow ? this.overlayLayer : this.worldLayer).add(sprite);
        v = { sprite, glow, visual };
        this.views.set(p.id, v);
      }
      v.sprite.setPosition(p.x, p.y);
      switch (v.visual.rotate) {
        case 'velocity':
          v.sprite.setRotation(Math.atan2(p.vy, p.vx));
          break;
        case 'spin':
          v.sprite.rotation += dt * 12 * Math.sign(p.vx || 1);
          break;
        case 'flip':
          v.sprite.setFlipX(p.vx < 0);
          break;
        case 'none':
          break;
      }
      v.glow?.setPosition(p.x, p.def.groundHug ? p.y - 6 : p.y);
    }
    for (const [id, v] of this.views) {
      if (alive.has(id)) continue;
      v.sprite.destroy();
      v.glow?.destroy();
      this.views.delete(id);
    }
  }

  destroy(): void {
    for (const v of this.views.values()) {
      v.sprite.destroy();
      v.glow?.destroy();
    }
    this.views.clear();
  }
}
