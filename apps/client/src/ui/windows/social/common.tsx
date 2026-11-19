import { INVENTORY_SIZE, itemRegistry, type ItemStack } from '@world/shared';
import { useEffect, useState } from 'react';
import { t } from '../../../i18n';
import { ItemIcon } from '../../components/ItemIcon';
import { ItemTooltip } from '../../components/ItemTooltip';
import { useServices } from '../../context';
import { useStore } from '../../hooks/useStore';

export function goldText(n: number): string {
  return t('gold.amount', { n: Math.floor(n).toLocaleString() });
}

export function itemLabel(itemId: string): string {
  const def = itemRegistry.get(itemId);
  return def ? t(def.nameKey) : itemId;
}

/** Message for a failed economy/society request. */
export function failText(reason: string, params?: Record<string, string | number>): string {
  const key = `fail.${reason}`;
  const text = t(key, params);
  return text === key ? t('fail.unavailable') : text;
}

/** Hover position (UI pixels) for tooltips. */
export function useMouse(): { x: number; y: number } {
  const { stores } = useServices();
  const uiScale = useStore(stores.settings, (s) => s.uiScale);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const move = (e: PointerEvent): void =>
      setMouse({ x: e.clientX / uiScale, y: e.clientY / uiScale });
    window.addEventListener('pointermove', move);
    return () => window.removeEventListener('pointermove', move);
  }, [uiScale]);
  return mouse;
}

/**
 * The player's inventory as a compact grid for trading windows. `badge` shows a price per slot;
 * left/right click call back with the slot index.
 */
export function MiniInventory(props: {
  readonly onLeft: (slot: number, stack: ItemStack) => void;
  readonly onRight?: (slot: number, stack: ItemStack) => void;
  readonly badge?: (stack: ItemStack) => string | null;
  readonly selected?: number | null;
  readonly testPrefix?: string;
}) {
  const { stores } = useServices();
  const slots = useStore(stores.inventory, (s) => s.slots);
  const mouse = useMouse();
  const [hover, setHover] = useState<ItemStack | null>(null);
  return (
    <div className="pw-mini-inv">
      {Array.from({ length: INVENTORY_SIZE }, (_, i) => {
        const st = slots[i] ?? null;
        const badge = st && props.badge ? props.badge(st) : null;
        return (
          <button
            key={i}
            type="button"
            className={`pw-slot pw-slot--mini ${props.selected === i ? 'is-selected' : ''} ${st ? '' : 'is-empty'}`}
            disabled={!st}
            onClick={() => st && props.onLeft(i, st)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (st) (props.onRight ?? props.onLeft)(i, st);
            }}
            onPointerEnter={() => setHover(st)}
            onPointerLeave={() => setHover(null)}
            data-testid={props.testPrefix ? `${props.testPrefix}-${i}` : undefined}
          >
            <ItemIcon stack={st} size={28} />
            {badge ? <span className="pw-slot__price">{badge}</span> : null}
          </button>
        );
      })}
      {hover ? <ItemTooltip stack={hover} x={mouse.x} y={mouse.y} /> : null}
    </div>
  );
}

/** Small up/down trend marker for market prices. */
export function Trend({ value }: { readonly value: number }) {
  if (Math.abs(value) < 0.03) return <span className="pw-trend">–</span>;
  const up = value > 0;
  return (
    <span className={`pw-trend ${up ? 'is-up' : 'is-down'}`}>
      {up ? '▲' : '▼'}
      {Math.round(Math.abs(value) * 100)}%
    </span>
  );
}

export const EMBLEM_COLORS = [
  '#c0394b',
  '#3a7bd5',
  '#2f9e6f',
  '#d9a43b',
  '#8a5cc7',
  '#2fb5c2',
  '#d96b2b',
  '#6b7a8f',
];

export function Emblem({ index, size = 18 }: { readonly index: number; readonly size?: number }) {
  return (
    <span
      className="pw-emblem"
      style={{
        width: size,
        height: size,
        background: EMBLEM_COLORS[index % EMBLEM_COLORS.length],
      }}
    />
  );
}
