import { hex, withAlpha } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import { SpriteAtlasBuilder, type SpriteAtlas } from '../SpriteAtlas';

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
  // Generic pixel
  const px = new PixelCanvas(1, 1);
  px.set(0, 0, hex('#ffffff'));
  b.add('pixel', px);
  return b.build(128);
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
