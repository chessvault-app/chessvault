import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { gamesApi } from './games.ts';
import { AnalysisStore } from './myGamesAnalysis.ts';
import { hashPassword, isHashedPassword, verifyPassword } from './password.ts';
import { VAULT_SKELETON } from './paths.ts';
import { settingsApi } from './settings.ts';
import { studiesApi } from './studies.ts';
import { totpAt } from './totp.ts';
import { git } from './vaultGit.ts';

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
  app.route(
    '/api',
    settingsApi({
      configPath: join(vault, 'config.json'),
      vaultDir: vault,
      sameMachine: true,
      derived: [join(vault, '..', 'analysis.sqlite')],
    }),
  );
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

describe('vault name', () => {
  it('round-trips, trims, and forgets on blank', async () => {
    expect((await json('PUT', '/api/settings/name', { name: '  Club games ' })).status).toBe(200);
    expect((await (await json('GET', '/api/settings')).json()).name).toBe('Club games');
    expect(config().name).toBe('Club games');
    expect(config().keepMe).toBe(1);
    expect((await json('PUT', '/api/settings/name', { name: '   ' })).status).toBe(200);
    expect((await (await json('GET', '/api/settings')).json()).name).toBeNull();
    expect(config().name).toBeUndefined();
  });

  it('refuses a non-string or an over-long name', async () => {
    expect((await json('PUT', '/api/settings/name', { name: 7 })).status).toBe(400);
    expect((await json('PUT', '/api/settings/name', { name: 'x'.repeat(61) })).status).toBe(400);
    expect((await json('PUT', '/api/settings/name', 'junk')).status).toBe(400);
  });

  it('reads a name somebody typed by hand as a number as none', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({ name: 42 }));
    expect((await (await json('GET', '/api/settings')).json()).name).toBeNull();
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


describe('training', () => {
  it('reports an empty object for a vault that never trained', async () => {
    expect((await (await json('GET', '/api/settings')).json()).training).toEqual({});
  });

  it('round-trips difficulty and the drilled study', async () => {
    expect((await json('PUT', '/api/settings/training', { difficulty: 'hard' })).status).toBe(200);
    await json('PUT', '/api/settings/training', { drill: { study: 'openings/najdorf', chapter: 'all' } });
    const body = await (await json('GET', '/api/settings')).json();
    expect(body.training).toEqual({
      difficulty: 'hard',
      drill: { study: 'openings/najdorf', chapter: 'all' },
    });
    expect(config().keepMe).toBe(1);
    expect(config().appPassword).toBe('hunter22');
  });

  it('patches rather than replaces', async () => {
    // The whole reason the route merges: the trainer and the driller write
    // this object from different pages, and a replace would have each one
    // forget what the other had just said.
    await json('PUT', '/api/settings/training', { drill: { study: 's', chapter: '2' } });
    await json('PUT', '/api/settings/training', { difficulty: 'easy' });
    const body = await (await json('GET', '/api/settings')).json();
    expect(body.training).toEqual({ difficulty: 'easy', drill: { study: 's', chapter: '2' } });
  });

  it('drops values it cannot use without failing the write beside them', async () => {
    await json('PUT', '/api/settings/training', {
      difficulty: 'impossible',
      drill: { study: 'kept', chapter: '0' },
      unknownField: 'ignored',
    });
    const body = await (await json('GET', '/api/settings')).json();
    expect(body.training).toEqual({ drill: { study: 'kept', chapter: '0' } });
  });

  it('refuses a body that is not an object', async () => {
    expect((await json('PUT', '/api/settings/training', 'hard')).status).toBe(400);
    expect(config().training).toBeUndefined();
  });

  it('answers for a config somebody broke by hand', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({ training: 'nonsense' }));
    const res = await json('GET', '/api/settings');
    expect(res.status).toBe(200);
    expect((await res.json()).training).toEqual({});
  });
});

