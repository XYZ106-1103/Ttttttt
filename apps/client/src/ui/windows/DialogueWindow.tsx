import { GUILD_FOUND_COST, GUILD_FOUND_LEVEL, type PlayerRequest } from '@world/shared';
import { useCallback, useEffect, useState } from 'react';
import { showToast } from '../../app/stores';
import { getLanguage, t } from '../../i18n';
import { Button } from '../components/Button';
import { Window } from '../components/Window';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';
import { closeWindow, openWindow } from '../windowActions';
import { failText } from './social/common';

interface Props {
  onClose: () => void;
  onFocus: () => void;
  zIndex: number;
}

interface Said {
  readonly who: string;
  readonly text: string;
  readonly mine?: boolean;
}

/**
 * Conversation with an NPC or an adventurer. Adventurers answer with their own voice (tone,
 * relationship, memories); every request goes through TownServices, which checks range and
 * applies the shared social rules.
 */
export function DialogueWindow(props: Props) {
  const { stores, bridge } = useServices();
  const target = useStore(stores.dialogue, (s) => s.target);
  const seq = useStore(stores.dialogue, (s) => s.seq);
  const party = useStore(stores.social, (s) => s.party);
  const myGuild = useStore(stores.social, (s) => s.guild);
  const adv = useStore(stores.adventurers, (s) =>
    target?.kind === 'adventurer' ? s.list.find((a) => a.key === target.key) : undefined,
  );
  const [log, setLog] = useState<Said[]>([]);
  const [gone, setGone] = useState(false);

  const speakerName =
    target?.kind === 'adventurer' ? bridge.nameOf(target.key) : target ? t(`npc.${target.id}`) : '';

  // Opening line.
  useEffect(() => {
    setGone(false);
    if (!target) return;
    if (target.kind === 'npc') {
      const params = { level: GUILD_FOUND_LEVEL, cost: GUILD_FOUND_COST };
      setLog([{ who: t(`npc.${target.id}`), text: t(`npc.${target.id}.hello`, params) }]);
      return;
    }
    const town = bridge.getTown();
    const r = town?.talk(target.key);
    if (!r) {
      setGone(true);
      setLog([]);
      return;
    }
    setLog([
      { who: bridge.nameOf(target.key), text: bridge.lineText(target.key, r.line, r.params) },
    ]);
    stores.adventurers.set({ selected: target.key });
  }, [target, seq, bridge, stores]);

  // Keep the adventurer listening while the window is open; notice when they leave.
  useEffect(() => {
    if (target?.kind !== 'adventurer') return;
    const id = window.setInterval(() => {
      const town = bridge.getTown();
      if (!town?.talkable(target.key)) setGone(true);
      else town.keepListening(target.key);
    }, 1000);
    return () => window.clearInterval(id);
  }, [target, bridge]);

  const say = useCallback(
    (mine: string, req: PlayerRequest) => {
      if (target?.kind !== 'adventurer') return;
      const r = bridge.getTown()?.ask(target.key, req);
      if (!r) {
        setGone(true);
        return;
      }
      setLog((l) =>
        [
          ...l,
          { who: t('dlg.you'), text: mine, mine: true },
          { who: bridge.nameOf(target.key), text: bridge.lineText(target.key, r.line, r.params) },
        ].slice(-6),
      );
      if (req === 'bye') window.setTimeout(() => closeWindow(stores, 'dialogue'), 700);
    },
    [target, bridge, stores],
  );

  if (!target) return null;

  const options: { label: string; onClick: () => void; testId: string; disabled?: boolean }[] = [];
  if (target.kind === 'npc') {
    const role = target.id === 'shopkeeper' ? 'shop' : target.id === 'clerk' ? 'exchange' : 'guild';
    if (role === 'shop')
      options.push({
        label: t('dlg.shop'),
        onClick: () => {
          closeWindow(stores, 'dialogue');
          openWindow(stores, 'shop');
        },
        testId: 'dlg-shop',
      });
    if (role === 'exchange')
      options.push({
        label: t('dlg.exchange'),
        onClick: () => {
          closeWindow(stores, 'dialogue');
          openWindow(stores, 'exchange');
        },
        testId: 'dlg-exchange',
      });
    if (role === 'guild') {
      if (!myGuild)
        options.push({
          label: t('dlg.found', { cost: GUILD_FOUND_COST }),
          testId: 'dlg-found',
          onClick: () => {
            const r = bridge.getTown()?.foundGuild();
            if (!r) return;
            if (r.ok) {
              showToast(
                stores,
                t('guild.founded', {
                  guild: getLanguage() === 'en' ? r.guild.name.en : r.guild.name.ko,
                }),
              );
              openWindow(stores, 'guild');
            } else showToast(stores, failText(r.reason, { level: GUILD_FOUND_LEVEL }));
          },
        });
      options.push({
        label: t('dlg.guildWindow'),
        onClick: () => openWindow(stores, 'guild'),
        testId: 'dlg-guild',
      });
    }
  } else {
    const key = target.key;
    const inParty = !!party?.some((m) => m.key === key);
    options.push({
      label: t('dlg.status'),
      testId: 'dlg-status',
      onClick: () => say(t('dlg.status'), 'status'),
    });
    options.push(
      inParty
        ? {
            label: t('dlg.leaveParty'),
            testId: 'dlg-leave',
            onClick: () => say(t('dlg.leaveParty'), 'leave_party'),
          }
        : {
            label: t('dlg.party'),
            testId: 'dlg-party',
            onClick: () => say(t('dlg.party'), 'party'),
          },
    );
    options.push({
      label: t('dlg.trade'),
      testId: 'dlg-trade',
      onClick: () => openWindow(stores, 'trade'),
    });
    if (myGuild && !adv?.guild)
      options.push({
        label: t('dlg.guildInvite'),
        testId: 'dlg-guild-invite',
        onClick: () => say(t('dlg.guildInvite'), 'guild_invite'),
      });
    if (!myGuild && adv?.guild)
      options.push({
        label: t('dlg.guildJoin'),
        testId: 'dlg-guild-join',
        onClick: () => say(t('dlg.guildJoin'), 'guild_join'),
      });
  }

  return (
    <Window
      title={`${t('window.dialogue')} — ${speakerName}`}
      width={440}
      initial={{
        x: Math.max(16, window.innerWidth / 2 - 220),
        y: Math.max(80, window.innerHeight - 440),
      }}
      testId="window-dialogue"
      {...props}
    >
      <div className="pw-dialogue">
        {adv ? (
          <div className="pw-dialogue__meta">
            Lv.{adv.level} · {t('dlg.relation', { label: t(`rel.${adv.relation}`) })}
            {adv.guild ? ` · ${adv.guild}` : ''}
          </div>
        ) : null}
        <div className="pw-dialogue__log" data-testid="dialogue-log">
          {log.map((l, i) => (
            <div key={i} className={`pw-dialogue__line ${l.mine ? 'is-mine' : ''}`}>
              <b>{l.who}</b>
              <span>{l.text}</span>
            </div>
          ))}
          {gone ? <div className="pw-note">{t('dlg.gone')}</div> : null}
        </div>
        <div className="pw-dialogue__options">
          {options.map((o) => (
            <Button
              key={o.testId}
              onClick={o.onClick}
              disabled={gone || o.disabled}
              testId={o.testId}
            >
              {o.label}
            </Button>
          ))}
          <Button
            variant="ghost"
            testId="dlg-bye"
            onClick={() =>
              target.kind === 'adventurer' && !gone
                ? say(t('dlg.bye'), 'bye')
                : closeWindow(stores, 'dialogue')
            }
          >
            {t('dlg.bye')}
          </Button>
        </div>
      </div>
    </Window>
  );
}
