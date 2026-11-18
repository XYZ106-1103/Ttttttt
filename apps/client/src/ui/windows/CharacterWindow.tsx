import { getJobDef, STAT_KEYS } from '@world/shared';
import { t } from '../../i18n';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

export function CharacterWindow(props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { stores } = useServices();
  const p = useStore(stores.player, (s) => s);
  const job = getJobDef(p.jobId);
  return (
    <Window
      title={t('window.character')}
      width={300}
      initial={{ x: 40, y: 150 }}
      testId="window-character"
      {...props}
    >
      <div className="pw-charwin">
        <div className="pw-charwin__top">
          <div className="pw-charwin__portrait">
            {p.portrait ? <img src={p.portrait} alt="" draggable={false} /> : null}
          </div>
          <dl className="pw-kv">
            <dt>{t('char.name')}</dt>
            <dd>{p.name}</dd>
            <dt>{t('char.job')}</dt>
            <dd style={{ color: job.color }}>{t(job.nameKey)}</dd>
            <dt>{t('char.level')}</dt>
            <dd>{p.level}</dd>
            <dt>{t('hud.hp')}</dt>
            <dd>
              {p.hp} / {p.maxHp}
            </dd>
            <dt>{t('hud.mp')}</dt>
            <dd>
              {p.mp} / {p.maxMp}
            </dd>
          </dl>
        </div>
        <div className="pw-stats">
          {STAT_KEYS.map((k) => (
            <div key={k} className="pw-stat">
              <span className="pw-stat__name">{t(`stat.${k}`)}</span>
              <span className="pw-stat__value">{p.stats[k]}</span>
            </div>
          ))}
        </div>
        <div className="pw-charwin__points">
          {t('char.statPoints')}: <b>{p.statPoints}</b>
        </div>
        <p className="pw-note">{t('char.note')}</p>
      </div>
    </Window>
  );
}
