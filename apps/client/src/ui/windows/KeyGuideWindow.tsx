import { t } from '../../i18n';
import { keyLabel } from '../../input/keybindings';
import { KeyCap } from '../components/KeyCap';
import { Window } from '../components/Window';
import { useServices } from '../context';

export function KeyGuideWindow(props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { input } = useServices();
  const keys = (action: Parameters<typeof input.bindingFor>[0]) =>
    input.bindingFor(action).map(keyLabel);
  const rows: { label: string; keys: string[] }[] = [
    { label: t('keys.move'), keys: [...keys('moveLeft'), ...keys('moveRight')] },
    { label: t('keys.jump'), keys: keys('jump') },
    { label: t('keys.drop'), keys: [`${keys('down')[0]} + ${keys('jump')[0]}`] },
    { label: t('keys.use'), keys: ['LMB'] },
    { label: t('keys.hotbar'), keys: ['1-0', 'Wheel'] },
    { label: t('keys.inventory'), keys: keys('inventory') },
    { label: t('keys.worldMap'), keys: keys('worldMap') },
    { label: t('keys.chat'), keys: keys('chat').slice(0, 1) },
    { label: t('keys.character'), keys: keys('character') },
    { label: t('keys.keyGuide'), keys: keys('keyGuide') },
    { label: t('keys.debug'), keys: keys('debug') },
    { label: t('keys.menu'), keys: keys('menu') },
  ];
  return (
    <Window
      title={t('window.keyGuide')}
      width={360}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 180), y: 160 }}
      testId="window-keyguide"
      {...props}
    >
      <table className="pw-keys">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>
                {r.keys.map((k) => (
                  <KeyCap key={k}>{k}</KeyCap>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Window>
  );
}
