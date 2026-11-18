import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameBridge } from './app/GameBridge';
import { createStores } from './app/stores';
import { PLAYER_APPEARANCE } from './game/art/character/appearance';
import { createGame } from './game/createGame';
import { EMPTY_SAVE, openSaveStore } from './game/persistence/SaveStore';
import type { GameServices } from './game/services';
import { setLanguage, t } from './i18n';
import { InputManager } from './input/InputManager';
import { UiContext } from './ui/context';
import { loadFonts } from './ui/fonts';
import { UiRoot } from './ui/UiRoot';
import './ui/styles/index.css';

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function bootstrap(): Promise<void> {
  const stores = createStores();
  setLanguage(stores.settings.get().language);
  const input = new InputManager();
  input.attach(window as unknown as Parameters<InputManager['attach']>[0]);
  const bridge = new GameBridge();
  const icons: Record<string, string> = {};

  const uiRoot = document.getElementById('ui-root');
  const gameRoot = document.getElementById('game-root');
  if (!uiRoot || !gameRoot) throw new Error('Missing root elements');

  createRoot(uiRoot).render(
    <StrictMode>
      <UiContext.Provider value={{ stores, bridge, input, icons }}>
        <UiRoot />
      </UiContext.Provider>
    </StrictMode>,
  );

  if (!hasWebGL()) {
    stores.app.set({ phase: 'error', error: t('boot.webglError') });
    return;
  }

  const [, saveStore] = await Promise.all([loadFonts(), openSaveStore()]);
  const services: GameServices = {
    stores,
    input,
    bridge,
    assets: { tileset: null, parallax: [], save: EMPTY_SAVE },
    playerAppearance: PLAYER_APPEARANCE,
    saveStore,
    icons,
  };
  const game = createGame(gameRoot, services);

  // Read-only hooks for automated tests and debugging (no state mutation exposed).
  interface WorldDebug {
    debugSnapshot(): unknown;
    debugTile(tx: number, ty: number): number;
    debugCount(itemId: string): number;
    debugFlushSave(): Promise<void>;
  }
  const scene = (): Partial<WorldDebug> | null =>
    game.scene.getScene('World') as unknown as Partial<WorldDebug> | null;
  (window as unknown as { __PW__: unknown }).__PW__ = {
    snapshot: () => scene()?.debugSnapshot?.(),
    tile: (tx: number, ty: number) => scene()?.debugTile?.(tx, ty),
    count: (itemId: string) => scene()?.debugCount?.(itemId),
    flush: () => scene()?.debugFlushSave?.(),
    stores,
  };
  // Development builds only: full access for debugging from the console. Never in production.
  if (import.meta.env.DEV) (window as unknown as { __PW_GAME__: unknown }).__PW_GAME__ = game;
}

bootstrap().catch((err) => {
  console.error(err);
  const el = document.getElementById('ui-root');
  if (el)
    el.textContent = `PROJECT WORLD failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
