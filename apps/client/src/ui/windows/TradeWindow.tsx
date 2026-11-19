import type { Offer } from '@world/shared';
import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { failText, goldText, itemLabel } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

/**
 * Face-to-face trade with an adventurer: what they part with (their surplus) and what they are
 * after (their goal's materials, potions). Friends get better prices.
 */
export function TradeWindow(props: Props) {
  const { stores, bridge } = useServices();
  const target = useStore(stores.dialogue, (s) => s.target);
  const gold = useStore(stores.economy, (s) => s.gold);
  const slots = useStore(stores.inventory, (s) => s.slots);
  const key = target?.kind === 'adventurer' ? target.key : null;
  const [offers, setOffers] = useState<{ sells: Offer[]; buys: Offer[] } | null>(null);

  const refresh = useCallback(() => {
    if (!key) return;
    const town = bridge.getTown();
    town?.keepListening(key);
    setOffers(town?.offers(key) ?? null);
  }, [key, bridge]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 1500);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!key) return null;
  const name = bridge.nameOf(key);
  const have = (itemId: string) =>
    slots.reduce((n, s) => n + (s && s.itemId === itemId ? s.count : 0), 0);

  const act = (kind: 'buy' | 'sell', o: Offer, count: number): void => {
    const town = bridge.getTown();
    const r =
      kind === 'buy' ? town?.buyFrom(key, o.itemId, count) : town?.sellTo(key, o.itemId, count);
    if (!r) return;
    if (r.ok) showToast(stores, t('trade.done', { item: itemLabel(o.itemId), count }));
    else showToast(stores, failText(r.reason));
    refresh();
  };

  return (
    <Window
      title={t('trade.title', { name })}
      width={560}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 280), y: 120 }}
      testId="window-trade"
      {...props}
    >
      <div className="pw-trade">
        {!offers ? (
          <p className="pw-note">{t('dlg.gone')}</p>
        ) : (
          <>
            <div className="pw-trade__col">
              <div className="pw-inv__label">{t('trade.theySell', { name })}</div>
              {offers.sells.length === 0 ? <p className="pw-note">{t('trade.none')}</p> : null}
              {offers.sells.map((o) => (
                <div
                  key={o.itemId}
                  className="pw-trade__row"
                  data-testid={`trade-sell-${o.itemId}`}
                >
                  <ItemIcon stack={{ itemId: o.itemId, count: o.count }} size={28} />
                  <span className="pw-ex__name">{itemLabel(o.itemId)}</span>
                  <span className="pw-price">{o.price}G</span>
                  <Button onClick={() => act('buy', o, 1)} disabled={gold < o.price}>
                    {t('trade.buy')}
                  </Button>
                </div>
              ))}
            </div>
            <div className="pw-trade__col">
              <div className="pw-inv__label">{t('trade.theyBuy', { name })}</div>
              {offers.buys.length === 0 ? <p className="pw-note">{t('trade.none')}</p> : null}
              {offers.buys.map((o) => {
                const n = have(o.itemId);
                return (
                  <div
                    key={o.itemId}
                    className="pw-trade__row"
                    data-testid={`trade-buy-${o.itemId}`}
                  >
                    <ItemIcon stack={{ itemId: o.itemId, count: o.count }} size={28} />
                    <span className="pw-ex__name">{itemLabel(o.itemId)}</span>
                    <span className="pw-price">{o.price}G</span>
                    <Button onClick={() => act('sell', o, Math.min(n, o.count))} disabled={n <= 0}>
                      {t('trade.sell', { n })}
                    </Button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="pw-trade__foot">
        <span className="pw-note">{t('trade.hint')}</span>
        <span className="pw-gold-line">
          {t('hud.gold')}: <b>{goldText(gold)}</b>
        </span>
      </div>
    </Window>
  );
}
