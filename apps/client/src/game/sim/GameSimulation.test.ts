import { describe, expect, it } from 'vitest';
import { IDLE_INPUT, seedFromString, SIM_DT } from '@world/shared';
import { MemorySaveStore } from '../persistence/SaveStore';
import { GameSimulation } from './GameSimulation';

const SEED = seedFromString('PROJECT-WORLD');
const make = (save?: ConstructorParameters<typeof GameSimulation>[0]['save']) =>
  new GameSimulation({ seed: SEED, worldId: 'test', playerName: 'tester', save });

function settle(
  sim: GameSimulation,
  seconds: number,
  use: { tx: number; ty: number } | null = null,
): void {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) sim.tick(SIM_DT, IDLE_INPUT, use);
}

describe('GameSimulation sandbox loop', () => {
  it('starts with the starting kit in the hotbar', () => {
    const sim = make();
    expect(sim.player.inventory.get(0)?.itemId).toBe('worn_pickaxe');
    expect(sim.player.inventory.get(1)?.itemId).toBe('worn_axe');
    expect(sim.player.inventory.count('torch')).toBe(10);
  });

  it('mines with held input, spawns a drop and magnet-collects it', () => {
    const sim = make();
    settle(sim, 0.5);
    const tx = Math.floor(sim.player.motor.x / 16) + 2;
    const ty = Math.round(sim.player.motor.y / 16);
    expect(sim.world.getFg(tx, ty)).not.toBe(0);
    settle(sim, 1.2, { tx, ty });
    expect(sim.world.getFg(tx, ty)).toBe(0);
    settle(sim, 2);
    expect(sim.drops.length).toBe(0);
    expect(sim.player.inventory.count('dirt')).toBe(1);
    expect(sim.events.pickups.some((p) => p.itemId === 'dirt')).toBe(true);
  });

  it('round-trips world changes and the player through a save store', async () => {
    const store = new MemorySaveStore(true);
    const a = make();
    settle(a, 0.5);
    const tx = Math.floor(a.player.motor.x / 16) - 3;
    const ty = Math.round(a.player.motor.y / 16);
    settle(a, 1.2, { tx, ty });
    settle(a, 2);
    a.selectSlot(3);
    a.explored.add(42);
    await store.saveChunks('test', a.world.collectDirty());
    await store.saveState('test', a.exportMeta(SEED), a.exportPlayer());

    const b = make(await store.load('test'));
    expect(b.world.getFg(tx, ty)).toBe(0);
    expect(b.player.inventory.count('dirt')).toBe(a.player.inventory.count('dirt'));
    expect(b.player.selectedSlot).toBe(3);
    expect(b.explored.has(42)).toBe(true);
    expect(Math.abs(b.player.motor.x - a.player.motor.x)).toBeLessThan(1);
  });

  it('crafts through the simulation and returns the cursor stack', () => {
    const sim = make();
    sim.player.inventory.add('wood', 2);
    expect(sim.craft('wood_planks', 2).crafted).toBe(2);
    expect(sim.player.inventory.count('wood_planks')).toBe(4);
    sim.clickInventory(0, 'left');
    expect(sim.player.inventory.cursor?.itemId).toBe('worn_pickaxe');
    sim.returnCursor();
    expect(sim.player.inventory.cursor).toBeNull();
    expect(sim.player.inventory.count('worn_pickaxe')).toBe(1);
  });
});
