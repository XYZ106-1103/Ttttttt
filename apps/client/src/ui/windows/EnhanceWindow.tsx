import {
  ENHANCE_DROP_FROM,
  ENHANCE_STONE,
  enhanceable,
  enhanceCost,
  itemRegistry,
  MAX_PLUS,
} from '@world/shared';
import { useState } from 'react';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { goldText, itemLabel, MiniInventory } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

type Outcome = { readonly outcome: 'success' | 'fail' | 'drop'; readonly plus: number } | null;

/** Blacksmith: enhance a weapon or armor piece with gold and enhancement stones. */
export function EnhanceWindow(props: Props) {
  const { stores, bridge } = useServices();
  const slots = useStore(stores.inventory, (s) => s.slots);
  const gold = useStore(stores.economy, (s) => s.gold);
  const [slot, setSlot] = useState<number | null>(null);
  const [last, setLast] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);

  const st = slot !== null ? (slots[slot] ?? null) : null;
  const def = st ? itemRegistry.get(st.itemId) : undefined;
  const plus = st?.plus ?? 0;
  const cost = def && enhanceable(def) && plus < MAX_PLUS ? enhanceCost(def, plus) : null;
  let stones = 0;
  for (const s of slots) if (s?.itemId === ENHANCE_STONE) stones += s.count;
  const canTry = !!cost && gold >= cost.gold && stones >= cost.stones && !busy;

  const attempt = (): void => {
    if (slot === null) return;
    setBusy(true);
    void bridge
      .getTown()
      ?.enhance(slot)
      .then((r) => {
        setBusy(false);
        if (r.ok) setLast({ outcome: r.outcome, plus: r.plus });
        else showToast(stores, t(`enhance.fail.${r.reason}`));
      });
  };

  return (
    <Window
      title={t('window.enhance')}
      width={600}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 300), y: 120 }}
      testId="window-enhance"
      {...props}
    >
      <div className="pw-enhance">
        <div className="pw-enhance__panel">
          <div className="pw-enhance__slot">
            <ItemIcon stack={st} size={40} />
          </div>
          {def ? (
            <>
              <strong>
                {itemLabel(def.id)}
                {plus > 0 ? ` +${plus}` : ''}
              </strong>
              {!enhanceable(def) ? (
                <span className="pw-note">{t('enhance.fail.not_gear')}</span>
              ) : !cost ? (
                <span className="pw-note">{t('enhance.fail.max')}</span>
              ) : (
                <>
                  <span>
                    +{plus} → +{plus + 1}
                  </span>
                  <span>{t('enhance.rate', { n: Math.round(cost.rate * 100) })}</span>
                  <span className={gold < cost.gold ? 'is-unmet' : ''}>
                    {t('enhance.gold', { n: goldText(cost.gold) })}
                  </span>
                  <span className={stones < cost.stones ? 'is-unmet' : ''}>
                    {t('enhance.stones', {
                      item: itemLabel(ENHANCE_STONE),
                      n: cost.stones,
                      have: stones,
                    })}
                  </span>
                  {plus >= ENHANCE_DROP_FROM ? (
                    <span className="pw-note">{t('enhance.dropWarn')}</span>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <span className="pw-note">{t('enhance.pick')}</span>
          )}
          <Button onClick={attempt} disabled={!canTry} testId="enhance-go">
            {t('enhance.go')}
          </Button>
          {last ? (
            <span className={`pw-enhance__result is-${last.outcome}`} data-testid="enhance-result">
              {t(`enhance.result.${last.outcome}`, { plus: last.plus })}
            </span>
          ) : null}
          <small className="pw-note">{t('enhance.hint')}</small>
        </div>
        <MiniInventory
          selected={slot}
          testPrefix="enhance-slot"
          onLeft={(i) => {
            setSlot(i);
            setLast(null);
          }}
        />
      </div>
    </Window>
  );
}
