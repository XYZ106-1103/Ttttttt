import { hash2f } from '@world/shared';
import { hex, mix, shade } from '../color';
import { PixelCanvas } from '../PixelCanvas';

/** Campfire flame animation frame count. */
export const CAMPFIRE_FRAMES = 6;

const WOOD = ['#2e1d17', '#4a2f22', '#6b4530', '#8c5d3c'].map((c) => hex(c));
const STONE = ['#3d4354', '#5b6378', '#7b8498'].map((c) => hex(c));
const FIRE = ['#7a1f1a', '#c7381f', '#f06a24', '#f9a63a', '#ffd86a', '#fff6c8'].map((c) => hex(c));

export function generateCampfire(frame: number): PixelCanvas {
  const pc = new PixelCanvas(24, 26);
  const base = 25;
  // Stone ring
  const stones = [3, 7, 12, 16, 20];
  for (const sx of stones) {
    pc.fillEllipse(sx, base - 1, 2.2, 1.6, STONE[1] ?? 0);
    pc.set(sx - 1, base - 2, STONE[2] ?? 0);
  }
  // Crossed logs
  for (let i = 0; i < 12; i++) {
    pc.set(6 + i, base - 2 - Math.floor(i / 3), WOOD[2] ?? 0);
    pc.set(6 + i, base - 1 - Math.floor(i / 3), WOOD[1] ?? 0);
    pc.set(17 - i, base - 2 - Math.floor(i / 3), WOOD[3] ?? 0);
    pc.set(17 - i, base - 1 - Math.floor(i / 3), WOOD[1] ?? 0);
  }
  pc.set(6, base - 2, WOOD[0] ?? 0);
  pc.set(17, base - 2, WOOD[0] ?? 0);
  // Embers in the log pile
  pc.set(11, base - 4, FIRE[3] ?? 0);
  pc.set(12, base - 4, FIRE[2] ?? 0);
  const ring = pc.clone();
  ring.outline(hex('#1a1214'));
  // Flame: layered teardrops, shape varies per frame.
  const flame = new PixelCanvas(24, 26);
  const t = (frame / CAMPFIRE_FRAMES) * Math.PI * 2;
  const layers = [
    { r: 5.2, h: 15, c: FIRE[1] },
    { r: 4.1, h: 12.5, c: FIRE[2] },
    { r: 3.0, h: 9.5, c: FIRE[3] },
    { r: 2.0, h: 6.5, c: FIRE[4] },
    { r: 1.0, h: 3.5, c: FIRE[5] },
  ];
  const fb = base - 4;
  layers.forEach((l, li) => {
    const sway = Math.sin(t + li * 0.7) * 1.2;
    const hh = l.h * (0.9 + 0.12 * Math.sin(t * 2 + li));
    for (let y = 0; y <= hh; y++) {
      const k = y / hh;
      const half = l.r * Math.sqrt(Math.max(0, 1 - k)) * (1 - k * 0.3);
      const cx = 11.5 + sway * k * k;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        // Flickering tongues near the top.
        if (k > 0.55 && hash2f(x, y + frame * 3, li) < (k - 0.55) * 1.2) continue;
        flame.set(x, fb - y, l.c ?? 0);
      }
    }
  });
  // Loose sparks
  const sparkY = fb - 15 - ((frame * 3) % 6);
  flame.set(9 + (frame % 3) * 3, sparkY, FIRE[4] ?? 0);
  pc.blit(ring, 0, 0);
  pc.blit(flame, 0, 0);
  return pc;
}

export function generateSignpost(): PixelCanvas {
  const pc = new PixelCanvas(22, 24);
  const post = WOOD[2] ?? 0;
  pc.fillRect(10, 8, 3, 16, post);
  pc.fillRect(12, 8, 1, 16, WOOD[1] ?? 0);
  pc.fillRect(10, 8, 1, 16, WOOD[3] ?? 0);
  // Board
  const board = hex('#a06c42');
  pc.fillRect(1, 2, 20, 10, board);
  pc.fillRect(1, 2, 20, 1, hex('#c48d5a'));
  pc.fillRect(1, 11, 20, 1, shade(board, -0.3));
  pc.fillRect(1, 6, 20, 1, shade(board, -0.15));
  // Carved "text" strokes
  const ink = hex('#4a2c1e');
  for (const [x, y, w] of [
    [4, 4, 5],
    [10, 4, 7],
    [4, 8, 8],
    [13, 8, 4],
  ] as const) {
    pc.fillRect(x, y, w, 1, ink);
  }
  // Arrow tip pointing right
  pc.set(21, 6, board);
  pc.set(21, 7, board);
  pc.outline(hex('#1c110d'));
  // Grass at the base
  pc.set(9, 23, mix(hex('#43904a'), post, 0.2));
  pc.set(13, 23, hex('#43904a'));
  return pc;
}
