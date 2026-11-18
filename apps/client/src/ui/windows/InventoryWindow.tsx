import {
  EQUIP_SLOTS,
  type EquipSlotId,
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  itemRegistry,
  type ItemStack,
  RECIPE_DEFS,
  type RecipeDef,
} from '@world/shared';
import { useEffect, useMemo, useState } from 'react';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { ItemTooltip, RARITY_COLORS } from '../components/ItemTooltip';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

function countOf(slots: readonly (ItemStack | null)[], itemId: string): number {
  let n = 0;
  for (const s of slots) if (s && s.itemId === itemId) n += s.count;
  return n;
}

function craftableTimes(slots: readonly (ItemStack | null)[], r: RecipeDef): number {
  let n = Infinity;
  for (const ing of r.inputs) n = Math.min(n, Math.floor(countOf(slots, ing.item) / ing.count));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Inventory (40 slots, first row = hotbar) with cursor-stack interaction and hand crafting.
 * Every action is a request to the simulation, which validates it with the shared Inventory.
 */
export function InventoryWindow(props: Props) {
  const { stores, bridge } = useServices();
  const slots = useStore(stores.inventory, (s) => s.slots);
  const cursor = useStore(stores.inventory, (s) => s.cursor);
  const selected = useStore(stores.inventory, (s) => s.selected);
  const uiScale = useStore(stores.settings, (s) => s.uiScale);
  const equipment = useStore(stores.player, (s) => s.equipment);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<ItemStack | null>(null);

  useEffect(() => {
    const move = (e: PointerEvent): void =>
      setMouse({ x: e.clientX / uiScale, y: e.clientY / uiScale });
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('pointermove', move);
      // Closing the window returns whatever the cursor holds.
      bridge.returnCursor();
    };
  }, [bridge, uiScale]);

  const recipes = useMemo(
    () =>
      [...RECIPE_DEFS].sort(
        (a, b) => Number(craftableTimes(slots, b) > 0) - Number(craftableTimes(slots, a) > 0),
      ),
    [slots],
  );

  const craft = (r: RecipeDef, times: number): void => {
    const res = bridge.craft(r.id, times);
    if (res.ok) {
      const name = t(itemRegistry.get(r.output.item)?.nameKey ?? r.output.item);
      showToast(stores, t('inv.crafted', { name, count: r.output.count * res.crafted }));
    } else if (res.reason === 'no_space') showToast(stores, t('use.inventory_full'));
  };

  const equipSlot = (id: EquipSlotId) => {
    const st = equipment[id];
    return (
      <button
        key={id}
        type="button"
        className={`pw-slot pw-slot--equip ${st ? '' : 'is-empty'}`}
        onClick={() => {
          const fail = bridge.clickEquipment(id);
          if (fail && fail !== 'invalid') showToast(stores, t(`equip.${fail}`));
        }}
        onPointerEnter={() => setHover(st)}
        onPointerLeave={() => setHover(null)}
        title={t(`equipSlot.${id}`)}
        data-testid={`equip-${id}`}
      >
        {st ? <ItemIcon stack={st} /> : <span className="pw-slot__ph">{t(`equipSlot.${id}`)}</span>}
      </button>
    );
  };

  const slot = (i: number) => {
    const s = slots[i] ?? null;
    return (
      <button
        key={i}
        type="button"
        className={`pw-slot ${i < HOTBAR_SIZE && i === selected ? 'is-selected' : ''}`}
        onClick={() => bridge.inventoryClick(i, 'left')}
        onContextMenu={(e) => {
          e.preventDefault();
          bridge.inventoryClick(i, 'right');
        }}
        onPointerEnter={() => setHover(s)}
        onPointerLeave={() => setHover(null)}
        data-testid={`inv-slot-${i}`}
      >
        {i < HOTBAR_SIZE ? <span className="pw-slot__key">{(i + 1) % 10}</span> : null}
        <ItemIcon stack={s} />
      </button>
    );
  };

  return (
    <Window
      title={t('window.inventory')}
      width={790}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 395), y: 110 }}
      testId="window-inventory"
      {...props}
    >
      <div className="pw-inv">
        <div className="pw-inv__equip">
          <div className="pw-inv__label">{t('inv.equipment')}</div>
          {EQUIP_SLOTS.map((id) => equipSlot(id))}
        </div>
        <div className="pw-inv__left">
          <div className="pw-inv__label">{t('inv.hotbar')}</div>
          <div className="pw-inv__grid">
            {Array.from({ length: HOTBAR_SIZE }, (_, i) => slot(i))}
          </div>
          <div className="pw-inv__grid pw-inv__grid--bag">
            {Array.from({ length: INVENTORY_SIZE - HOTBAR_SIZE }, (_, i) => slot(i + HOTBAR_SIZE))}
          </div>
          <div className="pw-note">{t('inv.hint')}</div>
        </div>
        <div className="pw-inv__craft">
          <div className="pw-inv__label">{t('inv.crafting')}</div>
          <div className="pw-recipes">
            {recipes.map((r) => {
              const times = craftableTimes(slots, r);
              const out = itemRegistry.get(r.output.item);
              return (
                <div
                  key={r.id}
                  className={`pw-recipe ${times > 0 ? '' : 'is-disabled'}`}
                  data-testid={`recipe-${r.id}`}
                >
                  <div
                    className="pw-recipe__out"
                    onPointerEnter={() =>
                      setHover({ itemId: r.output.item, count: r.output.count })
                    }
                    onPointerLeave={() => setHover(null)}
                  >
                    <ItemIcon stack={{ itemId: r.output.item, count: r.output.count }} />
                  </div>
                  <div className="pw-recipe__body">
                    <div
                      className="pw-recipe__name"
                      style={{ color: out ? RARITY_COLORS[out.rarity] : undefined }}
                    >
                      {t(out?.nameKey ?? r.output.item)}
                    </div>
                    <div className="pw-recipe__inputs">
                      {r.inputs.map((ing) => {
                        const have = countOf(slots, ing.item);
                        return (
                          <span
                            key={ing.item}
                            className={`pw-ing ${have >= ing.count ? '' : 'is-missing'}`}
                          >
                            <ItemIcon stack={{ itemId: ing.item, count: 1 }} size={16} />
                            {have}/{ing.count}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="pw-recipe__actions">
                    <Button
                      disabled={times < 1}
                      onClick={() => craft(r, 1)}
                      testId={`craft-${r.id}`}
                    >
                      {t('inv.craft')}
                    </Button>
                    <Button variant="ghost" disabled={times < 2} onClick={() => craft(r, times)}>
                      {t('inv.craftAll')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {cursor ? (
        <div className="pw-cursor-stack" style={{ left: mouse.x - 16, top: mouse.y - 16 }}>
          <ItemIcon stack={cursor} />
        </div>
      ) : null}
      {hover && !cursor ? <ItemTooltip stack={hover} x={mouse.x} y={mouse.y} /> : null}
    </Window>
  );
}
