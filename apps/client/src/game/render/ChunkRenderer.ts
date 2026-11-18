import type Phaser from 'phaser';
import {
  CHUNK_PIXELS,
  CHUNK_SIZE,
  type Chunk,
  localIndex,
  TILE_SIZE,
  type World,
} from '@world/shared';
import {
  fringeFrameIndex,
  TILE_VARIANTS,
  type Tileset,
  tileFrameIndex,
} from '../art/tiles/TilesetGenerator';
import { bgMask, fgMask, SIDE_OFFSETS, tileVariant } from '../world/autotile';
import { TEX } from './textureKeys';

export interface ViewRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface ChunkView {
  rt: Phaser.GameObjects.RenderTexture | null;
  version: number;
}

/** Background walls are drawn darker so foreground terrain reads clearly in front of them. */
const WALL_TINT = 0x8a8a9a;

/**
 * Streams chunk visuals in and out around the camera. Each non-empty chunk is baked once into
 * a RenderTexture (one draw call per chunk per frame) and re-baked only when its data version
 * changes. Builds are budgeted per frame to avoid hitches while moving fast.
 */
export class ChunkRenderer {
  private readonly views = new Map<number, ChunkView>();
  private readonly queue: number[] = [];
  private readonly queued = new Set<number>();
  /** Max chunk bakes per frame. */
  buildBudget = 2;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layer: Phaser.GameObjects.Layer,
    private readonly world: World,
    private readonly tileset: Tileset,
    private readonly depth = 0,
  ) {}

  get renderedCount(): number {
    let n = 0;
    for (const v of this.views.values()) if (v.rt) n++;
    return n;
  }

  private key(cx: number, cy: number): number {
    return cy * this.world.widthChunks + cx;
  }

  update(view: ViewRect): void {
    const margin = 1;
    const cx0 = Math.max(0, Math.floor(view.left / CHUNK_PIXELS) - margin);
    const cy0 = Math.max(0, Math.floor(view.top / CHUNK_PIXELS) - margin);
    const cx1 = Math.min(
      this.world.widthChunks - 1,
      Math.floor((view.left + view.width) / CHUNK_PIXELS) + margin,
    );
    const cy1 = Math.min(
      this.world.heightChunks - 1,
      Math.floor((view.top + view.height) / CHUNK_PIXELS) + margin,
    );

    // Queue missing or outdated chunks, nearest to the view center first.
    const centerX = (view.left + view.width / 2) / CHUNK_PIXELS;
    const centerY = (view.top + view.height / 2) / CHUNK_PIXELS;
    const wanted: { k: number; d: number }[] = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = this.key(cx, cy);
        const chunk = this.world.getChunk(cx, cy);
        const v = this.views.get(k);
        if (!chunk || (v && v.version === chunk.version) || this.queued.has(k)) continue;
        wanted.push({ k, d: Math.hypot(cx + 0.5 - centerX, cy + 0.5 - centerY) });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    for (const w of wanted) {
      this.queue.push(w.k);
      this.queued.add(w.k);
    }

    for (let i = 0; i < this.buildBudget && this.queue.length > 0; i++) {
      const k = this.queue.shift() as number;
      this.queued.delete(k);
      const cx = k % this.world.widthChunks;
      const cy = Math.floor(k / this.world.widthChunks);
      // Skip if it scrolled far out of range before we got to it.
      if (cx < cx0 - 1 || cx > cx1 + 1 || cy < cy0 - 1 || cy > cy1 + 1) continue;
      this.bake(cx, cy);
    }

    // Unload chunks well outside the view (hysteresis of 2 chunks avoids thrashing).
    for (const [k, v] of this.views) {
      const cx = k % this.world.widthChunks;
      const cy = Math.floor(k / this.world.widthChunks);
      if (cx < cx0 - 2 || cx > cx1 + 2 || cy < cy0 - 2 || cy > cy1 + 2) {
        v.rt?.destroy();
        this.views.delete(k);
      }
    }
  }

  /** Force every visible chunk to be rebaked (e.g. after a tileset change). */
  invalidateAll(): void {
    for (const v of this.views.values()) v.version = -1;
  }

  private isEmpty(chunk: Chunk): boolean {
    for (let i = 0; i < chunk.fg.length; i++) if (chunk.fg[i] || chunk.bg[i]) return false;
    return true;
  }

  private bake(cx: number, cy: number): void {
    const chunk = this.world.getChunk(cx, cy);
    if (!chunk) return;
    const k = this.key(cx, cy);
    let v = this.views.get(k);
    if (!v) {
      v = { rt: null, version: -1 };
      this.views.set(k, v);
    }
    v.version = chunk.version;
    if (this.isEmpty(chunk)) {
      v.rt?.destroy();
      v.rt = null;
      return;
    }
    if (!v.rt) {
      v.rt = this.scene.make.renderTexture(
        { x: cx * CHUNK_PIXELS, y: cy * CHUNK_PIXELS, width: CHUNK_PIXELS, height: CHUNK_PIXELS },
        false,
      );
      v.rt.setOrigin(0, 0).setDepth(this.depth);
      this.layer.add(v.rt);
    }
    const rt = v.rt;
    rt.clear();
    rt.beginDraw();
    const tx0 = cx * CHUNK_SIZE;
    const ty0 = cy * CHUNK_SIZE;
    const w = this.world;
    const ts = this.tileset;
    // Pass 1: background walls (only where no solid foreground hides them).
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = localIndex(lx, ly);
        const id = chunk.bg[i] ?? 0;
        if (!id) continue;
        const fg = chunk.fg[i] ?? 0;
        if (fg && (w.tiles.collision[fg] ?? 0) === 1 && fgMask(w, tx0 + lx, ty0 + ly, fg) === 15)
          continue;
        const tx = tx0 + lx;
        const ty = ty0 + ly;
        const frame = tileFrameIndex(
          ts,
          id,
          bgMask(w, tx, ty, id),
          tileVariant(tx, ty, TILE_VARIANTS),
        );
        if (frame >= 0)
          rt.batchDrawFrame(TEX.tiles, frame, lx * TILE_SIZE, ly * TILE_SIZE, 1, WALL_TINT);
      }
    }
    // Pass 2: foreground terrain + material fringes.
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const id = chunk.fg[localIndex(lx, ly)] ?? 0;
        if (!id) continue;
        const tx = tx0 + lx;
        const ty = ty0 + ly;
        const variant = tileVariant(tx, ty, TILE_VARIANTS);
        const frame = tileFrameIndex(ts, id, fgMask(w, tx, ty, id), variant);
        if (frame < 0) continue;
        rt.batchDrawFrame(TEX.tiles, frame, lx * TILE_SIZE, ly * TILE_SIZE);
        for (let side = 0; side < 4; side++) {
          const off = SIDE_OFFSETS[side] as readonly [number, number];
          const n = w.getFg(tx + off[0], ty + off[1]);
          if (n === id || !w.tiles.connects(id, n)) continue;
          const fi = fringeFrameIndex(ts, n, side, variant);
          if (fi >= 0) rt.batchDrawFrame(TEX.tiles, fi, lx * TILE_SIZE, ly * TILE_SIZE);
        }
      }
    }
    rt.endDraw();
  }

  destroy(): void {
    for (const v of this.views.values()) v.rt?.destroy();
    this.views.clear();
    this.queue.length = 0;
    this.queued.clear();
  }
}
