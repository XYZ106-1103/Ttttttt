import { itemRegistry, type ItemStack } from '@world/shared';
import { useMemo, useState } from 'react';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { ItemIcon } from '../components/ItemIcon';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { failText, goldText, itemLabel, MiniInventory, Trend } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

type Tab = 'buy' | 'sell' | 'mine';
const KINDS = ['weapon', 'armor', 'accessory', 'material', 'consumable', 'tool', 'block'] as const;
const FEE = 0.05;

/**
 * The exchange: listings by adventurers (and the player) with market reference prices that move
 * with supply and demand. Proceeds are collected here.
 */
export function ExchangeWindow(props: Props) {
  const { stores, bridge } = useServices();
  const eco = useStore(stores.economy, (s) => s);
  const slots = useStore(stores.inventory, (s) => s.slots);
  const [tab, setTab] = useState<Tab>('buy');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [price, setPrice] = useState(1);

  const listings = useMemo(() => {
    const q = query.trim().toLowerCase();
    return eco.listings
      .filter((l) => !l.mine)
      .filter((l) => !kind || itemRegistry.get(l.itemId)?.kind === kind)
      .filter((l) => !q || itemLabel(l.itemId).toLowerCase().includes(q))
      .sort((a, b) => itemLabel(a.itemId).localeCompare(itemLabel(b.itemId)) || a.price - b.price);
  }, [eco.listings, query, kind]);
  const mine = eco.listings.filter((l) => l.mine);

  const buy = (id: number, itemId: string, n: number): void => {
    void bridge
      .getTown()
      ?.marketBuy(id, n)
      .then((r) => {
        if (r.ok)
          showToast(stores, t('ex.bought', { item: itemLabel(itemId), count: n, gold: r.total }));
        else showToast(stores, failText(r.reason));
      });
  };

  const choose = (slot: number, st: ItemStack): void => {
    setPick(slot);
    setCount(st.count);
    setPrice(eco.prices[st.itemId]?.suggested ?? itemRegistry.get(st.itemId)?.value ?? 1);
  };
  const picked = pick !== null ? (slots[pick] ?? null) : null;
  const list = (): void => {
    if (pick === null || !picked) return;
    const itemId = picked.itemId;
    void bridge
      .getTown()
      ?.marketList(pick, count, price)
      .then((r) => {
        if (r.ok) {
          showToast(stores, t('ex.listed', { item: itemLabel(itemId), count }));
          setPick(null);
        } else showToast(stores, failText(r.reason, { n: eco.maxListings }));
      });
  };

  return (
    <Window
      title={t('window.exchange')}
      width={700}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 350), y: 90 }}
      testId="window-exchange"
      {...props}
    >
      <div className="pw-ex">
        <div className="pw-tabs">
          {(['buy', 'sell', 'mine'] as const).map((id) => (
            <Button key={id} active={tab === id} onClick={() => setTab(id)} testId={`ex-tab-${id}`}>
              {t(`ex.tab.${id}`)}
              {id === 'mine' && (eco.mailGold > 0 || eco.mailItems > 0) ? ' ●' : ''}
            </Button>
          ))}
          <span className="pw-gold-line">
            {t('hud.gold')}: <b data-testid="ex-gold">{goldText(eco.gold)}</b>
          </span>
        </div>

        {tab === 'buy' ? (
          <>
            <div className="pw-ex__filters">
              <input
                className="pw-input"
                placeholder={t('ex.search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                data-testid="ex-search"
              />
              <Button active={kind === null} onClick={() => setKind(null)}>
                {t('ex.all')}
              </Button>
              {KINDS.map((k) => (
                <Button key={k} active={kind === k} onClick={() => setKind(k)}>
                  {t(`ex.kind.${k}`)}
                </Button>
              ))}
            </div>
            <div className="pw-ex__table" data-testid="ex-listings">
              {listings.length === 0 ? <p className="pw-note">{t('ex.empty')}</p> : null}
              {listings.map((l) => {
                const pr = eco.prices[l.itemId];
                return (
                  <div key={l.id} className="pw-ex__row" data-testid={`ex-row-${l.itemId}`}>
                    <ItemIcon stack={{ itemId: l.itemId, count: l.count }} size={28} />
                    <span className="pw-ex__name">{itemLabel(l.itemId)}</span>
                    <span className="pw-ex__seller">{l.seller}</span>
                    <span className="pw-ex__ref">
                      {pr ? t('ex.ref', { n: pr.ref }) : ''}{' '}
                      {pr ? <Trend value={pr.trend} /> : null}
                    </span>
                    <span className="pw-price">
                      {l.price}G <small>{t('ex.unit')}</small>
                    </span>
                    <Button onClick={() => buy(l.id, l.itemId, 1)} testId={`ex-buy-${l.id}`}>
                      {t('ex.buyOne')}
                    </Button>
                    {l.count > 1 ? (
                      <Button onClick={() => buy(l.id, l.itemId, l.count)}>{t('ex.buyAll')}</Button>
                    ) : (
                      <span />
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        {tab === 'sell' ? (
          <div className="pw-ex__sell">
            <MiniInventory
              testPrefix="ex-pick"
              selected={pick}
              onLeft={choose}
              badge={(st) => (eco.prices[st.itemId] ? `${eco.prices[st.itemId]?.ref}` : null)}
            />
            <div className="pw-ex__form">
              {!picked ? (
                <p className="pw-note">{t('ex.pick')}</p>
              ) : (
                <>
                  <div className="pw-ex__picked">
                    <ItemIcon stack={picked} />
                    <b>{itemLabel(picked.itemId)}</b>
                  </div>
                  <label className="pw-field">
                    <span>{t('ex.count')}</span>
                    <input
                      className="pw-input"
                      type="number"
                      min={1}
                      max={picked.count}
                      value={count}
                      onChange={(e) =>
                        setCount(
                          Math.max(
                            1,
                            Math.min(picked.count, Math.floor(Number(e.target.value) || 1)),
                          ),
                        )
                      }
                      data-testid="ex-count"
                    />
                  </label>
                  <label className="pw-field">
                    <span>{t('ex.priceEach')}</span>
                    <input
                      className="pw-input"
                      type="number"
                      min={1}
                      value={price}
                      onChange={(e) =>
                        setPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))
                      }
                      data-testid="ex-price"
                    />
                  </label>
                  {eco.prices[picked.itemId] ? (
                    <p className="pw-note">
                      {t('ex.suggest', {
                        n: eco.prices[picked.itemId]?.suggested ?? 0,
                        ref: eco.prices[picked.itemId]?.ref ?? 0,
                      })}
                    </p>
                  ) : null}
                  <p className="pw-note">
                    {t('ex.fee', {
                      n: price * count - Math.max(1, Math.floor(price * count * FEE)),
                    })}
                  </p>
                  <Button variant="primary" onClick={list} testId="ex-list">
                    {t('ex.list')}
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'mine' ? (
          <div className="pw-ex__mine">
            <div className="pw-ex__mail">
              <span className="pw-note">{t('ex.mailHint')}</span>
              <Button
                variant="primary"
                disabled={eco.mailGold <= 0 && eco.mailItems <= 0}
                testId="ex-collect"
                onClick={() => {
                  void bridge
                    .getTown()
                    ?.marketCollect()
                    .then((got) => {
                      if (got) showToast(stores, t('ex.collected', { gold: got.gold }));
                    });
                }}
              >
                {t('ex.collect', { gold: eco.mailGold, items: eco.mailItems })}
              </Button>
            </div>
            <div className="pw-ex__table">
              {mine.length === 0 ? <p className="pw-note">{t('ex.noMine')}</p> : null}
              {mine.map((l) => (
                <div key={l.id} className="pw-ex__row" data-testid={`ex-mine-${l.itemId}`}>
                  <ItemIcon stack={{ itemId: l.itemId, count: l.count }} size={28} />
                  <span className="pw-ex__name">{itemLabel(l.itemId)}</span>
                  <span className="pw-ex__seller">
                    {t('ex.expires', { h: Math.max(1, Math.round(l.left / 60)) })}
                  </span>
                  <span />
                  <span className="pw-price">{l.price}G</span>
                  <Button
                    onClick={() => {
                      void bridge
                        .getTown()
                        ?.marketCancel(l.id)
                        .then((r) => {
                          if (!r.ok) showToast(stores, failText(r.reason));
                        });
                    }}
                  >
                    {t('ex.cancel')}
                  </Button>
                  <span />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Window>
  );
}
