import { t } from '../../i18n';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { toggleWindow } from '../windowActions';

/**
 * In-game menu. Note: it does NOT pause the world — PROJECT WORLD is a persistent online world,
 * so time and (later) AI adventurers keep living while the menu is open. Only input is blocked.
 */
export function PauseMenu() {
  const { stores, bridge } = useServices();
  const open = useStore(stores.ui, (s) => s.menuOpen);
  if (!open) return null;
  const close = (): void => stores.ui.set({ menuOpen: false });
  return (
    <div className="pw-modal" onClick={close} data-testid="pause-menu">
      <div className="pw-menu pw-panel pw-panel--ornate" onClick={(e) => e.stopPropagation()}>
        <div className="pw-menu__title">{t('hud.menu')}</div>
        <Button variant="primary" onClick={close}>
          {t('menu.resume')}
        </Button>
        <Button
          onClick={() => {
            close();
            toggleWindow(stores, 'settings');
          }}
        >
          {t('menu.settings')}
        </Button>
        <Button
          onClick={() => {
            close();
            toggleWindow(stores, 'keyGuide');
          }}
        >
          {t('menu.controls')}
        </Button>
        <Button
          testId="menu-title"
          variant="ghost"
          onClick={() => {
            close();
            bridge.returnToTitle();
          }}
        >
          {t('menu.title')}
        </Button>
      </div>
    </div>
  );
}
