/**
 * Bounded A* over the NavGrid, plus a PathFollower that turns a path into motor input.
 */
import { TILE_SIZE } from '../../constants';
import { IDLE_INPUT, type MotorInput, type MotorState } from '../../physics/CharacterMotor';
import type { NavEdge, NavGrid } from './NavGrid';

export interface PathResult {
  readonly edges: NavEdge[];
  /** True if the path ends at the goal; false = path to the closest node found. */
  readonly complete: boolean;
  readonly expanded: number;
}

interface OpenNode {
  key: number;
  f: number;
}

/** Binary min-heap on f. */
class Heap {
  private readonly a: OpenNode[] = [];
  get size(): number {
    return this.a.length;
  }
  push(n: OpenNode): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((a[p] as OpenNode).f <= n.f) break;
      a[i] = a[p] as OpenNode;
      i = p;
    }
    a[i] = n;
  }
  pop(): OpenNode | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop() as OpenNode;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && (a[l] as OpenNode).f < (a[m] as OpenNode).f) m = l;
        if (r < a.length && (a[r] as OpenNode).f < (a[m] as OpenNode).f) m = r;
        if (m === i) break;
        const tmp = a[i] as OpenNode;
        a[i] = a[m] as OpenNode;
        a[m] = tmp;
        i = m;
      }
    }
    return top;
  }
}

export interface PathOptions {
  readonly maxExpansions?: number;
  /** Accept any node within this many tiles of the goal. */
  readonly tolerance?: number;
}

export function findPath(
  nav: NavGrid,
  start: number,
  goal: number,
  opts: PathOptions = {},
): PathResult {
  const maxExp = opts.maxExpansions ?? 1500;
  const tol = opts.tolerance ?? 0;
  const gx = nav.tx(goal);
  const gy = nav.ty(goal);
  const h = (k: number): number => Math.abs(nav.tx(k) - gx) + Math.abs(nav.ty(k) - gy) * 0.6;
  const g = new Map<number, number>([[start, 0]]);
  const came = new Map<number, { from: number; edge: NavEdge }>();
  const open = new Heap();
  open.push({ key: start, f: h(start) });
  let best = start;
  let bestH = h(start);
  let expanded = 0;
  const closed = new Set<number>();
  while (open.size > 0 && expanded < maxExp) {
    const cur = open.pop() as OpenNode;
    if (closed.has(cur.key)) continue;
    closed.add(cur.key);
    expanded++;
    const hk = h(cur.key);
    if (hk < bestH) {
      bestH = hk;
      best = cur.key;
    }
    const ctx = nav.tx(cur.key);
    const cty = nav.ty(cur.key);
    if (cur.key === goal || (Math.abs(ctx - gx) <= tol && Math.abs(cty - gy) <= tol)) {
      best = cur.key;
      bestH = 0;
      break;
    }
    // Jumps are expensive to discover: only consider them where walking does not lead on.
    const base = nav.edges(cur.key, false);
    const dirToGoal = Math.sign(gx - ctx);
    const forward = base.some(
      (e) => e.dir === dirToGoal && (e.kind === 'walk' || e.kind === 'step'),
    );
    const wantJumps = !forward || gy < cty - 1 || Math.abs(gx - ctx) <= 6;
    const edges = wantJumps ? [...base, ...nav.jumpEdges(cur.key)] : base;
    const gc = g.get(cur.key) ?? 0;
    for (const e of edges) {
      const ng = gc + e.cost;
      if (ng >= (g.get(e.to) ?? Infinity)) continue;
      g.set(e.to, ng);
      came.set(e.to, { from: cur.key, edge: e });
      open.push({ key: e.to, f: ng + h(e.to) * 1.1 });
    }
  }
  const edges: NavEdge[] = [];
  let k = best;
  while (k !== start) {
    const c = came.get(k);
    if (!c) break;
    edges.push(c.edge);
    k = c.from;
  }
  edges.reverse();
  return { edges, complete: bestH === 0, expanded };
}

type Phase = 'move' | 'align' | 'jump';

/**
 * Follows a path edge by edge, producing MotorInput each tick. Jumps align to the node center
 * and replay the exact scripted input the edge was discovered with.
 */
