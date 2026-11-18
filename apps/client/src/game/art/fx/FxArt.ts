import { hash2f } from '@world/shared';
import { hex, withAlpha } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import { SpriteAtlasBuilder, type SpriteAtlas } from '../SpriteAtlas';
import { TILE_RECIPES } from '../tiles/tileArt';
import { drawTorch } from '../tiles/TilesetGenerator';

export const TORCH_FRAMES = 4;
export const CRACK_STAGES = 4;

/** Crack overlay for a tile being mined; stage 0 = first hairline, 3 = about to break. */
function crack(stage: number): PixelCanvas {
  const pc = new PixelCanvas(16, 16);
  const ink = withAlpha(hex('#120c10'), 200);
  const lines: [number, number, number, number][] = [
    [8, 8, 3, 4],
    [8, 8, 13, 5],
    [8, 8, 6, 14],
    [8, 8, 14, 12],
    [3, 4, 1, 9],
    [13, 5, 15, 1],
    [6, 14, 2, 12],
    [14, 12, 11, 15],
  ];
  const count = 2 + stage * 2;
  for (let i = 0; i < count && i < lines.length; i++) {
    const [x0, y0, x1, y1] = lines[i] as [number, number, number, number];
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const jitter = hash2f(i, k, 9) < 0.3 ? 1 : 0;
      pc.set(
        Math.round(x0 + (x1 - x0) * t),
        Math.round(y0 + (y1 - y0) * t) + jitter * (k % 2),
        ink,
      );
    }
  }
  if (stage >= 2) pc.set(8, 8, withAlpha(hex('#000000'), 230));
  return pc;
}

/** Small pixel particle sprites (dust, leaves, sparks, fireflies). */
export function generateFxAtlas(): SpriteAtlas {
  const b = new SpriteAtlasBuilder();
  // Dust puffs: 3 sizes.
  [2, 3, 4].forEach((r, i) => {
    const pc = new PixelCanvas(r * 2 + 2, r * 2 + 2);
    pc.fillCircle(r + 0.5, r + 0.5, r, hex('#e9e1d2'));
    pc.fillCircle(r + 1, r + 1.2, r * 0.6, hex('#cfc4b0'));
    b.add(`dust_${i}`, pc);
  });
  // Leaves: two tints.
  ['#62b552', '#d9a441', '#9ad66a'].forEach((c, i) => {
    const pc = new PixelCanvas(4, 3);
    pc.set(1, 0, hex(c));
    pc.set(2, 0, hex(c));
    pc.set(0, 1, hex(c));
    pc.set(1, 1, hex(c));
    pc.set(2, 1, hex('#2f6b3a'));
    pc.set(3, 2, hex('#2f6b3a'));
    b.add(`leaf_${i}`, pc);
  });
  // Spark / ember
  const spark = new PixelCanvas(2, 2);
  spark.fillRect(0, 0, 2, 2, hex('#ffd86a'));
  spark.set(1, 1, hex('#f06a24'));
  b.add('spark', spark);
  // Firefly: bright core with soft halo
  const fly = new PixelCanvas(5, 5);
  fly.set(2, 2, hex('#f6ffb0'));
  for (const [x, y] of [
    [1, 2],
    [3, 2],
    [2, 1],
    [2, 3],
  ] as const) {
    fly.set(x, y, withAlpha(hex('#d8f070'), 150));
  }
  b.add('firefly', fly);
  for (let i = 0; i < CRACK_STAGES; i++) b.add(`crack_${i}`, crack(i));
  const torch = TILE_RECIPES.torch;
  if (torch) {
    for (let f = 0; f < TORCH_FRAMES; f++) {
      const pc = new PixelCanvas(16, 16);
      drawTorch(
        pc,
        torch.ramp.map((c) => hex(c)),
        (torch.accent ?? []).map((c) => hex(c)),
        hex(torch.outline),
        f,
      );
      b.add(`torch_${f}`, pc);
    }
  }
  // Generic pixel
  const px = new PixelCanvas(1, 1);
  px.set(0, 0, hex('#ffffff'));
  b.add('pixel', px);
  return b.build(256);
}

/** Smooth radial glow (sampled with linear filtering, tinted at runtime). */
export function generateGlow(size = 64): PixelCanvas {
  const pc = new PixelCanvas(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      if (d >= 1) continue;
      const a = Math.pow(1 - d, 2.2);
      pc.set(x, y, withAlpha(hex('#ffffff'), Math.round(a * 255)));
    }
  }
  return pc;
}
