import { HOTBAR_SIZE, itemRegistry } from '@world/shared';
import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { ItemIcon } from '../components/ItemIcon';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { SkillBar } from './SkillBar';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/** Hotbar: the first 10 inventory slots. Number keys / mouse wheel / click select. */
export function Hotbar() {
  const { stores, bridge } = useServices();
  const slots = useStore(stores.inventory, (s) => s.slots);
  const selected = useStore(stores.inventory, (s) => s.selected);
  const stack = slots[selected] ?? null;
  const name = stack ? t(itemRegistry.get(stack.itemId)?.nameKey ?? '') : '';
  const [shownName, setShownName] = useState({ name, key: 0 });
  useEffect(() => setShownName((s) => ({ name, key: s.key + 1 })), [name, selected]);

  return (
    <div className="pw-hotbar-wrap">
      {shownName.name ? (
        <div key={shownName.key} className="pw-hotbar__name">
          {shownName.name}
        </div>
      ) : null}
      <div className="pw-hotbar-row">
        <div className="pw-quickslots pw-panel" data-testid="hotbar">
          {Array.from({ length: HOTBAR_SIZE }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`pw-slot ${i === selected ? 'is-selected' : ''}`}
              onClick={() => bridge.selectSlot(i)}
              data-testid={`hotbar-${i}`}
            >
              <span className="pw-slot__key">{KEYS[i]}</span>
              <ItemIcon stack={slots[i] ?? null} />
            </button>
          ))}
        </div>
        <SkillBar />
      </div>
    </div>
  );
}
