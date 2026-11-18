import { PixelCanvas } from './PixelCanvas';

export interface AtlasFrame {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface SpriteAtlas {
  readonly canvas: PixelCanvas;
  readonly frames: readonly AtlasFrame[];
}

/**
 * Shelf packer for procedurally generated sprites. Produces the same shape of data a texture
 * packer JSON atlas would, so hand-drawn atlases can replace generated ones transparently.
 */
export class SpriteAtlasBuilder {
  private readonly items: { name: string; pc: PixelCanvas }[] = [];
  private readonly names = new Set<string>();

  add(name: string, pc: PixelCanvas): this {
    if (this.names.has(name)) throw new Error(`Duplicate atlas frame: ${name}`);
    this.names.add(name);
    this.items.push({ name, pc });
    return this;
  }

  build(maxWidth = 1024, padding = 1): SpriteAtlas {
    const sorted = [...this.items].sort((a, b) => b.pc.height - a.pc.height);
    const frames: AtlasFrame[] = [];
    let x = padding;
    let y = padding;
    let shelf = 0;
    for (const { name, pc } of sorted) {
      if (x + pc.width + padding > maxWidth) {
        x = padding;
        y += shelf + padding;
        shelf = 0;
      }
      frames.push({ name, x, y, w: pc.width, h: pc.height });
      x += pc.width + padding;
      shelf = Math.max(shelf, pc.height);
    }
    const height = y + shelf + padding;
    const canvas = new PixelCanvas(maxWidth, Math.max(1, height));
    const byName = new Map(sorted.map((i) => [i.name, i.pc]));
    for (const f of frames) {
      const pc = byName.get(f.name);
      if (pc) canvas.blit(pc, f.x, f.y);
    }
    return { canvas, frames };
  }
}
