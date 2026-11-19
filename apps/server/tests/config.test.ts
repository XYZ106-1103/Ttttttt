import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { clientIp } from '../src/http/app';

const req = (forwarded: string | undefined, peer = '10.0.0.1') =>
  ({
    headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
    socket: { remoteAddress: peer },
  }) as unknown as IncomingMessage;

describe('client address behind a proxy', () => {
  it('ignores X-Forwarded-For unless the proxy is trusted', () => {
    expect(clientIp(req('1.2.3.4'))).toBe('10.0.0.1');
    expect(clientIp(req('1.2.3.4, 10.0.0.9'), true)).toBe('1.2.3.4');
    expect(clientIp(req(undefined), true)).toBe('10.0.0.1');
  });

  it('reads TRUST_PROXY and other settings from the environment', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(true);
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ ADVENTURERS: '10', PORT: '10000' })).toMatchObject({
      adventurers: 10,
      port: 10000,
    });
  });
});
