import { Hono } from 'hono';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startVaultBackup, type VaultBackup } from './vaultBackup.ts';
import { KINDS, vaultHistoryApi, type DocKind } from './vaultHistory.ts';
import { VAULT, VAULT_GAMES, VAULT_NOTES, VAULT_STUDIES } from './paths.ts';

/**
 * These run against a real git repo in a temp vault, the way
 * server/vaultBackup.test.ts does. The point of this API is that it reads
 * what the writer actually wrote, so a mocked git would test nothing worth
 * knowing.
 */

describe('vault history api', () => {
  let dir: string;
  let app: Hono;
  let backup: VaultBackup | null = null;

  afterEach(async () => {
    // Awaited: stop() resolves when the git children are gone, and on
    // Windows the directory cannot be removed until they are.
    await backup?.stop();
    backup = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** A vault with the three document directories and one autosave taken. */
  const vault = async (): Promise<void> => {
    dir = mkdtempSync(join(tmpdir(), 'vault-history-'));
    for (const kind of Object.keys(KINDS) as DocKind[]) {
      mkdirSync(resolve(dir, KINDS[kind].base), { recursive: true });
    }
    backup = await startVaultBackup(dir, 50);
    app = new Hono().route('/api', vaultHistoryApi(dir, { commitNow: () => backup!.commitNow() }));
  };

  const write = (path: string, content: string): void => {
    const at = resolve(dir, path);
    mkdirSync(resolve(at, '..'), { recursive: true });
    writeFileSync(at, content);
  };

  const json = async (path: string): Promise<any> => (await app.request(path)).json();

  const restore = (body: unknown): Promise<Response> | Response =>
    app.request('/api/history/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('lists a document its versions, newest first, and hands back their bytes', async () => {
    await vault();
    write('studies/Najdorf.pgn', 'first\n');
    await backup!.commitNow();
    write('studies/Najdorf.pgn', 'second\n');
    await backup!.commitNow();

    const listed = await json('/api/history/doc/studies/Najdorf');
    expect(listed.available).toBe(true);
    expect(listed.versions).toHaveLength(2);

    // Newest first: the first entry is the state we last wrote.
    const [newest, oldest] = listed.versions;
    expect((await json(`/api/history/at/${newest.sha}/studies/Najdorf`)).content).toBe('second\n');
    expect((await json(`/api/history/at/${oldest.sha}/studies/Najdorf`)).content).toBe('first\n');
  });

  it('restores a past version in place, and the restore is itself undoable', async () => {
    await vault();
    write('notes/Ideas.md', 'the good version\n');
    await backup!.commitNow();
    write('notes/Ideas.md', 'wrecked\n');
    await backup!.commitNow();

    const before = (await json('/api/history/doc/notes/Ideas')).versions;
    const good = before[before.length - 1];
    expect((await restore({ kind: 'notes', id: 'Ideas', sha: good.sha })).status).toBe(200);
    expect(readFileSync(resolve(dir, 'notes/Ideas.md'), 'utf-8')).toBe('the good version\n');

    // The wrecked state was committed before the write, so it is still
    // reachable — this is what makes restoring in place safe.
    await backup!.commitNow();
    const after = (await json('/api/history/doc/notes/Ideas')).versions;
    expect(after.length).toBeGreaterThan(before.length);
    const contents = await Promise.all(
      after.map(async (v: { sha: string }) =>
        (await json(`/api/history/at/${v.sha}/notes/Ideas`)).content,
      ),
    );
    expect(contents).toContain('wrecked\n');
  });

  it('finds a deleted document and puts it back, folder and all', async () => {
    await vault();
    write('studies/Openings/Sicilian.pgn', 'a line\n');
    await backup!.commitNow();
    rmSync(resolve(dir, 'studies/Openings'), { recursive: true, force: true });
    await backup!.commitNow();

    const gone = await json('/api/history/deleted');
    expect(gone.available).toBe(true);
    expect(gone.deleted).toContainEqual(
      expect.objectContaining({ kind: 'studies', id: 'Openings/Sicilian' }),
    );

    const versions = (await json('/api/history/doc/studies/Openings/Sicilian')).versions;
    expect(versions.length).toBeGreaterThan(0);
    const status = (
      await restore({ kind: 'studies', id: 'Openings/Sicilian', sha: versions[0].sha })
    ).status;
    expect(status).toBe(200);
    // The directory went with it, so putting the document back has to
    // recreate the collection it lived in.
    expect(readFileSync(resolve(dir, 'studies/Openings/Sicilian.pgn'), 'utf-8')).toBe('a line\n');

    // Back in the vault, so no longer offered as missing.
    await backup!.commitNow();
    const again = await json('/api/history/deleted');
    expect(again.deleted).not.toContainEqual(
      expect.objectContaining({ id: 'Openings/Sicilian' }),
    );
  });

  it('cannot be pointed at anything but a document', async () => {
    await vault();
    write('config.json', '{"password":"secret"}\n');
    await backup!.commitNow();

    // config.json holds the app password, the TOTP secret and the Lichess
    // token. There is no kind whose base could reach it, and no id that
    // escapes its base.
    expect((await app.request('/api/history/doc/config.json')).status).toBe(404);
    expect((await app.request('/api/history/doc/settings/x')).status).toBe(404);
    for (const id of ['../config', '..%2Fconfig', '.hidden', 'a//b']) {
      const listed = await app.request(`/api/history/doc/studies/${id}`);
      expect([400, 404]).toContain(listed.status);
    }
    expect((await restore({ kind: 'studies', id: '../../config', sha: 'a'.repeat(40) })).status)
      .toBe(400);
    expect((await restore({ kind: 'config', id: 'x', sha: 'a'.repeat(40) })).status).toBe(400);
    expect((await restore({ kind: 'studies', id: 'Najdorf', sha: 'nope' })).status).toBe(400);
  });

  it('says so plainly when the vault has no history repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-history-'));
    app = new Hono().route('/api', vaultHistoryApi(dir));

    expect(await json('/api/history')).toEqual({ available: false });
    expect(await json('/api/history/deleted')).toEqual({ available: false });
    expect(await json('/api/history/doc/studies/Anything')).toEqual({ available: false });
    expect((await restore({ kind: 'studies', id: 'Anything', sha: 'a'.repeat(40) })).status).toBe(
      409,
    );
  });

  it('reports an unknown version rather than writing something wrong', async () => {
    await vault();
    write('studies/Najdorf.pgn', 'only version\n');
    await backup!.commitNow();
    const absent = 'b'.repeat(40);
    expect((await app.request(`/api/history/at/${absent}/studies/Najdorf`)).status).toBe(404);
    expect((await restore({ kind: 'studies', id: 'Najdorf', sha: absent })).status).toBe(404);
    expect(readFileSync(resolve(dir, 'studies/Najdorf.pgn'), 'utf-8')).toBe('only version\n');
  });

  /**
   * The history repo stores vault-relative paths; server/mountVault.ts
   * mounts the document API on absolute ones from paths.ts. If those drift,
   * every lookup for that kind returns an empty list, which is
   * indistinguishable from "this vault has no history" — so it is checked
   * rather than commented.
   */
  it('agrees with the directories the document API is mounted on', () => {
    const dirs: Record<DocKind, string> = {
      studies: VAULT_STUDIES,
      notes: VAULT_NOTES,
      games: resolve(VAULT_GAMES, 'collection'),
    };
    for (const kind of Object.keys(KINDS) as DocKind[]) {
      expect(relative(VAULT, dirs[kind]).split(sep).join('/')).toBe(KINDS[kind].base);
    }
  });

  it('leaves the history repo itself alone', async () => {
    await vault();
    write('notes/Ideas.md', 'v1\n');
    await backup!.commitNow();
    write('notes/Ideas.md', 'v2\n');
    await backup!.commitNow();
    const versions = (await json('/api/history/doc/notes/Ideas')).versions;
    await restore({ kind: 'notes', id: 'Ideas', sha: versions[versions.length - 1].sha });
    // A `git checkout` restore would have moved HEAD or left an index
    // that fights the watcher; the blob is written as an ordinary file.
    expect(existsSync(resolve(dir, '.history.git', 'index.lock'))).toBe(false);
    expect(await json('/api/history')).toEqual({ available: true });
  });
});
