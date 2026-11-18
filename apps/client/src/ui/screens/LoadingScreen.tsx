import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

export function LoadingScreen() {
  const { stores } = useServices();
  const progress = useStore(stores.app, (s) => s.bootProgress);
  const label = useStore(stores.app, (s) => s.bootLabel);
  return (
    <div className="pw-loading" data-testid="loading">
      <div className="pw-logo pw-logo--small">{t('app.title')}</div>
      <div className="pw-loading__bar">
        <div className="pw-loading__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="pw-loading__label">{label}</div>
    </div>
  );
}
