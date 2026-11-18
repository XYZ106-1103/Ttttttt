import { useEffect } from 'react';
import { pushChat } from '../app/stores';
import { setLanguage, t } from '../i18n';
import type { UiAction } from '../input/keybindings';
import { useServices } from './context';
import { useStore } from './hooks/useStore';
import { Hud } from './hud/Hud';
import { ErrorScreen } from './screens/ErrorScreen';
import { LoadingScreen } from './screens/LoadingScreen';
import { PauseMenu } from './screens/PauseMenu';
import { TitleScreen } from './screens/TitleScreen';
import { toggleWindow } from './windowActions';
import { WindowLayer } from './windows/WindowLayer';

const LOCKED: Partial<Record<UiAction, { key: string; phase: string }>> = {
  quests: { key: 'hud.quests', phase: 'PHASE 5' },
};

/** Global hotkeys → UI state. Gameplay keys are polled by the simulation instead. */
function useHotkeys(): void {
  const { stores, input, bridge } = useServices();
  useEffect(
    () =>
      input.onUiAction((action) => {
        const app = stores.app.get();
        const ui = stores.ui.get();
        const playing = app.phase === 'playing';
        switch (action) {
          case 'menu':
            if (ui.chatOpen) stores.ui.set({ chatOpen: false });
            else if (ui.windows.length > 0) stores.ui.set({ windows: ui.windows.slice(0, -1) });
            else if (playing) stores.ui.set({ menuOpen: !ui.menuOpen });
            break;
          case 'chat':
            if (playing && !ui.menuOpen) stores.ui.set({ chatOpen: true });
            break;
          case 'character':
            if (playing) toggleWindow(stores, 'character');
            break;
          case 'inventory':
            if (playing) toggleWindow(stores, 'inventory');
            break;
          case 'worldMap':
            if (playing) toggleWindow(stores, 'worldMap');
            break;
          case 'skills':
            if (playing) toggleWindow(stores, 'skills');
            break;
          case 'keyGuide':
            toggleWindow(stores, 'keyGuide');
            break;
          case 'debug':
            stores.ui.set({ debugVisible: !ui.debugVisible });
            break;
          default: {
            if (action.startsWith('hotbar')) {
              if (playing && !ui.chatOpen) bridge.selectSlot((Number(action.slice(6)) + 9) % 10);
              break;
            }
            const locked = LOCKED[action];
            if (locked && playing)
              pushChat(
                stores,
                'system',
                t('chat.locked', { name: t(locked.key), phase: locked.phase }),
              );
          }
        }
      }),
    [input, stores, bridge],
  );
}

export function UiRoot() {
  const { stores } = useServices();
  const phase = useStore(stores.app, (s) => s.phase);
  const fade = useStore(stores.app, (s) => s.fade);
  const language = useStore(stores.settings, (s) => s.language);
  const uiScale = useStore(stores.settings, (s) => s.uiScale);
  setLanguage(language);
  useHotkeys();

  return (
    <div className="pw-ui" key={language} style={{ zoom: uiScale }}>
      {phase === 'playing' ? <Hud /> : null}
      {phase === 'title' ? <TitleScreen /> : null}
      <WindowLayer />
      <PauseMenu />
      {phase === 'booting' ? <LoadingScreen /> : null}
      {phase === 'error' ? <ErrorScreen /> : null}
      <div className="pw-fade" style={{ opacity: phase === 'booting' ? 0 : fade }} />
    </div>
  );
}
