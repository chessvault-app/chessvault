import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { authApi, requireAuth } from './auth.ts';
import { totpAt } from './totp.ts';

function makeApp(password: string | null, totp: string | null = null): Hono {
  const app = new Hono();
  app.route('/api', authApi(() => password, () => totp));
  app.use('/api/*', requireAuth(() => password, () => totp));
  app.get('/api/secret', (c) => c.json({ data: 42 }));
  return app;
}

const login = async (app: Hono, password: string, ip = '1.2.3.4'): Promise<Response> =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  });

describe('auth gate', () => {
  it('stays wide open with no password configured', async () => {
    const app = makeApp(null);
    expect((await app.request('/api/secret')).status).toBe(200);
    const status = await (await app.request('/api/auth/status')).json();
    expect(status).toEqual({ required: false, authed: true, totp: false });
  });

  it('gates /api and admits a valid session cookie', async () => {
    const app = makeApp('hunter2');
    expect((await app.request('/api/secret')).status).toBe(401);

    const bad = await login(app, 'wrong');
    expect(bad.status).toBe(401);

    const good = await login(app, 'hunter2');
    expect(good.status).toBe(200);
    const cookie = good.headers.get('set-cookie')!;
    expect(cookie).toContain('vault_session=');
    expect(cookie).toContain('HttpOnly');

    const withCookie = await app.request('/api/secret', {
      headers: { cookie: cookie.split(';')[0]! },
    });
    expect(withCookie.status).toBe(200);

    // A forged token of the right shape is rejected.
    const forged = await app.request('/api/secret', {
      headers: { cookie: `vault_session=${'a'.repeat(64)}` },
    });
    expect(forged.status).toBe(401);
  });

  it('auth routes stay reachable while gated', async () => {
    const app = makeApp('hunter2');
    expect((await app.request('/api/auth/status')).status).toBe(200);
    const status = await (await app.request('/api/auth/status')).json();
    expect(status).toEqual({ required: true, authed: false, totp: false });
  });

  it('throttles repeated login attempts per IP', async () => {
    const app = makeApp('hunter2');
    for (let i = 0; i < 10; i++) {
      expect((await login(app, 'wrong', '9.9.9.9')).status).toBe(401);
    }
    expect((await login(app, 'hunter2', '9.9.9.9')).status).toBe(429);
    // Another IP is unaffected.
    expect((await login(app, 'hunter2', '8.8.8.8')).status).toBe(200);
  });

  it('demands a live authenticator code when 2FA is on', async () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const app = makeApp('hunter2', secret);
    const status = await (await app.request('/api/auth/status')).json();
    expect(status.totp).toBe(true);

    const request = async (code?: string): Promise<Response> =>
      app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' },
        body: JSON.stringify({ password: 'hunter2', code }),
      });
    expect((await request()).status).toBe(401);
    expect((await request('000000')).status).toBe(401);
    const good = await request(totpAt(secret, Date.now())!);
    expect(good.status).toBe(200);

    const cookie = good.headers.get('set-cookie')!.split(';')[0]!;
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(200);

    // The same password's session token from a non-2FA world must not fit:
    // enabling 2FA rotates the session secret and evicts everyone.
    const before = await login(makeApp('hunter2'), 'hunter2');
    const oldCookie = before.headers.get('set-cookie')!.split(';')[0]!;
    expect((await app.request('/api/secret', { headers: { cookie: oldCookie } })).status).toBe(401);
  });
});
