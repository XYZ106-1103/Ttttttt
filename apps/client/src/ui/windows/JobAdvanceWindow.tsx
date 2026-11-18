import { JOB_STARTER_WEAPONS, nextJobs, skillsOfJob, type StatKey } from '@world/shared';
import { useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { closeWindow } from '../windowActions';

/** Job advancement: pick one of the next jobs once the level requirement is met. */
export function JobAdvanceWindow(props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { stores, bridge, icons } = useServices();
  const jobId = useStore(stores.player, (s) => s.jobId);
  const level = useStore(stores.player, (s) => s.level);
  const options = nextJobs(jobId);
  const [pick, setPick] = useState<string | null>(null);
  const chosen = options.find((j) => j.id === pick) ?? null;
  return (
    <Window
      title={t('window.jobAdvance')}
      width={760}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 380), y: 90 }}
      testId="window-job"
      {...props}
    >
      <div className="pw-jobwin">
        <p className="pw-jobwin__intro">{t('job.advanceIntro')}</p>
        <div className="pw-jobcards">
          {options.map((j) => (
            <button
              key={j.id}
              type="button"
              className={`pw-jobcard ${pick === j.id ? 'is-picked' : ''}`}
              style={{ ['--job' as string]: j.color }}
              onClick={() => setPick(j.id)}
              data-testid={`job-${j.id}`}
            >
              <div className="pw-jobcard__name">{t(j.nameKey)}</div>
              <div className="pw-jobcard__weapon">
                <ItemIcon
                  stack={{ itemId: JOB_STARTER_WEAPONS[j.id] ?? 'training_sword', count: 1 }}
                  size={32}
                />
                <span>{t(`weaponType.${j.weapons[0] ?? 'sword'}`)}</span>
              </div>
              <div className="pw-jobcard__desc">{t(j.descriptionKey)}</div>
              <div className="pw-jobcard__stat">
                {t('job.mainStat')}: <b>{t(`stat.${j.primaryStat as StatKey}`)}</b> ·{' '}
                {t(`stat.${j.secondaryStat}`)}
              </div>
              <div className="pw-jobcard__skills">
                {skillsOfJob(j.id).map((s) => (
                  <img
                    key={s.id}
                    src={icons[`skill:${s.id}`]}
                    alt=""
                    title={t(s.nameKey)}
                    draggable={false}
                  />
                ))}
              </div>
            </button>
          ))}
        </div>
        <div className="pw-jobwin__foot">
          {chosen ? (
            <span>
              {t('job.confirmText', { job: t(chosen.nameKey), level: chosen.advanceLevel })}
            </span>
          ) : (
            <span className="pw-note">{t('job.pickHint')}</span>
          )}
          <Button
            disabled={!chosen || level < (chosen?.advanceLevel ?? 999)}
            onClick={() => {
              if (chosen && bridge.advanceJob(chosen.id)) closeWindow(stores, 'jobAdvance');
            }}
            testId="job-confirm"
          >
            {t('job.confirm')}
          </Button>
        </div>
      </div>
    </Window>
  );
}
