import { useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { toggleWindow } from '../windowActions';
import { OnlinePanel } from './OnlinePanel';

/** Title menu over the live world (the camera drifts across the start zone at golden hour). */
export function TitleScreen() {
  const { bridge, stores } = useServices();
  const hasSave = useStore(stores.app, (s) => s.hasSave);
  const notice = useStore(stores.app, (s) => s.notice);
  const [confirming, setConfirming] = useState(false);
  const [online, setOnline] = useState(false);
  return (
    <div className="pw-title" data-testid="title-screen">
      <div className="pw-title__brand">
        <h1 className="pw-logo">{t('app.title')}</h1>
        <p className="pw-title__tagline">{t('app.tagline')}</p>
      </div>
      {notice ? (
        <p className="pw-title__alert" role="alert" data-testid="title-notice">
          {notice}
        </p>
      ) : null}
      <div className="pw-title__menu pw-panel pw-panel--ornate">
        {online ? (
          <OnlinePanel onBack={() => setOnline(false)} />
        ) : confirming ? (
          <>
            <p className="pw-title__confirm">{t('title.newWorldConfirm')}</p>
            <Button
              variant="primary"
              onClick={() => void bridge.resetWorld(true)}
              testId="confirm-new-world"
            >
              {t('title.confirm')}
            </Button>
            <Button onClick={() => setConfirming(false)}>{t('title.cancel')}</Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={() => bridge.startGame()} testId="start-button">
              {hasSave ? t('title.continue') : t('title.start')}
            </Button>
            <Button
              onClick={() => {
                stores.app.set({ notice: null });
                setOnline(true);
              }}
              testId="online-button"
            >
              {t('title.online')}
            </Button>
            {hasSave ? (
              <Button onClick={() => setConfirming(true)} testId="new-world-button">
                {t('title.newWorld')}
              </Button>
            ) : null}
            <Button onClick={() => toggleWindow(stores, 'settings')}>{t('title.settings')}</Button>
            <Button onClick={() => toggleWindow(stores, 'keyGuide')}>{t('title.controls')}</Button>
          </>
        )}
      </div>
      <p className="pw-title__notice">{t('title.notice')}</p>
      <div className="pw-title__version">{t('app.version')}</div>
    </div>
  );
}
