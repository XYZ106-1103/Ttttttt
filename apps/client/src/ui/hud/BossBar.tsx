import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Boss name and health at the top of the screen while a boss fight is active. */
export function BossBar() {
  const { stores } = useServices();
  const boss = useStore(stores.combat, (s) => s.boss);
  const [lag, setLag] = useState(1);
  const lagRef = useRef(1);
  const k = boss ? Math.max(0, boss.hp / boss.maxHp) : 0;
  useEffect(() => {
    if (!boss) {
      lagRef.current = 1;
      setLag(1);
      return;
    }
    const id = window.setTimeout(() => {
      lagRef.current = Math.max(k, lagRef.current - 0.04);
      setLag(lagRef.current);
    }, 60);
    return () => window.clearTimeout(id);
  }, [boss, k, lag]);
  if (!boss) return null;
  return (
    <div className={`pw-bossbar ${boss.phase > 0 ? 'is-enraged' : ''}`} data-testid="bossbar">
      <div className="pw-bossbar__name">
        <span className="pw-bossbar__lv">Lv.{boss.level}</span> {t(boss.nameKey)}
        {boss.phase > 0 ? <span className="pw-bossbar__phase">{t('combat.enraged')}</span> : null}
      </div>
      <div className="pw-bossbar__track">
        <div className="pw-bossbar__lag" style={{ width: `${lag * 100}%` }} />
        <div className="pw-bossbar__fill" style={{ width: `${k * 100}%` }} />
        <span className="pw-bossbar__num">
          {Math.ceil(boss.hp).toLocaleString()} / {boss.maxHp.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
