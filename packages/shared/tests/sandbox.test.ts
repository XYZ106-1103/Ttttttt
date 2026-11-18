import { describe, expect, it } from 'vitest';
import {
  craft,
  DEFAULT_OVERWORLD,
  getRecipe,
  HOTBAR_SIZE,
  type InteractionActor,
  type InteractionContext,
  Inventory,
  itemRegistry,
  maxCraftable,
  OverworldGenerator,
  previewUse,
  seedFromString,
  TILE,
  TILE_SIZE,
  applyItemUse,
  World,
} from '../src';

describe('Inventory', () => {
  it('stacks up to maxStack and reports overflow', () => {
    const inv = new Inventory(3);
    expect(inv.add('dirt', 1500)).toBe(0);
    expect(inv.get(0)).toEqual({ itemId: 'dirt', count: 999 });
    expect(inv.get(1)).toEqual({ itemId: 'dirt', count: 501 });
    // Room left: 498 in slot 1 + 999 in slot 2 = 1497.
    expect(inv.add('dirt', 2000)).toBe(503);
    expect(inv.count('dirt')).toBe(2997);
  });

  it('rejects unknown items and invalid counts', () => {
    const inv = new Inventory(4);
    expect(inv.add('not_an_item', 5)).toBe(5);
    expect(inv.add('dirt', -3)).toBe(0);
    expect(inv.add('dirt', 1.5)).toBe(1);
    expect(inv.count('dirt')).toBe(0);
  });

  it('removes all-or-nothing', () => {
    const inv = new Inventory(4);
    inv.add('stone', 10);
    expect(inv.remove('stone', 11)).toBe(false);
    expect(inv.remove('stone', 4)).toBe(true);
    expect(inv.count('stone')).toBe(6);
  });

  it('moves, merges and swaps', () => {
    const inv = new Inventory(4);
    inv.add('torch', 99);
    inv.add('torch', 10); // second slot
    inv.move(1, 0); // full stack: swap
    expect(inv.get(0)?.count).toBe(10);
    inv.add('wood', 5);
    inv.move(2, 3);
    expect(inv.get(3)).toEqual({ itemId: 'wood', count: 5 });
    expect(inv.get(2)).toBeNull();
  });

  it('implements cursor click semantics (pick, place, half, one)', () => {
    const inv = new Inventory(4);
    inv.add('wood', 9);
    inv.click(0, 'right'); // pick half (5)
    expect(inv.cursor).toEqual({ itemId: 'wood', count: 5 });
    expect(inv.get(0)?.count).toBe(4);
    inv.click(1, 'right'); // place one
    expect(inv.get(1)?.count).toBe(1);
    inv.click(0, 'left'); // merge rest into slot 0
    expect(inv.get(0)?.count).toBe(8);
    expect(inv.cursor).toBeNull();
    inv.click(0, 'left');
    expect(inv.cursor?.count).toBe(8);
    expect(inv.returnCursor()).toBeNull();
    expect(inv.count('wood')).toBe(9);
  });

  it('round-trips through save data and sanitizes bad entries', () => {
    const inv = new Inventory(5);
    inv.add('worn_pickaxe', 1);
    inv.add('dirt', 42);
    const copy = new Inventory(5);
    copy.load(JSON.parse(JSON.stringify(inv.toJSON())));
    expect(copy.snapshot()).toEqual(inv.snapshot());
    copy.load({
      slots: [
        { itemId: 'hacked', count: 9 },
        { itemId: 'dirt', count: 99999 },
      ],
      cursor: null,
    });
    expect(copy.get(0)).toBeNull();
    expect(copy.get(1)?.count).toBe(999);
    expect(HOTBAR_SIZE).toBe(10);
  });
});