describe('password change', () => {
  it('requires the current password and a sane new one, and stores only a hash', async () => {
    expect((await json('POST', '/api/settings/password', { current: 'nope', next: 'longenough' })).status).toBe(403);
    expect((await json('POST', '/api/settings/password', { current: 'hunter22', next: 'short' })).status).toBe(400);
    const ok = await json('POST', '/api/settings/password', { current: 'hunter22', next: 'a-better-password' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).reauth).toBe(true);
    // At rest is the scrypt form, never the password itself.
    const stored = config().appPassword as string;
    expect(isHashedPassword(stored)).toBe(true);
    expect(stored).not.toContain('a-better-password');
    expect(await verifyPassword('a-better-password', stored)).toBe(true);
  });

  it('verifies the current password in its hashed form too', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({ appPassword: hashPassword('hunter22') }));
    expect((await json('POST', '/api/settings/password', { current: 'nope', next: 'longenough' })).status).toBe(403);
    expect((await json('POST', '/api/settings/password', { current: 'hunter22', next: 'longenough' })).status).toBe(200);
  });

  it('lets an ungated vault set its first password without a current one', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({}));
    const ok = await json('POST', '/api/settings/password', { next: 'first-password' });
    expect(ok.status).toBe(200);
    expect(isHashedPassword(config().appPassword as string)).toBe(true);
    expect(await verifyPassword('first-password', config().appPassword as string)).toBe(true);
  });

  it('revokes every stored session — reauth means reauth everywhere', async () => {
    const sessions = join(vault, 'sessions.json');
    writeFileSync(sessions, JSON.stringify([{ hash: 'a'.repeat(64), createdAt: Date.now() }]));
    await json('POST', '/api/settings/password', { current: 'hunter22', next: 'a-better-password' });
    expect(JSON.parse(readFileSync(sessions, 'utf-8'))).toEqual([]);
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

describe('tablebase endpoint', () => {
  it('sets, reports, and empties back to the default', async () => {
    // Not a secret, so unlike the token it is read back — the page shows
    // what this vault is pointed at.
    expect((await (await json('GET', '/api/settings')).json()).tablebase).toEqual({
      // A vault that has never said anything asks the public server.
      source: 'lichess',
      url: null,
      fallback: 'https://tablebase.lichess.ovh/standard',
      // Nobody has named a folder of table files, so nothing local can
      // answer and the page says so rather than implying it might.
      dir: null,
      local: false,
      // Tests run without CHESS_BIND, which is not loopback-only — so
      // the page would not offer to take a filesystem path.
      sameMachine: true,
    });

    expect((await json('PUT', '/api/settings/tablebase', { url: 'nonsense' })).status).toBe(400);
    expect((await json('PUT', '/api/settings/tablebase', { url: 'file:///etc/passwd' })).status)
      .toBe(400);
    expect(config().tablebaseUrl).toBeUndefined();

    expect(
      (await json('PUT', '/api/settings/tablebase', { url: ' http://localhost:7788/standard ' }))
        .status,
    ).toBe(200);
    expect(config().tablebaseUrl).toBe('http://localhost:7788/standard');
    expect((await (await json('GET', '/api/settings')).json()).tablebase.url).toBe(
      'http://localhost:7788/standard',
    );

    // Emptying the box is how a text field says "back to the default".
    expect((await json('PUT', '/api/settings/tablebase', { url: '' })).status).toBe(200);
    expect(config().tablebaseUrl).toBeUndefined();
  });
});

describe('tablebase files', () => {
  it('takes any path and reports whether it answers, never whether it exists', async () => {
    // Deliberately NOT a 400: answering "no such directory" for one path
    // and 200 for another turned this route into a way to ask which
    // paths exist on the server, which a vault with no password has
    // nothing in front of.
    expect((await json('PUT', '/api/settings/tablebase-dir', { dir: 'nowhere-at-all' })).status)
      .toBe(200);
    expect(config().tablebaseDir).toBe('nowhere-at-all');
    // What comes back is whether it can actually answer — false here for
    // either of two reasons, which is what makes it not an oracle.
    expect((await (await json('GET', '/api/settings')).json()).tablebase.local).toBe(false);

    expect((await json('PUT', '/api/settings/tablebase-dir', { dir: vault })).status).toBe(200);
    expect(config().tablebaseDir).toBe(vault);

    expect((await json('PUT', '/api/settings/tablebase-dir', { dir: '' })).status).toBe(200);
    expect(config().tablebaseDir).toBeUndefined();
  });

  it('refuses the folder from across a network, where it would be an existence oracle', async () => {
    // `local` says whether the folder exists on the server's disk once
    // the native binary is there, and a page in another room has no
    // business asking that about arbitrary paths. The page hides the box
    // off the machine; the route now agrees with it.
    const remote = new Hono();
    remote.route(
      '/api',
      settingsApi({ configPath: join(vault, 'config.json'), vaultDir: vault, sameMachine: false }),
    );
    const res = await remote.request('/api/settings/tablebase-dir', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: vault }),
    });
    expect(res.status).toBe(403);
    expect(config().tablebaseDir).toBeUndefined();
    expect((await (await remote.request('/api/settings')).json()).tablebase.sameMachine).toBe(false);
  });
});

