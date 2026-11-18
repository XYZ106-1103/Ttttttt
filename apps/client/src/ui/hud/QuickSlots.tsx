import { t } from '../../i18n';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

/**
 * Quick-slot bar. PHASE 1: slots are empty placeholders (items and skills arrive in
 * PHASE 2 / PHASE 3); they are rendered so the HUD layout is final.
 */
export function QuickSlots() {
  return (
    <div className="pw-quickslots pw-panel" title={t('hud.locked', { phase: 'PHASE 2' })}>
      {KEYS.map((k) => (
        <div key={k} className="pw-slot">
          <span className="pw-slot__key">{k}</span>
        </div>
      ))}
    </div>
  );
}
