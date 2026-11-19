import { getJobDef, GUILD_MAX_MEMBERS } from '@world/shared';
import { showToast } from '../../app/stores';
import { t } from '../../i18n';
import { Button } from '../components/Button';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { Emblem } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

/** The player's guild (members, log) or, without one, the guilds of the world. */
export function GuildWindow(props: Props) {
  const { stores, bridge } = useServices();
  const guild = useStore(stores.social, (s) => s.guild);
  const guilds = useStore(stores.social, (s) => s.guilds);
  return (
    <Window
      title={t('window.guild')}
      width={460}
      initial={{ x: Math.max(16, window.innerWidth / 2 - 230), y: 110 }}
      testId="window-guild"
      {...props}
    >
      {guild ? (
        <div className="pw-guild">
          <div className="pw-guild__head">
            <Emblem index={guild.emblem} size={28} />
            <div>
              <div className="pw-guild__name">{guild.name}</div>
              <div className="pw-note">
                {t('guild.leaderName', { name: guild.leaderName })} ·{' '}
                {t('guild.members', { n: guild.members.length, max: GUILD_MAX_MEMBERS })} ·{' '}
                {t('guild.fame', { n: guild.fame })}
              </div>
            </div>
          </div>
          <div className="pw-guild__members">
            {guild.members.map((m) => (
              <div key={m.key} className="pw-guild__member">
                <span>
                  {m.leader ? '★ ' : ''}
                  {m.name}
                </span>
                <span style={{ color: getJobDef(m.jobId).color }}>
                  Lv.{m.level} {t(getJobDef(m.jobId).nameKey)}
                </span>
                <small>{m.near ? t('guild.member.near') : t('guild.member.away')}</small>
              </div>
            ))}
          </div>
          <div className="pw-inv__label">{t('guild.log')}</div>
          <ul className="pw-memories">
            {guild.log.map((e, i) => (
              <li key={i}>
                <span>{t(`guild.log.${e.kind}`, { who: e.who, detail: e.detail })}</span>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            testId="guild-leave"
            onClick={() => {
              bridge.getTown()?.leaveGuild();
              showToast(stores, t('guild.left'));
            }}
          >
            {t('guild.leave')}
          </Button>
        </div>
      ) : (
        <div className="pw-guild">
          <p className="pw-note">{t('guild.none')}</p>
          <p className="pw-note">{t('guild.joinHint')}</p>
          <div className="pw-inv__label">{t('guild.list')}</div>
          <div className="pw-guild__members" data-testid="guild-list">
            {guilds.map((g) => (
              <div key={g.id} className="pw-guild__member">
                <span>
                  <Emblem index={g.emblem} /> {g.name}
                </span>
                <span>{t('guild.leaderName', { name: g.leaderName })}</span>
                <small>
                  {t('guild.members', { n: g.members, max: GUILD_MAX_MEMBERS })} ·{' '}
                  {t('guild.fame', { n: g.fame })}
                </small>
              </div>
            ))}
          </div>
        </div>
      )}
    </Window>
  );
}
