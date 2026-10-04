import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireAuth } from './auth.ts';
import { historyLeaks } from './historyPurge.ts';
import { hashPassword } from './password.ts';
import { prepareHistoryRepo, startVaultBackup, type VaultBackup } from './vaultBackup.ts';
import { vaultHistoryApi } from './vaultHistory.ts';
import { git } from './vaultGit.ts';

/**
 * Taking out of a vault's history what it should never have held
 * (server/historyPurge.ts), against a real repo built the way the two
 * kinds of affected vault got that way: an older version that tracked
 * config.json and sessions.json, and a wipe before 0.12.1 that let the
 * autosave track everything, the repo's own folder, book PDFs, the
 * databases' PGN files and leftovers in folders included.
 */

/** An `ls-tree -r` line for a path the history never holds, as the tests
    plant them: written out by hand rather than asked of the list's
    matcher, which is what is under test. A top-level sources/ only: a
    notes folder of that name is a document's. */
const PURGED_LINE = /\t(config\.json|sessions\.json|\.history\.git\/|\.restore\/|sources\/|books\/[^/]+\/(book\.pdf|open\.bin)$|.*\.part$|.*\.swp$)/;

/** A debounce no test outlives: every save here is one the test makes,
    so the counts it checks are not raced by the watcher's own. */
const QUIET = 600_000;

/** What a history holding no secret says of them. */
const NO_SECRETS = {
  password: { current: false, past: 0 },
  totp: { current: false, past: 0 },
  token: { current: false, past: 0 },
};

