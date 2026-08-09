import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { settingsApi } from './settings.ts';
import { totpAt } from './totp.ts';

let vault: string;
let app: Hono;

const json = async (method: string, path: string, body?: unknown): Promise<Response> =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

const config = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(vault, 'config.json'), 'utf-8')) as Record<string, unknown>;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'vault-settings-'));
  writeFileSync(join(vault, 'config.json'), JSON.stringify({ appPassword: 'hunter22', keepMe: 1 }));
  app = new Hono();
  app.route('/api', settingsApi({ configPath: join(vault, 'config.json'), vaultDir: vault }));
});

afterEach(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe('settings read', () => {
  it('reports presence, never secrets', async () => {
    writeFileSync(
      join(vault, 'config.json'),
      JSON.stringify({ appPassword: 'hunter22', lichessToken: 'lip_abcdef123456' }),
    );
    const body = await (await json('GET', '/api/settings')).json();
    expect(body.gate).toBe(true);
    expect(body.totp).toBe(false);
    expect(body.lichess).toEqual({ configured: true, last4: '3456' });
    expect(JSON.stringify(body)).not.toContain('hunter22');
    expect(JSON.stringify(body)).not.toContain('lip_abcdef');
  });
});

describe('profile', () => {
  it('round-trips and trims', async () => {
    const put = await json('PUT', '/api/settings/profile', {
      name: '  lanph3re ', chesscom: 'lanph3re', lichess: '', junk: 'x',
    });
    expect(put.status).toBe(200);
    const body = await (await json('GET', '/api/settings')).json();
    expect(body.profile).toEqual({ name: 'lanph3re', chesscom: 'lanph3re' });
    expect(config().keepMe).toBe(1); // unknown config keys survive edits
  });
});

describe('password change', () => {
  it('requires the current password and a sane new one', async () => {
    expect((await json('POST', '/api/settings/password', { current: 'nope', next: 'longenough' })).status).toBe(403);
    expect((await json('POST', '/api/settings/password', { current: 'hunter22', next: 'short' })).status).toBe(400);
    const ok = await json('POST', '/api/settings/password', { current: 'hunter22', next: 'a-better-password' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).reauth).toBe(true);
    expect(config().appPassword).toBe('a-better-password');
  });

  it('lets an ungated vault set its first password without a current one', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({}));
    const ok = await json('POST', '/api/settings/password', { next: 'first-password' });
    expect(ok.status).toBe(200);
    expect(config().appPassword).toBe('first-password');
  });
});

describe('lichess token', () => {
  it('sets and clears', async () => {
    expect((await json('PUT', '/api/settings/lichess', { token: 'has space' })).status).toBe(400);
    expect((await json('PUT', '/api/settings/lichess', { token: 'lip_tok123' })).status).toBe(200);
    expect(config().lichessToken).toBe('lip_tok123');
    expect((await json('DELETE', '/api/settings/lichess')).status).toBe(200);
    expect(config().lichessToken).toBeUndefined();
  });
});

describe('2fa', () => {
  it('enrols only through a verified live code, disables the same way', async () => {
    const start = await (await json('POST', '/api/settings/2fa/start')).json();
    expect(start.secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(start.otpauth).toContain('otpauth://totp/');

    const wrong = await json('POST', '/api/settings/2fa/enable', { secret: start.secret, code: '000000' });
    expect(wrong.status).toBe(403);
    expect(config().totpSecret).toBeUndefined();

    const code = totpAt(start.secret, Date.now())!;
    const ok = await json('POST', '/api/settings/2fa/enable', { secret: start.secret, code });
    expect(ok.status).toBe(200);
    expect(config().totpSecret).toBe(start.secret);

    expect((await json('POST', '/api/settings/2fa/disable', { code: '111111' })).status).toBe(403);
    const off = await json('POST', '/api/settings/2fa/disable', { code: totpAt(start.secret, Date.now())! });
    expect(off.status).toBe(200);
    expect(config().totpSecret).toBeUndefined();
  });

  it('refuses enrolment when no password gate exists', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({}));
    expect((await json('POST', '/api/settings/2fa/start')).status).toBe(400);
  });
});

describe('wipe', () => {
  it('demands the phrase, empties the vault, keeps config', async () => {
    mkdirSync(join(vault, 'studies'), { recursive: true });
    writeFileSync(join(vault, 'studies', 'a.pgn'), '*');
    mkdirSync(join(vault, 'puzzlebooks', 'x'), { recursive: true });

    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe' })).status).toBe(400);
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(true);

    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe everything' })).status).toBe(200);
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(false);
    expect(existsSync(join(vault, 'puzzlebooks'))).toBe(false);
    expect(existsSync(join(vault, 'studies'))).toBe(true); // skeleton back
    expect(config().appPassword).toBe('hunter22');
  });
});

describe('totp core', () => {
  it('codes verify inside the drift window and not outside', async () => {
    const { verifyTotp } = await import('./totp.ts');
    const secret = 'JBSWY3DPEHPK3PXP';
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpAt(secret, now)!, now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now, -1)!, now)).toBe(true);
    expect(verifyTotp(secret, totpAt(secret, now, 2)!, now)).toBe(false);
    expect(verifyTotp(secret, 'abcdef', now)).toBe(false);
  });
});
