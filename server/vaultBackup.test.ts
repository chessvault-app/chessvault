import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startVaultBackup, type VaultBackup } from './vaultBackup.ts';
import { git } from './vaultGit.ts';

const log = (dir: string): string[] =>
  execFileSync('git', ['--git-dir', join(dir, '.history.git'), 'log', '--format=%s'], {
    encoding: 'utf-8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

const tracked = (dir: string): string =>
  execFileSync('git', ['--git-dir', join(dir, '.history.git'), 'ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf-8',
  });

/** How many saves the history holds; 0 for one that has none yet. */
const saves = (dir: string): number =>
  Number(execFileSync('git', ['--git-dir', join(dir, '.history.git'), 'rev-list', '--count', '--all'], { encoding: 'utf-8' }).trim());

/** What a restore that stopped part way leaves standing (server/restore.ts). */
function stuckJournal(dir: string, content = '{"moves":[]}'): string {
  const journal = join(dir, '.restore', 'journal.json');
  mkdirSync(join(dir, '.restore'), { recursive: true });
  writeFileSync(journal, content);
  return journal;
}

const settle = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe('vault backup', () => {
  let dir: string;
  let backup: VaultBackup | null = null;

  afterEach(async () => {
    // Awaited: stop() resolves when the git children are gone, and on
    // Windows the directory cannot be removed until they are.
    await backup?.stop();
    backup = null;
    rmSync(dir, { recursive: true, force: true });
  });

  it('commits the baseline, then each batch of changes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    writeFileSync(join(dir, 'note.md'), 'first\n');
    backup = await startVaultBackup(dir, 50);
    expect(log(dir)).toHaveLength(1); // baseline includes pre-existing files

    writeFileSync(join(dir, 'note.md'), 'second\n');
    await backup.commitNow();
    expect(log(dir)).toHaveLength(2);

    // No changes → no empty commit.
    await backup.commitNow();
    expect(log(dir)).toHaveLength(2);

    const shown = execFileSync(
      'git',
      ['--git-dir', join(dir, '.history.git'), 'show', 'HEAD:note.md'],
      { encoding: 'utf-8' },
    );
    expect(shown).toBe('second\n');
  });

  it('excludes sources/ and the library PDFs, and survives restarts', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    mkdirSync(join(dir, 'sources'));
    writeFileSync(join(dir, 'sources', 'big.pgn'), 'x'.repeat(1024));
    writeFileSync(join(dir, 'games.json'), '{}\n');
    // A library book: its PDF is the user's own copy of a book, megabytes
    // that never change, and a history repo that swallowed one would keep
    // it forever. Its metadata is small and does belong.
    mkdirSync(join(dir, 'books', 'b0123456789abcdef'), { recursive: true });
    writeFileSync(join(dir, 'books', 'b0123456789abcdef', 'book.pdf'), '%PDF-1.4 x'.repeat(100));
    writeFileSync(join(dir, 'books', 'b0123456789abcdef', 'book.pdf.part'), '%PDF-1.4');
    writeFileSync(join(dir, 'books', 'b0123456789abcdef', 'book.json'), '{"title":"x"}\n');
    // And its open cache (server/pdfWarm.ts), made from that PDF and made
    // again whenever the PDF changes: no version of it is worth keeping.
    writeFileSync(join(dir, 'books', 'b0123456789abcdef', 'open.bin'), 'warm'.repeat(100));
    backup = await startVaultBackup(dir, 50);
    const files = tracked(dir);
    expect(files).toContain('games.json');
    expect(files).not.toContain('big.pgn');
    expect(files).toContain('books/b0123456789abcdef/book.json');
    expect(files).not.toContain('book.pdf');
    expect(files).not.toContain('open.bin');

    // Second start reuses the repo instead of re-initialising.
    await backup.stop();
    writeFileSync(join(dir, 'games.json'), '{"a":1}\n');
    backup = await startVaultBackup(dir, 50);
    expect(log(dir)).toHaveLength(2);
  });

  it('saves a notes or studies folder named sources, and leaves out only the one at the top', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    mkdirSync(join(dir, 'sources'));
    writeFileSync(join(dir, 'sources', 'big.pgn'), 'x'.repeat(1024));
    mkdirSync(join(dir, 'notes', 'sources'), { recursive: true });
    writeFileSync(join(dir, 'notes', 'sources', 'Reading list.md'), '# Reading list\n');
    mkdirSync(join(dir, 'studies', 'Openings', 'sources'), { recursive: true });
    writeFileSync(join(dir, 'studies', 'Openings', 'sources', 'Najdorf.pgn'), '1. e4 c5 *\n');
    backup = await startVaultBackup(dir, 50);
    const files = tracked(dir).split('\n');
    expect(files).toContain('notes/sources/Reading list.md');
    expect(files).toContain('studies/Openings/sources/Najdorf.pgn');
    expect(files).not.toContain('sources/big.pgn');
  });

  it('untracks the per-book files an older version committed, and keeps them on disk', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    const book = join(dir, 'books', 'b0123456789abcdef');
    mkdirSync(book, { recursive: true });
    writeFileSync(join(book, 'book.json'), '{"title":"x"}\n');
    writeFileSync(join(book, 'book.pdf'), '%PDF-1.4 x'.repeat(100));
    writeFileSync(join(book, 'open.bin'), 'warm'.repeat(100));
    backup = await startVaultBackup(dir, 50);
    // What a version without the excludes committed, by force now that
    // they are there.
    const gitDir = join(dir, '.history.git');
    await git(gitDir, dir, ['add', '-f', 'books/b0123456789abcdef/book.pdf', 'books/b0123456789abcdef/open.bin']);
    await git(gitDir, dir, ['commit', '-q', '-m', 'older version']);
    expect(tracked(dir)).toContain('books/b0123456789abcdef/book.pdf');
    expect(tracked(dir)).toContain('books/b0123456789abcdef/open.bin');
    await backup.stop();

    backup = await startVaultBackup(dir, 50);
    expect(tracked(dir)).not.toContain('book.pdf');
    expect(tracked(dir)).not.toContain('open.bin');
    expect(tracked(dir)).toContain('books/b0123456789abcdef/book.json');
    expect(existsSync(join(book, 'book.pdf'))).toBe(true);
    expect(existsSync(join(book, 'open.bin'))).toBe(true);
  });

  it('untracks the history repo\'s own folder a wipe let the autosave commit', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    writeFileSync(join(dir, 'games.json'), '{"a":1}\n');
    backup = await startVaultBackup(dir, 50);
    // What the autosave committed after a wipe that re-made the repo with
    // no exclude list: the repo's own files, by force now that the
    // exclude is there.
    const gitDir = join(dir, '.history.git');
    await git(gitDir, dir, ['add', '-f', '.history.git']);
    await git(gitDir, dir, ['commit', '-q', '-m', 'after a wipe']);
    expect(tracked(dir)).toContain('.history.git/HEAD');
    await backup.stop();

    backup = await startVaultBackup(dir, 50);
    expect(tracked(dir)).not.toContain('.history.git/');
    expect(tracked(dir)).toContain('games.json');
  });

  /**
   * While a restore's journal stands, the vault is half one vault and half
   * another. An autosave there saved the half vault as a version, and the
   * put-back's save then added back everything it lacked: a duplicate
   * version of each document set aside, per episode (measured on a running
   * server before this was held).
   */
  it('records nothing while a restore stands part way, and saves again once it is put back', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    writeFileSync(join(dir, 'note.md'), 'first\n');
    backup = await startVaultBackup(dir, 50);
    expect(saves(dir)).toBe(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const said = (): number => warn.mock.calls.filter(([line]) => String(line).includes('part way through a restore')).length;
    try {
      const journal = stuckJournal(dir);
      writeFileSync(join(dir, 'note.md'), 'second\n');
      // The watcher's run, past its debounce, and two asked for directly.
      await settle(300);
      await backup.commitNow();
      await backup.commitNow();
      expect(saves(dir)).toBe(1);
      // Said once, not on every run held off.
      expect(said()).toBe(1);

      // Put back: the next run saves what changed.
      rmSync(journal);
      await backup.commitNow();
      expect(saves(dir)).toBe(2);
      expect(execFileSync('git', ['--git-dir', join(dir, '.history.git'), 'show', 'HEAD:note.md'], { encoding: 'utf-8' })).toBe('second\n');

      // A second episode is said again, once.
      stuckJournal(dir);
      writeFileSync(join(dir, 'note.md'), 'third\n');
      await backup.commitNow();
      await backup.commitNow();
      expect(saves(dir)).toBe(2);
      expect(said()).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * A start whose put-back failed comes up with the journal standing
   * (server/restore.ts), and the vault's own history may be one of the
   * folders set aside. A repo made then stood where that one has to go
   * back to, and the put-back, which skips a rename whose source is there
   * again, would have left the vault's history in `.restore`.
   */
  it('makes no repo and no first save at startup while a restore stands part way, and opens it once the vault is put back', async () => {
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    writeFileSync(join(dir, 'note.md'), 'first\n');
    // One the startup put-back could not finish, or cannot read: both stay.
    const journal = stuckJournal(dir, 'not a journal');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      backup = await startVaultBackup(dir, 50);
      await backup.commitNow();
    } finally {
      warn.mockRestore();
    }
    expect(existsSync(join(dir, '.history.git'))).toBe(false);
    // Nor does a save forced through exclusive() make one; no route
    // commits while the journal stands, and this one is refused.
    await expect(backup.exclusive((commit) => commit('too soon'))).rejects.toThrow(/part way through a restore/);
    expect(existsSync(join(dir, '.history.git'))).toBe(false);

    // Put back: the first save opens the repo and records the vault.
    rmSync(journal);
    await backup.commitNow();
    expect(saves(dir)).toBe(1);

    // A restore records the vault on each side of its swap through
    // exclusive(), outside the journal's lifetime; nothing holds those.
    stuckJournal(dir, 'not a journal');
    writeFileSync(join(dir, 'note.md'), 'second\n');
    await backup.exclusive((commit) => commit("a restore's own save"));
    expect(log(dir)[0]).toBe("a restore's own save");
    expect(saves(dir)).toBe(2);
    expect(tracked(dir)).not.toContain('journal.json');
  });

  /**
   * A vault is a folder the user picks, and it can arrive with a
   * `.history.git` already in it. Adopting one means git reads ITS config
   * and runs ITS hooks — `core.fsmonitor` on the startup `status`, the
   * hooks on the first commit — as whoever runs the server. Both are
   * refused before any git command runs.
   */
  it('refuses a history repo that came with the folder and can run code', async () => {
    for (const plant of [
      (gitDir: string): void => {
        mkdirSync(join(gitDir, 'hooks'), { recursive: true });
        writeFileSync(join(gitDir, 'hooks', 'pre-commit'), '#!/bin/sh\ntouch /tmp/pwned\n');
      },
      (gitDir: string): void => {
        writeFileSync(join(gitDir, 'config'), '[core]\n\tbare = true\n\tfsmonitor = touch /tmp/pwned\n');
      },
      (gitDir: string): void => {
        writeFileSync(
          join(gitDir, 'config'),
          '[core]\n\tbare = true\n[filter "evil"]\n\tclean = touch /tmp/pwned\n',
        );
      },
    ]) {
      dir = mkdtempSync(join(tmpdir(), 'vault-hostile-'));
      const gitDir = join(dir, '.history.git');
      execFileSync('git', ['init', '--quiet', '--bare', gitDir]);
      plant(gitDir);
      await expect(startVaultBackup(dir, 50)).rejects.toThrow(/refusing to use/);
      rmSync(dir, { recursive: true, force: true });
    }
    // And a plain repo the app made is still adopted.
    dir = mkdtempSync(join(tmpdir(), 'vault-backup-'));
    writeFileSync(join(dir, 'note.md'), 'first\n');
    backup = await startVaultBackup(dir, 50);
    expect(log(dir)).toHaveLength(1);
  });
});
