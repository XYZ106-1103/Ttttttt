import { itemRegistry } from '@world/shared';
import { useEffect } from 'react';
import { dropPickup } from '../../app/stores';
import { t } from '../../i18n';
import { ItemIcon } from '../components/ItemIcon';
import { RARITY_COLORS } from '../components/ItemTooltip';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

function FeedLine({ id, itemId, count }: { id: number; itemId: string; count: number }) {
  const { stores } = useServices();
  useEffect(() => {
    const timer = window.setTimeout(() => dropPickup(stores, id), 2600);
    return () => window.clearTimeout(timer);
  }, [id, stores]);
  const def = itemRegistry.get(itemId);
  return (
    <div className="pw-feed__line">
      <ItemIcon stack={{ itemId, count: 1 }} size={16} />
      <span style={{ color: def ? RARITY_COLORS[def.rarity] : undefined }}>
        {t('pickup.got', { count, name: t(def?.nameKey ?? itemId) })}
      </span>
    </div>
  );
}

/** Recent pickups (right side) and short action feedback toasts (above the hotbar). */
export function PickupFeed() {
  const { stores } = useServices();
  const pickups = useStore(stores.feed, (s) => s.pickups);
  const toast = useStore(stores.feed, (s) => s.toast);
  return (
    <>
      <div className="pw-feed" data-testid="pickup-feed">
        {pickups.map((p) => (
          <FeedLine key={p.id} {...p} />
        ))}
      </div>
      {toast ? (
        <div key={toast.id} className="pw-toast">
          {toast.text}
        </div>
      ) : null}
    </>
  );
}
