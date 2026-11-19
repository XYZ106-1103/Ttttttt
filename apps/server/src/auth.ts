import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Repository, Role } from './db/types';

/** Session lifetime. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCK_MS = 5 * 60 * 1000;
export const MAX_CHARACTERS = 3;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,100}\.[^\s@]{2,24}$/;
/** Hangul, Latin letters and digits; 2–12 characters. */
const NAME = /^[가-힣A-Za-z0-9]{2,12}$/;
const RESERVED = [
  'admin',
  'gm',
  'system',
  'server',
  'moderator',
  '운영자',
  '관리자',
  '시스템',
  'player',
];

export type AuthFail =
  | 'bad_email'
  | 'bad_password'
  | 'exists'
  | 'invalid_login'
  | 'locked'
  | 'bad_name'
  | 'name_taken'
  | 'limit'
  | 'unauthorized';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return email.length <= 160 && EMAIL.test(email);
}

export function validPassword(password: string): boolean {
  return password.length >= 8 && password.length <= 128;
}

export function validName(name: string): boolean {
  return NAME.test(name) && !RESERVED.includes(name.toLowerCase());
}

/** Session tokens are random; only their SHA-256 is stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class Auth {
  /** A real hash to verify against for unknown emails (constant-cost failures). */
  private readonly dummy: Promise<string>;

  constructor(
    private readonly repo: Repository,
    private readonly adminEmails: ReadonlySet<string>,
  ) {
    this.dummy = hash(randomBytes(16).toString('hex'));
  }

  async register(
    emailRaw: string,
    password: string,
  ): Promise<{ ok: true; token: string; accountId: number } | { ok: false; reason: AuthFail }> {
    const email = normalizeEmail(emailRaw);
    if (!validEmail(email)) return { ok: false, reason: 'bad_email' };
    if (!validPassword(password)) return { ok: false, reason: 'bad_password' };
    const role: Role = this.adminEmails.has(email) ? 'admin' : 'player';
    const account = await this.repo.createAccount(email, await hash(password), role);
    if (account === 'exists') return { ok: false, reason: 'exists' };
    return { ok: true, token: await this.startSession(account.id), accountId: account.id };
  }

  async login(
    emailRaw: string,
    password: string,
    now = Date.now(),
  ): Promise<{ ok: true; token: string; accountId: number } | { ok: false; reason: AuthFail }> {
    const email = normalizeEmail(emailRaw);
    const account = validEmail(email) ? await this.repo.accountByEmail(email) : null;
    if (!account) {
      // Same cost as a real check, so response time does not reveal which emails exist.
      await verify(await this.dummy, password).catch(() => false);
      return { ok: false, reason: 'invalid_login' };
    }
    if (account.lockedUntil !== null && account.lockedUntil > now)
      return { ok: false, reason: 'locked' };
    const good = await verify(account.passwordHash, password).catch(() => false);
    if (!good) {
      const failures = account.failedLogins + 1;
      await this.repo.setLoginFailures(
        account.id,
        failures >= MAX_FAILURES ? 0 : failures,
        failures >= MAX_FAILURES ? now + LOCK_MS : null,
      );
      return { ok: false, reason: failures >= MAX_FAILURES ? 'locked' : 'invalid_login' };
    }
    if (account.failedLogins > 0 || account.lockedUntil !== null)
      await this.repo.setLoginFailures(account.id, 0, null);
    return { ok: true, token: await this.startSession(account.id), accountId: account.id };
  }

  private async startSession(accountId: number): Promise<string> {
    const token = newToken();
    await this.repo.createSession(tokenHash(token), accountId, Date.now() + SESSION_TTL_MS);
    return token;
  }

  /** Account id for a session token, or null. */
  async session(token: string, now = Date.now()): Promise<number | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    return this.repo.sessionAccount(tokenHash(token), now);
  }

  async logout(token: string): Promise<void> {
    await this.repo.deleteSession(tokenHash(token));
  }
}
