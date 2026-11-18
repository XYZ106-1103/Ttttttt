import { hash2f, Rng } from '@world/shared';
import { type Color, hex, mix } from '../color';
import { PixelCanvas } from '../PixelCanvas';

const LEAF_OAK = ['#1d3d2c', '#27553a', '#336f43', '#46894b', '#66a957', '#94c96a'].map((c) =>
  hex(c),
);
const LEAF_PINE = ['#142c2a', '#1c3d36', '#255044', '#326552', '#457e62'].map((c) => hex(c));
const BARK = ['#2e1d17', '#4a2f22', '#64412d', '#7e563a', '#986c49'].map((c) => hex(c));
const OUTLINE_LEAF = hex('#11231c');
const OUTLINE_BARK = hex('#1c110d');

interface Blob {
  x: number;
  y: number;
  r: number;
}

function drawTrunk(
  pc: PixelCanvas,
  cx: number,
  bottom: number,
  top: number,
  baseW: number,
  rng: Rng,
): void {
  for (let y = top; y <= bottom; y++) {
    const t = (y - top) / Math.max(1, bottom - top);
    const flare = t > 0.82 ? Math.round((t - 0.82) * 18) : 0;
    const w = Math.round(baseW * (0.7 + 0.3 * t)) + flare;
    const x0 = Math.round(cx - w / 2);
    for (let x = x0; x < x0 + w; x++) {
      const u = (x - x0) / Math.max(1, w - 1);
      let c = u < 0.25 ? BARK[3] : u > 0.75 ? BARK[1] : BARK[2];
      // Vertical bark streaks.
      if (hash2f(x * 3, Math.floor(y / 3), 77) < 0.18) c = BARK[1];
      if (u < 0.15 && hash2f(x, y, 5) < 0.4) c = BARK[4];
      pc.set(x, y, c ?? 0);
    }
  }
  // Root bumps.
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1;
    const len = rng.int(2, 4);
    for (let k = 0; k < len; k++) {
      pc.set(Math.round(cx + dir * (baseW / 2 + k + 1)), bottom - Math.floor(k / 2), BARK[2] ?? 0);
      pc.set(Math.round(cx + dir * (baseW / 2 + k + 1)), bottom, BARK[1] ?? 0);
    }
  }
}

function drawBranch(pc: PixelCanvas, x0: number, y0: number, x1: number, y1: number): void {
  pc.line(x0, y0, x1, y1, BARK[2] ?? 0);
  pc.line(x0, y0 + 1, x1, y1 + 1, BARK[1] ?? 0);
}

/** Leafy canopy from overlapping blobs with directional shading and a bumpy silhouette. */
function drawCanopy(pc: PixelCanvas, blobs: Blob[], leaf: Color[], seed: number): void {
  const n = leaf.length;
  for (let y = 0; y < pc.height; y++) {
    for (let x = 0; x < pc.width; x++) {
      let best = -Infinity;
      let lit = 0;
      for (const b of blobs) {
        const dx = x + 0.5 - b.x;
        const dy = y + 0.5 - b.y;
        const ang = Math.atan2(dy, dx);
        const bump = 1 + 0.12 * Math.sin(ang * 7 + b.x) + 0.08 * Math.sin(ang * 13 + b.y);
        const d = Math.hypot(dx, dy) / (b.r * bump);
        if (d > 1) continue;
        const score = 1 - d;
        if (score > best) {
          best = score;
          // Light from the upper-left; deeper/lower parts of each blob are darker.
          const l = (-dx * 0.55 - dy * 0.8) / b.r;
          lit = l * 0.5 + 0.5 - (b.y / pc.height) * 0.25;
        }
      }
      if (best === -Infinity) continue;
      const dither = (hash2f(x, y, seed) - 0.5) * 0.18;
      const idx = Math.max(1, Math.min(n - 1, Math.floor((lit + dither) * (n - 0.5)) + 1));
      let c = leaf[idx] ?? leaf[2] ?? 0;
      // Leaf clusters: sparse brighter specks on lit side, darker holes on the shadow side.
      const r = hash2f(x * 7, y * 5, seed + 1);
      if (r < 0.04 && idx >= n - 3) c = leaf[n - 1] ?? c;
      else if (r > 0.97 && idx <= 2) c = leaf[0] ?? c;
      pc.set(x, y, c);
    }
  }
}

