import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { openWindow } from '../windowActions';
import { objectiveText, questTitle } from '../windows/QuestWindow';

/** Compact list of active quests at the side of the screen. */
export function QuestTracker() {
  const { stores } = useServices();
  const active = useStore(stores.quests, (s) => s.active);
  if (active.length === 0) return null;
  return (
    <button
      type="button"
      className="pw-quest-tracker"
      onClick={() => openWindow(stores, 'quests')}
      data-testid="quest-tracker"
    >
      <div className="pw-quest-tracker__title">{t('window.quests')}</div>
      {active.slice(0, 4).map((q) => (
        <div key={q.id} className={`pw-quest-tracker__item ${q.complete ? 'is-complete' : ''}`}>
          <div className="pw-quest-tracker__name">
            {q.complete ? '✔ ' : ''}
            {questTitle(q)}
          </div>
          {q.objectives.map((o, i) => (
            <div key={i} className="pw-quest-tracker__obj">
              {objectiveText(o)}
            </div>
          ))}
        </div>
      ))}
    </button>
  );
}
