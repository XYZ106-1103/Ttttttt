/**
 * Account API client (register, login, characters). The game server serves it on the same
 * origin as the client (the Vite dev server proxies /api and /ws to it in development).
 */

export interface CharacterSummary {
  readonly id: number;
  readonly name: string;
  readonly look: number;
  readonly level: number;
  readonly jobId: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const SESSION_KEY = 'pw.session';

export interface StoredSession {
  readonly token: string;
  readonly email: string;
}

/** Remembered login (per browser). Storage may be unavailable (private mode): then nothing is kept. */
export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredSession>;
    return typeof v.token === 'string' && typeof v.email === 'string'
      ? { token: v.token, email: v.email }
      : null;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable: the session lasts until the page closes
  }
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  token?: string,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: 'network', status: 0 };
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON response (proxy error page): reported by status below
  }
  if (!res.ok)
    return {
      ok: false,
      error: typeof json.error === 'string' ? json.error : res.status >= 500 ? 'server' : 'failed',
      status: res.status,
    };
  return { ok: true, value: json as T };
}

export const api = {
  health: () => call<{ ok: boolean; online: number }>('/api/health', 'GET'),
  register: (email: string, password: string) =>
    call<{ token: string }>('/api/register', 'POST', { email, password }),
  login: (email: string, password: string) =>
    call<{ token: string }>('/api/login', 'POST', { email, password }),
  logout: (token: string) => call<{ ok: boolean }>('/api/logout', 'POST', {}, token),
  characters: (token: string) =>
    call<{ characters: CharacterSummary[]; max: number }>(
      '/api/characters',
      'GET',
      undefined,
      token,
    ),
  createCharacter: (token: string, name: string, look: number) =>
    call<{ character: CharacterSummary }>('/api/characters', 'POST', { name, look }, token),
};
