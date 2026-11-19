import type { ItemStack } from '@world/shared';
import { useState } from 'react';
import { showToast, type TradeOfferView } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { failText, goldText, itemLabel, MiniInventory } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

const MAX_STACKS = 8;

function OfferList(props: {
  readonly offer: TradeOfferView;
  readonly onRemove?: (itemId: string) => void;
  readonly testId: string;
}) {
  const { offer } = props;
  return (
    <div
      className={`pw-ptrade__offer ${offer.confirmed ? 'is-confirmed' : ''}`}
      data-testid={props.testId}
    >
      {offer.items.length === 0 ? <p className="pw-note">{t('ptrade.empty')}</p> : null}
      {offer.items.map((it) => (
        <button
          key={it.itemId}
          type="button"
          className="pw-ptrade__item"
          disabled={!props.onRemove}
          onClick={() => props.onRemove?.(it.itemId)}
          title={props.onRemove ? t('ptrade.remove') : undefined}
        >
          <ItemIcon stack={it} size={24} />
          <span>
            {itemLabel(it.itemId)} ×{it.count}
          </span>
        </button>
      ))}
      <div className="pw-ptrade__gold">{goldText(offer.gold)}</div>
      <div className="pw-ptrade__status">
        {offer.confirmed ? t('ptrade.confirmed') : t('ptrade.notConfirmed')}
      </div>
    </div>
  );
}

/**
 * Player ↔ player trade (online). Both sides set an offer; any change clears both
 * confirmations; when both confirm, the server swaps everything at once after checking it all.
 */
export function PlayerTradeWindow(props: Props) {
  const { stores, bridge } = useServices();
  const trade = useStore(stores.players, (s) => s.trade);
  const myGold = useStore(stores.economy, (s) => s.gold);
  const [gold, setGold] = useState('0');
  if (!trade) return null;

  const send = (items: readonly ItemStack[], g: number): void => {
    void bridge
      .playerAction('trade', {
        op: 'offer',
        items: items.map((i) => ({ itemId: i.itemId, count: i.count })),
        gold: g,
      })
      .then((r) => {
        if (!r.ok) showToast(stores, failText(r.reason));
      });
  };
  const add = (_slot: number, st: ItemStack): void => {
    const items = [...trade.mine.items];
    const i = items.findIndex((x) => x.itemId === st.itemId);
    if (i >= 0) {
      const cur = items[i] as ItemStack;
      items[i] = { itemId: cur.itemId, count: cur.count + st.count };
    } else if (items.length < MAX_STACKS) items.push({ itemId: st.itemId, count: st.count });
    send(items, trade.mine.gold);
  };
  const remove = (itemId: string): void =>
    send(
      trade.mine.items.filter((i) => i.itemId !== itemId),
      trade.mine.gold,
    );

  return (
    <Window
      title={t('ptrade.title', { name: trade.withName })}
      width={600}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 300), y: 110 }}
      testId="window-player-trade"
      {...props}
      onClose={() => {
        void bridge.playerAction('trade', { op: 'cancel' });
        props.onClose();
      }}
    >
      <div className="pw-ptrade">
        <div className="pw-ptrade__cols">
          <div>
            <div className="pw-inv__label">{t('ptrade.mine')}</div>
            <OfferList offer={trade.mine} onRemove={remove} testId="ptrade-mine" />
            <label className="pw-ptrade__goldInput">
              {t('ptrade.gold', { max: myGold })}
              <input
                type="number"
                min={0}
                max={myGold}
                value={gold}
                onChange={(e) => setGold(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                onBlur={() => {
                  const g = Math.max(0, Math.min(myGold, Math.floor(Number(gold) || 0)));
                  setGold(String(g));
                  if (g !== trade.mine.gold) send(trade.mine.items, g);
                }}
                data-testid="ptrade-gold"
              />
            </label>
          </div>
          <div>
            <div className="pw-inv__label">{t('ptrade.theirs', { name: trade.withName })}</div>
            <OfferList offer={trade.theirs} testId="ptrade-theirs" />
          </div>
        </div>
        <p className="pw-note">{t('ptrade.hint')}</p>
        <MiniInventory onLeft={add} testPrefix="ptrade-inv" />
        <div className="pw-ptrade__buttons">
          <Button
            variant="primary"
            disabled={trade.mine.confirmed}
            testId="ptrade-confirm"
            onClick={() =>
              void bridge.playerAction('trade', { op: 'confirm' }).then((r) => {
                if (!r.ok) showToast(stores, failText(r.reason));
              })
            }
          >
            {t('ptrade.confirm')}
          </Button>
          <Button
            onClick={() => {
              void bridge.playerAction('trade', { op: 'cancel' });
              props.onClose();
            }}
          >
            {t('ptrade.cancel')}
          </Button>
        </div>
      </div>
    </Window>
  );
}