describe('tablebase source', () => {
  it('stores the choice rather than inferring it from the fields', async () => {
    expect((await json('PUT', '/api/settings/tablebase-source', { source: 'nonsense' })).status)
      .toBe(400);

    // A named choice means a filled field no longer decides: pointing at
    // a folder AND choosing the public server is a coherent state, and
    // the folder keeps its value for when the choice comes back.
    await json('PUT', '/api/settings/tablebase-dir', { dir: vault });
    expect((await json('PUT', '/api/settings/tablebase-source', { source: 'lichess' })).status)
      .toBe(200);
    const read = await (await json('GET', '/api/settings')).json();
    expect(read.tablebase.source).toBe('lichess');
    expect(read.tablebase.dir).toBe(vault);
    expect(read.tablebase.local).toBe(false); // not chosen, so not answering
  });

  it('reads a config written before the choice was named', async () => {
    // The old precedence, kept so an existing vault keeps behaving:
    // a folder beat an address beat the public server.
    writeFileSync(
      join(vault, 'config.json'),
      JSON.stringify({ tablebaseUrl: 'http://localhost:7788/standard' }),
    );
    expect((await (await json('GET', '/api/settings')).json()).tablebase.source).toBe('server');
    writeFileSync(join(vault, 'config.json'), JSON.stringify({ tablebaseDir: vault }));
    expect((await (await json('GET', '/api/settings')).json()).tablebase.source).toBe('files');
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

  it('stops answering after ten wrong codes, so the second factor cannot be guessed off', async () => {
    const start = await (await json('POST', '/api/settings/2fa/start')).json();
    await json('POST', '/api/settings/2fa/enable', {
      secret: start.secret,
      code: totpAt(start.secret, Date.now())!,
    });
    // Six digits is a million guesses, and disable is the route that
    // takes the factor away, so it cannot answer a scripted stream of them.
    for (let i = 0; i < 10; i++) {
      expect((await json('POST', '/api/settings/2fa/disable', { code: '111111' })).status).toBe(403);
    }
    expect((await json('POST', '/api/settings/2fa/disable', { code: '111111' })).status).toBe(429);
    // The real code is refused too while the window is open: that is the
    // point, and the owner waits it out like any lockout.
    const real = await json('POST', '/api/settings/2fa/disable', { code: totpAt(start.secret, Date.now())! });
    expect(real.status).toBe(429);
    expect(config().totpSecret).toBe(start.secret);
  });

  it('evicts every session on enable and on disable — 2FA is a credential rotation', async () => {
    const sessions = join(vault, 'sessions.json');
    const seed = (): void =>
      writeFileSync(sessions, JSON.stringify([{ hash: 'b'.repeat(64), createdAt: Date.now() }]));
    const start = await (await json('POST', '/api/settings/2fa/start')).json();

    seed();
    await json('POST', '/api/settings/2fa/enable', {
      secret: start.secret,
      code: totpAt(start.secret, Date.now())!,
    });
    expect(JSON.parse(readFileSync(sessions, 'utf-8'))).toEqual([]);

    seed();
    await json('POST', '/api/settings/2fa/disable', { code: totpAt(start.secret, Date.now())! });
    expect(JSON.parse(readFileSync(sessions, 'utf-8'))).toEqual([]);
  });

  it('refuses enrolment when no password gate exists', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({}));
    expect((await json('POST', '/api/settings/2fa/start')).status).toBe(400);
  });
});

