import { itemRegistry, type ItemStack } from '@world/shared';
import { t } from '../../i18n';

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
  const def = itemRegistry.get(stack.itemId);
  if (!def) return null;
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
      <p className="pw-tooltip__desc">{t(def.descKey)}</p>
    </div>
  );
}
