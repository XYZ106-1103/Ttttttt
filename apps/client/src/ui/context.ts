import { createContext, useContext } from 'react';
import type { GameBridge } from '../app/GameBridge';
import type { Stores } from '../app/stores';
import type { AudioEngine } from '../game/audio/AudioEngine';
import type { InputManager } from '../input/InputManager';

export interface UiServices {
  readonly stores: Stores;
  readonly bridge: GameBridge;
  readonly input: InputManager;
  readonly audio: AudioEngine;
  /** Item id → data URL icon (filled once the game has booted). */
  readonly icons: Record<string, string>;
}

export const UiContext = createContext<UiServices | null>(null);

export function useServices(): UiServices {
  const s = useContext(UiContext);
  if (!s) throw new Error('UiContext missing');
  return s;
}
