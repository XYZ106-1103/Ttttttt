import { TILE_SIZE } from '../constants';
import { HAND_REACH, HAND_SPEED, type ItemDef, PLACE_SPEED } from '../data/items';
import { getObjectDef, type ObjectDrop } from '../data/objects';
import { COLLISION_NONE, TILE } from '../world/TileRegistry';
import type { WorldObject } from '../world/types';
import type { World } from '../world/World';
import type { Inventory } from './Inventory';
import type { ItemRegistry } from './ItemRegistry';

export type UseAction = 'mine' | 'chop' | 'harvest' | 'place' | 'none';

export type UseFailReason =
  | 'cooldown'
  | 'out_of_world'
  | 'out_of_reach'
  | 'nothing'
  | 'wrong_tool'
  | 'tool_too_weak'
  | 'unbreakable'
  | 'supports_object'
  | 'occupied'
  | 'no_support'
  | 'blocked_by_body';

export interface BodyRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HitProgress {
  /** Target identity: `t:x,y` for tiles, `o:id` for objects. */
  readonly key: string;
  damage: number;
  lastHit: number;
}

/** Anything that can use items on the world: the player now, AI adventurers in PHASE 4. */
export interface InteractionActor extends BodyRect {
  readonly inventory: Inventory;
  progress: HitProgress | null;
  /** Simulation time (s) before which the next use is rejected. */
  nextUseAt: number;
}

export interface Drop {
  readonly itemId: string;
  readonly count: number;
  /** World pixel position the drop spawns at. */
  readonly x: number;
  readonly y: number;
}

export interface UseOutcome {
  readonly ok: boolean;
  readonly action: UseAction;
  readonly reason?: UseFailReason;
  readonly tx: number;
  readonly ty: number;
  /** Damage progress 0..1 after this use (mine / chop). */
  readonly progress: number;
  readonly broke: boolean;
  readonly drops: readonly Drop[];
  readonly placedTile?: number;
  readonly brokenTile?: number;
  readonly hitObject?: WorldObject;
  readonly removedObjects: readonly WorldObject[];
}

export interface InteractionContext {
  readonly world: World;
  readonly items: ItemRegistry;
  /** Other bodies that solid blocks may not be placed into. */
  readonly blockers?: readonly BodyRect[];
  /** Random source for drop rolls (seeded on the server for replayability). */
  readonly random?: () => number;
}

/** Damage resets if the same target is not hit again within this many seconds. */
const PROGRESS_TIMEOUT = 3;

interface Plan {
  action: UseAction;
  reason?: UseFailReason;
  item?: ItemDef;
  object?: WorldObject;
  /** Hit points of the target (mine/chop). */
  hp?: number;
  power?: number;
  placeId?: number;
  speed: number;
}

const fail = (reason: UseFailReason, speed = HAND_SPEED): Plan => ({
  action: 'none',
  reason,
  speed,
});

function intersects(a: BodyRect, l: number, t: number, r: number, b: number): boolean {
  const al = a.x - a.width / 2;
  const ar = a.x + a.width / 2;
  const at = a.y - a.height;
  return al < r && ar > l && at < b && a.y > t;
}

function isSolidOrPlatform(world: World, tx: number, ty: number): boolean {
  const id = world.getFg(tx, ty);
  return id !== 0 && (world.tiles.collision[id] ?? 0) !== COLLISION_NONE;
}

