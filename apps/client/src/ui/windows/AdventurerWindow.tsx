import { getJobDef, TRAITS } from '@world/shared';
import { t } from '../../i18n';
import { Window } from '../components/Window';
import { ItemIcon } from '../components/ItemIcon';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { openWindow } from '../windowActions';

function ago(s: number): string {
  if (s < 60) return t('adv.agoSec', { n: Math.max(1, Math.round(s)) });
  if (s < 3600) return t('adv.agoMin', { n: Math.round(s / 60) });
  return t('adv.agoHour', { n: Math.round(s / 3600) });
}

function goalText(g: { kind: string; params: Readonly<Record<string, string | number>> }): string {
  const p = { ...g.params };
  if (typeof p.item === 'string') p.item = t(`item.${p.item}`);
  if (typeof p.monster === 'string') p.monster = t(`monster.${p.monster}`);
  return t(`adv.goal.${g.kind}`, p);
}

function memoryText(
  m: { kind: string; detail?: string; who?: string },
  playerName: string,
): string {
  let detail = m.detail ?? '';
  if (m.kind === 'crafted' || m.kind === 'goal_done') detail = t(`item.${detail}`);
  if (m.kind === 'died' || m.kind === 'slew' || m.kind === 'raid' || m.kind === 'boss_seen')
    detail = detail ? t(`monster.${detail}`) : t('adv.unknown');
  if (m.kind === 'job') detail = t(`job.${detail}`);
  const who = m.who ?? t('adv.unknown');
  if (m.kind === 'met' && m.who && m.who !== playerName) return t('adv.mem.metWho', { who });
  return t(`adv.mem.${m.kind}`, { detail, who });
}

/** Inspection card of one adventurer (right-click them in the world, or pick from the roster). */
export function AdventurerWindow(props: {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}) {
  const { stores } = useServices();
  const d = useStore(stores.adventurers, (s) => s.detail);
  const playerName = useStore(stores.player, (s) => s.name);
  const debug = useStore(stores.ui, (s) => s.debugVisible);
  return (
    <Window
      title={t('window.adventurer')}
      width={360}
      initial={{ x: Math.max(16, window.innerWidth - 420), y: 120 }}
      testId="window-adventurer"
      {...props}
    >
      {!d ? (
        <p className="pw-note">{t('adv.none')}</p>
      ) : (
        <div className="pw-advcard">
          <div className="pw-advcard__head">
            <div>
              <div className="pw-advcard__name">
                {d.name} <span className="pw-advcard__tag">AI</span>
                {d.partyMate ? (
                  <span className="pw-advcard__tag is-party">{t('adv.inParty')}</span>
                ) : null}
              </div>
              <div className="pw-advcard__sub" style={{ color: getJobDef(d.jobId).color }}>
                Lv.{d.level} {t(getJobDef(d.jobId).nameKey)} · {t(`adv.arch.${d.archetype}`)}
              </div>
            </div>
            {d.weapon ? <ItemIcon stack={{ itemId: d.weapon, count: 1 }} /> : null}
          </div>
          <div className="pw-advcard__row">
            <span>{t('adv.doing')}</span>
            <b>{t(`adv.do.${d.doing}`)}</b>
          </div>
          <div className="pw-advcard__row">
            <span>{t('adv.goal')}</span>
            <b>{d.goal ? goalText(d.goal) : '—'}</b>
          </div>
          <div className="pw-advcard__row">
            <span>{t('adv.guild')}</span>
            <b>{d.guild ?? t('adv.noGuild')}</b>
          </div>
          <div className="pw-advcard__row">
            <span>{t('adv.hp')}</span>
            <b>
              {d.hp} / {d.maxHp}
            </b>
          </div>
          <div className="pw-advcard__label">{t('adv.personality')}</div>
          <div className="pw-traits">
            {TRAITS.map((k) => (
              <div key={k} className="pw-trait">
                <span>{t(`trait.${k}`)}</span>
                <span className="pw-trait__bar">
                  <i style={{ width: `${Math.round((d.personality[k] ?? 0) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
          <div className="pw-advcard__row">
            <span>{t('adv.style')}</span>
            <b>
              {t(`adv.tone.${d.tone}`)} · {t('adv.wantsJob', { job: t(`job.${d.preferredJob}`) })}
              {d.nightOwl ? ` · ${t('adv.nightOwl')}` : ''}
            </b>
          </div>
          <div className="pw-advcard__label">{t('adv.relation')}</div>
          <div className="pw-advcard__row">
            <span className="pw-affinity">
              <i style={{ width: `${Math.round(((d.affinity + 1) / 2) * 100)}%` }} />
            </span>
            <b>{t('adv.relationText', { met: d.met, helped: d.helped })}</b>
          </div>
          <div className="pw-advcard__row">
            <span />
            <b>
              {t('adv.relationLine', {
                label: t(`rel.${d.relation}`),
                talks: d.talks,
                trades: d.trades,
                raids: d.raids,
              })}
            </b>
          </div>
          <div className="pw-advcard__actions">
            <Button
              variant="primary"
              disabled={!d.talkable}
              testId="adv-talk"
              onClick={() => {
                stores.dialogue.set((s) => ({
                  target: { kind: 'adventurer', key: d.key },
                  seq: s.seq + 1,
                }));
                openWindow(stores, 'dialogue');
              }}
            >
              {t('adv.talk')}
            </Button>
            {!d.talkable ? <small className="pw-note">{t('adv.talkFar')}</small> : null}
          </div>
          <div className="pw-advcard__label">{t('adv.social')}</div>
          <ul className="pw-memories">
            {d.ties.length === 0 ? <li className="pw-note">{t('adv.noSocial')}</li> : null}
            {d.ties.map((tie) => (
              <li key={tie.key}>
                <span>{tie.name}</span>
                <small className={tie.affinity < 0 ? 'is-bad' : 'is-good'}>
                  {t(`rel.${tie.label}`)}
                </small>
              </li>
            ))}
          </ul>
          <div className="pw-advcard__label">{t('adv.memories')}</div>
          <ul className="pw-memories">
            {d.memories.length === 0 ? <li className="pw-note">{t('adv.noMemories')}</li> : null}
            {d.memories.map((m, i) => (
              <li key={i}>
                <span>{memoryText(m, playerName)}</span>
                <small>{ago(m.ago)}</small>
              </li>
            ))}
          </ul>
          {debug ? (
            <>
              <div className="pw-advcard__label">{t('adv.debug')}</div>
              <div className="pw-scores">
                {d.scores.map(([k, v]) => (
                  <div key={k} className="pw-score">
                    <span>{t(`adv.do.${k}`)}</span>
                    <span className="pw-trait__bar">
                      <i style={{ width: `${Math.min(100, Math.round(v * 70))}%` }} />
                    </span>
                    <small>{v.toFixed(2)}</small>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}
    </Window>
  );
}
