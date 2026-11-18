import { COLLISION_NONE, type World } from '@world/shared';
import { flicker } from './flicker';

export interface PointLight {
  readonly tx: number;
  readonly ty: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Encoded light range: byte 255 = this much light (allows over-bright warm light sources). */
export const LIGHT_RANGE = 2;

/**
 * Per-tile RGB light propagation (Terraria-style). Open sky seeds ambient light, point lights
 * seed their color, and light spreads through 4-neighborhood sweeps, attenuated by each tile's
 * `lightPass`. Pure and engine-free — the renderer uploads `encode()`'s bytes as a texture.
 */
export class LightGrid {
  w = 0;
  h = 0;
  x0 = 0;
  y0 = 0;
  r = new Float32Array(0);
  g = new Float32Array(0);
  b = new Float32Array(0);
  private pass = new Float32Array(0);

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    const n = w * h;
    this.r = new Float32Array(n);
    this.g = new Float32Array(n);
    this.b = new Float32Array(n);
    this.pass = new Float32Array(n);
  }

  compute(
    world: World,
    x0: number,
    y0: number,
    ambient: readonly [number, number, number],
    lights: readonly PointLight[],
    timeSec = 0,
  ): void {
    this.x0 = x0;
    this.y0 = y0;
    const { w, h, r, g, b, pass } = this;
    const tiles = world.tiles;
    for (let y = 0; y < h; y++) {
      const ty = y0 + y;
      for (let x = 0; x < w; x++) {
        const tx = x0 + x;
        const i = y * w + x;
        let lit = false;
        if (ty < 0) {
          pass[i] = 1;
          lit = true;
        } else if (!world.inTileBounds(tx, ty)) {
          pass[i] = 0.5;
        } else {
          const fg = world.getFg(tx, ty);
          pass[i] = tiles.lightPass[fg] ?? 1;
          lit = (tiles.collision[fg] ?? 0) === COLLISION_NONE && world.getBg(tx, ty) === 0;
          const emit = fg !== 0 ? tiles.get(fg)?.light : undefined;
          if (emit) {
            const f = flicker(timeSec, (tx * 73856093) ^ (ty * 19349663), 0.12);
            r[i] = Math.max(lit ? ambient[0] : 0, emit[0] * f);
            g[i] = Math.max(lit ? ambient[1] : 0, emit[1] * f);
            b[i] = Math.max(lit ? ambient[2] : 0, emit[2] * f);
            continue;
          }
        }
        r[i] = lit ? ambient[0] : 0;
        g[i] = lit ? ambient[1] : 0;
        b[i] = lit ? ambient[2] : 0;
      }
    }
    for (const l of lights) {
      const x = l.tx - x0;
      const y = l.ty - y0;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x;
      r[i] = Math.max(r[i] ?? 0, l.r);
      g[i] = Math.max(g[i] ?? 0, l.g);
      b[i] = Math.max(b[i] ?? 0, l.b);
    }
    for (let iter = 0; iter < 2; iter++) {
      this.sweep(r);
      this.sweep(g);
      this.sweep(b);
    }
  }

  private sweep(v: Float32Array): void {
    const { w, h, pass } = this;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 1; x < w; x++) {
        const i = row + x;
        const c = (v[i - 1] ?? 0) * (pass[i - 1] ?? 0);
        if (c > (v[i] ?? 0)) v[i] = c;
      }
      for (let x = w - 2; x >= 0; x--) {
        const i = row + x;
        const c = (v[i + 1] ?? 0) * (pass[i + 1] ?? 0);
        if (c > (v[i] ?? 0)) v[i] = c;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 1; y < h; y++) {
        const i = y * w + x;
        const c = (v[i - w] ?? 0) * (pass[i - w] ?? 0);
        if (c > (v[i] ?? 0)) v[i] = c;
      }
      for (let y = h - 2; y >= 0; y--) {
        const i = y * w + x;
        const c = (v[i + w] ?? 0) * (pass[i + w] ?? 0);
        if (c > (v[i] ?? 0)) v[i] = c;
      }
    }
  }

  /** Light at a tile (0 outside the grid). */
  sample(tx: number, ty: number): [number, number, number] {
    const x = tx - this.x0;
    const y = ty - this.y0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0];
    const i = y * this.w + x;
    return [this.r[i] ?? 0, this.g[i] ?? 0, this.b[i] ?? 0];
  }

  /** Write RGBA bytes (value / LIGHT_RANGE * 255). */
  encode(out: Uint8ClampedArray): void {
    const k = 255 / LIGHT_RANGE;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      out[i * 4] = (this.r[i] ?? 0) * k;
      out[i * 4 + 1] = (this.g[i] ?? 0) * k;
      out[i * 4 + 2] = (this.b[i] ?? 0) * k;
      out[i * 4 + 3] = 255;
    }
  }
}
