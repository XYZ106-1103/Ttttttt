import type { Color } from '../color';
import type { PixelCanvas } from '../PixelCanvas';
import type { HairStyleId } from './appearance';

/**
 * Procedural hair. Each style is a set of shape parameters; the mask is built from a skull cap,
 * spikes, bangs and optional back hair, then shaded with a shine band and edge shadows.
 * Coordinates are relative to the head template origin (head is 16×15, facing right).
 */
interface HairStyleDef {
  /** Extra thickness around the skull. */
  readonly volume: number;
  /** Spikes on the crown: [x, length, lean(-1 back..1 forward)]. */
  readonly spikes: readonly (readonly [number, number, number])[];
  /** Bangs over the forehead: [x, width, tip y]. Tips never reach the eye rows. */
  readonly bangs: readonly (readonly [number, number, number])[];
  /** Lowest row covered on the back (left) side of the head. */
  readonly napeY: number;
  readonly back: 'none' | 'bob' | 'long' | 'ponytail';
}

const STYLES: Record<HairStyleId, HairStyleDef> = {
  spiky: {
    volume: 1,
    spikes: [
      [1, 4, -1.4],
      [5, 5, -1.1],
      [9, 4, -0.7],
      [13, 3, 0.2],
    ],
    bangs: [
      [9, 3, 7],
      [12, 3, 6],
      [15, 3, 8],
    ],
    napeY: 11,
    back: 'none',
  },
  messy: {
    volume: 1,
    spikes: [
      [2, 3, -1.2],
      [7, 3, -0.6],
      [12, 2, 0.6],
    ],
    bangs: [
      [8, 3, 6],
      [11, 4, 7],
      [14, 3, 6],
      [16, 2, 8],
    ],
    napeY: 12,
    back: 'none',
  },
  bob: {
    volume: 1,
    spikes: [],
    bangs: [
      [7, 3, 6],
      [10, 3, 6],
      [13, 3, 6],
      [16, 2, 9],
    ],
    napeY: 13,
    back: 'bob',
  },
  long: {
    volume: 1,
    spikes: [],
    bangs: [
      [8, 4, 6],
      [12, 3, 6],
      [15, 3, 9],
    ],
    napeY: 13,
    back: 'long',
  },
  ponytail: {
    volume: 0,
    spikes: [[4, 2, -0.8]],
    bangs: [
      [9, 3, 6],
      [13, 3, 7],
      [16, 2, 8],
    ],
    napeY: 11,
    back: 'ponytail',
  },
};

export interface HairPalette {
  readonly base: Color;
  readonly shade: Color;
  readonly light: Color;
}

/** Eye pixels (head-relative) that hair must never cover. */
const EYE_PIXELS = new Set(['8,7', '8,8', '8,9', '12,7', '13,7', '12,8', '13,8', '12,9', '13,9']);

function triangle(
  mask: Set<string>,
  bx: number,
  by: number,
  width: number,
  tipX: number,
  tipY: number,
): void {
  const steps = Math.max(1, Math.abs(tipY - by));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = bx + (tipX - bx) * t;
    const half = (width / 2) * (1 - t);
    const y = Math.round(by + (tipY - by) * t);
    for (let x = Math.round(cx - half); x <= Math.round(cx + half - 0.01); x++)
      mask.add(`${x},${y}`);
  }
}

function buildFrontMask(style: HairStyleDef): Set<string> {
  const mask = new Set<string>();
  const cx = 7.5;
  const cy = 6;
  const rx = 8.6 + style.volume;
  const ry = 7.4 + style.volume;
  for (let y = -6; y <= 14; y++) {
    for (let x = -4; x <= 19; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      // Hairline: the back of the head is covered down to the nape, the face side stops at the
      // forehead, with a sideburn strip in front of the ear.
      const limit = x <= 4 ? style.napeY : x <= 6 ? 10 - (x - 4) : 4;
      if (y <= limit) mask.add(`${x},${y}`);
    }
  }
  for (const [x, len, lean] of style.spikes) {
    const baseY = Math.round(cy - ry + 1.5);
    triangle(mask, x, baseY + 2, 6, x + lean * len, baseY - len + 1);
  }
  for (const [x, w, tipY] of style.bangs) {
    triangle(mask, x, 3, w + 1, x + 0.5, tipY);
  }
  for (const p of EYE_PIXELS) mask.delete(p);
  return mask;
}

function shadeMask(
  layer: PixelCanvas,
  mask: Set<string>,
  ox: number,
  oy: number,
  pal: HairPalette,
): void {
  let top = Infinity;
  for (const k of mask) top = Math.min(top, Number(k.split(',')[1]));
  for (const k of mask) {
    const [xs, ys] = k.split(',');
    const x = Number(xs);
    const y = Number(ys);
    let c = pal.base;
    const below = mask.has(`${x},${y + 1}`);
    const right = mask.has(`${x + 1},${y}`);
    // Shine band: an arc a couple of pixels under the crown on the lit (left/top) side.
    const crown = top + 2 + Math.abs(x - 6) * 0.18;
    if (Math.abs(y - crown) < 0.9 && x >= 1 && x <= 11) c = pal.light;
    if (!below || !right) c = pal.shade;
    // Strand separations on the bangs.
    if (y >= 4 && y <= 8 && x >= 7 && (x === 10 || x === 14) && below) c = pal.shade;
    layer.set(ox + x, oy + y, c);
  }
}

/** Draw the hair that sits in front of the head. */
export function drawFrontHair(
  layer: PixelCanvas,
  styleId: HairStyleId,
  headX: number,
  headY: number,
  pal: HairPalette,
): void {
  const style = STYLES[styleId];
  shadeMask(layer, buildFrontMask(style), headX, headY, pal);
}

/** Draw the hair that hangs behind the head and body (long hair, bob, ponytail). */
export function drawBackHair(
  layer: PixelCanvas,
  styleId: HairStyleId,
  headX: number,
  headY: number,
  sway: number,
  pal: HairPalette,
): void {
  const style = STYLES[styleId];
  const mask = new Set<string>();
  if (style.back === 'bob') {
    for (let y = 4; y <= 15; y++) {
      const w = y < 13 ? 9 : 9 - (y - 12) * 2;
      for (let x = -2; x < -2 + w; x++) mask.add(`${x},${y}`);
    }
  } else if (style.back === 'long') {
    for (let y = 4; y <= 27; y++) {
      const t = (y - 4) / 23;
      const shift = Math.round(-sway * t * 1.2);
      const w = Math.round(9 - t * 3);
      const jag = y > 24 ? (y % 2 === 0 ? 1 : 0) : 0;
      for (let x = -2 + shift; x < -2 + shift + w - jag; x++) mask.add(`${x},${y}`);
    }
  } else if (style.back === 'ponytail') {
    // Tie at the back of the head, tail curving down and back.
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const x = Math.round(-1 - t * 4 - sway * t * 1.5);
      const y = Math.round(6 + t * 13);
      const r = 2.2 - t * 1.2;
      for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) {
        for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
          if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) mask.add(`${xx},${yy}`);
        }
      }
    }
  } else {
    return;
  }
  shadeMask(layer, mask, headX, headY, pal);
}
