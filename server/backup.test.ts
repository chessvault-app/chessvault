import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { backupApi, backupFilename } from './backup.ts';

/**
 * The archive is read back by the system's own tar, not by this code:
 * a writer that only its own reader accepts proves nothing about the
 * file a user will open on another machine.
 */
describe('vault backup', () => {
  let vault: string;
  let out: string;
  const long = `${'a-study-with-a-very-long-title-'.repeat(4)}.pgn`; // 128 chars: past ustar's 100
  const longKorean = `${'긴 제목의 한글 스터디 '.repeat(4)}끝.pgn`; // 57 chars, but 131 bytes

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), 'backup-vault-'));
    out = mkdtempSync(join(tmpdir(), 'backup-out-'));
    mkdirSync(join(vault, 'games', 'collection'), { recursive: true });
    mkdirSync(join(vault, 'games', '한국 대회'), { recursive: true });
    mkdirSync(join(vault, 'studies'), { recursive: true });
    mkdirSync(join(vault, '.history.git', 'objects'), { recursive: true });
    mkdirSync(join(vault, '.data'), { recursive: true });
    writeFileSync(join(vault, 'games', 'collection', 'a.pgn'), '1. e4 e5 *\n');
    writeFileSync(join(vault, 'games', '한국 대회', 'b.pgn'), '1. d4 *\n');
    writeFileSync(join(vault, 'studies', long), 'x'.repeat(1000));
    writeFileSync(join(vault, 'studies', '한글 스터디.pgn'), '*');
    writeFileSync(join(vault, 'studies', longKorean), '한글');
    writeFileSync(join(vault, '.history.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(vault, '.data', 'index.sqlite'), 'derived');
    writeFileSync(join(vault, 'config.json'), '{"password":"secret"}');
    writeFileSync(join(vault, 'sessions.json'), '[]');
    writeFileSync(join(vault, 'empty.md'), '');
  });
  afterAll(() => {
    rmSync(vault, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });

  it('streams a tar the system tar extracts byte for byte, without the credentials', async () => {
    const app = new Hono().route('/api', backupApi(vault, () => 'My vault'));
    const res = await app.request('/api/storage/backup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-tar');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="My vault \d{4}-\d{2}-\d{2}\.tar"; filename\*=UTF-8''/);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.length % 512).toBe(0);
    // A relative path and a cwd: GNU tar reads `C:\…` as a host name.
    writeFileSync(join(out, 'v.tar'), bytes);
    const x = join(out, 'x');
    mkdirSync(x);
    execFileSync('tar', ['-xf', '../v.tar'], { cwd: x });
    // What the tar wrote, not what it printed: Windows' own tar prints a
    // name in the system's code page, where a Korean one reads as noise.
    const extracted = readdirSync(x, { recursive: true, withFileTypes: true })
      .map((e) => `${relative(x, join(e.parentPath, e.name)).split(sep).join('/')}${e.isDirectory() ? '/' : ''}`)
      .sort();
    expect(extracted).toEqual(
      [
        '.history.git/',
        '.history.git/HEAD',
        '.history.git/objects/',
        'empty.md',
        'games/',
        'games/collection/',
        'games/collection/a.pgn',
        'games/한국 대회/',
        'games/한국 대회/b.pgn',
        'studies/',
        `studies/${long}`,
        `studies/${longKorean}`,
        'studies/한글 스터디.pgn',
      ].sort(),
    );
    expect(readFileSync(join(x, 'games', 'collection', 'a.pgn'), 'utf-8')).toBe('1. e4 e5 *\n');
    expect(readFileSync(join(x, 'games', '한국 대회', 'b.pgn'), 'utf-8')).toBe('1. d4 *\n');
    expect(readFileSync(join(x, 'studies', long), 'utf-8')).toBe('x'.repeat(1000));
    expect(readFileSync(join(x, 'studies', '한글 스터디.pgn'), 'utf-8')).toBe('*');
    expect(readFileSync(join(x, 'studies', longKorean), 'utf-8')).toBe('한글');
    expect(readFileSync(join(x, 'empty.md'), 'utf-8')).toBe('');
  });

  it('names the file after the vault, else its folder, and keeps the name filesystem-safe', () => {
    const day = new Date('2026-09-07T12:00:00Z');
    expect(backupFilename('/srv/chess/vault', null, day)).toBe('vault 2026-09-07.tar');
    expect(backupFilename('C:\\Users\\me\\Chess', 'Club: 2026/27', day)).toBe('Club 2026 27 2026-09-07.tar');
  });
});
