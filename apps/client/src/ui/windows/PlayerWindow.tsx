import { getJobDef } from '@world/shared';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { closeWindow } from '../windowActions';
import { failText } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

/** Another player (online): invite to a party, ask to trade, or whisper. */
export function PlayerWindow(props: Props) {
  const { stores, bridge } = useServices();
  const target = useStore(stores.players, (s) => s.menu);
  if (!target) return null;
  const job = getJobDef(target.jobId);

  const act = (op: string, args: Record<string, unknown>, done: string): void => {
    void bridge.playerAction(op, args).then((r) => {
      showToast(stores, r.ok ? t(done, { name: target.name }) : failText(r.reason));
      if (r.ok) closeWindow(stores, 'player');
    });
  };

  return (
    <Window
      title={target.name}
      width={260}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 130), y: 160 }}
      testId="window-player"
      {...props}
    >
      <div className="pw-player">
        <p className="pw-note">
          Lv.{target.level} · <span style={{ color: job.color }}>{t(job.nameKey)}</span>
        </p>
        <Button
          variant="primary"
          testId="player-invite"
          onClick={() => act('invitePlayer', { name: target.name }, 'player.invited')}
        >
          {t('player.invite')}
        </Button>
        <Button
          testId="player-trade"
          onClick={() => act('trade', { op: 'request', name: target.name }, 'player.tradeAsked')}
        >
          {t('player.trade')}
        </Button>
        <Button
          onClick={() => {
            closeWindow(stores, 'player');
            stores.ui.set({ chatOpen: true, chatDraft: `/w ${target.name} ` });
          }}
        >
          {t('player.whisper')}
        </Button>
      </div>
    </Window>
  );
}
