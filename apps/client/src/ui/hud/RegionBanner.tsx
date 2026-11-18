import { ZONE_NAME_KEY } from '@world/shared';
import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Cinematic region title shown when entering a new region. */
export function RegionBanner() {
  const { stores } = useServices();
  const banner = useStore(stores.ui, (s) => s.banner);
  if (!banner) return null;
  return (
    <div key={banner.id} className="pw-banner" aria-live="polite">
      <div className="pw-banner__zone">{t(ZONE_NAME_KEY)}</div>
      <div className="pw-banner__title">{t(banner.regionKey)}</div>
      <div className="pw-banner__rule" />
    </div>
  );
}