export class PathFollower {
  edges: NavEdge[] = [];
  index = 0;
  private phase: Phase = 'move';
  private tick = 0;
  private stuck = 0;
  private lastX = 0;
  private lastY = 0;
  private from = -1;
  failed = false;

  constructor(private readonly nav: NavGrid) {}

  set(edges: NavEdge[], start: number): void {
    this.edges = edges;
    this.index = 0;
    this.phase = 'move';
    this.tick = 0;
    this.stuck = 0;
    this.from = start;
    this.failed = false;
  }

  get done(): boolean {
    return this.index >= this.edges.length;
  }

  get target(): number | null {
    return this.edges[this.edges.length - 1]?.to ?? null;
  }

  private advance(): void {
    const e = this.edges[this.index];
    if (e) this.from = e.to;
    this.index++;
    this.phase = 'move';
    this.tick = 0;
    this.stuck = 0;
  }

  /** @param speedScale character move-speed multiplier (scripted jumps are normalized by it). */
  step(m: MotorState, dt: number, speedScale = 1): MotorInput {
    const e = this.edges[this.index];
    if (!e || this.failed) return IDLE_INPUT;
    const nav = this.nav;
    const toX = nav.tx(e.to) * TILE_SIZE + TILE_SIZE / 2;
    const toY = (nav.ty(e.to) + 1) * TILE_SIZE;
    const col = Math.floor(m.x / TILE_SIZE);
    // Stuck detection.
    if (Math.abs(m.x - this.lastX) + Math.abs(m.y - this.lastY) < 0.3) this.stuck += dt;
    else this.stuck = 0;
    this.lastX = m.x;
    this.lastY = m.y;
    if (this.stuck > 1.4) {
      this.failed = true;
      return IDLE_INPUT;
    }
    const steer = (tx: number): number => {
      const dx = tx - m.x;
      return Math.abs(dx) < 5 ? dx / 5 : Math.sign(dx);
    };
    switch (e.kind) {
      case 'walk':
      case 'step':
        if (col === nav.tx(e.to) && m.grounded && Math.abs(m.y - toY) <= TILE_SIZE + 1) {
          this.advance();
          return this.step(m, 0, speedScale);
        }
        return { ...IDLE_INPUT, moveX: Math.sign(toX - m.x) };
      case 'drop':
        if (m.grounded && col === nav.tx(e.to) && Math.abs(m.y - toY) <= 2) {
          this.advance();
          return this.step(m, 0, speedScale);
        }
        return { ...IDLE_INPUT, moveX: m.grounded ? Math.sign(toX - m.x) : steer(toX) * 0.6 };
      case 'through': {
        this.tick++;
        if (m.grounded && m.y > toY - 2 && this.tick > 2) {
          this.advance();
          return this.step(m, 0, speedScale);
        }
        return { ...IDLE_INPUT, down: true, jumpPressed: this.tick % 8 === 1, jumpHeld: false };
      }
      case 'jump': {
        const fromX = nav.tx(this.from) * TILE_SIZE + TILE_SIZE / 2;
        if (this.phase === 'move') this.phase = 'align';
        if (this.phase === 'align') {
          if (m.grounded && Math.abs(m.x - fromX) < 1.2 && Math.abs(m.vx) < 8) {
            this.phase = 'jump';
            this.tick = 0;
          } else {
            this.stuck = Math.min(this.stuck, 0.8);
            return { ...IDLE_INPUT, moveX: steer(fromX) * 0.5 };
          }
        }
        const t = this.tick++;
        if (t > 2 && m.grounded) {
          const landed = nav.nodeAt(m.x, m.y);
          if (
            landed !== null &&
            Math.abs(nav.tx(landed) - nav.tx(e.to)) <= 1 &&
            Math.abs(nav.ty(landed) - nav.ty(e.to)) <= 1
          ) {
            this.advance();
            this.from = landed;
            return this.step(m, 0, speedScale);
          }
          this.failed = true;
          return IDLE_INPUT;
        }
        return {
          moveX: Math.max(-1, Math.min(1, (e.moveX ?? 0) / Math.max(0.5, speedScale))),
          jumpPressed: t === 0,
          jumpHeld: t < (e.holdTicks ?? 40),
          down: false,
        };
      }
    }
  }
}
