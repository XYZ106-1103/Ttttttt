import type { Language, ZoomSetting } from '../../app/settings';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

const ZOOMS: ZoomSetting[] = ['auto', 1, 2, 3, 4];
const UI_SCALES = [1, 1.25, 1.5, 2];
const LANGS: { id: Language; label: string }[] = [
  { id: 'ko', label: '한국어' },
  { id: 'en', label: 'English' },
];

export function SettingsWindow(props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { stores } = useServices();
  const s = useStore(stores.settings, (x) => x);
  const set = stores.settings.set;
  return (
    <Window
      title={t('window.settings')}
      width={340}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 170), y: 140 }}
      testId="window-settings"
      {...props}
    >
      <div className="pw-settings">
        <div className="pw-setting">
          <span>{t('settings.zoom')}</span>
          <div className="pw-seg">
            {ZOOMS.map((z) => (
              <Button key={String(z)} active={s.zoom === z} onClick={() => set({ zoom: z })}>
                {z === 'auto' ? t('settings.zoomAuto') : `${z}×`}
              </Button>
            ))}
          </div>
        </div>
        <div className="pw-setting">
          <span>{t('settings.uiScale')}</span>
          <div className="pw-seg">
            {UI_SCALES.map((u) => (
              <Button key={u} active={s.uiScale === u} onClick={() => set({ uiScale: u })}>
                {`${u}×`}
              </Button>
            ))}
          </div>
        </div>
        <div className="pw-setting">
          <span>{t('settings.showFps')}</span>
          <div className="pw-seg">
            <Button active={s.showFps} onClick={() => set({ showFps: true })}>
              {t('settings.on')}
            </Button>
            <Button active={!s.showFps} onClick={() => set({ showFps: false })}>
              {t('settings.off')}
            </Button>
          </div>
        </div>
        <div className="pw-setting">
          <span>{t('settings.screenShake')}</span>
          <div className="pw-seg">
            <Button active={s.screenShake} onClick={() => set({ screenShake: true })}>
              {t('settings.on')}
            </Button>
            <Button active={!s.screenShake} onClick={() => set({ screenShake: false })}>
              {t('settings.off')}
            </Button>
          </div>
        </div>
        <div className="pw-setting">
          <span>{t('settings.language')}</span>
          <div className="pw-seg">
            {LANGS.map((l) => (
              <Button
                key={l.id}
                active={s.language === l.id}
                onClick={() => set({ language: l.id })}
              >
                {l.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </Window>
  );
}
