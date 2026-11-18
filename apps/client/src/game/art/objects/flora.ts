import { hash2f, Rng } from '@world/shared';
import { hex, mix, shade } from '../color';
import { PixelCanvas } from '../PixelCanvas';

const GRASS = ['#1f4a2e', '#2f6b3a', '#43904a', '#62b552', '#9ad66a'].map((c) => hex(c));
const OUTLINE = hex('#14281c');

/** Number of wind-sway frames generated for swaying plants. */
export const SWAY_FRAMES = 4;
/** Horizontal tip offset per sway frame (a gentle back-and-forth). */
const SWAY_OFFSETS = [0, 1, 0, -1];

interface Blade {
  x: number;
  h: number;
  lean: number;
  tone: number;
}

function drawBlades(pc: PixelCanvas, blades: Blade[], frame: number, outline: boolean): void {
  const sway = SWAY_OFFSETS[frame % SWAY_FRAMES] ?? 0;
  const bottom = pc.height - 1;
  for (const b of blades) {
    for (let i = 0; i < b.h; i++) {
      const t = i / Math.max(1, b.h - 1);
      const x = Math.round(b.x + (b.lean + sway) * t * t * 1.4);
      const y = bottom - i;
      const tone = Math.min(GRASS.length - 1, b.tone + (t > 0.6 ? 1 : 0));
      pc.set(x, y, (i === b.h - 1 ? GRASS[Math.min(4, tone + 1)] : GRASS[tone]) ?? 0);
    }
  }
  if (outline) {
    const copy = pc.clone();
    copy.outline(OUTLINE);
    // Keep the outline only on the sides/top (blades grow out of the grass, no bottom line).
    for (let y = 0; y < pc.height - 1; y++) {
      for (let x = 0; x < pc.width; x++) {
        if (!pc.isOpaque(x, y) && copy.isOpaque(x, y))
          pc.set(x, y, mix(OUTLINE, GRASS[1] ?? 0, 0.25));
      }
    }
  }
}

export function generateGrassTuft(variant: number, frame: number): PixelCanvas {
  const rng = new Rng(4200 + variant * 97);
  const pc = new PixelCanvas(14, 9);
  const blades: Blade[] = [];
  const count = rng.int(4, 6);
  for (let i = 0; i < count; i++) {
    blades.push({
      x: 2 + Math.round((i / (count - 1)) * 9) + rng.int(-1, 1),
      h: rng.int(3, 7),
      lean: rng.range(-1.2, 1.2),
      tone: rng.int(1, 2),
    });
  }
  drawBlades(pc, blades, frame + variant, true);
  return pc;
}

export function generateTallGrass(variant: number, frame: number): PixelCanvas {
  const rng = new Rng(4600 + variant * 53);
  const pc = new PixelCanvas(16, 16);
  const blades: Blade[] = [];
  const count = rng.int(5, 7);
  for (let i = 0; i < count; i++) {
    blades.push({
      x: 2 + Math.round((i / (count - 1)) * 11) + rng.int(-1, 1),
      h: rng.int(7, 14),
      lean: rng.range(-2, 2),
      tone: rng.int(2, 3),
    });
  }
  drawBlades(pc, blades, frame + variant * 2, true);
  return pc;
}

const PETALS = ['#f05d6c', '#f6c945', '#f4f1ea', '#a77ae6', '#5fa8f0'].map((c) => hex(c));

export function generateFlower(variant: number, frame: number): PixelCanvas {
  const pc = new PixelCanvas(9, 12);
  const sway = SWAY_OFFSETS[(frame + variant) % SWAY_FRAMES] ?? 0;
  const petal = PETALS[variant % PETALS.length] ?? 0;
  const stemH = 6 + (variant % 3);
  const bottom = pc.height - 1;
  let topX = 4;
  for (let i = 0; i < stemH; i++) {
    const t = i / stemH;
    const x = Math.round(4 + sway * t * t);
    pc.set(x, bottom - i, (i < 2 ? GRASS[1] : GRASS[2]) ?? 0);
    topX = x;
  }
  // Leaf
  pc.set(3, bottom - 2, GRASS[3] ?? 0);
  pc.set(2, bottom - 3, GRASS[2] ?? 0);
  const fy = bottom - stemH;
  const light = shade(petal, 0.3);
  const dark = shade(petal, -0.3);
  pc.set(topX, fy - 1, light);
  pc.set(topX - 1, fy, petal);
  pc.set(topX + 1, fy, dark);
  pc.set(topX, fy + 1, dark);
  pc.set(topX, fy, hex('#f8d24a'));
  pc.set(topX - 1, fy - 1, mix(petal, light, 0.5));
  pc.set(topX + 1, fy - 1, petal);
  pc.outline(mix(OUTLINE, dark, 0.3));
  return pc;
}

export function generateRock(variant: number): PixelCanvas {
  const rng = new Rng(5100 + variant * 11);
  const w = 12 + variant * 2;
  const h = 7 + variant;
  const pc = new PixelCanvas(w, h);
  const base = ['#3d4354', '#525a6e', '#6b7488', '#8a93a6'].map((c) => hex(c));
  pc.fillEllipse(w / 2 - 0.5, h - 1, w / 2 - 1.2, h - 1.5, base[1] ?? 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!pc.isOpaque(x, y)) continue;
      const lx = (x - w * 0.35) / w;
      const ly = (y - h * 0.3) / h;
      const lit = 1 - Math.hypot(lx, ly) * 2.2 + (hash2f(x, y, variant) - 0.5) * 0.3;
      pc.set(x, y, (lit > 0.55 ? base[3] : lit > 0.15 ? base[2] : base[1]) ?? 0);
    }
  }
  if (rng.chance(0.7)) pc.set(Math.round(w * 0.6), h - 3, base[0] ?? 0);
  // Moss tuft
  pc.set(Math.round(w * 0.3), 1, GRASS[3] ?? 0);
  pc.set(Math.round(w * 0.3) + 1, 1, GRASS[2] ?? 0);
  pc.outline(hex('#1e2130'));
  return pc;
}

export function generateMushroom(variant: number): PixelCanvas {
  const pc = new PixelCanvas(9, 9);
  const cap = variant === 0 ? hex('#d8434e') : hex('#c98a4a');
  pc.fillRect(3, 5, 3, 4, hex('#efe3cf'));
  pc.set(5, 6, hex('#c9b89c'));
  pc.fillEllipse(4, 4, 3.6, 2.4, cap);
  pc.set(2, 3, shade(cap, 0.35));
  pc.set(3, 2, shade(cap, 0.35));
  if (variant === 0) {
    pc.set(4, 3, hex('#ffffff'));
    pc.set(6, 4, hex('#ffffff'));
  }
  for (let x = 1; x <= 7; x++) if (pc.get(x, 5) === cap) pc.set(x, 5, shade(cap, -0.3));
  pc.outline(hex('#2a1418'));
  return pc;
}
