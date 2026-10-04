import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { historyExcludeFile, historyMatcherFor } from './historyExcludes.ts';
import { git } from './vaultGit.ts';

/**
 * The list's matcher against git's own reading of the exclude file it
 * writes. They are two readings of one list, and the purge takes out of
 * the history what the matcher names, so a path the two disagree on is a
 * file the history either goes on saving after a purge or loses from
 * every save while it is still saved.
 */

/** Every kind of path a vault has or had, at the depths each occurs, and
    the ones that look like them and are not. */
const PATHS = [
  'config.json',
  'CONFIG.JSON',
  'notes/config.json',
  'sessions.json',
  'studies/sessions.json.pgn',
  '.history.git/HEAD',
  '.history.git/objects/ab/cdef0123',
  'notes/.history.git/HEAD',
  '.restore/journal.json',
  '.restore/before/notes/Plans.md',
  'notes/.restore/a.md',
  'sources/twic1500.pgn',
  'sources/deep/b.pgn',
  'Sources/c.pgn',
  'sources.pgn',
  'notes/sources/Reading list.md',
  'studies/Openings/sources/Najdorf.pgn',
  'books/Endgames/book.pdf',
  'books/Endgames/BOOK.PDF',
  'books/Endgames/open.bin',
  'books/Endgames/book.json',
  'books/Endgames/book.pdf.part',
  'books/Endgames/scans/book.pdf',
  'books/book.pdf',
  'puzzlebooks/Endgames/book.pdf',
  'x.part',
  'notes/a/b/.Plans.md.swp',
  'notes/a.swp.md',
  'notes/a.part/x.md',
  'notes/a.PART',
  'games/collection/Carlsen - Nakamura.pgn',
  'notes/한글/.메모.md.swp',
  'notes/한글/메모.md',
];

describe('what the history never holds', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('names exactly what git leaves out by the exclude file, in either case setting', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-excludes-'));
    const gitDir = join(dir, '.history.git');
    execFileSync('git', ['init', '--quiet', '--bare', gitDir]);
    writeFileSync(join(gitDir, 'info', 'exclude'), historyExcludeFile());
    const run = (args: string[], input?: string): string =>
      execFileSync('git', ['--git-dir', gitDir, '--work-tree', dir, ...args], { encoding: 'utf-8', input });
    // An index holding every path, no file needed: one empty blob for all.
    const blob = run(['hash-object', '-w', '--stdin'], '').trim();
    run(['update-index', '-z', '--index-info'], PATHS.map((path) => `100644 ${blob}\t${path}\0`).join(''));

    for (const ignoreCase of ['false', 'true']) {
      run(['config', 'core.ignorecase', ignoreCase]);
      const byGit = run(['ls-files', '-z', '--cached', '--ignored', `--exclude-from=${join(gitDir, 'info', 'exclude')}`]).split('\0').filter(Boolean);
      const matcher = await historyMatcherFor(gitDir, dir, { fresh: true });
      const named = PATHS.filter((path) => matcher.within(path) !== null);
      expect(named.sort(), `core.ignorecase=${ignoreCase}`).toEqual(byGit.sort());
      // And the pathspecs git narrows a walk by reach every one of them.
      const reached = (await git(gitDir, dir, ['ls-files', '-z', '--', ...matcher.pathspecs], matcher.mode)).split('\0');
      expect(named.filter((path) => !reached.includes(path)), `core.ignorecase=${ignoreCase}`).toEqual([]);
    }
  });

  it('says which part of a path it names, and what kind that is', async () => {
    dir = mkdtempSync(join(tmpdir(), 'history-excludes-'));
    const gitDir = join(dir, '.history.git');
    execFileSync('git', ['init', '--quiet', '--bare', gitDir]);
    execFileSync('git', ['--git-dir', gitDir, 'config', 'core.ignorecase', 'false']);
    const matcher = await historyMatcherFor(gitDir, dir);
    expect(matcher.within('config.json')).toEqual({ at: 'config.json', kind: 'credentials' });
    expect(matcher.within('.history.git/objects/ab/cdef0123')).toEqual({ at: '.history.git', kind: 'folder' });
    expect(matcher.within('books/Endgames/book.pdf')).toEqual({ at: 'books/Endgames/book.pdf', kind: 'books' });
    expect(matcher.within('books/Endgames/open.bin')).toEqual({ at: 'books/Endgames/open.bin', kind: 'books' });
    expect(matcher.within('books/Endgames/book.pdf.part')).toEqual({ at: 'books/Endgames/book.pdf.part', kind: 'other' });
    expect(matcher.within('sources/deep/b.pgn')).toEqual({ at: 'sources', kind: 'sources' });
    expect(matcher.within('.restore/before/sources/a.pgn')).toEqual({ at: '.restore', kind: 'other' });
    expect(matcher.within('notes/a.part/x.md')).toEqual({ at: 'notes/a.part', kind: 'other' });
    expect(matcher.within('notes/sources/Reading list.md')).toBeNull();
    // A tree entry is asked as itself, a folder or not.
    expect(matcher.self('sources', true)).toBe('sources');
    expect(matcher.self('sources', false)).toBeNull();
  });
});
