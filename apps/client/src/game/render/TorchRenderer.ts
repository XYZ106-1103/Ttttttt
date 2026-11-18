import Phaser from 'phaser';
import { TILE_SIZE } from '@world/shared';
import type { ChunkRenderer } from './ChunkRenderer';
import { flicker } from './flicker';
import { TEX } from './textureKeys';
import { TORCH_ANIM } from './textures';

interface TorchSprite {
  flame: Phaser.GameObjects.Sprite;
  glow: Phaser.GameObjects.Image;
  seed: number;
}

/**
 * Animated, emissive tiles (torches). The light itself comes from the lightmap (tile emission);
 * this renders the flickering flame and a soft additive glow in the unlit overlay layer.
 */
export class TorchRenderer {
  private readonly torches = new Map<string, TorchSprite>();
  private syncedVersion = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly overlay: Phaser.GameObjects.Layer,
    private readonly chunks: ChunkRenderer,
  ) {}

  update(timeSec: number): void {
    if (this.syncedVersion !== this.chunks.animatedVersion) {
      this.syncedVersion = this.chunks.animatedVersion;
      const wanted = new Set<string>();
      for (const t of this.chunks.animatedTiles()) {
        const key = `${t.tx},${t.ty}`;
        wanted.add(key);
        if (this.torches.has(key)) continue;
        const x = t.tx * TILE_SIZE + TILE_SIZE / 2;
        const y = t.ty * TILE_SIZE + TILE_SIZE / 2;
        const flame = this.scene.make
          .sprite({ x, y, key: TEX.fx, frame: 'torch_0' }, false)
          .setDepth(5);
        flame.play({ key: TORCH_ANIM, startFrame: (t.tx + t.ty) & 3 });
        const glow = this.scene.make.image({ x, y: y - 5, key: TEX.glow }, false);
        glow.setBlendMode(Phaser.BlendModes.ADD).setTint(0xffb066).setAlpha(0.3).setScale(1.3);
        this.overlay.add([glow, flame]);
        this.torches.set(key, { flame, glow, seed: (t.tx * 7349) ^ (t.ty * 9151) });
      }
      for (const [key, s] of this.torches) {
        if (wanted.has(key)) continue;
        s.flame.destroy();
        s.glow.destroy();
        this.torches.delete(key);
      }
    }
    for (const s of this.torches.values()) {
      const f = flicker(timeSec, s.seed, 0.2);
      s.glow.setAlpha(0.18 + 0.14 * f).setScale(1.2 + 0.12 * f);
    }
  }

  get count(): number {
    return this.torches.size;
  }

  destroy(): void {
    for (const s of this.torches.values()) {
      s.flame.destroy();
      s.glow.destroy();
    }
    this.torches.clear();
  }
}
