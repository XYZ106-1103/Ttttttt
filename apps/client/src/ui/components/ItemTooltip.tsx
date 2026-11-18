import { itemRegistry, type ItemStack, type StatBonus } from '@world/shared';
import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

function bonusLines(b: StatBonus | undefined): string[] {
  if (!b) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!v) continue;
    const pctKeys = ['critRate', 'critDamage', 'moveSpeed'];
    out.push(`${t(`bonus.${k}`)} +${pctKeys.includes(k) ? `${Math.round(v * 100)}%` : v}`);
  }
  return out;
}

export const RARITY_COLORS: Record<string, string> = {
  common: '#f1ecdf',
  uncommon: '#7fd67a',
  rare: '#6fb3ff',
  epic: '#c58cff',
  legendary: '#ffb648',
};

/** Item details shown on hover. Positioned by the caller (fixed, near the mouse). */
export function ItemTooltip({
  stack,
  x,
  y,
}: {
  readonly stack: ItemStack;
  readonly x: number;
  readonly y: number;
}) {
  const { stores } = useServices();
  const level = useStore(stores.player, (s) => s.level);
  const def = itemRegistry.get(stack.itemId);
  if (!def) return null;
  const req = def.weapon?.reqLevel ?? def.equip?.reqLevel ?? 0;
  const bonuses = bonusLines(def.weapon?.bonus ?? def.equip?.bonus);
  return (
    <div className="pw-tooltip pw-panel" style={{ left: x + 16, top: y + 12 }} role="tooltip">
      <div className="pw-tooltip__name" style={{ color: RARITY_COLORS[def.rarity] }}>
        {t(def.nameKey)}
      </div>
      <div className="pw-tooltip__meta">
        {t(`itemKind.${def.kind}`)} · {t(`rarity.${def.rarity}`)}
      </div>
      {def.tool ? (
        <div className="pw-tooltip__stats">
          <span>{t(`tool.${def.tool.type}`)}</span>
          <span>
            {t('tool.power')} {def.tool.power}
          </span>
          <span>
            {t('tool.speed')} {def.tool.speed.toFixed(1)}/s
          </span>
          <span>
            {t('tool.reach')} {def.tool.reach}
          </span>
        </div>
      ) : null}
      {def.weapon ? (
        <div className="pw-tooltip__stats">
          <span>{t(`weaponType.${def.weapon.type}`)}</span>
          <span>
            {t(def.weapon.type === 'staff' ? 'bonus.magic' : 'bonus.attack')} {def.weapon.attack}
          </span>
          <span>
            {t('tool.speed')} ×{def.weapon.speed.toFixed(2)}
          </span>
        </div>
      ) : null}
      {def.consumable ? (
        <div className="pw-tooltip__stats">
          {def.consumable.heal ? (
            <span>{t('consume.heal', { v: def.consumable.heal })}</span>
          ) : null}
          {def.consumable.mana ? (
            <span>{t('consume.mana', { v: def.consumable.mana })}</span>
          ) : null}
          {def.consumable.summon ? (
            <span>{t('consume.summon', { name: t(`monster.${def.consumable.summon}`) })}</span>
          ) : null}
        </div>
      ) : null}
      {bonuses.length > 0 ? (
        <div className="pw-tooltip__bonus">
          {bonuses.map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      ) : null}
      {req > 1 ? (
        <div className={`pw-tooltip__req ${level < req ? 'is-unmet' : ''}`}>
          {t('item.reqLevel', { level: req })}
        </div>
      ) : null}
      <p className="pw-tooltip__desc">{t(def.descKey)}</p>
      {def.equip ? <p className="pw-tooltip__hint">{t('inv.equipHint')}</p> : null}
    </div>
  );
}
