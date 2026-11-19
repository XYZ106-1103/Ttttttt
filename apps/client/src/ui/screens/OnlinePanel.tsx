import { useCallback, useEffect, useMemo, useState } from 'react';
import { appearanceFromLook } from '../../game/art/character/appearance';
import { characterPortraitDataUrl } from '../../game/render/textures';
import { hasMessage, t } from '../../i18n';
import {
  api,
  type CharacterSummary,
  loadSession,
  saveSession,
  type StoredSession,
} from '../../net/api';
import { Button } from '../components/Button';
import { useServices } from '../context';

type View = 'login' | 'characters' | 'create' | 'connecting';

function errorText(code: string): string {
  const key = `online.err.${code}`;
  return t(hasMessage(key) ? key : 'online.err.failed');
}

const portraits = new Map<number, string>();
function portraitOf(look: number): string {
  let url = portraits.get(look);
  if (!url) {
    url = characterPortraitDataUrl(appearanceFromLook(look), 2);
    portraits.set(look, url);
  }
  return url;
}

function randomLook(): number {
  return 3 + Math.floor(Math.random() * 0x7ffffff0);
}

/**
 * Online play from the title screen: log in or register, pick or create a character, connect.
 * Offline single player stays available from the main title menu.
 */
export function OnlinePanel({ onBack }: { onBack: () => void }) {
  const { bridge } = useServices();
  const [session, setSession] = useState<StoredSession | null>(() => loadSession());
  const [view, setView] = useState<View>(session ? 'characters' : 'login');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(session?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [max, setMax] = useState(3);
  const [name, setName] = useState('');
  const [looks, setLooks] = useState<number[]>(() => [0, 1, 2, randomLook(), randomLook()]);
  const [look, setLook] = useState(0);

  const loadCharacters = useCallback(async (s: StoredSession) => {
    setBusy(true);
    const r = await api.characters(s.token);
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) {
        saveSession(null);
        setSession(null);
        setView('login');
        setError(errorText('session_expired'));
      } else setError(errorText(r.error));
      return;
    }
    setCharacters(r.value.characters);
    setMax(r.value.max);
    setError(null);
  }, []);

  useEffect(() => {
    if (session && view === 'characters') void loadCharacters(session);
    // Only on entering the character list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const submitLogin = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r =
      mode === 'login'
        ? await api.login(email.trim(), password)
        : await api.register(email.trim(), password);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    const s = { token: r.value.token, email: email.trim().toLowerCase() };
    saveSession(s);
    setSession(s);
    setPassword('');
    setView('characters');
  };

  const logout = async (): Promise<void> => {
    if (session) void api.logout(session.token);
    saveSession(null);
    setSession(null);
    setCharacters([]);
    setView('login');
  };

  const create = async (): Promise<void> => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.createCharacter(session.token, name.trim(), look);
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setName('');
    setView('characters');
  };

  const enter = async (c: CharacterSummary): Promise<void> => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    setView('connecting');
    const err = await bridge.startOnline(session.token, c.id);
    setBusy(false);
    if (err) {
      if (err === 'unauthorized') {
        saveSession(null);
        setSession(null);
        setView('login');
      } else setView('characters');
      setError(errorText(err));
    }
  };

  const lookChoices = useMemo(() => looks.map((l) => ({ look: l, url: portraitOf(l) })), [looks]);

  return (
    <div className="pw-online" data-testid="online-panel">
      <h2 className="pw-online__title">{t('online.title')}</h2>
      {error ? (
        <p className="pw-online__error" role="alert" data-testid="online-error">
          {error}
        </p>
      ) : null}

      {view === 'login' ? (
        <form
          className="pw-online__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submitLogin();
          }}
        >
          <div className="pw-online__tabs">
            <button
              type="button"
              className={mode === 'login' ? 'is-active' : ''}
              onClick={() => setMode('login')}
            >
              {t('online.login')}
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'is-active' : ''}
              onClick={() => setMode('register')}
              data-testid="online-register-tab"
            >
              {t('online.register')}
            </button>
          </div>
          <label className="pw-online__field">
            <span>{t('online.email')}</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              maxLength={160}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              data-testid="online-email"
              required
            />
          </label>
          <label className="pw-online__field">
            <span>{t('online.password')}</span>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              minLength={8}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              data-testid="online-password"
              required
            />
          </label>
          {mode === 'register' ? (
            <p className="pw-online__hint">{t('online.passwordHint')}</p>
          ) : null}
          <Button variant="primary" disabled={busy} testId="online-submit" type="submit">
            {mode === 'login' ? t('online.login') : t('online.registerSubmit')}
          </Button>
          <Button onClick={onBack}>{t('title.cancel')}</Button>
        </form>
      ) : null}

      {view === 'characters' ? (
        <div className="pw-online__chars">
          <p className="pw-online__hint">{t('online.signedIn', { email: session?.email ?? '' })}</p>
          {characters.length === 0 && !busy ? (
            <p className="pw-online__hint">{t('online.noCharacters')}</p>
          ) : null}
          <ul className="pw-online__list">
            {characters.map((c) => (
              <li key={c.id} className="pw-online__char">
                <img src={portraitOf(c.look)} alt="" className="pw-online__portrait" />
                <div className="pw-online__charInfo">
                  <strong>{c.name}</strong>
                  <span>
                    Lv.{c.level} · {t(`job.${c.jobId}`)}
                  </span>
                </div>
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void enter(c)}
                  testId={`online-enter-${c.name}`}
                >
                  {t('online.enter')}
                </Button>
              </li>
            ))}
          </ul>
          {characters.length < max ? (
            <Button
              onClick={() => {
                setError(null);
                setView('create');
              }}
              testId="online-new-character"
            >
              {t('online.newCharacter')}
            </Button>
          ) : null}
          <Button onClick={() => void logout()}>{t('online.logout')}</Button>
          <Button onClick={onBack}>{t('title.cancel')}</Button>
        </div>
      ) : null}

      {view === 'create' ? (
        <form
          className="pw-online__form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="pw-online__field">
            <span>{t('online.name')}</span>
            <input
              value={name}
              maxLength={12}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              data-testid="online-name"
              required
            />
          </label>
          <p className="pw-online__hint">{t('online.nameHint')}</p>
          <span className="pw-online__label">{t('online.look')}</span>
          <div className="pw-online__looks">
            {lookChoices.map((c) => (
              <button
                key={c.look}
                type="button"
                className={`pw-online__look ${c.look === look ? 'is-active' : ''}`}
                onClick={() => setLook(c.look)}
                aria-pressed={c.look === look}
              >
                <img src={c.url} alt="" />
              </button>
            ))}
          </div>
          <Button
            onClick={() => {
              const next = [0, 1, 2, randomLook(), randomLook()];
              setLooks(next);
              if (look > 2) setLook(0);
            }}
          >
            {t('online.moreLooks')}
          </Button>
          <Button variant="primary" disabled={busy} testId="online-create" type="submit">
            {t('online.create')}
          </Button>
          <Button onClick={() => setView('characters')}>{t('title.cancel')}</Button>
        </form>
      ) : null}

      {view === 'connecting' ? <p className="pw-online__hint">{t('online.connecting')}</p> : null}
    </div>
  );
}
