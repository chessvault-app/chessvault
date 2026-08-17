import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { authApi, migratePlaintextPassword, requireAuth, revokeAllSessions } from './auth.ts';
import { isHashedPassword, verifyPassword } from './password.ts';
import { totpAt } from './totp.ts';

let dir: string;
let storeN = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vault-auth-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeApp(
  password: string | null,
  totp: string | null = null,
  sessionsPath?: string,
): Hono {
  const sessions = sessionsPath ?? join(dir, `sessions-${storeN++}.json`);
  const app = new Hono();
  app.route('/api', authApi(() => password, () => totp, sessions));
  app.use('/api/*', requireAuth(() => password, sessions));
  app.get('/api/secret', (c) => c.json({ data: 42 }));
  return app;
}

const login = async (app: Hono, password: string, ip = '1.2.3.4'): Promise<Response> =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  });

/** The session cookie (`name=token`) a successful login handed out. */
const cookieOf = (res: Response): string => res.headers.get('set-cookie')!.split(';')[0]!;

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
    expect(cookie).toContain('Max-Age=31536000');

    const withCookie = await app.request('/api/secret', {
      headers: { cookie: cookie.split(';')[0]! },
    });
    expect(withCookie.status).toBe(200);

    // A forged token of the right shape is rejected: its hash is not in
    // the store.
    const forged = await app.request('/api/secret', {
      headers: { cookie: `vault_session=${'a'.repeat(64)}` },
    });
    expect(forged.status).toBe(401);
  });

  it('mints a fresh random token per login, each valid on its own', async () => {
    const app = makeApp('hunter2');
    const first = cookieOf(await login(app, 'hunter2'));
    const second = cookieOf(await login(app, 'hunter2'));
    // Not the old deterministic scheme: two logins are two sessions.
    expect(first).not.toBe(second);
    expect((await app.request('/api/secret', { headers: { cookie: first } })).status).toBe(200);
    expect((await app.request('/api/secret', { headers: { cookie: second } })).status).toBe(200);
  });

  it('logout revokes the presented session server-side, and only it', async () => {
    const app = makeApp('hunter2');
    const phone = cookieOf(await login(app, 'hunter2'));
    const desktop = cookieOf(await login(app, 'hunter2'));

    const out = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: phone },
    });
    expect(out.status).toBe(200);
    expect(out.headers.get('set-cookie')).toContain('Max-Age=0');

    // The logged-out token is dead even when replayed — a stolen copy of
    // it is revoked too, which the deterministic scheme could never do.
    expect((await app.request('/api/secret', { headers: { cookie: phone } })).status).toBe(401);
    expect((await app.request('/api/secret', { headers: { cookie: desktop } })).status).toBe(200);
  });

  it('does not conjure a sessions file when logout has nothing to revoke', async () => {
    const sessions = join(dir, 'sessions-logout-empty.json');
    const app = makeApp('hunter2', null, sessions);
    await app.request('/api/auth/logout', { method: 'POST' });
    await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `vault_session=${'b'.repeat(64)}` },
    });
    expect(existsSync(sessions)).toBe(false);
  });

  it('expires stored sessions on the same clock as the cookie', async () => {
    const sessions = join(dir, 'sessions-expiry.json');
    const app = makeApp('hunter2', null, sessions);
    const cookie = cookieOf(await login(app, 'hunter2'));
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(200);

    // Age the entry past the cookie's own Max-Age; the store must stop
    // honouring it even though the browser would still send it.
    const entries = JSON.parse(readFileSync(sessions, 'utf-8')) as { createdAt: number }[];
    for (const e of entries) e.createdAt -= 366 * 24 * 60 * 60 * 1000;
    writeFileSync(sessions, JSON.stringify(entries));
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(401);
  });

  it('treats a damaged sessions file as empty and heals it on login', async () => {
    const sessions = join(dir, 'sessions-damaged.json');
    writeFileSync(sessions, '{not json at all');
    const app = makeApp('hunter2', null, sessions);
    // Damaged store = no sessions, not an open door and not a crash.
    expect((await app.request('/api/secret', { headers: { cookie: `vault_session=${'c'.repeat(64)}` } })).status).toBe(401);
    const status = await (await app.request('/api/auth/status')).json();
    expect(status.authed).toBe(false);

    const cookie = cookieOf(await login(app, 'hunter2'));
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(200);
    const entries = JSON.parse(readFileSync(sessions, 'utf-8')) as unknown[];
    expect(entries).toHaveLength(1);
  });

  it('keeps entries a hand-edit mangled from killing the ones beside them', async () => {
    const sessions = join(dir, 'sessions-partial.json');
    const app = makeApp('hunter2', null, sessions);
    const cookie = cookieOf(await login(app, 'hunter2'));
    const entries = JSON.parse(readFileSync(sessions, 'utf-8')) as unknown[];
    writeFileSync(sessions, JSON.stringify([{ nonsense: true }, ...entries, 'a string']));
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(200);
  });

  it('caps the store at 20 sessions, evicting the oldest first', async () => {
    const sessions = join(dir, 'sessions-cap.json');
    const app = makeApp('hunter2', null, sessions);
    const cookies: string[] = [];
    for (let i = 0; i < 25; i++) cookies.push(cookieOf(await login(app, 'hunter2')));
    const entries = JSON.parse(readFileSync(sessions, 'utf-8')) as unknown[];
    expect(entries).toHaveLength(20);
    expect((await app.request('/api/secret', { headers: { cookie: cookies[0]! } })).status).toBe(401);
    expect((await app.request('/api/secret', { headers: { cookie: cookies[24]! } })).status).toBe(200);
  });

  it('revokeAllSessions signs every device out at once', async () => {
    const sessions = join(dir, 'sessions-revoke.json');
    const app = makeApp('hunter2', null, sessions);
    const a = cookieOf(await login(app, 'hunter2'));
    const b = cookieOf(await login(app, 'hunter2'));
    revokeAllSessions(sessions);
    expect((await app.request('/api/secret', { headers: { cookie: a } })).status).toBe(401);
    expect((await app.request('/api/secret', { headers: { cookie: b } })).status).toBe(401);
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

  it('keys the throttle on the LAST forwarded-for hop, not a spoofable prefix', async () => {
    const app = makeApp('hunter2');
    // Attacker rotates the first XFF element; the trusted proxy (last hop)
    // stays constant, so the bucket is shared and still locks out.
    for (let i = 0; i < 10; i++) {
      const r = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${i}.${i}.${i}.${i}, 5.5.5.5` },
        body: JSON.stringify({ password: 'wrong' }),
      });
      expect(r.status).toBe(401);
    }
    const blocked = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': 'fresh.spoof, 5.5.5.5' },
      body: JSON.stringify({ password: 'hunter2' }),
    });
    expect(blocked.status).toBe(429);
  });

  it('a successful login does not consume the failure budget', async () => {
    const app = makeApp('hunter2');
    for (let i = 0; i < 9; i++) expect((await login(app, 'wrong', '4.4.4.4')).status).toBe(401);
    // Success in the middle must not tip the bucket over.
    expect((await login(app, 'hunter2', '4.4.4.4')).status).toBe(200);
    expect((await login(app, 'hunter2', '4.4.4.4')).status).toBe(200);
  });

  it('denies (does not fail open) when the config is unreadable', async () => {
    // A password fn returning the UNREADABLE sentinel models a corrupt or
    // unreadable config — which is what the real configPassword returns.
    const sentinel = '\0unreadable\0';
    const sessions = join(dir, 'sessions-unreadable.json');
    const app = new Hono();
    app.route('/api', authApi(() => sentinel, () => null, sessions));
    app.use('/api/*', requireAuth(() => sentinel, sessions));
    app.get('/api/secret', (c) => c.json({ ok: true }));
    expect((await app.request('/api/secret')).status).toBe(401);
    // A live session from before the config broke must not soften the
    // fail-closed answer.
    const token = 'd'.repeat(64);
    const hash = createHash('sha256').update(token).digest('hex');
    writeFileSync(sessions, JSON.stringify([{ hash, createdAt: Date.now() }]));
    expect(
      (await app.request('/api/secret', { headers: { cookie: `vault_session=${token}` } })).status,
    ).toBe(401);
    // And the sentinel itself is not a submittable password — login errors.
    expect((await login(app, sentinel, '1.1.1.1')).status).toBe(503);
  });

  it('logs in against a hashed stored password', async () => {
    const { hashPassword } = await import('./password.ts');
    const app = makeApp(hashPassword('hunter2'));
    expect((await login(app, 'wrong')).status).toBe(401);
    const good = await login(app, 'hunter2');
    expect(good.status).toBe(200);
    expect((await app.request('/api/secret', { headers: { cookie: cookieOf(good) } })).status).toBe(200);
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
    // Two-stage sign-in: the password alone is ACCEPTED as stage one and
    // answers needTotp — but it must not hand out a session.
    const stageOne = await request();
    expect(stageOne.status).toBe(200);
    expect(await stageOne.clone().json()).toEqual({ needTotp: true });
    expect(stageOne.headers.get('set-cookie')).toBeNull();
    expect((await app.request('/api/secret')).status).toBe(401);
    // A code that is present but wrong is still a failed attempt.
    expect((await request('000000')).status).toBe(401);
    const good = await request(totpAt(secret, Date.now())!);
    expect(good.status).toBe(200);

    const cookie = cookieOf(good);
    expect((await app.request('/api/secret', { headers: { cookie } })).status).toBe(200);
  });
});

describe('plaintext config migration', () => {
  it('rewrites a plaintext appPassword to its scrypt form, touching nothing else', () => {
    const cfg = join(dir, 'config.json');
    writeFileSync(cfg, JSON.stringify({ appPassword: 'hunter22', keepMe: 1 }));
    migratePlaintextPassword(cfg);
    const after = JSON.parse(readFileSync(cfg, 'utf-8')) as Record<string, unknown>;
    expect(after.keepMe).toBe(1);
    expect(isHashedPassword(after.appPassword as string)).toBe(true);
    expect(verifyPassword('hunter22', after.appPassword as string)).toBe(true);
    // Idempotent: a second run must not re-hash the hash.
    migratePlaintextPassword(cfg);
    expect((JSON.parse(readFileSync(cfg, 'utf-8')) as Record<string, unknown>).appPassword).toBe(
      after.appPassword,
    );
  });

  it('leaves a missing, corrupt or ungated config alone', () => {
    // Missing: nothing thrown, nothing created.
    const missing = join(dir, 'nope.json');
    migratePlaintextPassword(missing);
    expect(existsSync(missing)).toBe(false);
    // Corrupt: left for the UNREADABLE handling, byte for byte.
    const corrupt = join(dir, 'corrupt.json');
    writeFileSync(corrupt, '{broken');
    migratePlaintextPassword(corrupt);
    expect(readFileSync(corrupt, 'utf-8')).toBe('{broken');
    // Ungated: no appPassword, no rewrite.
    const ungated = join(dir, 'ungated.json');
    writeFileSync(ungated, JSON.stringify({ lichessToken: 'lip_x' }));
    migratePlaintextPassword(ungated);
    expect(JSON.parse(readFileSync(ungated, 'utf-8'))).toEqual({ lichessToken: 'lip_x' });
  });
});
