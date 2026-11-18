import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Active buffs and debuffs under the status panel, with remaining time. */
export function BuffBar() {
  const { stores, icons } = useServices();
  const buffs = useStore(stores.combat, (s) => s.buffs);
  if (buffs.length === 0) return null;
  return (
    <div className="pw-buffs" data-testid="buffs">
      {buffs.map((b) => (
        <div
          key={b.id}
          className={`pw-buff ${b.kind === 'debuff' ? 'is-debuff' : ''} ${b.left < 3 ? 'is-ending' : ''}`}
          title={t(`status.${b.id}`)}
        >
          {icons[`status:${b.id}`] ? (
            <img src={icons[`status:${b.id}`]} alt="" draggable={false} />
          ) : null}
          <span className="pw-buff__time">
            {b.left >= 60 ? `${Math.floor(b.left / 60)}m` : Math.ceil(b.left)}
          </span>
        </div>
      ))}
    </div>
  );
}
