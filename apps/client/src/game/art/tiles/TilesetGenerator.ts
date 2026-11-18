import { hash2, hash2f, Rng, type TileRegistry } from '@world/shared';
import { type Color, hex, mix, shade, TRANSPARENT } from '../color';
import { PixelCanvas } from '../PixelCanvas';
import { TILE_RECIPES, type TileRecipe } from './tileArt';

/**
 * Autotile neighbor mask bits: a bit is SET when the neighbor on that side connects
 * (same merge group). Exposed sides get outlines, highlights and grass.
 */
export const MASK_N = 1;
export const MASK_E = 2;
export const MASK_S = 4;
export const MASK_W = 8;
export const TILE_VARIANTS = 3;
const T = 16;
const FRAMES_PER_TILE = 16 * TILE_VARIANTS;

export interface Tileset {
  readonly canvas: PixelCanvas;
  /** Atlas row for each tile id, -1 if the tile has no art (air). */
  readonly slotOf: Int16Array;
  /** Fringe slot for tile ids that spill over neighboring tiles of the same merge group. */
  readonly fringeOf: Int16Array;
  /** Frame index where fringe frames start. */
  readonly fringeBase: number;
  readonly frameCount: number;
}

/** Side indices for fringe frames (direction from the receiving tile toward the spilling one). */
export const SIDE_N = 0;
export const SIDE_E = 1;
export const SIDE_S = 2;
export const SIDE_W = 3;
const FRINGE_FRAMES = 4 * TILE_VARIANTS;

/** Frame index of a fringe overlay, or -1 if the tile has none. */
export function fringeFrameIndex(
  ts: Tileset,
  tileId: number,
  side: number,
  variant: number,
): number {
  const slot = ts.fringeOf[tileId] ?? -1;
  if (slot < 0) return -1;
  return ts.fringeBase + slot * FRINGE_FRAMES + side * TILE_VARIANTS + variant;
}

/** Atlas frame index for a tile id + mask + variant, or -1. */
export function tileFrameIndex(ts: Tileset, tileId: number, mask: number, variant: number): number {
  const slot = ts.slotOf[tileId] ?? -1;
  if (slot < 0) return -1;
  return slot * FRAMES_PER_TILE + mask * TILE_VARIANTS + variant;
}

/** Pixel position of a frame in the atlas. */
export function tileFrameRect(index: number): { x: number; y: number } {
  const slot = Math.floor(index / FRAMES_PER_TILE);
  const col = index % FRAMES_PER_TILE;
  return { x: col * T, y: slot * T };
}

type Pal = Color[];

function smoothNoise(x: number, y: number, seed: number, scale: number): number {
  // Tileable (period 16) bilinear value noise.
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const p = Math.round(T / scale);
  const wrap = (v: number): number => ((v % p) + p) % p;
  const v = (ix: number, iy: number): number => hash2f(wrap(ix), wrap(iy), seed) * 2 - 1;
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function soilBase(pc: PixelCanvas, pal: Pal, seed: number): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = smoothNoise(x, y, seed, 8) * 0.55 + smoothNoise(x, y, seed + 9, 4) * 0.45;
      const speck = hash2f(x, y, seed + 17);
      let c = n < -0.34 ? pal[1] : n > 0.38 ? pal[3] : pal[2];
      if (speck < 0.06) c = pal[1];
      else if (speck > 0.95) c = pal[3];
      pc.set(x, y, c ?? 0);
    }
  }
  // Pebbles: small dark clusters with a lit top-left pixel.
  const rng = new Rng(seed);
  const count = rng.int(2, 3);
  for (let i = 0; i < count; i++) {
    const px = rng.int(2, 12);
    const py = rng.int(2, 12);
    const w = rng.int(1, 2);
    pc.fillRect(px, py, w + 1, 1, pal[1] ?? 0);
    pc.set(px, py, pal[4] ?? 0);
    if (rng.chance(0.5)) pc.set(px + 1, py + 1, pal[0] ?? 0);
  }
}

