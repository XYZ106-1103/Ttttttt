import { Character } from '../actors/Character';
import type { MovementConfig } from '../data/movement';
import type { PlayerSave } from './saveTypes';

/**
 * A player's character. All rules live in the shared Character (AI adventurers use the same
 * class); this subclass only adds save-format glue. `key` is 'player' offline, 'pc:<id>' online.
 */
export class Player extends Character {
  constructor(
    id: number,
    name: string,
    x: number,
    y: number,
    movement: MovementConfig,
    key = 'player',
  ) {
    super(id, 'player', name, x, y, movement);
    this.key = key;
  }

  exportFields(): ReturnType<Character['exportSnapshot']> {
    return this.exportSnapshot();
  }

  /** Load a save (v1 saves predate combat and get the starter weapon and potions once). */
  importSave(p: PlayerSave): void {
    this.importSnapshot(p, (p.v ?? 1) < 2);
  }
}
