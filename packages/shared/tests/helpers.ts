import {
  COLLISION_NONE,
  COLLISION_PLATFORM,
  COLLISION_SOLID,
  type CollisionCode,
  type CollisionGrid,
} from '../src';

/**
 * Build a collision grid from ASCII art. '#' = solid, '=' = platform, anything else = empty.
 * Row 0 is the first line. Outside the art: solid below/sides, empty above.
 */
export function gridFromAscii(lines: string[]): CollisionGrid & { width: number; height: number } {
  const height = lines.length;
  const width = Math.max(...lines.map((l) => l.length));
  return {
    width,
    height,
    collisionAt(tx: number, ty: number): CollisionCode {
      if (ty < 0) return COLLISION_NONE;
      if (tx < 0 || tx >= width || ty >= height) return COLLISION_SOLID;
      const ch = lines[ty]?.[tx] ?? '.';
      if (ch === '#') return COLLISION_SOLID;
      if (ch === '=') return COLLISION_PLATFORM;
      return COLLISION_NONE;
    },
  };
}