function stoneBase(pc: PixelCanvas, pal: Pal, outline: Color, seed: number): void {
  // Wrapped Voronoi cobbles with bevels.
  const rng = new Rng(seed);
  const pts: [number, number, number][] = [];
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) pts.push([rng.range(0, T), rng.range(0, T), rng.int(1, 3)]);
  const cell = new Int8Array(T * T);
  const edge = new Uint8Array(T * T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best = 0;
      pts.forEach(([px, py], i) => {
        for (let oy = -T; oy <= T; oy += T) {
          for (let ox = -T; ox <= T; ox += T) {
            const d = Math.hypot(x + 0.5 - (px + ox), (y + 0.5 - (py + oy)) * 1.25);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = i;
            } else if (d < d2) d2 = d;
          }
        }
      });
      cell[y * T + x] = best;
      edge[y * T + x] = d2 - d1 < 1.1 ? 1 : 0;
    }
  }
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const i = y * T + x;
      const tone = pts[cell[i] ?? 0]?.[2] ?? 2;
      let c = pal[tone] ?? pal[2] ?? 0;
      if (edge[i]) c = mix(pal[1] ?? 0, outline, 0.25);
      else {
        const up = y > 0 ? edge[(y - 1) * T + x] : 0;
        const left = x > 0 ? edge[y * T + x - 1] : 0;
        const down = y < T - 1 ? edge[(y + 1) * T + x] : 0;
        if (up || left) c = shade(c, 0.1);
        else if (down) c = shade(c, -0.14);
        const grain = smoothNoise(x, y, seed + 3, 4);
        if (grain > 0.5) c = shade(c, 0.06);
        else if (grain < -0.5) c = shade(c, -0.08);
      }
      pc.set(x, y, c);
    }
  }
}

function wallBase(pc: PixelCanvas, pal: Pal, seed: number): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const n = smoothNoise(x, y, seed, 8) * 0.6 + smoothNoise(x, y, seed + 5, 4) * 0.4;
      // Faint brick-like horizontal strata.
      const band = (y + (x > 7 ? 4 : 0)) % 8 === 0 ? -0.5 : 0;
      const v = n + band;
      pc.set(x, y, (v < -0.35 ? pal[1] : v > 0.35 ? pal[3] : pal[2]) ?? 0);
    }
  }
}

function planksBase(pc: PixelCanvas, pal: Pal, seed: number): void {
  for (let y = 0; y < T; y++) {
    const board = Math.floor(y / 4);
    const joint = (hash2(board, 0, seed) % 10) + 3;
    for (let x = 0; x < T; x++) {
      let c = pal[2] ?? 0;
      const grain = smoothNoise(x * 0.25, y * 2, seed + board, 2);
      if (grain > 0.45) c = pal[3] ?? c;
      else if (grain < -0.5) c = pal[1] ?? c;
      if (y % 4 === 0) c = pal[3] ?? c;
      if (y % 4 === 3) c = pal[1] ?? c;
      if (x === joint) c = pal[0] ?? c;
      pc.set(x, y, c);
    }
  }
}

/** Apply outline, bevel highlights and rounded corners for exposed sides. */
function applyEdges(pc: PixelCanvas, mask: number, pal: Pal, outline: Color, soft = false): void {
  const n = !(mask & MASK_N);
  const e = !(mask & MASK_E);
  const s = !(mask & MASK_S);
  const w = !(mask & MASK_W);
  const light = pal[4] ?? 0;
  const dark = pal[0] ?? 0;
  // Inner bevel first so the outline overwrites at the borders.
  for (let i = 0; i < T; i++) {
    if (n) pc.set(i, 1, soft ? mix(pc.get(i, 1), light, 0.35) : light);
    if (w) pc.set(1, i, mix(pc.get(1, i), light, 0.4));
    if (s) pc.set(i, T - 2, mix(pc.get(i, T - 2), dark, 0.55));
    if (e) pc.set(T - 2, i, mix(pc.get(T - 2, i), dark, 0.45));
  }
  for (let i = 0; i < T; i++) {
    if (n) pc.set(i, 0, outline);
    if (s) pc.set(i, T - 1, outline);
    if (w) pc.set(0, i, outline);
    if (e) pc.set(T - 1, i, outline);
  }
  const corner = (cx: number, cy: number, ix: number, iy: number): void => {
    pc.set(cx, cy, TRANSPARENT);
    pc.set(ix, iy, outline);
  };
  if (n && w) corner(0, 0, 1, 1);
  if (n && e) corner(T - 1, 0, T - 2, 1);
  if (s && w) corner(0, T - 1, 1, T - 2);
  if (s && e) corner(T - 1, T - 1, T - 2, T - 2);
}

