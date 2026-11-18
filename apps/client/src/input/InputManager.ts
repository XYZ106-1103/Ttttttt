import {
  type Action,
  type Bindings,
  DEFAULT_BINDINGS,
  GAMEPLAY_ACTIONS,
  type GameplayAction,
  type UiAction,
} from './keybindings';

interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

export interface InputTarget {
  addEventListener(type: string, listener: (e: never) => void): void;
  removeEventListener(type: string, listener: (e: never) => void): void;
}

/** True when the event comes from a text field — those keys belong to the UI, not the game. */
function isTyping(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

/**
 * Keyboard input, decoupled from Phaser so it can drive both the game (polled once per fixed
 * simulation tick) and the UI (event callbacks for window hotkeys).
 */
export class InputManager {
  private bindings: Bindings;
  private codeToActions = new Map<string, Action[]>();
  private readonly heldCodes = new Set<string>();
  private readonly pressed = new Map<GameplayAction, number>();
  private readonly uiListeners = new Set<(action: UiAction) => void>();
  private target: InputTarget | null = null;
  /** When false, gameplay actions read as released (menus, title screen, chat). */
  gameplayEnabled = true;

  constructor(bindings: Bindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.rebuild();
  }

  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.rebuild();
    this.releaseAll();
  }

  private rebuild(): void {
    this.codeToActions.clear();
    for (const [action, codes] of Object.entries(this.bindings) as [Action, readonly string[]][]) {
      for (const code of codes) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
  }

  attach(target: InputTarget): void {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onKeyDown as (e: never) => void);
    target.addEventListener('keyup', this.onKeyUp as (e: never) => void);
    target.addEventListener('blur', this.onBlur as (e: never) => void);
  }

  detach(): void {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onKeyDown as (e: never) => void);
    this.target.removeEventListener('keyup', this.onKeyUp as (e: never) => void);
    this.target.removeEventListener('blur', this.onBlur as (e: never) => void);
    this.target = null;
  }

  /** Feed a key event directly (used by attach() and by tests). */
  handleKeyDown = (e: KeyEventLike): void => {
    if (isTyping(e.target)) return;
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    e.preventDefault();
    this.heldCodes.add(e.code);
    if (e.repeat) return;
    for (const action of actions) {
      if ((GAMEPLAY_ACTIONS as readonly string[]).includes(action)) {
        const a = action as GameplayAction;
        this.pressed.set(a, (this.pressed.get(a) ?? 0) + 1);
      } else {
        for (const l of this.uiListeners) l(action as UiAction);
      }
    }
  };

  handleKeyUp = (e: KeyEventLike): void => {
    this.heldCodes.delete(e.code);
  };

  private onKeyDown = (e: KeyboardEvent): void => this.handleKeyDown(e);
  private onKeyUp = (e: KeyboardEvent): void => this.handleKeyUp(e);
  private onBlur = (): void => this.releaseAll();

  releaseAll(): void {
    this.heldCodes.clear();
    this.pressed.clear();
  }

  isHeld(action: GameplayAction): boolean {
    if (!this.gameplayEnabled) return false;
    for (const code of this.bindings[action]) if (this.heldCodes.has(code)) return true;
    return false;
  }

  /** True if the action was pressed since the last call (consumes the press). */
  consumePressed(action: GameplayAction): boolean {
    const n = this.pressed.get(action) ?? 0;
    if (n > 0) this.pressed.set(action, 0);
    return n > 0 && this.gameplayEnabled;
  }

  /** Horizontal axis from held keys: -1, 0 or 1. */
  axisX(): number {
    return (this.isHeld('moveRight') ? 1 : 0) - (this.isHeld('moveLeft') ? 1 : 0);
  }

  onUiAction(listener: (action: UiAction) => void): () => void {
    this.uiListeners.add(listener);
    return () => this.uiListeners.delete(listener);
  }

  bindingFor(action: Action): readonly string[] {
    return this.bindings[action];
  }
}
