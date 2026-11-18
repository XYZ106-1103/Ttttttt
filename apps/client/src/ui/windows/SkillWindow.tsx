import {
  checkLearn,
  getJobDef,
  jobLineage,
  scaled,
  type SkillDef,
  skillsOfJob,
} from '@world/shared';
import { useState } from 'react';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { keyLabel, SKILL_ACTIONS } from '../../input/keybindings';
import { Button } from '../components/Button';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits).replace(/\.0+$/, '');
}

/** Numbers that change with the skill level (shown for the current and next level). */
function levelLine(def: SkillDef, level: number): string {
  const parts: string[] = [];
  if (def.type === 'passive' && def.passive) {
    for (const [k, v] of Object.entries(def.passive)) {
      const val = (v ?? 0) * level;
      parts.push(
        `${t(`mod.${k}`)} +${k.endsWith('Pct') || k.startsWith('crit') ? `${fmt(val * 100, 1)}%` : fmt(val, 1)}`,
      );
    }
    return parts.join(' · ');
  }
  const dmg = scaled(def.damage, level);
  if (dmg > 0) parts.push(t('skill.damage', { v: fmt(dmg) }));
  if (def.value && def.status)
    parts.push(t(`skill.value.${def.status}`, { v: fmt(scaled(def.value, level), 1) }));
  if (def.value && !def.status)
    parts.push(t('skill.distance', { v: fmt(scaled(def.value, level) / 16, 1) }));
  if (def.duration) parts.push(t('skill.duration', { v: fmt(scaled(def.duration, level)) }));
  parts.push(t('skill.mp', { v: fmt(Math.max(0, Math.round(scaled(def.mp, level)))) }));
  const cd = scaled(def.cooldown, level);
  if (cd >= 1) parts.push(t('skill.cooldown', { v: fmt(cd, 1) }));
  return parts.join(' · ');
}

/** Skill window (K): learn skills with skill points and assign them to Q/E/R/F. */
export function SkillWindow(props: { onClose: () => void; onFocus: () => void; zIndex: number }) {
  const { stores, bridge, icons, input } = useServices();
  const jobId = useStore(stores.player, (s) => s.jobId);
  const level = useStore(stores.player, (s) => s.level);
  const sp = useStore(stores.player, (s) => s.skillPoints);
  const skills = useStore(stores.player, (s) => s.skills);
  const bar = useStore(stores.player, (s) => s.skillBar);
  const lineage = jobLineage(jobId).reverse();
  const [tab, setTab] = useState(lineage[lineage.length - 1] ?? 'novice');
  const list = skillsOfJob(tab);

  const learn = (id: string): void => {
    const fail = bridge.learnSkill(id);
    if (fail) showToast(stores, t(`learn.${fail}`));
  };

  return (
    <Window
      title={t('window.skills')}
      width={560}
      initial={{ x: Math.max(16, window.innerWidth - 620), y: 110 }}
      testId="window-skills"
      {...props}
    >
      <div className="pw-skillwin">
        <div className="pw-skillwin__head">
          <div className="pw-tabs">
            {lineage.map((j) => (
              <button
                key={j}
                type="button"
                className={`pw-tab ${tab === j ? 'is-active' : ''}`}
                onClick={() => setTab(j)}
                style={{ color: getJobDef(j).color }}
              >
                {t(getJobDef(j).nameKey)}
              </button>
            ))}
          </div>
          <div className="pw-skillwin__sp" data-testid="skill-points">
            {t('skill.points')} <b>{sp}</b>
          </div>
        </div>
        {jobId === 'novice' && level >= 10 ? (
          <div className="pw-callout">{t('job.readyHint')}</div>
        ) : null}
        <div className="pw-skilllist">
          {list.map((def) => {
            const lv = skills[def.id] ?? 0;
            const fail = checkLearn(skills, def.id, jobId, { level, skillPoints: sp });
            const assignable = def.type !== 'passive' && lv > 0;
            return (
              <div
                key={def.id}
                className={`pw-skillrow ${lv > 0 ? '' : 'is-unlearned'}`}
                data-testid={`skill-${def.id}`}
              >
                <img
                  className="pw-skillrow__icon"
                  src={icons[`skill:${def.id}`]}
                  alt=""
                  draggable={false}
                />
                <div className="pw-skillrow__body">
                  <div className="pw-skillrow__name">
                    {t(def.nameKey)}
                    <span className="pw-skillrow__lv">
                      {lv}/{def.maxLevel}
                    </span>
                    <span className="pw-skillrow__type">{t(`skillType.${def.type}`)}</span>
                    {def.weapon ? (
                      <span className="pw-skillrow__type">{t(`weaponType.${def.weapon}`)}</span>
                    ) : null}
                  </div>
                  <div className="pw-skillrow__desc">{t(def.descKey)}</div>
                  <div className="pw-skillrow__stats">
                    {lv > 0 ? (
                      <span>
                        {t('skill.now')} {levelLine(def, lv)}
                      </span>
                    ) : null}
                    {lv < def.maxLevel ? (
                      <span className="pw-skillrow__next">
                        {t('skill.next')} {levelLine(def, lv + 1)}
                      </span>
                    ) : null}
                  </div>
                  {fail === 'level' ? (
                    <div className="pw-skillrow__req">
                      {t('skill.reqLevel', { level: def.reqLevel })}
                    </div>
                  ) : null}
                  {fail === 'prereq' && def.prereq ? (
                    <div className="pw-skillrow__req">
                      {t('skill.reqSkill', {
                        name: t(`skill.${def.prereq.skill}`),
                        level: def.prereq.level,
                      })}
                    </div>
                  ) : null}
                </div>
                <div className="pw-skillrow__actions">
                  <Button
                    disabled={fail !== null}
                    onClick={() => learn(def.id)}
                    testId={`learn-${def.id}`}
                  >
                    +
                  </Button>
                  {assignable ? (
                    <div className="pw-skillrow__keys">
                      {SKILL_ACTIONS.map((a, i) => (
                        <button
                          key={a}
                          type="button"
                          className={`pw-keybtn ${bar[i] === def.id ? 'is-on' : ''}`}
                          onClick={() => bridge.setSkillSlot(i, bar[i] === def.id ? null : def.id)}
                          data-testid={`assign-${def.id}-${i}`}
                        >
                          {keyLabel(input.bindingFor(a)[0] ?? '')}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <p className="pw-note">{t('skill.note')}</p>
      </div>
    </Window>
  );
}
