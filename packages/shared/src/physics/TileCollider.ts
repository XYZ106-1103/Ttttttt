import { TILE_SIZE } from '../constants';
import { COLLISION_PLATFORM, COLLISION_SOLID, type CollisionCode } from '../world/TileRegistry';

/** Anything that can answer "what collision does this tile have?" (the World, or a test grid). */
export interface CollisionGrid {
  collisionAt(tx: number, ty: number): CollisionCode;
}

/**
 * Axis-aligned body described by its feet position (bottom-center) and size.
 * Using the feet as the origin keeps sprite anchoring and ground checks trivial.
 */
export interface Body {
  x: number;
  y: number;
  readonly width: number;
  readonly height: number;
}

/** Tolerance so bodies resting exactly on tile edges are treated as touching, not overlapping. */
const EPS = 1e-4;
const TS = TILE_SIZE;

/** First and last tile rows overlapped by the vertical span [top, bottom). */
function rowsOf(top: number, bottom: number): [number, number] {
  return [Math.floor((top + EPS) / TS), Math.floor((bottom - EPS) / TS)];
}

/** First and last tile columns overlapped by the horizontal span [left, right). */
function colsOf(left: number, right: number): [number, number] {
  return [Math.floor((left + EPS) / TS), Math.floor((right - EPS) / TS)];
}

/** True if any solid tile overlaps the given pixel rectangle. */
export function isRegionSolid(
  grid: CollisionGrid,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  const [tx0, tx1] = colsOf(left, right);
  const [ty0, ty1] = rowsOf(top, bottom);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (grid.collisionAt(tx, ty) === COLLISION_SOLID) return true;
    }
  }
  return false;
}

/**
 * Move a body horizontally by `dx`, stopping flush against the first solid tile column entered.
 * Returns the distance actually moved.
 */
export function sweepX(grid: CollisionGrid, body: Body, dx: number): number {
  if (dx === 0) return 0;
  const half = body.width / 2;
  const [ty0, ty1] = rowsOf(body.y - body.height, body.y);

  if (dx > 0) {
    const edge = body.x + half;
    const target = edge + dx;
    const first = Math.ceil((edge - EPS) / TS);
    const last = Math.ceil((target - EPS) / TS) - 1;
    for (let tx = first; tx <= last; tx++) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (grid.collisionAt(tx, ty) === COLLISION_SOLID) {
          const allowed = Math.max(0, tx * TS - edge);
          body.x += allowed;
          return allowed;
        }
      }
    }
  } else {
    const edge = body.x - half;
    const target = edge + dx;
    const first = Math.floor((edge + EPS) / TS) - 1;
    const last = Math.floor((target + EPS) / TS);
    for (let tx = first; tx >= last; tx--) {
      for (let ty = ty0; ty <= ty1; ty++) {
        if (grid.collisionAt(tx, ty) === COLLISION_SOLID) {
          const allowed = Math.min(0, (tx + 1) * TS - edge);
          body.x += allowed;
          return allowed;
        }
      }
    }
  }
  body.x += dx;
  return dx;
}

export interface SweepYOptions {
  /** Ignore one-way platforms (dropping through). */
  ignorePlatforms: boolean;
}

export interface SweepYResult {
  moved: number;
  hitFloor: boolean;
  hitCeiling: boolean;
  /** Collision type of the tile landed on (when hitFloor). */
  floorType: CollisionCode;
}

/**
 * Move a body vertically by `dy`. Solid tiles block both ways; one-way platforms block only
 * downward motion, and only rows whose top edge is at or below the feet's starting position —
 * so a body jumping up through a platform passes freely and lands on it on the way down.
 */
export function sweepY(
  grid: CollisionGrid,
  body: Body,
  dy: number,
  options: SweepYOptions,
): SweepYResult {
  const result: SweepYResult = { moved: 0, hitFloor: false, hitCeiling: false, floorType: 0 };
  if (dy === 0) return result;
  const half = body.width / 2;
  const [tx0, tx1] = colsOf(body.x - half, body.x + half);

  if (dy > 0) {
    const feet = body.y;
    const target = feet + dy;
    const first = Math.ceil((feet - EPS) / TS);
    const last = Math.floor((target + EPS) / TS);
    for (let ty = first; ty <= last; ty++) {
      let hit: CollisionCode = 0;
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = grid.collisionAt(tx, ty);
        if (c === COLLISION_SOLID) {
          hit = c;
          break;
        }
        if (c === COLLISION_PLATFORM && !options.ignorePlatforms) hit = c;
      }
      if (hit !== 0) {
        const allowed = Math.max(0, ty * TS - feet);
        body.y += allowed;
        result.moved = allowed;
        result.hitFloor = true;
        result.floorType = hit;
        return result;
      }
    }
  } else {
    const head = body.y - body.height;
    const target = head + dy;
    const first = Math.floor((head + EPS) / TS) - 1;
    const last = Math.ceil((target - EPS) / TS) - 1;
    for (let ty = first; ty >= last; ty--) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (grid.collisionAt(tx, ty) === COLLISION_SOLID) {
          const allowed = Math.min(0, (ty + 1) * TS - head);
          body.y += allowed;
          result.moved = allowed;
          result.hitCeiling = true;
          return result;
        }
      }
    }
  }
  body.y += dy;
  result.moved = dy;
  return result;
}

/**
 * Collision type of the ground directly under the feet (within `probe` px), or 0 when airborne.
 * Solid ground takes precedence over platforms.
 */
export function groundBelow(
  grid: CollisionGrid,
  body: Body,
  ignorePlatforms: boolean,
  probe = 1,
): CollisionCode {
  const half = body.width / 2;
  const [tx0, tx1] = colsOf(body.x - half, body.x + half);
  const ty = Math.ceil((body.y - EPS) / TS);
  if (ty * TS > body.y + probe) return 0;
  let found: CollisionCode = 0;
  for (let tx = tx0; tx <= tx1; tx++) {
    const c = grid.collisionAt(tx, ty);
    if (c === COLLISION_SOLID) return c;
    if (c === COLLISION_PLATFORM && !ignorePlatforms) found = c;
  }
  return found;
}
