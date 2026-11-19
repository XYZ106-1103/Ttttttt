import { showToast } from '../../app/stores';
import { t } from '../../i18n';
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

/** NPC shop: buy from finite stock (scarcity raises prices) and sell anything with a value. */
export function ShopWindow(props: Props) {
  const { stores, bridge } = useServices();
  const shop = useStore(stores.economy, (s) => s.shop);
  const gold = useStore(stores.economy, (s) => s.gold);
  const buyback = useStore(stores.economy, (s) => s.buyback);
  const npcId = shop?.npcId ?? 'shopkeeper';

  const buy = (itemId: string, count: number): void => {
    const r = bridge.getTown()?.shopBuy(npcId, itemId, count);
    if (!r) return;
    if (r.ok) showToast(stores, t('ex.bought', { item: itemLabel(itemId), count, gold: r.total }));
    else showToast(stores, failText(r.reason));
  };
  const sell = (slot: number, count: number): void => {
    const r = bridge.getTown()?.shopSell(npcId, slot, count);
    if (r && !r.ok) showToast(stores, failText(r.reason));
  };

  return (
    <Window
      title={t('window.shop')}
      width={620}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 310), y: 110 }}
      testId="window-shop"
      {...props}
    >
      <div className="pw-shop">
        <div className="pw-shop__col">
          <div className="pw-inv__label">
            {t('shop.buy')} <small className="pw-note">{t('shop.buyHint')}</small>
          </div>
          <div className="pw-shop__list">
            {(shop?.items ?? []).map((it) => (
              <button
                key={it.itemId}
                type="button"
                className="pw-shop__row"
                disabled={it.stock <= 0}
                onClick={() => buy(it.itemId, 1)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  buy(it.itemId, Math.min(5, it.stock));
                }}
                data-testid={`shop-buy-${it.itemId}`}
              >
                <ItemIcon stack={{ itemId: it.itemId, count: 1 }} size={28} />
                <span className="pw-shop__name">{itemLabel(it.itemId)}</span>
                <span className="pw-shop__stock">
                  {it.stock > 0 ? t('shop.stock', { n: it.stock }) : t('shop.soldOut')}
                </span>
                <span className="pw-price">{t('shop.price', { n: it.price })}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="pw-shop__col">
          <div className="pw-inv__label">
            {t('shop.sell')} <small className="pw-note">{t('shop.sellHint')}</small>
          </div>
          <MiniInventory
            testPrefix="shop-sell"
            badge={(st) => {
              const p = buyback[st.itemId] ?? 0;
              return p > 0 ? `${p}` : null;
            }}
            onLeft={(slot) => sell(slot, 1)}
            onRight={(slot, st) => sell(slot, st.count)}
          />
          <div className="pw-gold-line" data-testid="shop-gold">
            {t('hud.gold')}: <b>{goldText(gold)}</b>
          </div>
        </div>
      </div>
    </Window>
  );
}
