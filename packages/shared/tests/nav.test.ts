import { describe, expect, it } from 'vitest';
import {
  COLLISION_NONE,
  COLLISION_PLATFORM,
  COLLISION_SOLID,
  type CollisionCode,
  createMotorState,
  DEFAULT_MOVEMENT,
  findPath,
  NavGrid,
  PathFollower,
  SIM_DT,
  stepMotor,
} from '../src';

/** ASCII test map: '#' solid, '=' platform, '.' air. Row 0 is the top. */
function grid(rows: string[]) {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  return {
    widthTiles: w,
    heightTiles: h,
    collisionAt(tx: number, ty: number): CollisionCode {
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return COLLISION_SOLID;
      const c = rows[ty]?.[tx];
      return c === '#' ? COLLISION_SOLID : c === '=' ? COLLISION_PLATFORM : COLLISION_NONE;
    },
  };
}

function walkPath(nav: NavGrid, fromX: number, fromY: number, toX: number, toY: number) {
  const start = nav.key(fromX, fromY);
  const goal = nav.key(toX, toY);
  const res = findPath(nav, start, goal);
  const m = createMotorState(fromX * 16 + 8, (fromY + 1) * 16, DEFAULT_MOVEMENT);
  m.grounded = true;
  const f = new PathFollower(nav);
  f.set(res.edges, start);
  for (let i = 0; i < 60 * 30 && !f.done && !f.failed; i++) {
    stepMotor(m, f.step(m, SIM_DT), nav.world, DEFAULT_MOVEMENT, SIM_DT);
  }
  return { res, m, f, node: nav.nodeAt(m.x, m.y) };
}

const W = '#'.repeat(40);

describe('NavGrid & pathfinding', () => {
  it('knows where a 3-tile-tall body can stand', () => {
    const nav = new NavGrid(
      grid(['.'.repeat(40), '.'.repeat(40), '.'.repeat(40), '.'.repeat(40), '.'.repeat(40), W]),
      DEFAULT_MOVEMENT,
    );
    expect(nav.standable(5, 4)).toBe(true);
    expect(nav.standable(5, 3)).toBe(false);
    expect(nav.standable(0, 4)).toBe(false);
  });

  it('jumps over a wall and walks to the goal, executed with the real motor', () => {
    const rows = [
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '...............#........................',
      '...............#........................',
      '...............#........................',
      W,
    ];
    const nav = new NavGrid(grid(rows), DEFAULT_MOVEMENT);
    const r = walkPath(nav, 5, 8, 25, 8);
    expect(r.res.complete).toBe(true);
    expect(r.res.edges.some((e) => e.kind === 'jump')).toBe(true);
    expect(r.f.failed).toBe(false);
    expect(r.node).toBe(nav.key(25, 8));
  });

  it('crosses a gap, drops off a ledge and falls through a platform', () => {
    const rows = [
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '.'.repeat(40),
      '##########....##########................',
      '..................................====..',
      '........................................',
      '........................................',
      '........................................',
      W,
    ];
    const nav = new NavGrid(grid(rows), DEFAULT_MOVEMENT);
    const gap = walkPath(nav, 3, 4, 20, 4);
    expect(gap.res.complete).toBe(true);
    expect(gap.node).toBe(nav.key(20, 4));
    const down = walkPath(nav, 20, 4, 30, 9);
    expect(down.res.complete).toBe(true);
    expect(down.node).toBe(nav.key(30, 9));
    // Platform drop-through: stand on the platform, go below it.
    const plat = findPath(nav, nav.key(35, 5), nav.key(35, 9));
    expect(plat.complete).toBe(true);
    expect(plat.edges[0]?.kind).toBe('through');
  });

  it('returns the closest reachable node when the goal is walled off', () => {
    const rows = [
      '.'.repeat(40),
      '.'.repeat(40),
      '..........##########......',
      '..........##########......'.padEnd(40, '.'),
      '..........##########......'.padEnd(40, '.'),
      W,
    ];
    const fixed = rows.map((r) => r.padEnd(40, '.'));
    const tall = ['..........#.........'.padEnd(40, '.'), ...fixed];
    const nav = new NavGrid(
      grid(['..........#'.padEnd(40, '.'), '..........#'.padEnd(40, '.'), ...tall]),
      DEFAULT_MOVEMENT,
    );
    const res = findPath(nav, nav.key(3, 7), nav.key(30, 7), { maxExpansions: 400 });
    expect(res.complete).toBe(false);
    expect(res.edges.length).toBeGreaterThan(0);
  });
});
