import { Character, HURT_IFRAMES, type MovementConfig, SKILL_BAR_SIZE } from '@world/shared';
import type { PlayerSave } from '../persistence/SaveStore';

export { SKILL_BAR_SIZE };
export const PLAYER_HURT_IFRAMES = HURT_IFRAMES;

/**
 * The local player's character. All rules live in the shared Character (AI adventurers use the
 * same class); this subclass only adds save-format glue.
 */
export class Player extends Character {
  constructor(id: number, name: string, x: number, y: number, movement: MovementConfig) {
    super(id, 'player', name, x, y, movement);
  }

  exportFields(): ReturnType<Character['exportSnapshot']> {
    return this.exportSnapshot();
  }

  /** Load a save (v1 saves predate combat and get the starter weapon and potions once). */
  importSave(p: PlayerSave): void {
    this.importSnapshot(p, (p.v ?? 1) < 2);
  }
}