describe('crafting', () => {
  it('consumes ingredients and produces output atomically', () => {
    const inv = new Inventory(10);
    inv.add('wood', 3);
    inv.add('fiber', 1);
    const torch = getRecipe('torch')!;
    expect(maxCraftable(inv, torch)).toBe(1);
    expect(craft(inv, 'torch').ok).toBe(true);
    expect(inv.count('torch')).toBe(3);
    expect(inv.count('wood')).toBe(2);
    const fail = craft(inv, 'torch');
    expect(fail.reason).toBe('missing_ingredients');
    expect(inv.count('wood')).toBe(2);
  });

  it('crafts multiple times and rejects unknown recipes', () => {
    const inv = new Inventory(10);
    inv.add('wood', 4);
    expect(craft(inv, 'wood_planks', 4).crafted).toBe(4);
    expect(inv.count('wood_planks')).toBe(8);
    expect(craft(inv, 'nope').reason).toBe('unknown_recipe');
  });

  it('every recipe references known items', () => {
    for (const id of [
      'wood_planks',
      'wood_platform',
      'torch',
      'stone_bricks',
      'copper_pickaxe',
      'iron_axe',
    ]) {
      const r = getRecipe(id)!;
      expect(itemRegistry.has(r.output.item)).toBe(true);
      for (const i of r.inputs) expect(itemRegistry.has(i.item)).toBe(true);
    }
  });
});

function setup() {
  const world = new World(
    new OverworldGenerator({ seed: seedFromString('PROJECT-WORLD'), ...DEFAULT_OVERWORLD }),
  );
  const spawn = world.spawnPoint();
  const inventory = new Inventory();
  inventory.add('worn_pickaxe', 1); // slot 0
  inventory.add('worn_axe', 1); // slot 1
  inventory.add('dirt', 10); // slot 2
  inventory.add('torch', 5); // slot 3
  const actor: InteractionActor & { x: number; y: number } = {
    x: spawn.x,
    y: spawn.y,
    width: 14,
    height: 44,
    inventory,
    progress: null,
    nextUseAt: 0,
  };
  let r = 0.5;
  const ctx: InteractionContext = {
    world,
    items: itemRegistry,
    random: () => (r = ((r * 9301 + 49297) % 233280) / 233280),
  };
  const tx = Math.floor(spawn.x / TILE_SIZE);
  const ty = spawn.y / TILE_SIZE; // ground row under the feet
  return { world, actor, ctx, tx, ty };
}

/** Hit until the outcome breaks (or `max` uses), advancing time past the cooldown. */
function hitUntilBroken(
  ctx: InteractionContext,
  actor: InteractionActor,
  slot: number,
  tx: number,
  ty: number,
  t0 = 0,
) {
  let t = t0;
  for (let i = 0; i < 20; i++) {
    const out = applyItemUse(ctx, actor, slot, tx, ty, t);
    t += 1;
    if (!out.ok || out.broke) return { out, hits: i + 1, t };
  }
  throw new Error('never broke');
}