describe('wipe', () => {
  it('demands the phrase and the password on a gated vault', async () => {
    mkdirSync(join(vault, 'studies'), { recursive: true });
    writeFileSync(join(vault, 'studies', 'a.pgn'), '*');
    mkdirSync(join(vault, 'puzzlebooks', 'x'), { recursive: true });

    // wrong phrase
    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe' })).status).toBe(400);
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(true);
    // right phrase, missing/wrong password (gate is on), each refusal
    // saying which, since the dialog shows it as it is
    const missing = await json('POST', '/api/settings/wipe', { confirm: 'wipe everything' });
    expect(missing.status).toBe(403);
    expect((await missing.json()).error).toBe('Enter your app password to wipe the vault.');
    const wrong = await json('POST', '/api/settings/wipe', { confirm: 'wipe everything', password: 'nope' });
    expect(wrong.status).toBe(403);
    expect((await wrong.json()).error).toBe('That password is wrong. Nothing was wiped.');
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(true);

    // The engine pass's findings sit outside the vault and go with it.
    writeFileSync(join(vault, '..', 'analysis.sqlite'), 'x');
    const ok = await json('POST', '/api/settings/wipe', { confirm: 'wipe everything', password: 'hunter22' });
    expect(ok.status).toBe(200);
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(false);
    expect(existsSync(join(vault, '..', 'analysis.sqlite'))).toBe(false);
    expect(existsSync(join(vault, 'puzzlebooks'))).toBe(false);
    expect(existsSync(join(vault, 'studies'))).toBe(true); // skeleton back
    expect(config().appPassword).toBe('hunter22');
  });

  it('gives the fresh history repo its excludes, so the next autosave cannot commit the credentials', async () => {
    writeFileSync(join(vault, 'sessions.json'), JSON.stringify([{ hash: 'c'.repeat(64), createdAt: Date.now() }]));
    mkdirSync(join(vault, 'studies'), { recursive: true });
    writeFileSync(join(vault, 'studies', 'a.pgn'), '*');
    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe everything', password: 'hunter22' })).status).toBe(200);

    // Stage the wiped vault the way the autosave does (vaultBackup's
    // `add -A`, through the same helper and flags), then read the index.
    const gitDir = join(vault, '.history.git');
    expect(existsSync(gitDir)).toBe(true);
    writeFileSync(join(vault, 'studies', 'b.pgn'), '*');
    await git(gitDir, vault, ['add', '-A']);
    const staged = (await git(gitDir, vault, ['ls-files'])).split('\n').filter(Boolean);
    expect(staged).toContain('studies/b.pgn');
    expect(staged).not.toContain('config.json');
    expect(staged).not.toContain('sessions.json');
    expect(staged.some((path) => path.startsWith('.history.git'))).toBe(false);
  });

  it('checks the gate in its hashed form, and keeps the wiper signed in', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({ appPassword: hashPassword('hunter22') }));
    // The wiper's own session must survive: sessions.json stays, like
    // config.json, so wiping the data does not also lock the door.
    writeFileSync(join(vault, 'sessions.json'), JSON.stringify([{ hash: 'c'.repeat(64), createdAt: Date.now() }]));
    mkdirSync(join(vault, 'studies'), { recursive: true });
    writeFileSync(join(vault, 'studies', 'a.pgn'), '*');

    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe everything', password: 'nope' })).status).toBe(403);
    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe everything', password: 'hunter22' })).status).toBe(200);
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(false);
    expect(existsSync(join(vault, 'sessions.json'))).toBe(true);
    expect(existsSync(join(vault, 'config.json'))).toBe(true);
  });

  it('leaves the vault in the shape startup does, so the games routes keep answering', async () => {
    // Mounted the way mountVault mounts them, over this test's vault: both
    // read games/collection, which they made when they were built, and a
    // wipe that did not put it back had them answer 500 until a restart.
    const games = join(vault, 'games');
    app.route('/api', gamesApi(games, join(vault, 'config.json')));
    app.route('/api', studiesApi(join(games, 'collection'), 'games/docs', '.pgn'));
    writeFileSync(join(games, 'collection', 'a.pgn'), '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 *\n');
    expect((await (await json('GET', '/api/games')).json()).total).toBe(1);

    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe everything', password: 'hunter22' })).status).toBe(200);
    const list = await json('GET', '/api/games');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ total: 0, games: [] });
    const docs = await json('GET', '/api/games/docs');
    expect(docs.status).toBe(200);
    for (const d of VAULT_SKELETON) expect(existsSync(join(vault, d))).toBe(true);
  });

  it('lets go of the engine pass’s open file before deleting it, so the wipe finishes and its records go', async () => {
    // The store keeps its file open from its first read, as it does once
    // Insights has been visited. Deleting it under that handle answered
    // 500 on Windows (EPERM) with the vault already emptied, and elsewhere
    // left the store reading the deleted file's records until a restart.
    const data = mkdtempSync(join(tmpdir(), 'vault-derived-'));
    const file = join(data, 'analysis.sqlite');
    const store = new AnalysisStore(file);
    try {
      store.put({
        file: 'collection/a.pgn',
        index: 0,
        side: 'white',
        site: null,
        plies: 10,
        depth: 12,
        accuracy: 90,
        acpl: 20,
        moves: 5,
        inaccuracies: 0,
        mistakes: 0,
        blunders: 0,
        brilliancies: 0,
        bookMoves: 2,
        perMove: [],
      });
      expect(store.all().size).toBe(1);
      const wiper = new Hono();
      wiper.route(
        '/api',
        settingsApi({ configPath: join(vault, 'config.json'), vaultDir: vault, sameMachine: true, derived: [file] }),
      );
      const res = await wiper.request('/api/settings/wipe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'wipe everything', password: 'hunter22' }),
      });
      expect(res.status).toBe(200);
      expect(store.all().size).toBe(0);
    } finally {
      store.close();
      rmSync(data, { recursive: true, force: true });
    }
  });

  it('skips the password check on an ungated vault', async () => {
    writeFileSync(join(vault, 'config.json'), JSON.stringify({}));
    mkdirSync(join(vault, 'studies'), { recursive: true });
    writeFileSync(join(vault, 'studies', 'a.pgn'), '*');
    expect((await json('POST', '/api/settings/wipe', { confirm: 'wipe everything' })).status).toBe(200);
    expect(existsSync(join(vault, 'studies', 'a.pgn'))).toBe(false);
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
