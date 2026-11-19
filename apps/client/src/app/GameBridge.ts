import type { CraftResult, EquipFail, EquipSlotId, LearnFail, StatKey, World } from '@world/shared';
import type { TownServices } from '@world/shared';

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
  clickEquipment(slot: EquipSlotId): EquipFail | null;
  allocateStat(stat: StatKey, amount: number): boolean;
  autoAllocate(): boolean;
  learnSkill(skillId: string): LearnFail | null;
  setSkillSlot(slot: number, skillId: string | null): void;
  advanceJob(jobId: string): boolean;
  respawn(): boolean;
  /** Developer commands (single player only; PHASE 6 restricts them to admins). */
  devLevel(level: number): void;
  devSummon(monsterId: string): boolean;
  devGive(itemId: string, count: number): boolean;
  devHeal(): void;
  devGold(amount: number): void;
  setMonsters(enabled: boolean): void;
}

export interface GameQueries {
  getWorld(): World | null;
  getPlayerTile(): { x: number; y: number } | null;
  /** Chunk indices seen by the player (world map fog of war). */
  getExplored(): ReadonlySet<number>;
  /** Town services (shop, exchange, talking, parties, guilds) — validated commands only. */
  getTown(): TownServices | null;
  /** Name of a character key ('player' or an adventurer) in the current language. */
  nameOf(key: string): string;
  /** Text of a conversation line spoken by an adventurer (or an NPC line key). */
  lineText(
    speaker: string,
    line: string,
    params?: Readonly<Record<string, string | number>>,
  ): string;
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
  clickEquipment(slot: EquipSlotId): EquipFail | null {
    return this.impl?.clickEquipment(slot) ?? 'invalid';
  }
  allocateStat(stat: StatKey, amount: number): boolean {
    return this.impl?.allocateStat(stat, amount) ?? false;
  }
  autoAllocate(): boolean {
    return this.impl?.autoAllocate() ?? false;
  }
  learnSkill(skillId: string): LearnFail | null {
    return this.impl?.learnSkill(skillId) ?? 'unknown';
  }
  setSkillSlot(slot: number, skillId: string | null): void {
    this.impl?.setSkillSlot(slot, skillId);
  }
  advanceJob(jobId: string): boolean {
    return this.impl?.advanceJob(jobId) ?? false;
  }
  respawn(): boolean {
    return this.impl?.respawn() ?? false;
  }
  devLevel(level: number): void {
    this.impl?.devLevel(level);
  }
  devSummon(monsterId: string): boolean {
    return this.impl?.devSummon(monsterId) ?? false;
  }
  devGive(itemId: string, count: number): boolean {
    return this.impl?.devGive(itemId, count) ?? false;
  }
  devHeal(): void {
    this.impl?.devHeal();
  }
  devGold(amount: number): void {
    this.impl?.devGold(amount);
  }
  setMonsters(enabled: boolean): void {
    this.impl?.setMonsters(enabled);
  }
  getTown(): TownServices | null {
    return this.impl?.getTown() ?? null;
  }
  nameOf(key: string): string {
    return this.impl?.nameOf(key) ?? key;
  }
  lineText(
    speaker: string,
    line: string,
    params?: Readonly<Record<string, string | number>>,
  ): string {
    return this.impl?.lineText(speaker, line, params) ?? line;
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
