import { getJobDef, nextJobs, STAT_KEYS } from '@world/shared';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { openWindow } from '../windowActions';

const pct = (v: number): string => `${(v * 100).toFixed(1).replace(/\.0$/, '')}%`;

/** Character window (C): profile, stat allocation, derived combat stats and job advancement. */
export function CharacterWindow(props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { stores, bridge } = useServices();
  const p = useStore(stores.player, (s) => s);
  const job = getJobDef(p.jobId);
  const advanceTo = nextJobs(p.jobId).filter((j) => p.level >= j.advanceLevel);
  const d = p.derived;
  return (
    <Window
      title={t('window.character')}
      width={340}
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
        {advanceTo.length > 0 ? (
          <div className="pw-callout pw-callout--job">
            <span>{t('job.available')}</span>
            <Button onClick={() => openWindow(stores, 'jobAdvance')} testId="open-job">
              {t('job.advance')}
            </Button>
          </div>
        ) : null}
        <div className="pw-charwin__points">
          {t('char.statPoints')}: <b data-testid="stat-points">{p.statPoints}</b>
          <Button
            variant="ghost"
            disabled={p.statPoints <= 0}
            onClick={() => bridge.autoAllocate()}
            testId="auto-stats"
          >
            {t('char.auto')}
          </Button>
        </div>
        <div className="pw-stats">
          {STAT_KEYS.map((k) => (
            <div key={k} className={`pw-stat ${k === job.primaryStat ? 'is-primary' : ''}`}>
              <span className="pw-stat__name">{t(`stat.${k}`)}</span>
              <span className="pw-stat__value">
                {p.totals[k]}
                {p.totals[k] !== p.stats[k] ? (
                  <small>
                    {' '}
                    ({p.stats[k]}+{p.totals[k] - p.stats[k]})
                  </small>
                ) : null}
              </span>
              <button
                type="button"
                className="pw-stat__plus"
                disabled={p.statPoints <= 0}
                onClick={() => bridge.allocateStat(k, 1)}
                data-testid={`stat-plus-${k}`}
                aria-label={`${t(`stat.${k}`)} +1`}
              >
                +
              </button>
            </div>
          ))}
        </div>
        <dl className="pw-kv pw-kv--derived">
          <dt>{t('derived.attack')}</dt>
          <dd>{d.attack}</dd>
          <dt>{t('derived.magic')}</dt>
          <dd>{d.magic}</dd>
          <dt>{t('derived.defense')}</dt>
          <dd>{d.defense}</dd>
          <dt>{t('derived.critRate')}</dt>
          <dd>{pct(d.critRate)}</dd>
          <dt>{t('derived.critDamage')}</dt>
          <dd>{pct(1 + d.critDamage)}</dd>
          <dt>{t('derived.attackSpeed')}</dt>
          <dd>{pct(d.attackSpeed)}</dd>
          <dt>{t('derived.moveSpeed')}</dt>
          <dd>{pct(d.moveSpeed)}</dd>
          <dt>{t('derived.regen')}</dt>
          <dd>
            {d.hpRegen.toFixed(1)} / {d.mpRegen.toFixed(1)}
          </dd>
        </dl>
        <p className="pw-note">{t('char.note')}</p>
      </div>
    </Window>
  );
}
