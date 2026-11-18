import type { CraftResult, World } from '@world/shared';

/**
 * Commands the UI may send to the game, and read-only queries it may make.
 * The UI never touches Phaser objects or mutates simulation state directly.
 */
export interface GameCommands {
  startGame(): void;
  returnToTitle(): void;
  /** Developer command (/time). PHASE 6 restricts to admins server-side. */
  setTimeOfDay(hours: number): void;
  /** Developer command (/tp, /spawn). Places the player's feet on top of tile (x, y). */
  teleport(tileX: number, tileY: number): boolean;
  spawn(): void;
  selectSlot(index: number): void;
  inventoryClick(index: number, button: 'left' | 'right'): void;
  /** Put the cursor stack back (inventory window closed). */
  returnCursor(): void;
  craft(recipeId: string, times: number): CraftResult;
  /** Delete the saved world. `start` immediately begins a new adventure afterwards. */
  resetWorld(start: boolean): Promise<void>;
}

export interface GameQueries {
  getWorld(): World | null;
  getPlayerTile(): { x: number; y: number } | null;
  /** Chunk indices seen by the player (world map fog of war). */
  getExplored(): ReadonlySet<number>;
}

/** Late-bound bridge: the world scene attaches its implementation once created. */
export class GameBridge implements GameCommands, GameQueries {
  private impl: (GameCommands & GameQueries) | null = null;

  attach(impl: GameCommands & GameQueries): void {
    this.impl = impl;
  }

  detach(): void {
    this.impl = null;
  }

  startGame(): void {
    this.impl?.startGame();
  }
  returnToTitle(): void {
    this.impl?.returnToTitle();
  }
  setTimeOfDay(hours: number): void {
    this.impl?.setTimeOfDay(hours);
  }
  teleport(tileX: number, tileY: number): boolean {
    return this.impl?.teleport(tileX, tileY) ?? false;
  }
  spawn(): void {
    this.impl?.spawn();
  }
  selectSlot(index: number): void {
    this.impl?.selectSlot(index);
  }
  inventoryClick(index: number, button: 'left' | 'right'): void {
    this.impl?.inventoryClick(index, button);
  }
  returnCursor(): void {
    this.impl?.returnCursor();
  }
  craft(recipeId: string, times: number): CraftResult {
    return this.impl?.craft(recipeId, times) ?? { ok: false, crafted: 0 };
  }
  async resetWorld(start: boolean): Promise<void> {
    await this.impl?.resetWorld(start);
  }
  getExplored(): ReadonlySet<number> {
    return this.impl?.getExplored() ?? new Set();
  }
  getWorld(): World | null {
    return this.impl?.getWorld() ?? null;
  }
  getPlayerTile(): { x: number; y: number } | null {
    return this.impl?.getPlayerTile() ?? null;
  }
}
