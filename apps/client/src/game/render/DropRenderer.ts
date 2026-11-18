import type Phaser from 'phaser';
import type { DropEntity } from '../sim/GameSimulation';
import { TEX } from './textureKeys';

/** Sprites for item drops lying in the world, with a gentle bob while resting. */
export class DropRenderer {
  private readonly sprites = new Map<number, Phaser.GameObjects.Image>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
  ) {}

  update(drops: readonly DropEntity[], timeSec: number): void {
    const alive = new Set<number>();
    for (const d of drops) {
      alive.add(d.id);
      let s = this.sprites.get(d.id);
      if (!s) {
        s = this.scene.make.image({ x: d.x, y: d.y, key: TEX.items, frame: d.itemId }, false);
        s.setOrigin(0.5, 1).setDepth(22).setScale(0.75);
        this.layer.add(s);
        this.sprites.set(d.id, s);
      }
      const bob = d.magnet ? 0 : Math.sin(timeSec * 3 + d.id) * 1.2 - 1;
      s.setPosition(Math.round(d.x * 2) / 2, Math.round((d.y + bob) * 2) / 2);
    }
    for (const [id, s] of this.sprites) {
      if (alive.has(id)) continue;
      s.destroy();
      this.sprites.delete(id);
    }
  }

  destroy(): void {
    for (const s of this.sprites.values()) s.destroy();
    this.sprites.clear();
  }
}
