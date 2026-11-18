import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GameBridge } from './app/GameBridge';
import { createStores } from './app/stores';
import { PLAYER_APPEARANCE } from './game/art/character/appearance';
import { createGame } from './game/createGame';
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

  const uiRoot = document.getElementById('ui-root');
  const gameRoot = document.getElementById('game-root');
  if (!uiRoot || !gameRoot) throw new Error('Missing root elements');

  createRoot(uiRoot).render(
    <StrictMode>
      <UiContext.Provider value={{ stores, bridge, input }}>
        <UiRoot />
      </UiContext.Provider>
    </StrictMode>,
  );

  if (!hasWebGL()) {
    stores.app.set({ phase: 'error', error: t('boot.webglError') });
    return;
  }

  await loadFonts();
  const services: GameServices = {
    stores,
    input,
    bridge,
    assets: { tileset: null, parallax: [] },
    playerAppearance: PLAYER_APPEARANCE,
  };
  const game = createGame(gameRoot, services);

  // Read-only hooks for automated tests and debugging (no state mutation exposed).
  (window as unknown as { __PW__: unknown }).__PW__ = {
    snapshot: () =>
      (
        game.scene.getScene('World') as unknown as { debugSnapshot?: () => unknown }
      )?.debugSnapshot?.(),
    stores,
  };
}

bootstrap().catch((err) => {
  console.error(err);
  const el = document.getElementById('ui-root');
  if (el)
    el.textContent = `PROJECT WORLD failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
