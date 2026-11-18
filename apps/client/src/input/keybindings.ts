/**
 * Input actions and their default key bindings (KeyboardEvent.code, so they are layout- and
 * IME-independent — Korean IME input does not affect game controls).
 */
export type GameplayAction = 'moveLeft' | 'moveRight' | 'jump' | 'down' | 'up';
export type UiAction =
  | 'chat'
  | 'menu'
  | 'character'
  | 'inventory'
  | 'skills'
  | 'quests'
  | 'worldMap'
  | 'keyGuide'
  | 'debug'
  | 'hotbar1'
  | 'hotbar2'
  | 'hotbar3'
  | 'hotbar4'
  | 'hotbar5'
  | 'hotbar6'
  | 'hotbar7'
  | 'hotbar8'
  | 'hotbar9'
  | 'hotbar10';
export type Action = GameplayAction | UiAction;

export const GAMEPLAY_ACTIONS: readonly GameplayAction[] = [
  'moveLeft',
  'moveRight',
  'jump',
  'down',
  'up',
];

export type Bindings = Readonly<Record<Action, readonly string[]>>;

export const DEFAULT_BINDINGS: Bindings = {
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'KeyX'],
  down: ['KeyS', 'ArrowDown'],
  up: ['KeyW', 'ArrowUp'],
  chat: ['Enter', 'NumpadEnter'],
  menu: ['Escape'],
  character: ['KeyC'],
  inventory: ['KeyI'],
  skills: ['KeyK'],
  quests: ['KeyL'],
  worldMap: ['KeyM'],
  keyGuide: ['F1'],
  debug: ['F3'],
  hotbar1: ['Digit1'],
  hotbar2: ['Digit2'],
  hotbar3: ['Digit3'],
  hotbar4: ['Digit4'],
  hotbar5: ['Digit5'],
  hotbar6: ['Digit6'],
  hotbar7: ['Digit7'],
  hotbar8: ['Digit8'],
  hotbar9: ['Digit9'],
  hotbar10: ['Digit0'],
};

/** Human-readable label for a key code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    Space: 'Space',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Escape: 'Esc',
    Enter: 'Enter',
    NumpadEnter: 'Enter',
  };
  return map[code] ?? code;
}
