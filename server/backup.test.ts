import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  beforeAll(() => {
    vault = mkdtempSync(join(tmpdir(), 'backup-vault-'));
    out = mkdtempSync(join(tmpdir(), 'backup-out-'));
    mkdirSync(join(vault, 'games', 'collection'), { recursive: true });
    mkdirSync(join(vault, 'studies'), { recursive: true });
    mkdirSync(join(vault, '.history.git', 'objects'), { recursive: true });
    mkdirSync(join(vault, '.data'), { recursive: true });
    writeFileSync(join(vault, 'games', 'collection', 'a.pgn'), '1. e4 e5 *\n');
    writeFileSync(join(vault, 'studies', long), 'x'.repeat(1000));
    writeFileSync(join(vault, 'studies', '한글 스터디.pgn'), '*');
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
    // A relative path and a cwd: GNU tar reads `C:\…` as a host name. A
    // UTF-8 locale, or its listing escapes every byte of a Korean name.
    writeFileSync(join(out, 'v.tar'), bytes);
    const listed = execFileSync('tar', ['-tf', 'v.tar'], { cwd: out, encoding: 'utf-8', env: { ...process.env, LC_ALL: 'C.UTF-8' } }).trim().split('\n').sort();
    expect(listed).toEqual(
      [
        '.history.git/',
        '.history.git/HEAD',
        '.history.git/objects/',
        'empty.md',
        'games/',
        'games/collection/',
        'games/collection/a.pgn',
        'studies/',
        `studies/${long}`,
        'studies/한글 스터디.pgn',
      ].sort(),
    );
    execFileSync('tar', ['-xf', 'v.tar'], { cwd: out });
    expect(readFileSync(join(out, 'games', 'collection', 'a.pgn'), 'utf-8')).toBe('1. e4 e5 *\n');
    expect(readFileSync(join(out, 'studies', long), 'utf-8')).toBe('x'.repeat(1000));
    expect(readFileSync(join(out, 'studies', '한글 스터디.pgn'), 'utf-8')).toBe('*');
    expect(readFileSync(join(out, 'empty.md'), 'utf-8')).toBe('');
  });

  it('names the file after the vault, else its folder, and keeps the name filesystem-safe', () => {
    const day = new Date('2026-09-07T12:00:00Z');
    expect(backupFilename('/srv/chess/vault', null, day)).toBe('vault 2026-09-07.tar');
    expect(backupFilename('C:\\Users\\me\\Chess', 'Club: 2026/27', day)).toBe('Club 2026 27 2026-09-07.tar');
  });
});
