/**
 * Material-id raster layers and vector primitives for the character composer.
 * Parts are rasterized as material ids first; shading happens afterwards per layer, so every
 * part gets consistent lighting, rim light and selective outlines.
 */
export interface Pt {
  readonly x: number;
  readonly y: number;
}

export const pt = (x: number, y: number): Pt => ({ x, y });

export class MaskLayer {
  readonly w: number;
  readonly h: number;
  /** 0 = empty, otherwise material index + 1. */
  readonly mat: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.mat = new Uint8Array(w * h);
  }

  set(x: number, y: number, m: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.mat[y * this.w + x] = m + 1;
  }

  /** Material index at (x, y), or -1 if empty. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return (this.mat[y * this.w + x] ?? 0) - 1;
  }

  has(x: number, y: number): boolean {
    return this.get(x, y) >= 0;
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.mat[y * this.w + x] = 0;
  }
}

/** Even-odd polygon fill sampled at pixel centers. */
export function fillPolygon(layer: MaskLayer, pts: readonly Pt[], m: number): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as Pt;
      const b = pts[(i + 1) % pts.length] as Pt;
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.ceil((xs[i] as number) - 0.5);
      const x1 = Math.floor((xs[i + 1] as number) - 0.5);
      for (let x = x0; x <= x1; x++) layer.set(x, y, m);
    }
  }
}

/** Tapered capsule from a (radius ra) to b (radius rb). */
export function capsule(layer: MaskLayer, a: Pt, b: Pt, ra: number, rb: number, m: number): void {
  const r = Math.max(ra, rb);
  const x0 = Math.floor(Math.min(a.x, b.x) - r - 1);
  const x1 = Math.ceil(Math.max(a.x, b.x) + r + 1);
  const y0 = Math.floor(Math.min(a.y, b.y) - r - 1);
  const y1 = Math.ceil(Math.max(a.y, b.y) + r + 1);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-6;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - a.x;
      const py = y + 0.5 - a.y;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      const ex = px - dx * t;
      const ey = py - dy * t;
      const rr = ra + (rb - ra) * t;
      if (ex * ex + ey * ey <= rr * rr) layer.set(x, y, m);
    }
  }
}

export function disc(layer: MaskLayer, c: Pt, r: number, m: number): void {
  capsule(layer, c, c, r, r, m);
}

/** Polyline of tapered capsules (scarves, strands, coat tails). */
export function ribbon(
  layer: MaskLayer,
  pts: readonly Pt[],
  r0: number,
  r1: number,
  m: number,
): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const t0 = i / Math.max(1, pts.length - 1);
    const t1 = (i + 1) / Math.max(1, pts.length - 1);
    capsule(layer, pts[i] as Pt, pts[i + 1] as Pt, r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, m);
  }
}

/** Points along a chain that starts at `origin`, each segment rotated by `angleAt(i)` (radians). */
export function chain(
  origin: Pt,
  segments: number,
  segLen: number,
  angleAt: (i: number) => number,
): Pt[] {
  const out: Pt[] = [origin];
  let p = origin;
  for (let i = 0; i < segments; i++) {
    const a = angleAt(i);
    p = { x: p.x + Math.cos(a) * segLen, y: p.y + Math.sin(a) * segLen };
    out.push(p);
  }
  return out;
}

/** 2-bone IK joint; bendDir +1 bends toward +x for a downward limb (knees), -1 backward (elbows). */
export function solveJoint(a: Pt, b: Pt, l1: number, l2: number, bendDir: number): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.min(Math.max(Math.hypot(dx, dy), 0.001), l1 + l2 - 0.001);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  const base = Math.atan2(dy, dx);
  const j = base - ang * bendDir;
  return { x: a.x + Math.cos(j) * l1, y: a.y + Math.sin(j) * l1 };
}
