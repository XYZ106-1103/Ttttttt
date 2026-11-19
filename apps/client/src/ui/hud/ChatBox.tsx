import type { ChatChannelId } from '@world/shared';
import { useEffect, useRef, useState } from 'react';
import { pushChat } from '../../app/stores';
import { t } from '../../i18n';
import { useServices } from '../context';
import { useStore } from '../hooks/useStore';

/** Online chat channels the input cycles through (whispers use /w name). */
const SEND_CHANNELS: readonly ChatChannelId[] = ['all', 'near', 'party', 'guild'];
const PREFIX: Record<string, ChatChannelId> = { a: 'all', s: 'near', p: 'party', g: 'guild' };
const AUTHORED = new Set(['local', 'nearby', 'world', 'guild', 'whisper']);

const DEV_COMMANDS = new Set([
  'time',
  'tp',
  'spawn',
  'level',
  'summon',
  'give',
  'heal',
  'gold',
  'peace',
  'monsters',
]);

/**
 * Chat & system log. PHASE 1 chat is local only (no server); PHASE 6 routes it through the
 * WebSocket gateway. Slash commands are developer tools and will be permission-checked
 * server-side later.
 */
export function ChatBox() {
  const { stores, bridge } = useServices();
  const messages = useStore(stores.chat, (s) => s.messages);
  const open = useStore(stores.ui, (s) => s.chatOpen);
  const playerName = useStore(stores.player, (s) => s.name);
  const [draft, setDraft] = useState('');
  const [channel, setChannel] = useState<ChatChannelId>('all');
  const online = useStore(stores.net, (s) => s.mode === 'online');
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const pre = stores.ui.get().chatDraft;
    if (pre) {
      setDraft(pre);
      stores.ui.set({ chatDraft: null });
    }
    inputRef.current?.focus();
  }, [open, stores]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const close = (): void => {
    setDraft('');
    stores.ui.set({ chatOpen: false });
    inputRef.current?.blur();
  };

  const runCommand = (line: string): void => {
    const [cmd, ...args] = line.slice(1).trim().split(/\s+/);
    const name = (cmd ?? '').toLowerCase();
    // Online chat channels: /w name text, /a /s /p /g text.
    if (bridge.isOnline()) {
      if (name === 'w' || name === 'whisper') {
        const [to, ...words] = args;
        const text = words.join(' ').trim();
        if (to && text) bridge.sendChat('whisper', text, to);
        else pushChat(stores, 'system', t('chat.whisperUsage'));
        return;
      }
      const ch = PREFIX[name];
      if (ch) {
        const text = args.join(' ').trim();
        if (text) bridge.sendChat(ch, text);
        setChannel(ch);
        return;
      }
    }
    // Online, developer commands are checked by the server; non-admins are told up front.
    if (DEV_COMMANDS.has(name) && bridge.isOnline() && !bridge.isAdmin()) {
      pushChat(stores, 'system', t('chat.adminOnly'));
      return;
    }
    switch (name) {
      case 'help':
        pushChat(stores, 'system', t('chat.help'));
        if (bridge.isOnline()) pushChat(stores, 'system', t('chat.onlineHelp'));
        break;
      case 'time': {
        const h = Number(args[0]);
        if (!Number.isFinite(h) || h < 0 || h > 24) {
          pushChat(stores, 'system', t('chat.timeUsage'));
          break;
        }
        bridge.setTimeOfDay(h);
        const hh = Math.floor(h) % 24;
        const mm = Math.round((h - Math.floor(h)) * 60);
        pushChat(
          stores,
          'system',
          t('chat.timeSet', {
            time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
          }),
        );
        break;
      }
      case 'pos': {
        const p = bridge.getPlayerTile();
        if (p) pushChat(stores, 'system', t('chat.pos', { x: p.x, y: p.y }));
        break;
      }
      case 'tp': {
        const x = Number(args[0]);
        const y = Number(args[1]);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          pushChat(stores, 'system', t('chat.tpUsage'));
          break;
        }
        pushChat(
          stores,
          'system',
          bridge.teleport(x, y) ? t('chat.pos', { x, y }) : t('chat.tpBlocked'),
        );
        break;
      }
      case 'spawn':
        bridge.spawn();
        break;
      case 'seed':
        pushChat(stores, 'system', t('chat.seed', { seed: stores.world.get().seed }));
        break;
      // --- Developer commands (single player testing; PHASE 6 restricts to admins) ---------
      case 'level': {
        const n = Number(args[0]);
        if (!Number.isInteger(n) || n < 1 || n > 200) {
          pushChat(stores, 'system', t('chat.levelUsage'));
          break;
        }
        bridge.devLevel(n);
        pushChat(stores, 'system', t('chat.levelSet', { level: n }));
        break;
      }
      case 'summon': {
        const id = args[0] ?? '';
        pushChat(
          stores,
          'system',
          bridge.devSummon(id) ? t('chat.summoned', { id }) : t('chat.summonUsage'),
        );
        break;
      }
      case 'give': {
        const id = args[0] ?? '';
        const n = Number(args[1] ?? 1);
        pushChat(
          stores,
          'system',
          bridge.devGive(id, Number.isFinite(n) ? n : 1)
            ? t('chat.given', { id, count: n })
            : t('chat.giveUsage'),
        );
        break;
      }
      case 'heal':
        bridge.devHeal();
        break;
      case 'gold': {
        const n = Math.floor(Number(args[0] ?? 1000));
        if (Number.isFinite(n) && n > 0) {
          bridge.devGold(n);
          pushChat(stores, 'system', t('chat.goldGiven', { n }));
        }
        break;
      }
      case 'peace':
      case 'monsters': {
        const on = (cmd ?? '').toLowerCase() === 'monsters';
        bridge.setMonsters(on);
        pushChat(stores, 'system', t(on ? 'chat.monstersOn' : 'chat.monstersOff'));
        break;
      }
      default:
        pushChat(stores, 'system', t('chat.unknown'));
    }
  };

  const submit = (): void => {
    const text = draft.trim().slice(0, 200);
    if (text.startsWith('/')) runCommand(text);
    else if (text && bridge.isOnline()) bridge.sendChat(channel, text);
    else if (text) pushChat(stores, 'local', text, playerName);
    close();
  };

  return (
    <div className={`pw-chat ${open ? 'is-open' : ''}`} data-testid="hud-chat">
      <div className="pw-chat__log pw-panel" ref={logRef}>
        {messages.slice(open ? -40 : -7).map((m) => (
          <div key={m.id} className={`pw-chat__line pw-chat__line--${m.channel}`}>
            {m.channel !== 'local' ? (
              <span className="pw-chat__tag">
                [
                {m.channel === 'notice'
                  ? '★'
                  : m.channel === 'system'
                    ? t('chat.system')
                    : t(`chat.tag.${m.channel}`)}
                ]
              </span>
            ) : null}
            {AUTHORED.has(m.channel) && m.author ? (
              <span className="pw-chat__author">{m.author}</span>
            ) : null}
            <span className="pw-chat__text">{m.text}</span>
          </div>
        ))}
      </div>
      {open && online ? (
        <button
          type="button"
          className={`pw-chat__channel pw-chat__channel--${channel}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            setChannel(
              SEND_CHANNELS[(SEND_CHANNELS.indexOf(channel) + 1) % SEND_CHANNELS.length] ?? 'all',
            )
          }
          title={t('chat.channelHint')}
          data-testid="chat-channel"
        >
          {t(`chat.ch.${channel}`)}
        </button>
      ) : null}
      {open ? (
        <input
          ref={inputRef}
          className="pw-chat__input"
          value={draft}
          maxLength={200}
          placeholder={t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => stores.ui.set({ chatOpen: false })}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') submit();
            else if (e.key === 'Escape') close();
            else if (e.key === 'Tab' && online) {
              e.preventDefault();
              setChannel(
                SEND_CHANNELS[(SEND_CHANNELS.indexOf(channel) + 1) % SEND_CHANNELS.length] ?? 'all',
              );
            }
            e.stopPropagation();
          }}
          data-testid="chat-input"
        />
      ) : (
        <div className="pw-chat__hint">{t('chat.hint')}</div>
      )}
    </div>
  );
}
