import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireAuth } from './auth.ts';
import { historyLeaks } from './historyPurge.ts';
import { revokeLichessToken } from './lichess.ts';
import { hashPassword } from './password.ts';
import { prepareHistoryRepo, startVaultBackup, type VaultBackup } from './vaultBackup.ts';
import { vaultHistoryApi } from './vaultHistory.ts';
import { git } from './vaultGit.ts';

/**
 * Taking the old credentials and the repo's own folder out of a vault's
 * history (server/historyPurge.ts), against a real repo built the way the
 * two kinds of affected vault got that way: an older version that tracked
 * config.json and sessions.json, and a wipe before 0.12.1 that let the
 * autosave track the repo's own folder.
 */

const PURGED_LINE = /\t(config\.json|sessions\.json|\.history\.git\/)/;

/** A debounce no test outlives: every save here is one the test makes,
    so the counts it checks are not raced by the watcher's own. */
const QUIET = 600_000;

/** What a history holding no secret says of them. */
const NO_SECRETS = {
  password: { current: false, past: 0 },
  totp: { current: false, past: 0 },
  token: { current: false, past: 0 },
};

// Every test here builds a real history, restarts its writer and runs a
// few dozen git processes, which took over vitest's five seconds once
// the whole suite ran beside it.
describe('removing old secrets from the history', { timeout: 30_000 }, () => {
  let dir = '';
  let backup: VaultBackup | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    await backup?.stop();
    backup = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  const gitDir = (): string => join(dir, '.history.git');
  const run = (args: string[], input?: string): string =>
    execFileSync('git', ['--git-dir', gitDir(), ...args], { encoding: 'utf-8', input });
  /** Which of `ids` git's store still has, asked in one process. */
  const present = (ids: string[]): string[] =>
    run(['cat-file', '--batch-check'], `${ids.join('\n')}\n`)
      .split('\n')
      .filter((line) => line && !line.endsWith(' missing'))
      .map((line) => line.split(' ')[0]!);
  const exists = (id: string): boolean => present([id]).length > 0;
  const write = (path: string, content: string): void => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  };

  /**
   * Every save, oldest first: who wrote it and when, its message, its
   * place in the graph and every file it holds bar the purged ones. What
   * a purge must leave exactly as it was.
   */
  const saves = (): { meta: string; parents: number[]; files: string }[] => {
    // One log for every save's header and message, %x01 between saves.
    const logged = run(['log', '--all', '--topo-order', '--reverse', '--date=raw', '--format=%H %P%x00%an%x00%ae%x00%ad%x00%cn%x00%ce%x00%cd%x00%B%x01'])
      .split('\x01')
      .map((entry) => entry.replace(/^\n/, ''))
      .filter(Boolean);
    const ids = logged.map((entry) => entry.slice(0, 40));
    return logged.map((entry) => {
      const [graph = '', ...meta] = entry.split('\0');
      return {
        meta: meta.join('\0'),
        parents: graph.split(' ').slice(1).map((parent) => ids.indexOf(parent)),
        files: run(['ls-tree', '-r', '--full-tree', graph.slice(0, 40)])
          .split('\n')
          .filter((line) => line && !PURGED_LINE.test(line))
          .join('\n'),
      };
    });
  };

  /**
   * A vault whose history holds both: config.json and sessions.json
   * tracked by force, as an older version did, changed in a later save,
   * and the repo's own folder tracked as a wipe before 0.12.1 left it,
   * with documents saved around them and one note deleted. Restarted, so
   * the start untracks all three as it does on a real vault.
   */
  const leakyVault = async (): Promise<void> => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('studies/Najdorf.pgn', '1. e4 c5 *\n');
    write('notes/Plans.md', '# Plans\n');
    write('notes/Scratch.md', 'to be deleted\n');
    backup = await startVaultBackup(dir, QUIET);
    write('config.json', '{"appPassword":"scrypt$first-secret-hash","lichessToken":"lip_firsttoken"}\n');
    write('sessions.json', '[{"hash":"first-session-hash"}]\n');
    await git(gitDir(), dir, ['add', '-f', 'config.json', 'sessions.json']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'an older version']);
    write('studies/Najdorf.pgn', '1. e4 c5 2. Nf3 d6 *\n');
    write('config.json', '{"appPassword":"scrypt$second-secret-hash","lichessToken":"lip_secondtoken"}\n');
    await backup.commitNow();
    write('notes/Plans.md', '# Plans\n\nPlay the Najdorf.\n');
    await git(gitDir(), dir, ['add', '-f', '.history.git']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'after a wipe']);
    write('studies/Najdorf.pgn', '1. e4 c5 2. Nf3 d6 3. d4 cxd4 *\n');
    await backup.commitNow();
    rmSync(join(dir, 'notes/Scratch.md'));
    await backup.commitNow();
    await backup.stop();
    backup = await startVaultBackup(dir, QUIET);
  };

  /** Every id config.json and sessions.json ever had, and every id of
      the folder, across every save. */
  const purgedIds = (): string[] => {
    const ids = new Set<string>();
    for (const commit of run(['rev-list', '--all']).split('\n').filter(Boolean)) {
      for (const line of run(['ls-tree', commit, 'config.json', 'sessions.json', '.history.git']).split('\n').filter(Boolean)) {
        ids.add(line.split(/\s+/)[2]!);
      }
    }
    return [...ids];
  };

  it('takes them out of every save and keeps everything else as it was', async () => {
    await leakyVault();
    const before = saves();
    const oldCommits = run(['rev-list', '--all']).split('\n').filter(Boolean);
    const oldIds = purgedIds();
    // Two versions of config.json, one of sessions.json, and the folder.
    expect(oldIds.length).toBeGreaterThanOrEqual(4);
    const leaks = await backup!.leaks();
    // Two saves wrote the credentials. The folder was written by the save
    // that took it in and by every save after, since the repo's index and
    // refs change with each one; the save that untracked all three at the
    // start counts as none.
    expect(leaks).toMatchObject({ credentials: 2, folder: 3, commits: 5, pending: false });
    // config.json as it is now holds the second password and token, so
    // those are in use and the first ones are past.
    expect(leaks.secrets).toEqual({
      password: { current: true, past: 1 },
      totp: { current: false, past: 0 },
      token: { current: true, past: 1 },
    });

    const outcome = await backup!.purge();
    expect(outcome.pruned).toBe(true);
    expect(outcome.removed.commits).toBe(5);
    // Counted without reading the secrets, which nothing after a purge uses.
    expect(outcome.removed).not.toHaveProperty('secrets');

    // The same saves, each with its own author, committer, dates, message,
    // parents and every other file.
    expect(saves()).toEqual(before);
    // None of them holds a purged path, and none of the old ids is left in
    // git's store: not the files, not the saves that held them.
    expect(run(['log', '--all', '--full-history', '--format=%H', '--', 'config.json', 'sessions.json', '.history.git'])).toBe('');
    expect(present(oldIds)).toEqual([]);
    const kept = new Set(run(['rev-list', '--all']).split('\n').filter(Boolean));
    expect(present(oldCommits.filter((commit) => !kept.has(commit)))).toEqual([]);
    // The save before the first that held them keeps its id.
    expect(kept.has(oldCommits.at(-1)!)).toBe(true);
    expect(run(['reflog', 'show', '--all'])).toBe('');
    expect(await backup!.leaks()).toEqual({ commits: 0, credentials: 0, folder: 0, pending: false, secrets: NO_SECRETS });
  });

  it('leaves the autosave working, the documents recoverable and the next start quiet', async () => {
    await leakyVault();
    const app = new Hono().route(
      '/api',
      vaultHistoryApi(dir, {
        commitNow: () => backup!.commitNow(),
        purge: { leaks: () => backup!.leaks(), run: () => backup!.purge() },
      }),
    );
    const json = async (path: string, init?: RequestInit): Promise<any> => (await app.request(path, init)).json();
    const contents = async (): Promise<string[]> =>
      Promise.all(
        (await json('/api/history/doc/studies/Najdorf')).versions.map(
          async (v: { sha: string }) => (await json(`/api/history/at/${v.sha}/studies/Najdorf`)).content as string,
        ),
      );
    const versionsBefore = await contents();
    expect(versionsBefore).toHaveLength(3);

    expect(await json('/api/history/purge')).toMatchObject({ available: true, commits: 5, credentials: 2, folder: 3 });
    const res = await app.request('/api/history/purge', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, pruned: true });
    expect(await json('/api/history/purge')).toEqual({ available: true, commits: 0, credentials: 0, folder: 0, pending: false, secrets: NO_SECRETS });

    // Every version of the study, read through the ids the history has now.
    expect(await contents()).toEqual(versionsBefore);
    expect((await json('/api/history/deleted')).deleted).toContainEqual(expect.objectContaining({ kind: 'notes', id: 'Scratch' }));

    // The autosave goes on from the rewritten history.
    const count = Number(run(['rev-list', '--count', 'HEAD']).trim());
    write('notes/After.md', 'written after the purge\n');
    await backup!.commitNow();
    expect(Number(run(['rev-list', '--count', 'HEAD']).trim())).toBe(count + 1);
    expect(run(['show', 'HEAD:notes/After.md'])).toBe('written after the purge\n');
    expect((await git(gitDir(), dir, ['status', '--porcelain'])).trim()).toBe('');

    // And the next start has nothing to say about it.
    await backup!.stop();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    backup = await startVaultBackup(dir, QUIET);
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/save\(s\) in \.history\.git/);
    expect(await backup.leaks()).toMatchObject({ commits: 0 });
  });

  it('tells which secrets the history holds against the ones in use, and never a value', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    backup = await startVaultBackup(dir, QUIET);
    // An older version's config.json: the password itself, from before the
    // hashing, a 2FA secret and a token.
    write('config.json', '{"appPassword":"correct horse battery","totpSecret":"JBSWY3DPEHPK3PXP","lichessToken":"lip_oldtoken"}\n');
    await git(gitDir(), dir, ['add', '-f', 'config.json']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'an older version']);
    // Since then a login hashed the same password, 2FA was set up again and
    // the token removed.
    write('config.json', `${JSON.stringify({ appPassword: hashPassword('correct horse battery'), totpSecret: 'KRSXG5CTMVRXEZLU' })}\n`);
    await backup.stop();
    backup = await startVaultBackup(dir, QUIET);
    const app = new Hono().route('/api', vaultHistoryApi(dir, { purge: { leaks: () => backup!.leaks(), run: () => backup!.purge() } }));
    const answer = await (await app.request('/api/history/purge')).text();
    expect(JSON.parse(answer).secrets).toEqual({
      password: { current: true, past: 0 },
      totp: { current: false, past: 1 },
      token: { current: false, past: 1 },
    });
    for (const secret of ['correct horse', 'JBSWY3DPEHPK3PXP', 'lip_oldtoken', 'KRSXG5CTMVRXEZLU', 'scrypt:']) {
      expect(answer).not.toContain(secret);
    }
    // The token put back in use: read again against config.json as it is
    // now, though the history has not changed.
    write('config.json', `${JSON.stringify({ lichessToken: 'lip_oldtoken' })}\n`);
    expect((await backup.leaks()).secrets).toEqual({
      password: { current: false, past: 1 },
      totp: { current: false, past: 1 },
      token: { current: true, past: 0 },
    });
  });

  it('cannot tell the secrets from a config.json that is not JSON, or from a purge cut off', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    backup = await startVaultBackup(dir, QUIET);
    write('config.json', '{"lichessToken":"lip_cut\n');
    await git(gitDir(), dir, ['add', '-f', 'config.json']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'a config cut short']);
    write('config.json', '{}\n');
    expect(await historyLeaks(gitDir(), dir, { fresh: true })).toMatchObject({ credentials: 1, secrets: null });
    await backup.purge();
    writeFileSync(join(gitDir(), 'chessvault-purging'), 'cut off\n');
    expect(await historyLeaks(gitDir(), dir, { fresh: true })).toMatchObject({ commits: 0, pending: true, secrets: null });
  });

  it('says so at the start while the history holds them', async () => {
    await leakyVault();
    await backup!.stop();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    backup = await startVaultBackup(dir, QUIET);
    expect(warn.mock.calls.flat().join('\n')).toMatch(/5 save\(s\) in \.history\.git hold config\.json/);
  });

  it('counts again after a write that can change the history', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    backup = await startVaultBackup(dir, QUIET);
    expect((await backup.leaks()).commits).toBe(0);
    // A restore runs under exclusive, and can put a copy's history in place.
    write('config.json', '{"lichessToken":"lip_restored"}\n');
    await backup.exclusive(async () => {
      await git(gitDir(), dir, ['add', '-f', 'config.json']);
      await git(gitDir(), dir, ['commit', '-q', '-m', 'a copy that held it']);
    });
    expect((await backup.leaks()).credentials).toBe(1);
    // A wipe makes a new repo and readies it through prepareHistoryRepo.
    rmSync(gitDir(), { recursive: true, force: true });
    execFileSync('git', ['init', '--quiet', '--bare', gitDir()]);
    await prepareHistoryRepo(gitDir(), dir);
    expect((await backup.leaks()).commits).toBe(0);
  });

  it('finishes at the next start a purge cut off before the old saves were deleted', async () => {
    await leakyVault();
    await backup!.purge();
    // What a purge stopped between moving the refs and pruning leaves: its
    // marker, and an object nothing reaches.
    const orphan = execFileSync('git', ['--git-dir', gitDir(), 'hash-object', '-w', '--stdin'], {
      input: '{"appPassword":"scrypt$left-behind"}\n',
      encoding: 'utf-8',
    }).trim();
    writeFileSync(join(gitDir(), 'chessvault-purging'), 'cut off\n');
    await backup!.stop();
    backup = await startVaultBackup(dir, QUIET);
    expect(exists(orphan)).toBe(false);
    expect(existsSync(join(gitDir(), 'chessvault-purging'))).toBe(false);
    expect(await backup.leaks()).toMatchObject({ commits: 0, pending: false });
  });

  it('does nothing to a history that holds none of them', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    backup = await startVaultBackup(dir, QUIET);
    const head = run(['rev-parse', 'HEAD']).trim();
    expect(await backup.purge()).toMatchObject({ rewritten: 0, pruned: true });
    expect(run(['rev-parse', 'HEAD']).trim()).toBe(head);
  });

  it('is behind the session like every other vault route', async () => {
    await leakyVault();
    const head = run(['rev-parse', 'HEAD']).trim();
    const app = new Hono();
    app.use('/api/*', requireAuth(() => 'a password is set', join(dir, 'sessions.json')));
    app.route('/api', vaultHistoryApi(dir, { purge: { leaks: () => backup!.leaks(), run: () => backup!.purge() } }));
    expect((await app.request('/api/history/purge')).status).toBe(401);
    expect((await app.request('/api/history/purge', { method: 'POST' })).status).toBe(401);
    expect(run(['rev-parse', 'HEAD']).trim()).toBe(head);
    expect((await backup!.leaks()).commits).toBe(5);
  });

  // --- Revoking the old Lichess tokens at Lichess ------------------------------

  /** The tokens tokenVault plants: two the vault no longer uses, and the
      one in use. */
  const OLD_ONE = 'lip_oldtokenone';
  const OLD_TWO = 'lip_oldtokentwo';
  const IN_USE = 'lip_tokeninuse';
  const TOKENS = [OLD_ONE, OLD_TWO, IN_USE];

  /**
   * A vault whose history holds three Lichess tokens: an older version's
   * config.json tracked by force, the first token in two saves (a later
   * save changed another setting beside it), then a second, then the one
   * in use now, which config.json still holds with a password and a name.
   */
  const tokenVault = async (): Promise<void> => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    backup = await startVaultBackup(dir, QUIET);
    const plant = async (config: Record<string, unknown>, message: string): Promise<void> => {
      write('config.json', `${JSON.stringify(config)}\n`);
      await git(gitDir(), dir, ['add', '-f', 'config.json']);
      await git(gitDir(), dir, ['commit', '-q', '-m', message]);
    };
    await plant({ lichessToken: OLD_ONE }, 'an older version');
    await plant({ lichessToken: OLD_ONE, name: 'Club' }, 'a name beside it');
    await plant({ lichessToken: OLD_TWO, name: 'Club' }, 'a new token');
    await plant({ lichessToken: IN_USE, name: 'Club' }, 'the token in use');
    write('config.json', `${JSON.stringify({ appPassword: 'scrypt$hash-in-use', lichessToken: IN_USE, name: 'Club' })}\n`);
    await backup.stop();
    backup = await startVaultBackup(dir, QUIET);
  };

  /**
   * A stand-in for Lichess, through the fetcher revokeLichessToken takes:
   * every request it is sent, with its Authorization header, answered by
   * `answer` (204 unless it says otherwise; a throw is a network failure).
   */
  const fakeLichess = (answer: (token: string) => number | 'unreachable' = () => 204) => {
    const sent: { url: string; method: string; authorization: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const authorization = new Headers(init?.headers).get('authorization');
      sent.push({ url: String(input), method: init?.method ?? 'GET', authorization });
      const status = answer(authorization?.replace(/^Bearer /, '') ?? '');
      if (status === 'unreachable') throw new TypeError('fetch failed');
      return new Response(status === 204 ? null : '{"error":"No such token"}', { status });
    };
    return { sent, fetcher };
  };

  /** The purge routes, wired to the stand-in as server/index.ts wires them
      to Lichess. */
  const purgeApp = (fetcher: typeof fetch): Hono =>
    new Hono().route(
      '/api',
      vaultHistoryApi(dir, {
        purge: {
          leaks: () => backup!.leaks(),
          run: (tokens) => backup!.purge(tokens ? { ...tokens, revoke: (token) => revokeLichessToken(token, fetcher) } : undefined),
        },
      }),
    );

  /** POST the purge with `body`, recording every console line it makes. */
  const purgeWith = async (app: Hono, body?: unknown): Promise<{ status: number; text: string; logged: string }> => {
    const lines: unknown[][] = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args);
      });
    }
    const res = await app.request('/api/history/purge', {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await res.text();
    vi.restoreAllMocks();
    return { status: res.status, text, logged: lines.map((args) => args.map(String).join(' ')).join('\n') };
  };

  /** Every token, as a value or a header, in none of `texts`. */
  const holdsNoToken = (...texts: string[]): void => {
    for (const text of texts) for (const token of TOKENS) expect(text).not.toContain(token);
  };

  const configNow = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as Record<string, unknown>;

  it('revokes at Lichess, once each, the old tokens chosen, and not the one in use', async () => {
    await tokenVault();
    const lichess = fakeLichess();
    const app = purgeApp(lichess.fetcher);
    const asked = await (await app.request('/api/history/purge')).text();
    expect(JSON.parse(asked).secrets.token).toEqual({ current: true, past: 2 });

    const { status, text, logged } = await purgeWith(app, { revokeTokens: { past: true, current: false } });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      pruned: true,
      tokens: { past: { revoked: 2, invalid: 0, failed: 0 }, current: { revoked: 0, invalid: 0, failed: 0 } },
    });
    expect(lichess.sent.map(({ authorization }) => authorization).sort()).toEqual([`Bearer ${OLD_ONE}`, `Bearer ${OLD_TWO}`]);
    for (const request of lichess.sent) expect(request).toMatchObject({ url: 'https://lichess.org/api/token', method: 'DELETE' });
    // The token in use stays in use, and the history holds none of them.
    expect(configNow()).toMatchObject({ lichessToken: IN_USE, name: 'Club' });
    expect(run(['log', '--all', '--full-history', '--format=%H', '--', 'config.json'])).toBe('');
    holdsNoToken(asked, text, logged);
  });

  it('revokes the token in use only when that is chosen too, and takes it out of config.json', async () => {
    await tokenVault();
    const lichess = fakeLichess();
    const { status, text, logged } = await purgeWith(purgeApp(lichess.fetcher), { revokeTokens: { past: true, current: true } });
    expect(status).toBe(200);
    expect(JSON.parse(text).tokens).toEqual({
      past: { revoked: 2, invalid: 0, failed: 0 },
      current: { revoked: 1, invalid: 0, failed: 0 },
    });
    expect(lichess.sent.map(({ authorization }) => authorization).sort()).toEqual([OLD_ONE, OLD_TWO, IN_USE].map((token) => `Bearer ${token}`).sort());
    // Revoked, it is of no use to the explorer: gone from config.json, and
    // everything else there kept.
    expect(configNow()).toEqual({ appPassword: 'scrypt$hash-in-use', name: 'Club' });
    holdsNoToken(text, logged);
  });

  it('sends nothing to Lichess unless it is chosen', async () => {
    await tokenVault();
    const lichess = fakeLichess();
    const app = purgeApp(lichess.fetcher);
    // Not chosen in so many words: anything but `true` is no.
    const { status, text } = await purgeWith(app, { revokeTokens: { past: 'yes', current: 1 } });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ ok: true, pruned: true, tokens: null });
    expect(lichess.sent).toEqual([]);
    expect(configNow()).toMatchObject({ lichessToken: IN_USE });

    // And a purge asked with no body at all, as before this choice.
    await backup!.stop();
    rmSync(dir, { recursive: true, force: true });
    await tokenVault();
    const again = await purgeWith(purgeApp(lichess.fetcher));
    expect(again.status).toBe(200);
    expect(JSON.parse(again.text)).toMatchObject({ ok: true, tokens: null });
    expect(lichess.sent).toEqual([]);
  });

  it('counts a token Lichess no longer takes as already invalid', async () => {
    await tokenVault();
    const lichess = fakeLichess((token) => (token === OLD_TWO ? 204 : 401));
    const { status, text } = await purgeWith(purgeApp(lichess.fetcher), { revokeTokens: { past: true, current: true } });
    expect(status).toBe(200);
    expect(JSON.parse(text).tokens).toEqual({
      past: { revoked: 1, invalid: 1, failed: 0 },
      current: { revoked: 0, invalid: 1, failed: 0 },
    });
    // Of no use at Lichess either way, so it leaves config.json too.
    expect(configNow()).not.toHaveProperty('lichessToken');
  });

  it('finishes the purge when Lichess cannot be reached, and says so', async () => {
    await tokenVault();
    const lichess = fakeLichess((token) => (token === OLD_ONE ? 500 : 'unreachable'));
    const { status, text, logged } = await purgeWith(purgeApp(lichess.fetcher), { revokeTokens: { past: true, current: true } });
    expect(status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      pruned: true,
      tokens: { past: { revoked: 0, invalid: 0, failed: 2 }, current: { revoked: 0, invalid: 0, failed: 1 } },
    });
    expect(lichess.sent).toHaveLength(3);
    // The history is clean all the same, and the token in use, which may
    // still work, is still the one in use.
    expect(run(['log', '--all', '--full-history', '--format=%H', '--', 'config.json'])).toBe('');
    expect(await backup!.leaks()).toMatchObject({ commits: 0, pending: false });
    expect(configNow()).toMatchObject({ lichessToken: IN_USE });
    // The log says what became of them, in numbers and nothing else.
    expect(logged).toContain('2 not revoked');
    holdsNoToken(text, logged);
  });

  it('says plainly when there is no history to purge', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    const app = new Hono().route('/api', vaultHistoryApi(dir));
    expect(await (await app.request('/api/history/purge')).json()).toEqual({ available: false });
    expect((await app.request('/api/history/purge', { method: 'POST' })).status).toBe(409);
  });
});
