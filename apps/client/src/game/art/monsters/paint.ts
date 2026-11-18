/** Shading helpers shared by the procedural monster painters. */
import { alpha, type Color, mix, shade, withAlpha } from '../color';
import type { PixelCanvas } from '../PixelCanvas';

/** 4×4 Bayer matrix, normalized to [0, 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function bayer(x: number, y: number): number {
  return BAYER[(y & 3) * 4 + (x & 3)] ?? 0.5;
}

export interface BlobOptions {
  /** Colors from darkest to lightest. */
  readonly ramp: readonly Color[];
  /** Specular highlight color (top-left). */
  readonly spec?: Color;
  /** Rows below this y are not painted (flat bottoms resting on the ground). */
  readonly clipBottom?: number;
  /** Only paint pixels where this returns true. */
  readonly mask?: (x: number, y: number) => boolean;
  readonly alphaValue?: number;
  /** Rim light color on the lower-right edge. */
  readonly rim?: Color;
  /** Superellipse exponent: 2 = ellipse, higher = boxier (rocks, armor plates). */
  readonly power?: number;
  /** Facet cell size (px): breaks shading into flat chiseled planes. */
  readonly facet?: number;
  readonly seed?: number;
}

function cellHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Volumetric ellipse lit from the top-left: the pixel normal is reconstructed from the ellipse,
 * dotted with the light and quantized to the ramp with ordered dithering between bands.
 */
export function shadedBlob(
  pc: PixelCanvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  o: BlobOptions,
): void {
  const L = [-0.5, -0.65, 0.57];
  const n = o.ramp.length;
  const pw = o.power ?? 2;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    if (o.clipBottom !== undefined && y > o.clipBottom) continue;
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx;
      const ny = (y + 0.5 - cy) / ry;
      const f = Math.pow(Math.abs(nx), pw) + Math.pow(Math.abs(ny), pw);
      if (f > 1) continue;
      if (o.mask && !o.mask(x, y)) continue;
      let gx = Math.sign(nx) * Math.pow(Math.abs(nx), pw - 1);
      let gy = Math.sign(ny) * Math.pow(Math.abs(ny), pw - 1);
      let gz = Math.sqrt(Math.max(0, 1 - f)) * (pw > 2 ? 1.4 : 1);
      if (o.facet) {
        // Tilt each facet cell's normal a little: flat chiseled planes.
        const fx = Math.floor((x - cx) / o.facet);
        const fy = Math.floor((y - cy) / o.facet);
        gx += (cellHash(fx, fy, o.seed ?? 1) - 0.5) * 0.7;
        gy += (cellHash(fy, fx, (o.seed ?? 1) + 7) - 0.5) * 0.7;
      }
      const len = Math.hypot(gx, gy, gz) || 1;
      gx /= len;
      gy /= len;
      gz /= len;
      const lit = Math.max(0, gx * (L[0] ?? 0) + gy * (L[1] ?? 0) + gz * (L[2] ?? 0));
      const dither = o.facet ? 0.25 : 0.7;
      const t = Math.min(n - 1, lit * (n - 0.15) + (bayer(x, y) - 0.5) * dither);
      let c = o.ramp[Math.max(0, Math.min(n - 1, Math.floor(t)))] ?? 0;
      if (o.spec && lit > 0.94) c = o.spec;
      if (o.rim && f > 0.72 && nx > 0.25 && ny > -0.2) c = mix(c, o.rim, 0.55);
      if (o.alphaValue !== undefined) c = withAlpha(c, o.alphaValue);
      pc.set(x, y, c);
    }
  }
}

/** Selective outline: transparent pixels next to the sprite take a darkened neighbor color. */
export function selOut(pc: PixelCanvas, amount = 0.6, minAlpha = 40): void {
  const marks: [number, number, Color][] = [];
  for (let y = 0; y < pc.height; y++) {
    for (let x = 0; x < pc.width; x++) {
      if (alpha(pc.get(x, y)) >= minAlpha) continue;
      let src = 0;
      for (const [dx, dy] of [
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ] as const) {
        const c = pc.get(x + dx, y + dy);
        if (alpha(c) >= minAlpha) {
          src = c;
          break;
        }
      }
      if (src) marks.push([x, y, withAlpha(shade(withAlpha(src, 255), -amount), 255)]);
    }
  }
  for (const [x, y, c] of marks) pc.set(x, y, c);
}

/** Thick line made of filled circles. */
export function stroke(
  pc: PixelCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  c: Color,
): void {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(d * 2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pc.fillCircle(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c);
  }
}

/** Glow: additive-looking soft disc (alpha falls off), for emissive sprites. */
export function softDisc(
  pc: PixelCanvas,
  cx: number,
  cy: number,
  r: number,
  c: Color,
  peak = 160,
): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      const a = Math.round(peak * (1 - d) * (1 - d));
      if (a <= 0) continue;
      pc.blend(x, y, withAlpha(c, a));
    }
  }
}

/** Flip a canvas vertically (upside-down corpses). */
export function flipY(src: PixelCanvas, out: PixelCanvas): PixelCanvas {
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) out.set(x, src.height - 1 - y, src.get(x, y));
  return out;
}
