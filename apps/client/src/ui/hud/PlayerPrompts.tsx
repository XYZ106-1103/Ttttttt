import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { failText } from '../windows/social/common';

/** Another player asked to trade (online): accept or decline. */
export function PlayerPrompts() {
  const { stores, bridge } = useServices();
  const request = useStore(stores.players, (s) => s.request);
  if (!request) return null;
  const answer = (accept: boolean): void => {
    stores.players.set({ request: null });
    void bridge.playerAction('trade', { op: accept ? 'accept' : 'decline' }).then((r) => {
      if (!r.ok) showToast(stores, failText(r.reason));
    });
  };
  return (
    <div className="pw-invite pw-panel pw-invite--trade" data-testid="trade-request">
      <div>{t('ptrade.request', { name: request.name })}</div>
      <div className="pw-invite__buttons">
        <Button variant="primary" testId="trade-accept" onClick={() => answer(true)}>
          {t('party.accept')}
        </Button>
        <Button onClick={() => answer(false)}>{t('party.decline')}</Button>
      </div>
    </div>
  );
}