/** Grass on exposed top (and a lip down exposed sides). */
function applyGrass(pc: PixelCanvas, mask: number, grass: Pal, seed: number): void {
  const n = !(mask & MASK_N);
  const e = !(mask & MASK_E);
  const w = !(mask & MASK_W);
  if (!n) return;
  const outline = grass[0] ?? 0;
  for (let x = 0; x < T; x++) {
    const depth = 3 + (hash2(x, 1, seed) % 3); // 3..5
    for (let y = 0; y <= depth; y++) {
      let c: Color;
      if (y === 0) c = outline;
      else if (y === 1) c = (hash2(x, 2, seed) % 4 === 0 ? grass[4] : grass[3]) ?? 0;
      else if (y === depth) c = grass[1] ?? 0;
      else c = grass[2] ?? 0;
      pc.set(x, y, c);
    }
    // Dark root pixel under each blade tip for depth.
    if (hash2(x, 3, seed) % 3 === 0) pc.set(x, depth + 1, mix(pc.get(x, depth + 1), outline, 0.5));
  }
  const side = (sx: number, inner: number): void => {
    const len = 6 + (hash2(sx, 4, seed) % 4);
    for (let y = 0; y < len; y++) {
      pc.set(sx, y, outline);
      pc.set(inner, y, (y === len - 1 ? grass[1] : grass[2]) ?? 0);
    }
  };
  if (w) side(0, 1);
  if (e) side(T - 1, T - 2);
  if (w) pc.set(0, 0, TRANSPARENT);
  if (e) pc.set(T - 1, 0, TRANSPARENT);
}

function applyMoss(pc: PixelCanvas, mask: number, moss: Pal, seed: number): void {
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const nTop = !(mask & MASK_N) ? Math.max(0, 1 - y / 6) : 0;
      const v = smoothNoise(x, y, seed + 21, 4) + nTop * 0.9;
      if (v > 0.55 && pc.get(x, y) !== TRANSPARENT)
        pc.set(x, y, (v > 0.85 ? moss[3] : moss[2]) ?? 0);
    }
  }
}

function platformFrame(
  pc: PixelCanvas,
  mask: number,
  pal: Pal,
  outline: Color,
  seed: number,
): void {
  const e = !(mask & MASK_E);
  const w = !(mask & MASK_W);
  // Plank top surface rows 0..5.
  for (let x = 0; x < T; x++) {
    pc.set(x, 0, outline);
    pc.set(x, 1, pal[4] ?? 0);
    const grain = hash2(x, 7, seed) % 7 === 0;
    pc.set(x, 2, (grain ? pal[2] : pal[3]) ?? 0);
    pc.set(x, 3, pal[2] ?? 0);
    pc.set(x, 4, pal[1] ?? 0);
    pc.set(x, 5, outline);
  }
  // Board seam and nails.
  const seam = 7 + (seed % 2);
  for (let y = 1; y <= 4; y++) pc.set(seam, y, pal[0] ?? 0);
  pc.set(seam - 3, 3, pal[0] ?? 0);
  pc.set(seam + 3, 3, pal[0] ?? 0);
  // Ends: rounded caps and a diagonal support bracket underneath.
  const end = (x0: number, dir: 1 | -1): void => {
    pc.set(x0, 0, TRANSPARENT);
    pc.set(x0, 5, TRANSPARENT);
    for (let y = 1; y <= 4; y++) pc.set(x0, y, outline);
    for (let i = 0; i < 6; i++) {
      const bx = x0 + dir * (2 + Math.floor(i * 0.8));
      const by = 6 + i;
      pc.set(bx, by, pal[2] ?? 0);
      pc.set(bx + dir, by, pal[1] ?? 0);
      pc.set(bx - dir, by, outline);
      pc.set(bx + dir * 2, by, outline);
    }
  };
  if (w) end(0, 1);
  if (e) end(T - 1, -1);
}

/** Ore: stone body with metallic nuggets (highlight + shadow pixel each). */
function oreNuggets(pc: PixelCanvas, ore: Pal, seed: number): void {
  const rng = new Rng(seed + 501);
  const count = rng.int(3, 4);
  for (let i = 0; i < count; i++) {
    const x = rng.int(2, 11);
    const y = rng.int(2, 11);
    const w = rng.int(2, 3);
    const h = rng.int(1, 2);
    for (let yy = y; yy <= y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) pc.set(xx, yy, (yy === y ? ore[2] : ore[1]) ?? 0);
    }
    pc.set(x, y, ore[3] ?? 0);
    pc.set(x + w - 1, y + h, ore[0] ?? 0);
    pc.set(x + w, y + h, mix(pc.get(x + w, y + h), ore[0] ?? 0, 0.6));
  }
}

