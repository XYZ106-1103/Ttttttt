import { getQuestDef, itemRegistry, MAX_ACTIVE_QUESTS } from '@world/shared';
import { useState } from 'react';
import { showToast, type QuestObjectiveView, type QuestView } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

/** Name of a quest (bounties are generated, so their title names the target). */
export function questTitle(q: QuestView): string {
  const def = getQuestDef(q.id);
  if (!def) return q.id;
  const o = q.objectives[0];
  return t(def.nameKey, { target: o ? targetName(o) : '' });
}

export function targetName(o: QuestObjectiveView): string {
  switch (o.kind) {
    case 'kill':
      return t(`monster.${o.target}`);
    case 'collect':
    case 'craft': {
      const def = itemRegistry.get(o.target);
      return def ? t(def.nameKey) : o.target;
    }
    case 'reach':
      return t(`biome.${o.target}`);
    default:
      return '';
  }
}

export function objectiveText(o: QuestObjectiveView): string {
  return t(`quest.obj.${o.kind}`, { target: targetName(o), have: o.have, need: o.need });
}

function Rewards({ id }: { readonly id: string }) {
  const def = getQuestDef(id);
  if (!def) return null;
  const r = def.reward;
  return (
    <div className="pw-quest__rewards">
      <span>{t('quest.reward')}</span>
      <span>{t('quest.rewardExp', { n: r.exp })}</span>
      <span>{t('quest.rewardGold', { n: r.gold })}</span>
      {r.items.map((it) => (
        <span key={it.item} className="pw-quest__reward-item">
          <ItemIcon stack={{ itemId: it.item, count: it.count }} size={20} />
        </span>
      ))}
    </div>
  );
}

/**
 * Quest log: the story chapter and daily bounties the village guide offers, active quests with
 * their progress, and turning finished ones in. Accepting and turning in happen at the guide.
 */
export function QuestWindow(props: Props) {
  const { stores, bridge } = useServices();
  const active = useStore(stores.quests, (s) => s.active);
  const available = useStore(stores.quests, (s) => s.available);
  const near = useStore(stores.quests, (s) => s.nearGiver);
  const doneStory = useStore(stores.quests, (s) => s.doneStory);
  const [tab, setTab] = useState<'active' | 'available'>(
    active.length > 0 ? 'active' : 'available',
  );

  const onResult = (
    r: { ok: true } | { ok: false; reason: string },
    okKey: string,
    q: QuestView,
  ) => {
    if (r.ok) showToast(stores, t(okKey, { name: questTitle(q) }));
    else showToast(stores, t(`quest.fail.${r.reason}`, { max: MAX_ACTIVE_QUESTS }));
  };

  const list = tab === 'active' ? active : available;
  return (
    <Window
      title={t('window.quests')}
      width={460}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 230), y: 100 }}
      testId="window-quests"
      {...props}
    >
      <div className="pw-tabs">
        <button
          type="button"
          className={`pw-tab ${tab === 'active' ? 'is-active' : ''}`}
          onClick={() => setTab('active')}
          data-testid="quests-tab-active"
        >
          {t('quest.tab.active', { n: active.length, max: MAX_ACTIVE_QUESTS })}
        </button>
        <button
          type="button"
          className={`pw-tab ${tab === 'available' ? 'is-active' : ''}`}
          onClick={() => setTab('available')}
          data-testid="quests-tab-available"
        >
          {t('quest.tab.available', { n: available.length })}
        </button>
      </div>
      <p className="pw-note">
        {near ? t('quest.atGiver') : t('quest.goToGiver')} ·{' '}
        {t('quest.storyDone', { n: doneStory })}
      </p>
      <div className="pw-quest__list">
        {list.length === 0 ? <p className="pw-note">{t(`quest.empty.${tab}`)}</p> : null}
        {list.map((q) => {
          const def = getQuestDef(q.id);
          return (
            <div key={q.id} className="pw-quest" data-testid={`quest-${q.id}`}>
              <div className="pw-quest__head">
                <span className={`pw-quest__kind is-${q.kind}`}>{t(`quest.kind.${q.kind}`)}</span>
                <strong>{questTitle(q)}</strong>
                {def && def.minLevel > 1 ? (
                  <small className="pw-note">Lv.{def.minLevel}+</small>
                ) : null}
              </div>
              {def && def.kind === 'story' ? (
                <p className="pw-quest__desc">{t(def.descKey)}</p>
              ) : null}
              <ul className="pw-quest__objectives">
                {q.objectives.map((o, i) => (
                  <li key={i} className={tab === 'active' && o.have >= o.need ? 'is-done' : ''}>
                    {objectiveText(o)}
                  </li>
                ))}
              </ul>
              <Rewards id={q.id} />
              <div className="pw-quest__actions">
                {tab === 'available' ? (
                  <Button
                    disabled={!near}
                    testId={`quest-accept-${q.id}`}
                    onClick={() =>
                      void bridge
                        .getTown()
                        ?.acceptQuest(q.id)
                        .then((r) => onResult(r, 'quest.accepted', q))
                    }
                  >
                    {t('quest.accept')}
                  </Button>
                ) : (
                  <>
                    <Button
                      disabled={!near || !q.complete}
                      testId={`quest-turnin-${q.id}`}
                      onClick={() =>
                        void bridge
                          .getTown()
                          ?.turnInQuest(q.id)
                          .then((r) => onResult(r, 'quest.completed', q))
                      }
                    >
                      {t('quest.turnIn')}
                    </Button>
                    <Button
                      variant="ghost"
                      testId={`quest-abandon-${q.id}`}
                      onClick={() => bridge.getTown()?.abandonQuest(q.id)}
                    >
                      {t('quest.abandon')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Window>
  );
}
