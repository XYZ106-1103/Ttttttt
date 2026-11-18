import { getJobDef } from '@world/shared';
import { useState } from 'react';
import { t } from '../../i18n';
import { useServices } from '../context';
import { Window } from '../components/Window';
import { useStore } from '../hooks/useStore';
import { openWindow } from '../windowActions';

type Sort = 'level' | 'name' | 'affinity';

/** Adventurer roster (O): everyone in the world, what they are doing and where. */
export function RosterWindow(props: { onClose: () => void; onFocus: () => void; zIndex: number }) {
  const { stores } = useServices();
  const list = useStore(stores.adventurers, (s) => s.list);
  const [sort, setSort] = useState<Sort>('level');
  const rows = [...list].sort((a, b) =>
    sort === 'level'
      ? b.level - a.level || a.name.localeCompare(b.name)
      : sort === 'name'
        ? a.name.localeCompare(b.name)
        : b.affinity - a.affinity,
  );
  return (
    <Window
      title={t('window.roster')}
      width={560}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 280), y: 100 }}
      testId="window-roster"
      {...props}
    >
      <div className="pw-roster">
        <div className="pw-tabs">
          {(['level', 'name', 'affinity'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`pw-tab ${sort === k ? 'is-active' : ''}`}
              onClick={() => setSort(k)}
            >
              {t(`roster.sort.${k}`)}
            </button>
          ))}
          <span className="pw-roster__count">{t('roster.count', { n: list.length })}</span>
        </div>
        <div className="pw-roster__list">
          {rows.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`pw-roster__row ${a.active ? 'is-near' : ''} ${a.alive ? '' : 'is-dead'}`}
              onClick={() => {
                stores.adventurers.set({ selected: a.key });
                openWindow(stores, 'adventurer');
              }}
              data-testid={`roster-${a.key}`}
            >
              <span className="pw-roster__name">{a.name}</span>
              <span>Lv.{a.level}</span>
              <span style={{ color: getJobDef(a.jobId).color }}>
                {t(getJobDef(a.jobId).nameKey)}
              </span>
              <span className="pw-roster__doing">{t(`adv.do.${a.doing}`)}</span>
              <span className="pw-roster__where">
                {a.active ? t('roster.near') : t('roster.far', { x: a.x })}
              </span>
            </button>
          ))}
        </div>
        <p className="pw-note">{t('roster.note')}</p>
      </div>
    </Window>
  );
}
