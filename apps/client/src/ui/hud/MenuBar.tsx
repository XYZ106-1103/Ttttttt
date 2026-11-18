import { pushChat, type WindowId } from '../../app/stores';
import { t } from '../../i18n';
import { keyLabel } from '../../input/keybindings';
import { useServices } from '../context';
import { toggleWindow } from '../windowActions';

interface MenuEntry {
  readonly id: string;
  readonly labelKey: string;
  readonly icon: string;
  readonly window?: WindowId;
  readonly lockedPhase?: string;
  readonly action: 'character' | 'inventory' | 'skills' | 'quests' | 'worldMap' | 'menu';
}

const ENTRIES: readonly MenuEntry[] = [
  {
    id: 'character',
    labelKey: 'hud.character',
    icon: '◆',
    window: 'character',
    action: 'character',
  },
  {
    id: 'inventory',
    labelKey: 'hud.inventory',
    icon: '▣',
    window: 'inventory',
    action: 'inventory',
  },
  { id: 'skills', labelKey: 'hud.skills', icon: '✦', window: 'skills', action: 'skills' },
  { id: 'quests', labelKey: 'hud.quests', icon: '❖', lockedPhase: 'PHASE 5', action: 'quests' },
  {
    id: 'worldMap',
    labelKey: 'hud.worldMap',
    icon: '◎',
    window: 'worldMap',
    action: 'worldMap',
  },
  { id: 'menu', labelKey: 'hud.menu', icon: '≡', action: 'menu' },
];

export function MenuBar() {
  const services = useServices();
  const { stores, input } = services;
  return (
    <nav className="pw-menubar pw-panel">
      {ENTRIES.map((e) => {
        const key = keyLabel(input.bindingFor(e.action)[0] ?? '');
        const title = e.lockedPhase
          ? `${t(e.labelKey)} — ${t('hud.locked', { phase: e.lockedPhase })}`
          : `${t(e.labelKey)} (${key})`;
        return (
          <button
            key={e.id}
            type="button"
            className={`pw-menubtn ${e.lockedPhase ? 'is-locked' : ''}`}
            title={title}
            onClick={() => {
              if (e.lockedPhase) {
                pushChat(
                  stores,
                  'system',
                  t('chat.locked', { name: t(e.labelKey), phase: e.lockedPhase }),
                );
              } else if (e.window) toggleWindow(stores, e.window);
              else if (e.action === 'menu') stores.ui.set((u) => ({ menuOpen: !u.menuOpen }));
            }}
          >
            <span className="pw-menubtn__icon">{e.icon}</span>
            <span className="pw-menubtn__key">{key}</span>
          </button>
        );
      })}
    </nav>
  );
}
