import { getJobDef } from '@world/shared';
import { t } from '../../i18n';
import { Gauge } from '../components/Gauge';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Top-left character card: portrait, name, level, job, HP and MP. */
export function StatusPanel() {
  const { stores } = useServices();
  const p = useStore(stores.player, (s) => s);
  const job = getJobDef(p.jobId);
  return (
    <div className="pw-status pw-panel pw-panel--ornate" data-testid="hud-status">
      <div className="pw-status__portrait">
        {p.portrait ? <img src={p.portrait} alt="" draggable={false} /> : null}
        <span className="pw-status__level">
          {t('hud.level')}
          <b>{p.level}</b>
        </span>
      </div>
      <div className="pw-status__info">
        <div className="pw-status__name">
          <span>{p.name}</span>
          <span className="pw-status__job" style={{ color: job.color }}>
            {t(job.nameKey)}
          </span>
        </div>
        <Gauge kind="hp" label={t('hud.hp')} value={p.hp} max={p.maxHp} />
        <Gauge kind="mp" label={t('hud.mp')} value={p.mp} max={p.maxMp} />
      </div>
    </div>
  );
}
