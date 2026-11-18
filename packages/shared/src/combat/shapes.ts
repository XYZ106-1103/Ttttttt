/** Hit-shape geometry against axis-aligned body boxes (feet at bottom-center). */
import type { ShapeDef } from './actions';

export interface Aabb {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BodyLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function bodyAabb(b: BodyLike): Aabb {
  const h = b.width / 2;
  return { x0: b.x - h, y0: b.y - b.height, x1: b.x + h, y1: b.y };
}

export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function circleAabb(cx: number, cy: number, r: number, b: Aabb): boolean {
  const nx = Math.max(b.x0, Math.min(cx, b.x1));
  const ny = Math.max(b.y0, Math.min(cy, b.y1));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Sector test: any of the box's nearest point / center / corners inside the sector. */
export function sectorAabb(
  cx: number,
  cy: number,
  radius: number,
  aim: number,
  halfAngle: number,
  b: Aabb,
): boolean {
  if (cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1) return true;
  if (!circleAabb(cx, cy, radius, b)) return false;
  const pts: [number, number][] = [
    [Math.max(b.x0, Math.min(cx, b.x1)), Math.max(b.y0, Math.min(cy, b.y1))],
    [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2],
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x0, b.y1],
    [b.x1, b.y1],
  ];
  for (const [px, py] of pts) {
    const dx = px - cx;
    const dy = py - cy;
    if (dx * dx + dy * dy > radius * radius) continue;
    if (angleDiff(Math.atan2(dy, dx), aim) <= halfAngle) return true;
  }
  return false;
}

/** World-space test of a hit shape owned by `owner` against a target box. */
export function shapeHits(
  shape: ShapeDef,
  owner: BodyLike,
  facing: number,
  aim: number,
  target: Aabb,
): boolean {
  const cx = owner.x;
  const cy = owner.y - owner.height / 2;
  switch (shape.type) {
    case 'arc':
      return sectorAabb(cx, cy, shape.radius, aim, shape.halfAngle, target);
    case 'circle':
      return circleAabb(cx + (shape.forward ?? 0) * facing, cy, shape.radius, target);
    case 'box': {
      const bx = cx + shape.forward * facing;
      const by = cy - (shape.up ?? 0);
      return aabbOverlap(
        { x0: bx - shape.w / 2, y0: by - shape.h / 2, x1: bx + shape.w / 2, y1: by + shape.h / 2 },
        target,
      );
    }
  }
}
