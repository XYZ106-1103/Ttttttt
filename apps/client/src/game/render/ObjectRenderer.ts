import Phaser from 'phaser';
import {
  CHUNK_PIXELS,
  getObjectDef,
  type ObjectChange,
  type ObjectLight,
  TILE_SIZE,
  tileToChunk,
  type World,
  type WorldObject,
} from '@world/shared';
import { objectFrameCount, objectFrameName } from '../art/objects/ObjectArt';
import type { ViewRect } from './ChunkRenderer';
import { flicker } from './flicker';
import { objectAnimKey, TEX } from './textureKeys';

export interface LitObject {
  readonly object: WorldObject;
  readonly light: ObjectLight;
  readonly x: number;
  readonly y: number;
  glow: Phaser.GameObjects.Image | null;
}

interface ChunkObjects {
  sprites: Map<number, Phaser.GameObjects.Sprite>;
  lights: LitObject[];
}

const DEPTH: Record<string, number> = {
  tree_pine: 6,
  tree_oak: 7,
  bush: 8,
};
const DEPTH_BACK = 10;
const DEPTH_FRONT = 40;

/**
 * Streams world-object sprites (trees, flora, props) with the same chunk window as the tiles,
 * rebuilds a chunk's sprites when its objects change, and plays hit / felling feedback.
 * Light-emitting objects also get an additive glow in the unlit overlay layer.
 */
export class ObjectRenderer {
  private readonly chunks = new Map<number, ChunkObjects>();
  private readonly stale = new Set<number>();
  private readonly unsubscribe: () => void;
  buildBudget = 3;
  private spriteCount = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly worldLayer: Phaser.GameObjects.Layer,
    private readonly overlayLayer: Phaser.GameObjects.Layer,
    private readonly world: World,
  ) {
    this.unsubscribe = world.onObjectChange((c) => this.onObjectChange(c));
  }

  get count(): number {
    return this.spriteCount;
  }

  private onObjectChange(change: ObjectChange): void {
    const k = change.cy * this.world.widthChunks + change.cx;
    const chunk = this.chunks.get(k);
    if (!chunk) return;
    const sprite = chunk.sprites.get(change.removed.id);
    if (sprite && change.removed.key.startsWith('tree_')) this.fell(sprite);
    this.stale.add(k);
  }

  /** A felled tree topples away from the player and fades out. */
  private fell(source: Phaser.GameObjects.Sprite): void {
    const ghost = this.scene.make.sprite(
      { x: source.x, y: source.y, key: TEX.objects, frame: source.frame.name },
      false,
    );
    ghost.setOrigin(0.5, 1).setDepth(source.depth).setFlipX(source.flipX);
    this.worldLayer.add(ghost);
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.scene.tweens.add({
      targets: ghost,
      angle: dir * 82,
      alpha: 0,
      duration: 900,
      ease: 'Quad.easeIn',
      onComplete: () => ghost.destroy(),
    });
  }

  /** Brief shake on a hit object (trees being chopped, rocks being mined). */
  shake(object: WorldObject): void {
    const k = tileToChunk(object.ty) * this.world.widthChunks + tileToChunk(object.tx);
    const sprite = this.chunks.get(k)?.sprites.get(object.id);
    if (!sprite) return;
    const baseX = object.tx * TILE_SIZE + TILE_SIZE / 2;
    this.scene.tweens.killTweensOf(sprite);
    sprite.x = baseX;
    this.scene.tweens.add({
      targets: sprite,
      x: { from: baseX + 1.5, to: baseX },
      duration: 160,
      ease: 'Bounce.easeOut',
    });
  }

  update(view: ViewRect, timeSec: number): void {
    const w = this.world;
    const cx0 = Math.max(0, Math.floor(view.left / CHUNK_PIXELS) - 1);
    const cy0 = Math.max(0, Math.floor(view.top / CHUNK_PIXELS) - 1);
    const cx1 = Math.min(
      w.widthChunks - 1,
      Math.floor((view.left + view.width) / CHUNK_PIXELS) + 1,
    );
    const cy1 = Math.min(
      w.heightChunks - 1,
      Math.floor((view.top + view.height) / CHUNK_PIXELS) + 1,
    );

    for (const k of this.stale) {
      const c = this.chunks.get(k);
      if (c) this.release(c);
      this.chunks.delete(k);
    }
    this.stale.clear();

    let built = 0;
    for (let cy = cy0; cy <= cy1 && built < this.buildBudget; cy++) {
      for (let cx = cx0; cx <= cx1 && built < this.buildBudget; cx++) {
        const k = cy * w.widthChunks + cx;
        if (this.chunks.has(k)) continue;
        this.chunks.set(k, this.build(cx, cy));
        built++;
      }
    }
    for (const [k, c] of this.chunks) {
      const cx = k % w.widthChunks;
      const cy = Math.floor(k / w.widthChunks);
      if (cx < cx0 - 2 || cx > cx1 + 2 || cy < cy0 - 2 || cy > cy1 + 2) {
        this.release(c);
        this.chunks.delete(k);
      }
    }
    for (const c of this.chunks.values()) {
      for (const l of c.lights) {
        if (!l.glow) continue;
        const f = flicker(timeSec, l.object.seed, l.light.flicker);
        l.glow.setAlpha(0.32 * f + 0.08).setScale(2.6 * (0.94 + 0.06 * f));
      }
    }
  }

  private release(c: ChunkObjects): void {
    for (const s of c.sprites.values()) s.destroy();
    for (const l of c.lights) l.glow?.destroy();
    this.spriteCount -= c.sprites.size;
  }

  private build(cx: number, cy: number): ChunkObjects {
    const out: ChunkObjects = { sprites: new Map(), lights: [] };
    for (const o of this.world.objectsInChunk(cx, cy)) {
      const def = getObjectDef(o.key);
      const x = o.tx * TILE_SIZE + TILE_SIZE / 2;
      const y = (o.ty + 1) * TILE_SIZE;
      const frames = objectFrameCount(o.key);
      const sprite = this.scene.make.sprite(
        { x, y, key: TEX.objects, frame: objectFrameName(o.key, o.variant, 0) },
        false,
      );
      sprite.setOrigin(0.5, 1);
      sprite.setDepth(DEPTH[o.key] ?? (def.depth === 'front' ? DEPTH_FRONT : DEPTH_BACK));
      if (o.key !== 'campfire' && o.key !== 'signpost' && (o.seed & 4) !== 0) sprite.setFlipX(true);
      if (frames > 1)
        sprite.play({ key: objectAnimKey(o.key, o.variant), startFrame: o.seed % frames });
      this.worldLayer.add(sprite);
      out.sprites.set(o.id, sprite);
      if (def.light) {
        const glow = this.scene.make.image({ x, y: y - 8, key: TEX.glow }, false);
        glow.setBlendMode(Phaser.BlendModes.ADD).setTint(0xffa456).setAlpha(0.35).setScale(2.6);
        this.overlayLayer.add(glow);
        out.lights.push({ object: o, light: def.light, x, y: y - 8, glow });
      }
    }
    this.spriteCount += out.sprites.size;
    return out;
  }

  /** Currently streamed-in light sources. */
  *lights(): Iterable<LitObject> {
    for (const c of this.chunks.values()) yield* c.lights;
  }

  destroy(): void {
    this.unsubscribe();
    for (const c of this.chunks.values()) this.release(c);
    this.chunks.clear();
    this.spriteCount = 0;
  }
}
