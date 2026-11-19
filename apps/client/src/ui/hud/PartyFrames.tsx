import { getJobDef } from '@world/shared';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Party member frames (left side) and adventurers' invitations to team up. */
export function PartyFrames() {
  const { stores, bridge } = useServices();
  const party = useStore(stores.social, (s) => s.party);
  const leader = useStore(stores.social, (s) => s.partyLeader);
  const invites = useStore(stores.social, (s) => s.invites);
  const dismiss = (from: string) =>
    stores.social.set((s) => ({ invites: s.invites.filter((i) => i.from !== from) }));
  return (
    <>
      {party ? (
        <div className="pw-party pw-panel" data-testid="hud-party">
          <div className="pw-party__title">
            {t('party.title')}
            <button
              type="button"
              className="pw-party__leave"
              onClick={() => bridge.getTown()?.leaveParty()}
              title={t('party.leave')}
              data-testid="party-leave"
            >
              ✕
            </button>
          </div>
          {party
            .filter((m) => m.key !== bridge.selfKey())
            .map((m) => (
              <div key={m.key} className={`pw-party__member ${m.alive ? '' : 'is-dead'}`}>
                <div className="pw-party__name">
                  {m.leader ? '★ ' : ''}
                  {m.name}
                  <small style={{ color: getJobDef(m.jobId).color }}> Lv.{m.level}</small>
                  {!m.near ? <small className="pw-note"> · {t('party.far')}</small> : null}
                  {leader ? (
                    <button
                      type="button"
                      className="pw-party__kick"
                      title={t('party.kick')}
                      onClick={() => bridge.getTown()?.kick(m.key)}
                    >
                      −
                    </button>
                  ) : null}
                </div>
                <div className="pw-party__hp">
                  <i style={{ width: `${Math.round((m.hp / Math.max(1, m.maxHp)) * 100)}%` }} />
                </div>
              </div>
            ))}
        </div>
      ) : null}
      {invites.slice(0, 1).map((inv) => (
        <div key={inv.from} className="pw-invite pw-panel" data-testid="party-invite">
          <div>
            {inv.purpose === 'raid'
              ? t('party.inviteRaid', { name: inv.name })
              : t('party.invite', { name: inv.name })}
          </div>
          <div className="pw-invite__buttons">
            <Button
              variant="primary"
              testId="invite-accept"
              onClick={() => {
                if (inv.purpose === 'player') bridge.answerPlayerInvite(inv.from, true);
                else void bridge.getTown()?.acceptInvite(inv.from);
                dismiss(inv.from);
              }}
            >
              {t('party.accept')}
            </Button>
            <Button
              onClick={() => {
                if (inv.purpose === 'player') bridge.answerPlayerInvite(inv.from, false);
                else bridge.getTown()?.declineInvite(inv.from);
                dismiss(inv.from);
              }}
            >
              {t('party.decline')}
            </Button>
          </div>
        </div>
      ))}
    </>
  );
}