/** Stone bricks: staggered 8×4 courses, mortar lines, per-brick bevel. */
function bricksBase(pc: PixelCanvas, pal: Pal, seed: number): void {
  for (let y = 0; y < T; y++) {
    const course = y >> 2;
    const offset = course % 2 === 0 ? 0 : 4;
    for (let x = 0; x < T; x++) {
      const bx = (x + offset) % 8;
      const by = y % 4;
      let c = pal[2] ?? 0;
      if (by === 3 || bx === 7) c = pal[0] ?? 0;
      else if (by === 0 || bx === 0) c = pal[3] ?? 0;
      else if (by === 2 && bx === 6) c = pal[1] ?? 0;
      if (c === pal[2] && hash2f(x, y, seed) < 0.12) c = pal[1] ?? c;
      pc.set(x, y, c);
    }
  }
}

/** Torch: stick + teardrop flame. `frame` animates the flame for in-world sprites. */
export function drawTorch(pc: PixelCanvas, wood: Pal, fire: Pal, outline: Color, frame = 0): void {
  for (let y = 7; y < 15; y++) {
    pc.set(7, y, wood[3] ?? 0);
    pc.set(8, y, wood[1] ?? 0);
  }
  pc.set(7, 6, wood[0] ?? 0);
  pc.set(8, 6, wood[0] ?? 0);
  const sway = [0, 1, 0, -1][frame % 4] ?? 0;
  const stretch = [0, 0.4, 0.8, 0.3][frame % 4] ?? 0;
  const shape = [
    [7.5, 5, 2.2],
    [7.5 + sway * 0.4, 3.6 - stretch * 0.3, 1.7],
    [7.5 + sway * 0.8, 2.2 - stretch * 0.6, 1.1],
    [7.5 + sway, 1 - stretch, 0.6],
  ] as const;
  shape.forEach(([cx, cy, r], i) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x + 0.5 - cx - 0.5) ** 2 + (y + 0.5 - cy) ** 2 <= r * r)
          pc.set(x, y, fire[Math.min(4, i + 1)] ?? 0);
      }
    }
  });
  pc.set(7, 5, fire[4] ?? 0);
  pc.set(8, 4, fire[4] ?? 0);
  const copy = pc.clone();
  copy.outline(outline);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++)
      if (!pc.isOpaque(x, y) && copy.isOpaque(x, y)) pc.set(x, y, mix(outline, fire[0] ?? 0, 0.35));
  }
}

/** Vertical support post (6px wide) with a cap when nothing connects above. */
function beamFrame(pc: PixelCanvas, mask: number, pal: Pal, outline: Color, seed: number): void {
  const x0 = 5;
  const w = 6;
  for (let y = 0; y < T; y++) {
    pc.set(x0, y, outline);
    pc.set(x0 + w - 1, y, outline);
    for (let x = x0 + 1; x < x0 + w - 1; x++) {
      const u = x - x0;
      let c = u === 1 ? pal[3] : u === w - 2 ? pal[1] : pal[2];
      if (hash2(x, y >> 2, seed) % 9 === 0) c = pal[1];
      pc.set(x, y, c ?? 0);
    }
  }
  if (!(mask & MASK_N)) {
    for (let x = x0 - 1; x <= x0 + w; x++) {
      pc.set(x, 0, outline);
      pc.set(x, 1, pal[3] ?? 0);
      pc.set(x, 2, outline);
    }
  }
  // Iron band every tile for a constructed look.
  for (let x = x0; x < x0 + w; x++) pc.set(x, 9, mix(pal[0] ?? 0, hex('#5a5f70'), 0.6));
}