export function generateOak(variant: number): PixelCanvas {
  const rng = new Rng(9100 + variant * 31);
  const w = 64;
  const h = 92;
  const pc = new PixelCanvas(w, h);
  const cx = w / 2;
  const trunkTop = rng.int(30, 38);
  drawTrunk(pc, cx, h - 1, trunkTop, rng.int(6, 8), rng);
  drawBranch(pc, cx - 1, trunkTop + 14, cx - 10, trunkTop + 4);
  drawBranch(pc, cx + 1, trunkTop + 10, cx + 9, trunkTop + 2);
  const canopy = new PixelCanvas(w, h);
  const blobs: Blob[] = [
    { x: cx, y: 24, r: rng.range(15, 18) },
    { x: cx - 13, y: 33, r: rng.range(11, 13) },
    { x: cx + 13, y: 31, r: rng.range(11, 13) },
    { x: cx - 6, y: 15, r: rng.range(10, 12) },
    { x: cx + 7, y: 14, r: rng.range(9, 11) },
    { x: cx + rng.range(-4, 4), y: 38, r: rng.range(10, 12) },
  ];
  drawCanopy(canopy, blobs, LEAF_OAK, 300 + variant);
  canopy.outline(OUTLINE_LEAF);
  pc.outline(OUTLINE_BARK);
  pc.blit(canopy, 0, 0);
  return pc;
}

export function generatePine(variant: number): PixelCanvas {
  const rng = new Rng(9500 + variant * 17);
  const w = 46;
  const h = 104;
  const pc = new PixelCanvas(w, h);
  const cx = w / 2;
  drawTrunk(pc, cx, h - 1, 40, 5, rng);
  const foliage = new PixelCanvas(w, h);
  const tiers = 5;
  const top = 4;
  const bottom = h - 18;
  for (let t = 0; t < tiers; t++) {
    const ty0 = top + Math.round(((bottom - top) * t) / (tiers + 0.6));
    const ty1 = ty0 + Math.round((bottom - top) / tiers) + 8;
    const maxHalf = 6 + t * 3.6 + rng.range(-1, 1);
    for (let y = ty0; y <= ty1; y++) {
      const k = (y - ty0) / (ty1 - ty0);
      const half = maxHalf * Math.pow(k, 0.85);
      // Drooping, jagged tier edge.
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        const edge = Math.abs(x - cx) / Math.max(1, half);
        if (k > 0.85 && hash2f(x, y, 41 + variant) < (k - 0.85) * 5 * edge) continue;
        const lit = ((cx - x) / Math.max(1, half)) * 0.5 + 0.5 - k * 0.35;
        const dither = (hash2f(x, y, 7 + variant) - 0.5) * 0.25;
        const idx = Math.max(1, Math.min(LEAF_PINE.length - 1, Math.floor((lit + dither) * 4) + 1));
        foliage.set(x, y, LEAF_PINE[idx] ?? 0);
      }
    }
    // Shadow line under each tier.
    for (let x = 0; x < w; x++) {
      if (foliage.isOpaque(x, ty1) && !foliage.isOpaque(x, ty1 + 1)) {
        foliage.set(x, ty1, LEAF_PINE[0] ?? 0);
      }
    }
  }
  // Snow-free tip highlight.
  foliage.set(Math.round(cx), top, LEAF_PINE[4] ?? 0);
  foliage.outline(OUTLINE_LEAF);
  pc.outline(OUTLINE_BARK);
  pc.blit(foliage, 0, 0);
  return pc;
}

export function generateBush(variant: number): PixelCanvas {
  const rng = new Rng(9900 + variant * 13);
  const pc = new PixelCanvas(28, 18);
  const blobs: Blob[] = [
    { x: 14, y: 11, r: rng.range(7, 8) },
    { x: 7, y: 13, r: rng.range(5, 6) },
    { x: 21, y: 13, r: rng.range(5, 6) },
  ];
  drawCanopy(pc, blobs, LEAF_OAK, 700 + variant);
  // Berries on some variants.
  if (variant === 1) {
    for (let i = 0; i < 5; i++) {
      const x = rng.int(6, 22);
      const y = rng.int(8, 15);
      if (pc.isOpaque(x, y)) {
        pc.set(x, y, hex('#d8434e'));
        pc.set(x - 1, y - 1, hex('#ff8a8a'));
      }
    }
  }
  pc.outline(OUTLINE_LEAF);
  // Flatten the bottom so it sits on the ground.
  for (let x = 0; x < pc.width; x++)
    if (pc.isOpaque(x, 16)) pc.set(x, 17, mix(OUTLINE_LEAF, LEAF_OAK[0] ?? 0, 0.5));
  return pc;
}
