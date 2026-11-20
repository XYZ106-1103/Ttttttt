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
import { AudioEngine } from './game/audio/AudioEngine';
import type { SfxName } from './game/audio/sfx';
import type { ThemeId } from './game/audio/music';
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
  const audio = new AudioEngine();
  const applyVolumes = (): void => {
    const s = stores.settings.get();
    audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
  };
  applyVolumes();
  stores.settings.subscribe(applyVolumes);
  // Window open/close sounds.
  let openWindows = stores.ui.get().windows.length;
  stores.ui.subscribe(() => {
    const n = stores.ui.get().windows.length;
    if (n > openWindows) audio.play('ui_open');
    else if (n < openWindows) audio.play('ui_close');
    openWindows = n;
  });

  const uiRoot = document.getElementById('ui-root');
  const gameRoot = document.getElementById('game-root');
  if (!uiRoot || !gameRoot) throw new Error('Missing root elements');

  createRoot(uiRoot).render(
    <StrictMode>
      <UiContext.Provider value={{ stores, bridge, input, icons, audio }}>
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
    audio,
  };
  const game = createGame(gameRoot, services);

  // Read-only hooks for automated tests and debugging (no state mutation exposed).
  interface WorldDebug {
    debugSnapshot(): unknown;
    debugTile(tx: number, ty: number): number;
    debugCount(itemId: string): number;
    debugFlushSave(): Promise<void>;
    debugSummon(id: string): boolean;
    debugMonsters(): unknown;
    debugAdventurers(): unknown;
    debugNpc(id: string): unknown;
    debugNearestObject(prefix: string): unknown;
    debugPeers(): unknown;
  }
  const scene = (): Partial<WorldDebug> | null =>
    game.scene.getScene('World') as unknown as Partial<WorldDebug> | null;
  (window as unknown as { __PW__: unknown }).__PW__ = {
    snapshot: () => scene()?.debugSnapshot?.(),
    tile: (tx: number, ty: number) => scene()?.debugTile?.(tx, ty),
    count: (itemId: string) => scene()?.debugCount?.(itemId),
    flush: () => scene()?.debugFlushSave?.(),
    monsters: () => scene()?.debugMonsters?.(),
    adventurers: () => scene()?.debugAdventurers?.(),
    npc: (id: string) => scene()?.debugNpc?.(id),
    nearest: (prefix: string) => scene()?.debugNearestObject?.(prefix),
    peers: () => scene()?.debugPeers?.(),
    // Test-only spawning lives behind the same developer command the chat exposes (/summon).
    summon: (id: string) => scene()?.debugSummon?.(id),
    stores,
    bridge,
    audio: () => audio.stats(),
    /** Render sounds offline and measure them (quality checks); returns WAV as base64. */
    renderAudio: async (what: { sfx: SfxName[] } | { theme: ThemeId; seconds: number }) => {
      const r = await AudioEngine.renderOffline(what);
      let bin = '';
      for (let i = 0; i < r.wav.length; i += 0x8000)
        bin += String.fromCharCode(...r.wav.subarray(i, i + 0x8000));
      return { peak: r.peak, rms: r.rms, seconds: r.seconds, perSound: r.perSound, wav: btoa(bin) };
    },
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
