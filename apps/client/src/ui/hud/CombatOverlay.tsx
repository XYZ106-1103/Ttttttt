import { useEffect, useState } from 'react';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Damage vignette, low-HP pulse, level-up banner and the death screen. */
export function CombatOverlay() {
  const { stores, bridge } = useServices();
  const hitFlash = useStore(stores.combat, (s) => s.hitFlash);
  const levelUp = useStore(stores.combat, (s) => s.levelUp);
  const level = useStore(stores.combat, (s) => s.lastLevel);
  const dead = useStore(stores.combat, (s) => s.dead);
  const respawnIn = useStore(stores.combat, (s) => s.respawnIn);
  const lowHp = useStore(stores.player, (s) => s.hp > 0 && s.hp / Math.max(1, s.maxHp) < 0.25);
  const [flashKey, setFlashKey] = useState(0);
  const [banner, setBanner] = useState<{ key: number; level: number } | null>(null);

  useEffect(() => {
    if (hitFlash > 0) setFlashKey(hitFlash);
  }, [hitFlash]);
  useEffect(() => {
    if (levelUp <= 0) return;
    setBanner({ key: levelUp, level });
    const id = window.setTimeout(() => setBanner(null), 2600);
    return () => window.clearTimeout(id);
    // Only a new level-up counter triggers the banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelUp]);

  return (
    <>
      {flashKey > 0 ? <div key={flashKey} className="pw-hitflash" /> : null}
      {lowHp && !dead ? <div className="pw-lowhp" /> : null}
      {banner ? (
        <div key={banner.key} className="pw-levelup" data-testid="levelup-banner">
          <div className="pw-levelup__title">LEVEL UP!</div>
          <div className="pw-levelup__sub">
            {t('combat.levelUpBanner', { level: banner.level })}
          </div>
        </div>
      ) : null}
      {dead ? (
        <div className="pw-death" data-testid="death-screen">
          <div className="pw-death__title">{t('combat.died')}</div>
          <div className="pw-death__sub">{t('combat.diedSub')}</div>
          <Button disabled={respawnIn > 0} onClick={() => bridge.respawn()} testId="respawn">
            {respawnIn > 0
              ? t('combat.respawnIn', { s: Math.ceil(respawnIn) })
              : t('combat.respawn')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