function generateFrame(
  recipe: TileRecipe,
  mask: number,
  variant: number,
  seed: number,
): PixelCanvas {
  const pc = new PixelCanvas(T, T);
  const pal = recipe.ramp.map((c) => hex(c));
  const outline = hex(recipe.outline);
  const accent = (recipe.accent ?? []).map((c) => hex(c));
  const vseed = seed + variant * 7919;
  switch (recipe.style) {
    case 'soil':
      soilBase(pc, pal, vseed);
      applyEdges(pc, mask, pal, outline);
      break;
    case 'grass':
      soilBase(pc, pal, vseed);
      applyEdges(pc, mask, pal, outline);
      applyGrass(pc, mask, accent, vseed);
      break;
    case 'stone':
      stoneBase(pc, pal, outline, vseed);
      applyEdges(pc, mask, pal, outline);
      break;
    case 'mossy':
      stoneBase(pc, pal, outline, vseed);
      applyMoss(pc, mask, accent, vseed);
      applyEdges(pc, mask, pal, outline);
      break;
    case 'ore':
      stoneBase(pc, pal, outline, vseed);
      oreNuggets(pc, accent, vseed);
      applyEdges(pc, mask, pal, outline);
      break;
    case 'bricks':
      bricksBase(pc, pal, vseed);
      applyEdges(pc, mask, pal, outline);
      break;
    case 'torch':
      drawTorch(pc, pal, accent, outline);
      break;
    case 'planks':
      planksBase(pc, pal, vseed);
      applyEdges(pc, mask, pal, outline);
      break;
    case 'wall':
      wallBase(pc, pal, vseed);
      applyEdges(pc, mask, pal, outline, true);
      break;
    case 'platform':
      platformFrame(pc, mask, pal, outline, vseed);
      break;
    case 'beam':
      beamFrame(pc, mask, pal, outline, vseed);
      break;
  }
  return pc;
}

/**
 * A fringe frame: the spilling material's jagged edge drawn over the neighbor tile, so borders
 * between dirt and stone read as organic seams instead of square tiles.
 */
function generateFringe(
  recipe: TileRecipe,
  side: number,
  variant: number,
  seed: number,
): PixelCanvas {
  const full = generateFrame(recipe, 15, variant, seed);
  const pc = new PixelCanvas(T, T);
  const outline = hex(recipe.outline);
  const vseed = seed + variant * 31 + side * 977;
  for (let i = 0; i < T; i++) {
    const depth = 1 + (hash2(i, side, vseed) % 3) + (hash2(i >> 2, side + 9, vseed) % 2);
    for (let d = 0; d <= depth; d++) {
      let x: number;
      let y: number;
      if (side === SIDE_N) [x, y] = [i, d];
      else if (side === SIDE_S) [x, y] = [i, T - 1 - d];
      else if (side === SIDE_W) [x, y] = [d, i];
      else [x, y] = [T - 1 - d, i];
      pc.set(x, y, d === depth ? mix(full.get(x, y), outline, 0.55) : full.get(x, y));
    }
  }
  return pc;
}

/** Tile keys whose material spills over same-group neighbors. */
const FRINGE_KEYS = new Set(['stone', 'mossy_stone']);

/** Build the full tile atlas: one row per tile type, 16 masks × variants per row. */
export function generateTileset(registry: TileRegistry, seed = 1337): Tileset {
  const slotOf = new Int16Array(registry.defs.length).fill(-1);
  const fringeOf = new Int16Array(registry.defs.length).fill(-1);
  const entries: { id: number; recipe: TileRecipe }[] = [];
  registry.defs.forEach((def) => {
    if (!def || def.id === 0) return;
    const recipe = TILE_RECIPES[def.key];
    if (!recipe) return;
    slotOf[def.id] = entries.length;
    entries.push({ id: def.id, recipe });
  });
  const fringeEntries = entries.filter((e) => FRINGE_KEYS.has(registry.get(e.id)?.key ?? ''));
  fringeEntries.forEach((e, i) => (fringeOf[e.id] = i));
  const fringeBase = entries.length * FRAMES_PER_TILE;
  const fringeRows = Math.ceil((fringeEntries.length * FRINGE_FRAMES) / FRAMES_PER_TILE);
  const canvas = new PixelCanvas(FRAMES_PER_TILE * T, Math.max(1, entries.length + fringeRows) * T);
  entries.forEach(({ id, recipe }, slot) => {
    for (let mask = 0; mask < 16; mask++) {
      for (let v = 0; v < TILE_VARIANTS; v++) {
        const frame = generateFrame(recipe, mask, v, seed + id * 104729);
        canvas.blit(frame, (mask * TILE_VARIANTS + v) * T, slot * T);
      }
    }
  });
  fringeEntries.forEach(({ id, recipe }, fslot) => {
    for (let side = 0; side < 4; side++) {
      for (let v = 0; v < TILE_VARIANTS; v++) {
        const index = fringeBase + fslot * FRINGE_FRAMES + side * TILE_VARIANTS + v;
        const r = tileFrameRect(index);
        canvas.blit(generateFringe(recipe, side, v, seed + id * 104729), r.x, r.y);
      }
    }
  });
  return {
    canvas,
    slotOf,
    fringeOf,
    fringeBase,
    frameCount: fringeBase + fringeEntries.length * FRINGE_FRAMES,
  };
}
