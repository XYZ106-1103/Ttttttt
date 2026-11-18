import Phaser from 'phaser';
import { TILE_SIZE, type World } from '@world/shared';
import type { ViewRect } from './ChunkRenderer';
import { LightGrid, type PointLight } from './LightGrid';
import type { LightingPipeline } from './LightingPipeline';
import { TEX } from './textureKeys';

/** Extra tiles of light simulation around the view so off-screen lights still reach in. */
const MARGIN = 12;

/**
 * Owns the light grid, its GPU texture and the lighting post-FX uniforms.
 * Recomputes at a fixed cadence (light changes slowly) or immediately when the view moves to a
 * new tile origin.
 */
export class LightmapRenderer {
  private readonly grid = new LightGrid();
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private imageData: ImageData | null = null;
  private lastX0 = Number.NaN;
  private lastY0 = Number.NaN;
  private frame = 0;
  /** Recompute every N frames even if the view did not move (flicker, day/night). */
  interval = 4;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly world: World,
    private readonly pipeline: LightingPipeline | null,
  ) {}

  update(
    view: ViewRect,
    ambient: readonly [number, number, number],
    lights: readonly PointLight[],
    timeSec = 0,
  ): void {
    const x0 = Math.floor(view.left / TILE_SIZE) - MARGIN;
    const y0 = Math.floor(view.top / TILE_SIZE) - MARGIN;
    const w = Math.ceil(view.width / TILE_SIZE) + MARGIN * 2 + 1;
    const h = Math.ceil(view.height / TILE_SIZE) + MARGIN * 2 + 1;
    this.ensureTexture(w, h);
    this.frame++;
    const moved = x0 !== this.lastX0 || y0 !== this.lastY0;
    if (moved || this.frame % this.interval === 0) {
      this.grid.resize(w, h);
      this.grid.compute(this.world, x0, y0, ambient, lights, timeSec);
      this.upload();
      this.lastX0 = x0;
      this.lastY0 = y0;
    }
    const p = this.pipeline;
    if (p) {
      p.viewOrigin.x = view.left;
      p.viewOrigin.y = view.top;
      p.viewSize.x = view.width;
      p.viewSize.y = view.height;
      p.lightOrigin.x = this.grid.x0 * TILE_SIZE;
      p.lightOrigin.y = this.grid.y0 * TILE_SIZE;
      p.lightSize.x = this.grid.w * TILE_SIZE;
      p.lightSize.y = this.grid.h * TILE_SIZE;
    }
  }

  /** Light level at a world pixel (used to tint unlit-layer things like name tags). */
  sampleAt(px: number, py: number): [number, number, number] {
    return this.grid.sample(Math.floor(px / TILE_SIZE), Math.floor(py / TILE_SIZE));
  }

  private ensureTexture(w: number, h: number): void {
    if (this.texture && this.texture.width === w && this.texture.height === h) return;
    if (this.scene.textures.exists(TEX.lightmap)) this.scene.textures.remove(TEX.lightmap);
    const tex = this.scene.textures.createCanvas(TEX.lightmap, w, h);
    if (!tex) throw new Error('Failed to create lightmap texture');
    tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.texture = tex;
    this.imageData = tex.context.createImageData(w, h);
    this.lastX0 = Number.NaN;
    if (this.pipeline) this.pipeline.lightTexture = tex.source[0]?.glTexture ?? null;
  }

  private upload(): void {
    if (!this.texture || !this.imageData) return;
    this.grid.encode(this.imageData.data);
    this.texture.context.putImageData(this.imageData, 0, 0);
    this.texture.refresh();
    // Phaser re-derives the filter from the global (pixel-art = nearest) setting on every
    // upload; the lightmap must be sampled bilinearly for smooth light gradients.
    this.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
  }

  destroy(): void {
    if (this.pipeline) this.pipeline.lightTexture = null;
    if (this.scene.textures.exists(TEX.lightmap)) this.scene.textures.remove(TEX.lightmap);
    this.texture = null;
  }
}
