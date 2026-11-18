import { getSkillDef } from '@world/shared';
import { t } from '../../i18n';
import { keyLabel, SKILL_ACTIONS } from '../../input/keybindings';
import { ItemIcon } from '../components/ItemIcon';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { toggleWindow } from '../windowActions';

/** Cooldown sweep overlay (fraction remaining 0..1). */
function Sweep({ left }: { readonly left: number }) {
  if (left <= 0) return null;
  const deg = Math.round(left * 360);
  return (
    <span
      className="pw-sweep"
      style={{ background: `conic-gradient(rgba(6,8,16,0.72) ${deg}deg, transparent ${deg}deg)` }}
    />
  );
}

/** Skill slots (Q E R F), dodge (Shift) and quick potions (H J). */
export function SkillBar() {
  const { stores, input, icons } = useServices();
  const bar = useStore(stores.combat, (s) => s.skillBar);
  const dodge = useStore(stores.combat, (s) => s.dodge);
  const potion = useStore(stores.combat, (s) => s.potion);
  const potionMax = useStore(stores.combat, (s) => s.potionMax);
  const heal = useStore(stores.combat, (s) => s.healPotions);
  const mana = useStore(stores.combat, (s) => s.manaPotions);
  const key = (a: Parameters<typeof input.bindingFor>[0]) => keyLabel(input.bindingFor(a)[0] ?? '');
  return (
    <div className="pw-skillbar pw-panel" data-testid="skillbar">
      {SKILL_ACTIONS.map((action, i) => {
        const s = bar[i];
        const def = s?.id ? getSkillDef(s.id) : undefined;
        return (
          <button
            key={action}
            type="button"
            className={`pw-slot pw-slot--skill ${s?.id && !s.usable ? 'is-dim' : ''}`}
            title={def ? `${t(def.nameKey)} (${key(action)})` : t('skillbar.empty')}
            onClick={() => toggleWindow(stores, 'skills')}
            data-testid={`skillslot-${i}`}
          >
            <span className="pw-slot__key">{key(action)}</span>
            {s?.id && icons[`skill:${s.id}`] ? (
              <img
                className="pw-skill-icon"
                src={icons[`skill:${s.id}`]}
                alt=""
                draggable={false}
              />
            ) : null}
            {s?.id ? <Sweep left={s.cooldown / s.cooldownMax} /> : null}
            {s?.id && s.cooldown > 0.95 ? (
              <span className="pw-slot__cd">{Math.ceil(s.cooldown)}</span>
            ) : null}
          </button>
        );
      })}
      <span className="pw-skillbar__sep" />
      <div className="pw-slot pw-slot--util" title={`${t('keys.dodge')} (${key('dodge')})`}>
        <span className="pw-slot__key">{key('dodge')}</span>
        <span className="pw-slot__glyph">»</span>
        <Sweep left={dodge} />
      </div>
      <div
        className="pw-slot pw-slot--util"
        title={`${t('item.healing_potion')} (${key('quickHeal')})`}
      >
        <span className="pw-slot__key">{key('quickHeal')}</span>
        {heal > 0 ? <ItemIcon stack={{ itemId: 'healing_potion', count: heal }} /> : null}
        <Sweep left={potion / potionMax} />
      </div>
      <div
        className="pw-slot pw-slot--util"
        title={`${t('item.mana_potion')} (${key('quickMana')})`}
      >
        <span className="pw-slot__key">{key('quickMana')}</span>
        {mana > 0 ? <ItemIcon stack={{ itemId: 'mana_potion', count: mana }} /> : null}
        <Sweep left={potion / potionMax} />
      </div>
    </div>
  );
}