/** What a history holding none of them says. */
const NOTHING = {
  commits: 0,
  credentials: 0,
  folder: 0,
  books: 0,
  sources: 0,
  other: 0,
  bytes: { folder: 0, books: 0, sources: 0, other: 0 },
  pending: false,
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
        files: run(['-c', 'core.quotePath=false', 'ls-tree', '-r', '--full-tree', graph.slice(0, 40)])
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
    expect(await backup!.leaks()).toEqual({ ...NOTHING, secrets: NO_SECRETS });
  });

  /**
   * A vault wiped before 0.12.1 whose new history took in everything until
   * the restart: every kind of path the list names, each at the depth it
   * really sits, beside documents that only look like them.
   */
  const PLANTED = {
    'config.json': '{"lichessToken":"lip_planted"}\n',
    'sessions.json': '[{"hash":"planted-session"}]\n',
    'books/Endgames/book.pdf': `%PDF-1.4 ${'a commercial book '.repeat(400)}`,
    'books/Endgames/open.bin': 'warm'.repeat(300),
    'books/Endgames/book.pdf.part': '%PDF-1.4 half an upload',
    'sources/twic1500.pgn': `[Event "TWIC"]\n\n${'1. e4 e5 2. Nf3 Nc6 '.repeat(500)}1-0\n`,
    'sources/lichess/elite.pgn': '[Event "Elite"]\n\n1. d4 d5 1/2-1/2\n',
    'notes/Openings/.Najdorf.md.swp': 'unsaved keystrokes',
    'notes/한글/.메모.md.swp': '저장 안 된 글',
    'studies/Openings/.Najdorf.pgn.swp': '1. e4 c5 2. Nf3',
    '.restore/before/notes/Plans.md': '# Plans, set aside by a restore\n',
    'download.part': 'an engine net on its way',
  };
  const KEPT = {
    'studies/Openings/Najdorf.pgn': '1. e4 c5 *\n',
    'notes/Plans.md': '# Plans\n',
    'notes/sources/Reading list.md': '# Reading list\n',
    'notes/한글/메모.md': '# 메모\n',
    'books/Endgames/book.json': '{"title":"Endgames"}\n',
  };

  const plantedVault = async (): Promise<string> => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    for (const [path, content] of Object.entries(KEPT)) write(path, content);
    backup = await startVaultBackup(dir, QUIET);
    const first = run(['rev-parse', 'HEAD']).trim();
    // The wipe's autosave, which had no exclude: everything at once.
    for (const [path, content] of Object.entries(PLANTED)) write(path, content);
    await git(gitDir(), dir, ['add', '-f', '--', ...Object.keys(PLANTED)]);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'vault autosave after a wipe']);
    // Then saves that changed documents and the planted files alike, the
    // repo's own folder among them, and a new version of the PDF.
    write('studies/Openings/Najdorf.pgn', '1. e4 c5 2. Nf3 d6 *\n');
    write('books/Endgames/book.pdf', `%PDF-1.4 ${'a second printing '.repeat(400)}`);
    write('sources/twic1500.pgn', `[Event "TWIC"]\n\n${'1. d4 d5 2. c4 e6 '.repeat(500)}1-0\n`);
    await git(gitDir(), dir, ['add', '-f', '--', 'studies/Openings/Najdorf.pgn', 'books/Endgames/book.pdf', 'sources/twic1500.pgn', '.history.git']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'vault autosave']);
    write('notes/sources/Reading list.md', '# Reading list\n\nDvoretsky.\n');
    write('notes/한글/메모.md', '# 메모\n\n둘째 줄\n');
    await git(gitDir(), dir, ['add', '-f', '--', 'notes', '.history.git']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'vault autosave']);
    // The restart: the start untracks them all, and the autosave goes on.
    await backup!.stop();
    backup = await startVaultBackup(dir, QUIET);
    write('studies/Openings/Najdorf.pgn', '1. e4 c5 2. Nf3 d6 3. d4 cxd4 *\n');
    await backup.commitNow();
    return first;
  };

  /** Every path every save's tree holds, folders included, with its id. */
  const everyPath = (): { commit: string; type: string; id: string; path: string }[] =>
    run(['rev-list', '--all']).split('\n').filter(Boolean).flatMap((commit) =>
      run(['-c', 'core.quotePath=false', 'ls-tree', '-r', '-t', '--full-tree', commit])
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [meta = '', path = ''] = line.split('\t');
          const [, type = '', id = ''] = meta.split(' ');
          return { commit, type, id, path };
        }),
    );
  /** A path the list names, or one inside a folder it names. */
  const isPlanted = (path: string): boolean =>
    Object.keys(PLANTED).includes(path) || /^(sources|\.restore|\.history\.git)(\/|$)/.test(path) || /\.(part|swp)$/.test(path) || /^books\/[^/]+\/(book\.pdf|open\.bin)$/.test(path);

  it('takes out every kind the list names at its own depth, and nothing else', async () => {
    const first = await plantedVault();
    const before = saves();
    const oldCommits = run(['rev-list', '--all']).split('\n').filter(Boolean);
    const planted = everyPath().filter(({ path }) => isPlanted(path));
    // Every planted file is in some save, each PDF version among them.
    for (const path of Object.keys(PLANTED)) expect(planted.map((p) => p.path)).toContain(path);
    const oldIds = [...new Set(planted.map(({ id }) => id))];
    const pdfVersions = new Set(planted.filter(({ path }) => path === 'books/Endgames/book.pdf').map(({ id }) => id));
    expect(pdfVersions.size).toBe(2);

    const leaks = await backup!.leaks();
    expect(leaks).toMatchObject({ commits: 3, credentials: 1, folder: 2, books: 2, sources: 2, other: 1, pending: false });
    for (const kind of ['folder', 'books', 'sources', 'other'] as const) expect(leaks.bytes[kind]).toBeGreaterThan(0);

    const outcome = await backup!.purge();
    // Every save but the first: the rest held them or follow one that did.
    expect(outcome).toMatchObject({ pruned: true, rewritten: oldCommits.length - 1 });

    // No save holds any of them, at any depth, as a file or as a folder.
    const after = everyPath();
    expect(after.filter(({ path }) => isPlanted(path))).toEqual([]);
    // Every other path, every version of it, as it was: the same saves,
    // each with its own author, committer, dates, message and parents.
    expect(saves()).toEqual(before);
    for (const path of Object.keys(KEPT)) expect(after.map((p) => p.path)).toContain(path);
    // The save before the first that held them keeps its id; the old ones
    // and every planted version are gone from git's store.
    const kept = new Set(run(['rev-list', '--all']).split('\n').filter(Boolean));
    expect(kept.has(first)).toBe(true);
    expect(present(oldCommits.filter((commit) => !kept.has(commit)))).toEqual([]);
    expect(present(oldIds)).toEqual([]);
    expect(await backup!.leaks()).toEqual({ ...NOTHING, secrets: NO_SECRETS });

    // The autosave goes on, holding none of them, and the files are on disk.
    write('notes/After.md', 'written after the purge\n');
    await backup!.commitNow();
    expect(run(['show', 'HEAD:notes/After.md'])).toBe('written after the purge\n');
    expect(run(['-c', 'core.quotePath=false', 'ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter(isPlanted)).toEqual([]);
    expect((await git(gitDir(), dir, ['status', '--porcelain'])).trim()).toBe('');
    for (const path of Object.keys(PLANTED)) expect(existsSync(join(dir, path))).toBe(true);
  });

  it('keeps a merge a merge, with both sides written again without them', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    write('studies/Openings/Najdorf.pgn', '1. e4 c5 *\n');
    backup = await startVaultBackup(dir, QUIET);
    // A side branch that held a swap file deep in a folder and a PDF, merged
    // back after the main line held config.json.
    await git(gitDir(), dir, ['branch', 'side']);
    write('config.json', '{"lichessToken":"lip_main"}\n');
    write('notes/Plans.md', '# Plans\n\nMain line.\n');
    await git(gitDir(), dir, ['add', '-f', 'config.json', 'notes/Plans.md']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'main']);
    await git(gitDir(), dir, ['checkout', '-q', 'side']);
    write('studies/Openings/.Najdorf.pgn.swp', 'unsaved');
    write('books/Endgames/book.pdf', '%PDF-1.4 side');
    write('books/Endgames/book.json', '{"title":"Endgames"}\n');
    await git(gitDir(), dir, ['add', '-f', 'studies', 'books']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'side']);
    await git(gitDir(), dir, ['checkout', '-q', 'master']);
    await git(gitDir(), dir, ['merge', '-q', '--no-ff', '-m', 'merge side', 'side']);
    const before = saves();
    expect(before.at(-1)!.parents).toHaveLength(2);

    await backup.purge();
    expect(saves()).toEqual(before);
    expect(everyPath().filter(({ path }) => isPlanted(path))).toEqual([]);
    expect(run(['show', 'HEAD:books/Endgames/book.json'])).toBe('{"title":"Endgames"}\n');
    expect(run(['show', 'HEAD:notes/Plans.md'])).toBe('# Plans\n\nMain line.\n');
  });

  it('looks everywhere once, then at the saves made since, and again from scratch when a save it kept is gone', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    write('notes/Plans.md', '# Plans\n');
    backup = await startVaultBackup(dir, QUIET);
    const scanned = (): { tips: string[]; found: string[] } => JSON.parse(readFileSync(join(gitDir(), 'chessvault-scanned'), 'latin1'));
    // The start counted before its first save; this is the first look.
    expect(await historyLeaks(gitDir(), dir, { fresh: true })).toMatchObject({ commits: 0 });
    expect(scanned()).toEqual({ tips: [run(['rev-parse', 'HEAD']).trim()], found: [] });
    // A swap file deep in a folder, saved after that look.
    write('notes/Openings/Sicilian/.Najdorf.md.swp', 'unsaved');
    await git(gitDir(), dir, ['add', '-f', 'notes/Openings/Sicilian/.Najdorf.md.swp']);
    await git(gitDir(), dir, ['commit', '-q', '-m', 'an older version']);
    expect(await historyLeaks(gitDir(), dir, { fresh: true })).toMatchObject({ commits: 1, other: 1 });
    expect(scanned()).toEqual({ tips: [run(['rev-parse', 'HEAD']).trim()], found: ['notes/Openings/Sicilian/.Najdorf.md.swp'] });
    // What it kept names a save that is no longer there: it looks again.
    writeFileSync(join(gitDir(), 'chessvault-scanned'), JSON.stringify({ tips: ['0123456789abcdef0123456789abcdef01234567'], found: [] }));
    expect(await historyLeaks(gitDir(), dir, { fresh: true })).toMatchObject({ commits: 1, other: 1 });
    // And a purge leaves it saying the new history holds none.
    await backup.purge();
    expect(scanned()).toEqual({ tips: [run(['rev-parse', 'HEAD']).trim()], found: [] });
    expect(await historyLeaks(gitDir(), dir, { fresh: true })).toMatchObject({ commits: 0, other: 0 });
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
    expect(await json('/api/history/purge')).toEqual({ available: true, ...NOTHING, secrets: NO_SECRETS });

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
    const said = warn.mock.calls.flat().join('\n');
    expect(said).toMatch(/5 save\(s\) in \.history\.git hold what the history never keeps/);
    expect(said).toMatch(/config\.json or sessions\.json \(2, which may hold past secrets\); its own folder \(3\)/);
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

  it('says plainly when there is no history to purge', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-purge-'));
    const app = new Hono().route('/api', vaultHistoryApi(dir));
    expect(await (await app.request('/api/history/purge')).json()).toEqual({ available: false });
    expect((await app.request('/api/history/purge', { method: 'POST' })).status).toBe(409);
  });
});