function plan(
  ctx: InteractionContext,
  actor: InteractionActor,
  slot: number,
  tx: number,
  ty: number,
): Plan {
  const { world, items } = ctx;
  if (!world.inTileBounds(tx, ty)) return fail('out_of_world');
  const stack = actor.inventory.get(slot);
  const item = stack ? items.get(stack.itemId) : undefined;
  const tool = item?.tool;
  const speed = tool ? tool.speed : item?.places ? PLACE_SPEED : HAND_SPEED;
  const reach = tool?.reach ?? HAND_REACH;
  const cx = actor.x;
  const cy = actor.y - actor.height / 2;
  const dx = tx * TILE_SIZE + TILE_SIZE / 2 - cx;
  const dy = ty * TILE_SIZE + TILE_SIZE / 2 - cy;
  if (Math.hypot(dx, dy) > reach * TILE_SIZE) return fail('out_of_reach', speed);

  const fg = world.getFg(tx, ty);
  const object = world.objectAt(tx, ty) ?? undefined;
  const objDef = object ? getObjectDef(object.key) : undefined;

  // --- Placing --------------------------------------------------------------------------------
  if (item?.places) {
    const placeId = world.tiles.idOf(item.places);
    const placeDef = world.tiles.get(placeId);
    if (fg !== 0) return fail('occupied', speed);
    if (object && !objDef?.replaceable) return fail('occupied', speed);
    const wall = world.getBg(tx, ty) !== 0;
    const solidSide = (x: number, y: number): boolean =>
      (world.tiles.collision[world.getFg(x, y)] ?? 0) === 1;
    const supported =
      placeDef?.collision === 'none'
        ? wall || solidSide(tx - 1, ty) || solidSide(tx + 1, ty) || solidSide(tx, ty + 1)
        : wall ||
          isSolidOrPlatform(world, tx - 1, ty) ||
          isSolidOrPlatform(world, tx + 1, ty) ||
          isSolidOrPlatform(world, tx, ty - 1) ||
          isSolidOrPlatform(world, tx, ty + 1);
    if (!supported) return fail('no_support', speed);
    if (placeDef?.collision === 'solid') {
      const l = tx * TILE_SIZE;
      const t = ty * TILE_SIZE;
      const bodies = [actor, ...(ctx.blockers ?? [])];
      if (bodies.some((b) => intersects(b, l, t, l + TILE_SIZE, t + TILE_SIZE)))
        return fail('blocked_by_body', speed);
    }
    return { action: 'place', item, placeId, speed, ...(object ? { object } : {}) };
  }

  // --- Objects (trees, rocks, plants) ---------------------------------------------------------
  if (object && objDef?.harvest) {
    const h = objDef.harvest;
    if (h.tool === 'hand')
      return {
        action: 'harvest',
        object,
        speed: tool ? tool.speed : HAND_SPEED,
        ...(item ? { item } : {}),
      };
    if (tool && tool.type === h.tool) {
      return {
        action: tool.type === 'axe' ? 'chop' : 'mine',
        object,
        hp: h.hp,
        power: tool.power,
        speed,
        item: item as ItemDef,
      };
    }
    if (fg === 0) return fail(tool ? 'wrong_tool' : 'nothing', speed);
  }

  // --- Tiles ----------------------------------------------------------------------------------
  if (fg !== 0) {
    if (!tool) return fail('nothing', speed);
    if (tool.type !== 'pickaxe') return fail('wrong_tool', speed);
    const def = world.tiles.get(fg);
    if (!def || def.durability < 0) return fail('unbreakable', speed);
    if (tool.power < def.minPower) return fail('tool_too_weak', speed);
    const above = world.objectAnchoredAt(tx, ty - 1);
    if (above && getObjectDef(above.key).blocksSupport) return fail('supports_object', speed);
    return {
      action: 'mine',
      hp: Math.max(1, def.durability),
      power: tool.power,
      speed,
      item: item as ItemDef,
    };
  }
  return fail('nothing', speed);
}

/** What using the selected item on a tile would do, without changing anything (cursor preview). */
export function previewUse(
  ctx: InteractionContext,
  actor: InteractionActor,
  slot: number,
  tx: number,
  ty: number,
): { action: UseAction; ok: boolean; reason?: UseFailReason } {
  const p = plan(ctx, actor, slot, tx, ty);
  return p.reason
    ? { action: p.action, ok: false, reason: p.reason }
    : { action: p.action, ok: true };
}

function rollDrops(
  drops: readonly ObjectDrop[],
  x: number,
  y: number,
  random: () => number,
): Drop[] {
  const out: Drop[] = [];
  for (const d of drops) {
    if (random() >= d.chance) continue;
    const count = d.min + Math.floor(random() * (d.max - d.min + 1));
    if (count > 0) out.push({ itemId: d.item, count, x, y });
  }
  return out;
}

function objectCenter(o: WorldObject): { x: number; y: number } {
  const fp = getObjectDef(o.key).footprint;
  return {
    x: o.tx * TILE_SIZE + TILE_SIZE / 2,
    y: (o.ty + 1) * TILE_SIZE - Math.min(fp.h, 2) * (TILE_SIZE / 2),
  };
}

/** Remove torches that lost their support after the tile at (tx, ty) became air. */
function popUnsupportedTorches(world: World, tx: number, ty: number, drops: Drop[]): void {
  const torch = TILE.torch;
  for (const [x, y] of [
    [tx - 1, ty],
    [tx + 1, ty],
    [tx, ty - 1],
  ] as const) {
    if (world.getFg(x, y) !== torch) continue;
    const solid = (a: number, b: number): boolean =>
      (world.tiles.collision[world.getFg(a, b)] ?? 0) === 1;
    if (world.getBg(x, y) !== 0 || solid(x - 1, y) || solid(x + 1, y) || solid(x, y + 1)) continue;
    world.setTile(x, y, 'fg', 0);
    drops.push({ itemId: 'torch', count: 1, x: x * TILE_SIZE + 8, y: y * TILE_SIZE + 8 });
  }
}

