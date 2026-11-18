import { t } from '../../i18n';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { toggleWindow } from '../windowActions';

/** Title menu over the live world (the camera drifts across the start zone at golden hour). */
export function TitleScreen() {
  const { bridge, stores } = useServices();
  return (
    <div className="pw-title" data-testid="title-screen">
      <div className="pw-title__brand">
        <h1 className="pw-logo">{t('app.title')}</h1>
        <p className="pw-title__tagline">{t('app.tagline')}</p>
      </div>
      <div className="pw-title__menu pw-panel pw-panel--ornate">
        <Button variant="primary" onClick={() => bridge.startGame()} testId="start-button">
          {t('title.start')}
        </Button>
        <Button onClick={() => toggleWindow(stores, 'settings')}>{t('title.settings')}</Button>
        <Button onClick={() => toggleWindow(stores, 'keyGuide')}>{t('title.controls')}</Button>
      </div>
      <p className="pw-title__notice">{t('title.notice')}</p>
      <div className="pw-title__version">{t('app.version')}</div>
    </div>
  );
}