describe('interaction rules', () => {
  it('mines a dirt block with accumulated damage and drops dirt', () => {
    const { ctx, actor, tx, ty, world } = setup();
    const col = tx + 2;
    const first = applyItemUse(ctx, actor, 0, col, ty, 0);
    expect(first.ok).toBe(true);
    expect(first.action).toBe('mine');
    expect(first.broke).toBe(false);
    expect(first.progress).toBeCloseTo(35 / 50, 5);
    const second = applyItemUse(ctx, actor, 0, col, ty, 1);
    expect(second.broke).toBe(true);
    expect(second.drops).toEqual([{ itemId: 'dirt', count: 1, x: col * 16 + 8, y: ty * 16 + 8 }]);
    expect(world.getFg(col, ty)).toBe(0);
  });

  it('enforces cooldown, reach and tool type', () => {
    const { ctx, actor, tx, ty } = setup();
    expect(applyItemUse(ctx, actor, 0, tx + 2, ty, 0).ok).toBe(true);
    expect(applyItemUse(ctx, actor, 0, tx + 2, ty, 0.05).reason).toBe('cooldown');
    expect(applyItemUse(ctx, actor, 0, tx + 20, ty, 5).reason).toBe('out_of_reach');
    expect(applyItemUse(ctx, actor, 1, tx + 3, ty, 6).reason).toBe('wrong_tool');
  });

  it('requires enough pickaxe power for iron', () => {
    const { ctx, actor, tx, ty, world } = setup();
    world.setTile(tx + 2, ty, 'fg', TILE.ironOre);
    expect(previewUse(ctx, actor, 0, tx + 2, ty).reason).toBe('tool_too_weak');
    actor.inventory.removeAt(0, 1);
    actor.inventory.add('copper_pickaxe', 1);
    const slot = [...Array(40).keys()].find(
      (i) => actor.inventory.get(i)?.itemId === 'copper_pickaxe',
    )!;
    const res = hitUntilBroken(ctx, actor, slot, tx + 2, ty);
    expect(res.out.drops[0]?.itemId).toBe('iron_ore');
    expect(res.hits).toBe(4); // 200 hp / 55 power
  });

  it('places blocks only with support and never inside the player', () => {
    const { ctx, actor, tx, ty, world } = setup();
    // Inside the player's body.
    expect(previewUse(ctx, actor, 2, tx, ty - 1).reason).toBe('blocked_by_body');
    // Next to the ground: fine, and the grass underneath turns to dirt.
    const out = applyItemUse(ctx, actor, 2, tx + 3, ty - 1, 0);
    expect(out.ok).toBe(true);
    expect(world.getFg(tx + 3, ty - 1)).toBe(TILE.dirt);
    expect(world.getFg(tx + 3, ty)).toBe(TILE.dirt);
    expect(actor.inventory.count('dirt')).toBe(9);
    // Floating in the air with nothing around: no support.
    expect(previewUse(ctx, actor, 2, tx - 3, ty - 4).reason).toBe('no_support');
    // Occupied tile.
    expect(previewUse(ctx, actor, 2, tx + 3, ty - 1).reason).toBe('occupied');
  });

  it('torches need a solid side or a wall, and pop off when their support is mined', () => {
    const { ctx, actor, tx, ty, world } = setup();
    expect(applyItemUse(ctx, actor, 3, tx + 2, ty - 1, 0).ok).toBe(true);
    expect(world.getFg(tx + 2, ty - 1)).toBe(TILE.torch);
    const res = hitUntilBroken(ctx, actor, 0, tx + 2, ty, 1);
    expect(res.out.broke).toBe(true);
    expect(world.getFg(tx + 2, ty - 1)).toBe(0);
    expect(res.out.drops.map((d) => d.itemId).sort()).toEqual(['dirt', 'torch']);
  });

  it('chops trees with an axe, refuses to mine the ground under them', () => {
    const { ctx, actor, world, ty } = setup();
    // Find a tree near spawn.
    let tree = null;
    for (let cx = 28; cx <= 36 && !tree; cx++) {
      tree =
        world
          .objectsInChunk(cx, Math.floor((ty - 1) / 32))
          .find((o) => o.key.startsWith('tree_')) ?? null;
    }
    expect(tree).not.toBeNull();
    actor.x = tree!.tx * 16 + 40;
    actor.y = (tree!.ty + 1) * 16;
    expect(previewUse(ctx, actor, 0, tree!.tx, tree!.ty + 1).reason).toBe('supports_object');
    const res = hitUntilBroken(ctx, actor, 1, tree!.tx, tree!.ty - 1);
    expect(res.out.action).toBe('chop');
    expect(res.out.broke).toBe(true);
    expect(res.out.drops[0]?.itemId).toBe('wood');
    expect(world.objectAt(tree!.tx, tree!.ty)).toBeNull();
  });

  it('harvests plants by hand and they break when their ground is mined', () => {
    const { ctx, actor, world, tx, ty } = setup();
    let plant = null;
    for (let x = tx - 5; x <= tx + 5 && !plant; x++) {
      const o = world.objectAnchoredAt(x, ty - 1);
      if (o && (o.key === 'grass_tuft' || o.key === 'flower' || o.key === 'tall_grass')) plant = o;
    }
    expect(plant).not.toBeNull();
    actor.inventory.load({ slots: [], cursor: null }); // empty hands
    const out = applyItemUse(ctx, actor, 5, plant!.tx, plant!.ty, 0);
    expect(out.action).toBe('harvest');
    expect(world.objectAnchoredAt(plant!.tx, plant!.ty)).toBeNull();
  });
});