/**
 * Use the item in `slot` on tile (tx, ty) at simulation time `now`.
 * All rules (reach, cooldown, tool type & power, support, overlap) are enforced here.
 */
export function applyItemUse(
  ctx: InteractionContext,
  actor: InteractionActor,
  slot: number,
  tx: number,
  ty: number,
  now: number,
): UseOutcome {
  const base = {
    tx,
    ty,
    progress: 0,
    broke: false,
    drops: [] as Drop[],
    removedObjects: [] as WorldObject[],
  };
  if (now < actor.nextUseAt) return { ...base, ok: false, action: 'none', reason: 'cooldown' };
  const p = plan(ctx, actor, slot, tx, ty);
  if (p.reason) return { ...base, ok: false, action: p.action, reason: p.reason };
  const { world } = ctx;
  const random = ctx.random ?? Math.random;
  actor.nextUseAt = now + 1 / p.speed;
  const drops: Drop[] = [];
  const removed: WorldObject[] = [];

  if (p.action === 'place' && p.placeId !== undefined) {
    if (p.object) {
      world.removeObject(p.object);
      removed.push(p.object);
    }
    world.setTile(tx, ty, 'fg', p.placeId);
    if ((world.tiles.collision[p.placeId] ?? 0) === 1 && world.getFg(tx, ty + 1) === TILE.grass) {
      world.setTile(tx, ty + 1, 'fg', TILE.dirt);
    }
    actor.inventory.removeAt(slot, 1);
    return { ...base, ok: true, action: 'place', placedTile: p.placeId, removedObjects: removed };
  }

  if (p.action === 'harvest' && p.object) {
    const def = getObjectDef(p.object.key);
    world.removeObject(p.object);
    const c = objectCenter(p.object);
    drops.push(...rollDrops(def.harvest?.drops ?? [], c.x, c.y, random));
    return {
      ...base,
      ok: true,
      action: 'harvest',
      broke: true,
      progress: 1,
      drops,
      removedObjects: [p.object],
      hitObject: p.object,
    };
  }

  // mine / chop with accumulated damage
  const key = p.object ? `o:${p.object.id}` : `t:${tx},${ty}`;
  if (
    !actor.progress ||
    actor.progress.key !== key ||
    now - actor.progress.lastHit > PROGRESS_TIMEOUT
  ) {
    actor.progress = { key, damage: 0, lastHit: now };
  }
  const prog = actor.progress;
  prog.damage += p.power ?? 0;
  prog.lastHit = now;
  const hp = p.hp ?? 1;
  const progress = Math.min(1, prog.damage / hp);
  if (prog.damage < hp) {
    return {
      ...base,
      ok: true,
      action: p.action,
      progress,
      ...(p.object ? { hitObject: p.object } : {}),
    };
  }
  actor.progress = null;

  if (p.object) {
    const def = getObjectDef(p.object.key);
    world.removeObject(p.object);
    const c = objectCenter(p.object);
    drops.push(...rollDrops(def.harvest?.drops ?? [], c.x, c.y, random));
    return {
      ...base,
      ok: true,
      action: p.action,
      progress: 1,
      broke: true,
      drops,
      hitObject: p.object,
      removedObjects: [p.object],
    };
  }

  const fg = world.getFg(tx, ty);
  const def = world.tiles.get(fg);
  world.setTile(tx, ty, 'fg', 0);
  if (def?.drop)
    drops.push({ itemId: def.drop, count: 1, x: tx * TILE_SIZE + 8, y: ty * TILE_SIZE + 8 });
  // Plants standing on the broken tile lose their footing.
  const above = world.objectAnchoredAt(tx, ty - 1);
  if (above && getObjectDef(above.key).replaceable) {
    world.removeObject(above);
    removed.push(above);
    const c = objectCenter(above);
    drops.push(...rollDrops(getObjectDef(above.key).harvest?.drops ?? [], c.x, c.y, random));
  }
  popUnsupportedTorches(world, tx, ty, drops);
  return {
    ...base,
    ok: true,
    action: 'mine',
    progress: 1,
    broke: true,
    drops,
    brokenTile: fg,
    removedObjects: removed,
  };
}
