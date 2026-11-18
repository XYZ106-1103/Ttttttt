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
  | 'debug';
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
