import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startVaultBackup, type VaultBackup } from './vaultBackup.ts';

const log = (dir: string): string[] =>
  execFileSync('git', ['--git-dir', join(dir, '.history.git'), 'log', '--format=%s'], {
    encoding: 'utf-8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);

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
    backup = await startVaultBackup(dir, 50);
    const files = execFileSync(
      'git',
      ['--git-dir', join(dir, '.history.git'), 'ls-tree', '-r', '--name-only', 'HEAD'],
      { encoding: 'utf-8' },
    );
    expect(files).toContain('games.json');
    expect(files).not.toContain('big.pgn');
    expect(files).toContain('books/b0123456789abcdef/book.json');
    expect(files).not.toContain('book.pdf');

    // Second start reuses the repo instead of re-initialising.
    await backup.stop();
    writeFileSync(join(dir, 'games.json'), '{"a":1}\n');
    backup = await startVaultBackup(dir, 50);
    expect(log(dir)).toHaveLength(2);
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
