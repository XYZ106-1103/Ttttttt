import { t } from '../../i18n';
import { Gauge } from '../components/Gauge';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

export function ExpBar() {
  const { stores } = useServices();
  const exp = useStore(stores.player, (s) => s.exp);
  const max = useStore(stores.player, (s) => s.expToNext);
  return (
    <div className="pw-expbar">
      <Gauge kind="exp" label={t('hud.exp')} value={exp} max={max} showPercent />
    </div>
  );
}
