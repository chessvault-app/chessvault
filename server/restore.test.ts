import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { requireAuth } from './auth.ts';
import { backupApi } from './backup.ts';
import { recoverInterruptedRestore, restoreApi, type RestoreOptions } from './restore.ts';
import { studiesApi } from './studies.ts';
import { startVaultBackup, type VaultBackup } from './vaultBackup.ts';
import { vaultHistoryApi } from './vaultHistory.ts';

/**
 * Restore from a copy, against real folders and, where the history is the
 * point, a real git repo: the copies are made by the app's own writer
 * (server/backup.ts), by the writer before 0.12.0 (kept below as it was),
 * by the system tar, and by hand for the archives nobody honest makes.
 */

// --- fixtures ------------------------------------------------------------

/** 128 bytes: past ustar's 100, so a pax record (or, before 0.12.0, a GNU long name). */
const LONG = `${'a-study-with-a-very-long-title-'.repeat(4)}.pgn`;
/** 57 characters and 131 bytes. */
const LONG_KOREAN = `${'긴 제목의 한글 스터디 '.repeat(4)}끝.pgn`;
/** With `notes/`, exactly 100 bytes: the field full, with no NUL after it. */
const EXACT_100 = `${'x'.repeat(91)}.md`;
/** Bytes that are not text and span several chunks. */
const PDF = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7919 + (i >> 8)) % 256));

const dirs: string[] = [];
const backups: VaultBackup[] = [];

afterEach(async () => {
  // Awaited first: on Windows a folder a git child still holds cannot go.
  for (const backup of backups.splice(0)) await backup.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A vault folder inside a parent of its own, so an archive entry that
    climbed out of the vault would be found beside it. */
function scratch(prefix: string): { parent: string; vault: string } {
  const parent = mkdtempSync(join(tmpdir(), `restore-${prefix}-`));
  dirs.push(parent);
  const vault = join(parent, 'vault');
  mkdirSync(vault);
  return { parent, vault };
}

function put(vault: string, path: string, content: string | Buffer, mtime?: number): void {
  const at = join(vault, ...path.split('/'));
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, content);
  if (mtime !== undefined) utimesSync(at, mtime, mtime);
}

/** Everything a copy has to carry, and the files it must not. */
function fillSource(vault: string): void {
  put(vault, 'studies/Najdorf.pgn', '[Event "Najdorf"]\n\n1. e4 c5 *\n');
  put(vault, 'studies/Shared.pgn', 'theirs\n');
  put(vault, `studies/${LONG}`, 'x'.repeat(1000));
  put(vault, `studies/${LONG_KOREAN}`, '한글');
  put(vault, 'studies/한글 스터디.pgn', '*\n');
  put(vault, 'studies/.Najdorf.pgn.swp', 'unsaved');
  put(vault, `notes/${EXACT_100}`, 'a hundred bytes of name\n');
  put(vault, 'notes/♟ Endgames 🏆.md', '# Rook endings\n\nLucena first.\n');
  put(vault, 'notes/🏁 folder/inner.md', 'inside\n');
  put(vault, 'notes/empty.md', '');
  mkdirSync(join(vault, 'notes', 'empty folder'), { recursive: true });
  put(vault, 'games/collection/a.pgn', '1. e4 e5 *\n');
  put(vault, 'games/collection/한국 대회/b.pgn', '1. d4 *\n');
  put(vault, 'books/b0123456789abcdef/book.json', '{"title":"Endgame manual"}\n');
  put(vault, 'books/b0123456789abcdef/book.pdf', PDF);
  put(vault, 'sources/elite.pgn', '[Event "Elite"]\n\n1. c4 *\n');
  put(vault, 'puzzles/history.jsonl', '{"id":"p1"}\n');
  put(vault, 'repertoire/map.json', '{}\n');
  put(vault, 'activity.jsonl', '{"kind":"study"}\n');
  put(vault, 'config.json', '{"appPassword":"source-secret"}\n');
  put(vault, 'sessions.json', '["source-session"]\n');
  put(vault, '.welcomed', 'source\n');
}

/** A vault with work of its own in it, and its own credentials. */
function fillTarget(vault: string): void {
  put(vault, 'studies/Old.pgn', 'old study\n');
  put(vault, 'studies/Shared.pgn', 'mine\n');
  put(vault, 'notes/Gone.md', '# A note the copy does not have\n');
  put(vault, 'books/bfedcba9876543210/book.json', '{"title":"Mine"}\n');
  put(vault, 'books/bfedcba9876543210/book.pdf', Buffer.from(PDF).reverse());
  put(vault, 'sources/mine.pgn', '[Event "Mine"]\n\n1. f4 *\n');
  mkdirSync(join(vault, 'games'), { recursive: true });
  put(vault, 'config.json', '{"appPassword":"target-secret"}\n');
  put(vault, 'sessions.json', '["target-session"]\n');
  put(vault, '.welcomed', 'target\n');
}

const CREDENTIALS_AND_DOTFILES = ['config.json', 'sessions.json', '.welcomed', '.history.git', '.restore'];

/** Every file and folder under `dir`, a file as a hash of its bytes. */
function tree(dir: string, skip: string[] = CREDENTIALS_AND_DOTFILES): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string[]): void => {
    for (const entry of readdirSync(join(dir, ...rel), { withFileTypes: true })) {
      if (rel.length === 0 && skip.includes(entry.name)) continue;
      const path = [...rel, entry.name];
      if (entry.isDirectory()) {
        out[`${path.join('/')}/`] = 'folder';
        walk(path);
      } else {
        out[path.join('/')] = createHash('sha256').update(readFileSync(join(dir, ...path))).digest('hex');
      }
    }
  };
  walk([]);
  return out;
}

/** The whole vault, credentials included, for "exactly as it was". */
const everything = (dir: string): Record<string, string> => tree(dir, ['.history.git', '.restore']);

const read = (vault: string, path: string): string => readFileSync(join(vault, ...path.split('/')), 'utf-8');

/** What `.restore` holds besides a pending restore: nothing, after any request. */
function leftovers(vault: string): string[] {
  const work = join(vault, '.restore');
  return existsSync(work) ? readdirSync(work).filter((name) => name !== 'before') : [];
}

async function download(vault: string): Promise<Buffer> {
  const res = await new Hono().route('/api', backupApi(vault)).request('/api/storage/backup');
  expect(res.status).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

function restorer(vault: string, options: RestoreOptions = {}) {
  const app = new Hono().route('/api', restoreApi(vault, { free: async () => null, ...options }));
  return {
    app,
    restore: (body: Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string> = {}) =>
      app.request('/api/storage/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/x-tar', ...headers },
        body,
        duplex: 'half',
      } as RequestInit),
    state: async (): Promise<any> => (await app.request('/api/storage/restore')).json(),
    undo: () => app.request('/api/storage/restore/undo', { method: 'POST' }),
    keep: () => app.request('/api/storage/restore/keep', { method: 'POST' }),
  };
}

// --- the writer before 0.12.0, as 87091e4e left it -----------------------

function legacyHeader(name: string, size: number, mode: number, mtime: number, type: '0' | '5' | 'L'): Buffer {
  const buf = Buffer.alloc(512);
  const putText = (text: string, at: number, len: number): void => {
    buf.write(text.slice(0, len), at, 'latin1');
  };
  const num = (n: number, at: number, len: number): void => {
    putText(n.toString(8).padStart(len - 1, '0'), at, len - 1);
  };
  Buffer.from(name, 'utf-8').copy(buf, 0, 0, 100);
  num(mode, 100, 8);
  num(0, 108, 8);
  num(0, 116, 8);
  num(size, 124, 12);
  num(Math.floor(mtime / 1000), 136, 12);
  putText('        ', 148, 8);
  putText(type, 156, 1);
  putText('ustar', 257, 6);
  putText('00', 263, 2);
  let sum = 0;
  for (const byte of buf) sum += byte;
  putText(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buf;
}

const pad = (size: number): Buffer => Buffer.alloc((512 - (size % 512)) % 512);

function* legacyLongName(name: string): Generator<Buffer> {
  const bytes = Buffer.from(name, 'utf-8');
  if (bytes.length <= 100) return;
  const body = Buffer.concat([bytes, Buffer.alloc(1)]);
  yield legacyHeader('././@LongLink', body.length, 0o644, Date.now(), 'L');
  yield body;
  yield pad(body.length);
}

async function* legacyEntries(root: string, rel: string[]): AsyncGenerator<Buffer> {
  const names = await readdir(resolve(root, ...rel), { withFileTypes: true });
  names.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of names) {
    if (rel.length === 0 && entry.name.startsWith('.') && entry.name !== '.history.git') continue;
    if (rel.length === 0 && (entry.name === 'config.json' || entry.name === 'sessions.json')) continue;
    const path = [...rel, entry.name];
    const name = path.join('/');
    const full = resolve(root, ...path);
    if (entry.isDirectory()) {
      const mtime = (await stat(full)).mtimeMs;
      yield* legacyLongName(`${name}/`);
      yield legacyHeader(`${name}/`, 0, 0o755, mtime, '5');
      yield* legacyEntries(root, path);
    } else if (entry.isFile()) {
      const handle = await open(full, 'r');
      try {
        const info = await handle.stat();
        yield* legacyLongName(name);
        yield legacyHeader(name, info.size, 0o644, info.mtimeMs, '0');
        yield await handle.readFile();
        yield pad(info.size);
      } finally {
        await handle.close();
      }
    }
  }
}

async function legacyCopy(vault: string): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const part of legacyEntries(vault, [])) parts.push(part);
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

// --- archives by hand ------------------------------------------------------

function header(
  name: string,
  options: { size?: number; type?: string; link?: string; prefix?: string; gnu?: boolean } = {},
): Buffer {
  const buf = Buffer.alloc(512);
  Buffer.from(name, 'utf-8').copy(buf, 0, 0, 100);
  buf.write('0000644\0', 100, 'latin1');
  buf.write('0000000\0', 108, 'latin1');
  buf.write('0000000\0', 116, 'latin1');
  buf.write(`${(options.size ?? 0).toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  buf.write(`${(1_700_000_000).toString(8).padStart(11, '0')}\0`, 136, 'latin1');
  buf.write('        ', 148, 'latin1');
  buf.write(options.type ?? '0', 156, 'latin1');
  if (options.link) buf.write(options.link, 157, 'utf-8');
  if (options.gnu) buf.write('ustar  \0', 257, 'latin1');
  else {
    buf.write('ustar\0', 257, 'latin1');
    buf.write('00', 263, 'latin1');
  }
  if (options.prefix) buf.write(options.prefix, 345, 'utf-8');
  let sum = 0;
  for (const byte of buf) sum += byte;
  buf.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return buf;
}

function file(name: string, content: string | Buffer = '', options: Parameters<typeof header>[1] = {}): Buffer {
  const body = Buffer.from(content);
  return Buffer.concat([header(name, { ...options, size: body.length }), body, pad(body.length)]);
}

function paxPath(path: string): Buffer {
  const rest = Buffer.byteLength(` path=${path}\n`);
  let length = rest + String(rest).length;
  length = rest + String(length).length;
  const body = Buffer.from(`${length} path=${path}\n`, 'utf-8');
  return Buffer.concat([header('././@PaxHeader', { type: 'x', size: body.length }), body, pad(body.length)]);
}

function longLink(path: string): Buffer {
  const body = Buffer.concat([Buffer.from(path, 'utf-8'), Buffer.alloc(1)]);
  return Buffer.concat([header('././@LongLink', { type: 'L', size: body.length, gnu: true }), body, pad(body.length)]);
}

const archive = (...parts: Buffer[]): Buffer => Buffer.concat([...parts, Buffer.alloc(1024)]);

/** A tar that is a vault in every way but the entry under test. */
const vaultWith = (...parts: Buffer[]): Buffer =>
  archive(file('studies/', '', { type: '5' }), file('studies/fine.pgn', '1. e4 *\n'), ...parts);

// --- tests ---------------------------------------------------------------

describe('restore from a copy', () => {
  it('puts back every file the copy holds, byte for byte, and leaves the credentials where they are', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await download(source.vault);
    // The copy is the current writer's: pax records for the long and the
    // non-ASCII names.
    expect(copy.includes('././@PaxHeader')).toBe(true);

    const target = scratch('target');
    fillTarget(target.vault);
    const before = everything(target.vault);
    const { restore, state } = restorer(target.vault);
    const res = await restore(copy);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, history: 'none' });

    expect(tree(target.vault)).toEqual(tree(source.vault));
    expect(read(target.vault, 'books/b0123456789abcdef/book.pdf')).toBe(PDF.toString('utf-8'));
    // The vault's own credentials and marker, not the copy's.
    expect(read(target.vault, 'config.json')).toBe('{"appPassword":"target-secret"}\n');
    expect(read(target.vault, 'sessions.json')).toBe('["target-session"]\n');
    expect(read(target.vault, '.welcomed')).toBe('target\n');
    // Times come back to the second a tar header keeps.
    for (const path of ['studies/Najdorf.pgn', `studies/${LONG_KOREAN}`, 'books/b0123456789abcdef/book.pdf']) {
      const was = statSync(join(source.vault, ...path.split('/'))).mtimeMs;
      expect(statSync(join(target.vault, ...path.split('/'))).mtimeMs).toBe(Math.floor(was / 1000) * 1000);
    }
    // What the vault held is all still there, waiting to be kept or undone.
    expect(tree(join(target.vault, '.restore', 'before'), ['.restored.json'])).toEqual(
      Object.fromEntries(Object.entries(before).filter(([path]) => !['config.json', 'sessions.json', '.welcomed'].includes(path))),
    );
    const waiting = await state();
    expect(waiting.pending).toMatchObject({ history: 'none' });
    expect(waiting.pending.bytes).toBeGreaterThan(PDF.length);
    expect(leftovers(target.vault)).toEqual([]);
  });

  it('reads a copy the writer before 0.12.0 made: raw UTF-8 names and GNU long names', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await legacyCopy(source.vault);
    // The shapes under test really are in it.
    expect(copy.includes('././@LongLink')).toBe(true);
    expect(copy.includes('././@PaxHeader')).toBe(false);
    expect(copy.includes(Buffer.from('studies/한글 스터디.pgn', 'utf-8'))).toBe(true);
    expect(copy.includes(Buffer.from(`notes/${EXACT_100}`, 'latin1'))).toBe(true);

    const target = scratch('target');
    const res = await restorer(target.vault).restore(copy);
    expect(res.status).toBe(200);
    expect(tree(target.vault)).toEqual(tree(source.vault));
  });

  it('reads what the system tar writes, in its own format and as plain ustar', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    // Windows' own tar (bsdtar 3.8.8) dies on these two names, exit code
    // 0xC0000005, writing nothing: measured, and nothing to do with the
    // restore. The app's own writers carry them in the tests above.
    rmSync(join(source.vault, 'notes', '♟ Endgames 🏆.md'));
    rmSync(join(source.vault, 'notes', '🏁 folder'), { recursive: true });
    const out = scratch('out');
    // A relative path and a cwd: GNU tar reads `C:\…` as a host name.
    const to = (from: string, name: string): string => relative(from, join(out.vault, name)).split(sep).join('/');
    execFileSync('tar', ['-cf', to(source.vault, 'copy.tar'), '.'], { cwd: source.vault });
    const target = scratch('target');
    const res = await restorer(target.vault).restore(readFileSync(join(out.vault, 'copy.tar')));
    expect(res.status).toBe(200);
    // The system tar took the credentials and the marker too; the restore did not.
    expect(tree(target.vault)).toEqual(tree(source.vault));
    expect(readdirSync(target.vault).filter((name) => /config|sessions|welcomed/i.test(name))).toEqual([]);

    // Plain ustar: a long path split across the prefix and name fields.
    const ascii = scratch('ascii');
    const deep = `studies/${'opening-'.repeat(8)}/${'line-'.repeat(12)}.pgn`;
    put(ascii.vault, deep, '1. Nf3 *\n');
    execFileSync('tar', ['--format=ustar', '-cf', to(ascii.vault, 'ustar.tar'), 'studies'], { cwd: ascii.vault });
    const plain = readFileSync(join(out.vault, 'ustar.tar'));
    expect(plain.includes('././@')).toBe(false);
    const again = scratch('again');
    expect((await restorer(again.vault).restore(plain)).status).toBe(200);
    expect(read(again.vault, deep)).toBe('1. Nf3 *\n');
  });

  it('refuses a hostile or broken archive whole, and leaves the vault exactly as it was', async () => {
    const copy = await (async () => {
      const source = scratch('source');
      fillSource(source.vault);
      return download(source.vault);
    })();
    // A bit of the second header's name: the first one would read as not a tar at all.
    const second = 512 + Math.ceil(parseInt(copy.toString('latin1', 124, 135), 8) / 512) * 512;
    const flipped = Buffer.from(copy);
    flipped[second + 1] = flipped[second + 1]! ^ 0x01;
    const cases: [string, Buffer | Uint8Array, string][] = [
      ['an absolute path', vaultWith(file('/etc/escape.txt', 'x')), 'unsafe-path'],
      ['a parent segment', vaultWith(file('../escape.txt', 'x')), 'unsafe-path'],
      ['a parent segment inside', vaultWith(file('studies/../../escape.txt', 'x')), 'unsafe-path'],
      ['a drive letter', vaultWith(file('C:/escape.txt', 'x')), 'unsafe-path'],
      ['a drive-relative path', vaultWith(file('C:escape.txt', 'x')), 'unsafe-path'],
      ['backslashes', vaultWith(file('studies\\..\\..\\escape.txt', 'x')), 'unsafe-path'],
      ['a data stream', vaultWith(file('config.json::$DATA', 'x')), 'unsafe-path'],
      ['a device name', vaultWith(file('studies/con.pgn', 'x')), 'unsafe-path'],
      ['a bare device name', vaultWith(file('notes/NUL', 'x')), 'unsafe-path'],
      ['a trailing dot', vaultWith(file('config.json.', 'x')), 'unsafe-path'],
      ['a trailing space', vaultWith(file('studies/x.pgn ', 'x')), 'unsafe-path'],
      ['a pax path that climbs out', vaultWith(paxPath('../escape.txt'), file('studies/innocent.pgn', 'x')), 'unsafe-path'],
      ['a GNU long name that climbs out', vaultWith(longLink(`../../${'e'.repeat(120)}.txt`), file('studies/stub', 'x')), 'unsafe-path'],
      ['a symbolic link', vaultWith(file('studies/link', '', { type: '2', link: '/etc/passwd' })), 'unsupported-entry'],
      ['a hard link', vaultWith(file('studies/hard', '', { type: '1', link: 'config.json' })), 'unsupported-entry'],
      ['a character device', vaultWith(file('studies/tty', '', { type: '3' })), 'unsupported-entry'],
      ['a block device', vaultWith(file('studies/disk', '', { type: '4' })), 'unsupported-entry'],
      ['a FIFO', vaultWith(file('studies/pipe', '', { type: '6' })), 'unsupported-entry'],
      ['a sparse file', vaultWith(file('studies/sparse', '', { type: 'S', gnu: true })), 'unsupported-entry'],
      ['an unknown type', vaultWith(file('studies/odd', '', { type: 'Z' })), 'unsupported-entry'],
      ['a checksum that does not match', flipped, 'checksum'],
      ['an archive cut inside a file', copy.subarray(0, Math.floor(copy.length * 0.6)), 'truncated'],
      ['an archive cut at an entry, with no end marker', vaultWith().subarray(0, 512 * 3), 'truncated'],
      ['a size that is not a number', (() => {
        const bad = file('studies/x.pgn', 'x');
        bad.write('zzzzzzzzzzz\0', 124, 'latin1');
        let sum = 0;
        bad.write('        ', 148, 'latin1');
        for (let i = 0; i < 512; i += 1) sum += bad[i]!;
        bad.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
        return vaultWith(bad);
      })(), 'malformed'],
      ['a file where a folder has to go', archive(file('studies', 'x'), file('studies/x.pgn', 'y')), 'malformed'],
      ['something that is not a tar', Buffer.from('%PDF-1.7\n'.repeat(200)), 'not-tar'],
      ['an empty upload', Buffer.alloc(0), 'not-tar'],
      ['a tar of something else', archive(file('readme.txt', 'hello')), 'not-tar'],
    ];
    for (const [what, body, reason] of cases) {
      const target = scratch('target');
      fillTarget(target.vault);
      const before = everything(target.vault);
      const res = await restorer(target.vault).restore(body);
      expect(res.status, what).toBe(400);
      const answer = await res.json();
      expect(answer.reason, what).toBe(reason);
      // The restore window shows it as it comes, so it is a sentence.
      expect(answer.error, what).toMatch(/^[A-Z].*\.$/);
      expect(everything(target.vault), what).toEqual(before);
      expect(leftovers(target.vault), what).toEqual([]);
      expect(existsSync(join(target.vault, '.restore', 'before')), what).toBe(false);
      expect(readdirSync(target.parent), what).toEqual(['vault']);
    }
  });

  it('never takes credentials or the vault\'s own dotfiles from a copy, whatever the case', async () => {
    const target = scratch('target');
    fillTarget(target.vault);
    const copy = vaultWith(
      file('config.json', '{"appPassword":"stolen"}'),
      file('CONFIG.JSON', '{"appPassword":"stolen"}'),
      file('Sessions.json', '["stolen"]'),
      file('.welcomed', 'stolen'),
      file('.restore/before/evil.pgn', 'stolen'),
      file('.data/index.sqlite', 'stolen'),
    );
    const res = await restorer(target.vault).restore(copy);
    expect(res.status).toBe(200);
    expect(read(target.vault, 'config.json')).toBe('{"appPassword":"target-secret"}\n');
    expect(read(target.vault, 'sessions.json')).toBe('["target-session"]\n');
    expect(read(target.vault, '.welcomed')).toBe('target\n');
    expect(readdirSync(target.vault).sort()).toEqual(
      ['.restore', '.welcomed', 'config.json', 'games', 'notes', 'sessions.json', 'sources', 'studies'].sort(),
    );
    expect(existsSync(join(target.vault, '.restore', 'before', 'evil.pgn'))).toBe(false);
    expect(read(target.vault, 'studies/fine.pgn')).toBe('1. e4 *\n');
  });

  it('puts every rename back when one of the swap fails part way', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await download(source.vault);
    // Fourteen renames: five of the vault's folders out, the copy's eight
    // in, and the one that makes the restore pending.
    for (const failAt of [1, 5, 6, 9, 14]) {
      const target = scratch('target');
      fillTarget(target.vault);
      const before = everything(target.vault);
      let calls = 0;
      const { restore, state } = restorer(target.vault, {
        move: (from, to) => {
          calls += 1;
          if (calls === failAt) throw Object.assign(new Error('the disk said no'), { code: 'EIO' });
          renameSync(from, to);
        },
      });
      const res = await restore(copy);
      expect(res.status, `failing rename ${failAt}`).toBe(500);
      expect((await res.json()).error).toBe('Could not put the copy in place, so the vault is as it was.');
      expect(everything(target.vault)).toEqual(before);
      expect(leftovers(target.vault)).toEqual([]);
      expect((await state()).pending).toBeNull();
    }
  });

  it('leaves the vault as it was when the upload is cut off or goes quiet', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await download(source.vault);
    const target = scratch('target');
    fillTarget(target.vault);
    const before = everything(target.vault);

    let sent = false;
    const cut = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(copy.subarray(0, Math.floor(copy.length / 2)));
        } else controller.error(new Error('the client went away'));
      },
    });
    expect((await restorer(target.vault).restore(cut)).status).toBe(500);
    expect(everything(target.vault)).toEqual(before);
    expect(leftovers(target.vault)).toEqual([]);

    let first = true;
    const quiet = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (first) {
          first = false;
          controller.enqueue(copy.subarray(0, 20_000));
          return undefined;
        }
        return new Promise<void>(() => undefined);
      },
    });
    const res = await restorer(target.vault, { idleMs: 100 }).restore(quiet);
    expect(res.status).toBe(408);
    expect(everything(target.vault)).toEqual(before);
    expect(leftovers(target.vault)).toEqual([]);
  });

  it('finishes putting back a swap the server was killed in the middle of', async () => {
    const target = scratch('target');
    fillTarget(target.vault);
    const before = everything(target.vault);
    // The state a kill leaves: the journal written, the vault's folders
    // moved aside, and one of the copy's moved in.
    const work = join(target.vault, '.restore', 'c0ffee00');
    mkdirSync(join(work, 'in', 'studies'), { recursive: true });
    writeFileSync(join(work, 'in', 'studies', 'Theirs.pgn'), 'theirs\n');
    mkdirSync(join(work, 'in', 'notes'));
    mkdirSync(join(work, 'out'));
    const moves = [
      ...['books', 'games', 'notes', 'sources', 'studies'].map((name) => ({ from: name, to: join('.restore', 'c0ffee00', 'out', name) })),
      { from: join('.restore', 'c0ffee00', 'in', 'notes'), to: 'notes' },
      { from: join('.restore', 'c0ffee00', 'in', 'studies'), to: 'studies' },
      { from: join('.restore', 'c0ffee00', 'out'), to: join('.restore', 'before') },
    ];
    writeFileSync(join(target.vault, '.restore', 'journal.json'), JSON.stringify({ moves }));
    for (const move of moves.slice(0, 7)) renameSync(join(target.vault, move.from), join(target.vault, move.to));
    expect(read(target.vault, 'studies/Theirs.pgn')).toBe('theirs\n');

    recoverInterruptedRestore(target.vault);
    expect(everything(target.vault)).toEqual(before);
    expect(readdirSync(join(target.vault, '.restore'))).toEqual([]);
  });

  it('keeps the vault it replaced until asked, puts it back byte for byte, and deletes it only on keep', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await download(source.vault);
    const target = scratch('target');
    fillTarget(target.vault);
    const before = everything(target.vault);
    const { restore, state, undo, keep } = restorer(target.vault);

    expect((await undo()).status).toBe(409);
    expect((await keep()).status).toBe(409);
    expect((await restore(copy)).status).toBe(200);
    // A second copy waits for the first to be kept or undone.
    const second = await restore(copy);
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe('Keep or undo the last restore first.');

    expect((await undo()).status).toBe(200);
    // Book PDFs and uploaded PGN files are in no history; they are back too.
    expect(everything(target.vault)).toEqual(before);
    expect((await state()).pending).toBeNull();
    expect(leftovers(target.vault)).toEqual([]);

    expect((await restore(copy)).status).toBe(200);
    const kept = await keep();
    expect(kept.status).toBe(200);
    expect((await kept.json()).freed).toBeGreaterThan(PDF.length);
    expect(existsSync(join(target.vault, '.restore', 'before'))).toBe(false);
    expect(tree(target.vault)).toEqual(tree(source.vault));
    expect(read(target.vault, 'config.json')).toBe('{"appPassword":"target-secret"}\n');
    expect((await restore(copy)).status).toBe(200);
  });

  it('records the vault on both sides in its history, where the Recovery card finds what the copy lacks', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await download(source.vault);
    const target = scratch('target');
    fillTarget(target.vault);
    const backup = await startVaultBackup(target.vault, 50);
    backups.push(backup);
    put(target.vault, 'studies/Shared.pgn', 'mine, edited\n');
    await backup.commitNow();
    const before = everything(target.vault);
    const { restore, state, undo } = restorer(target.vault, { history: async () => backup });
    expect((await state()).history).toBe('keep');

    const res = await restore(copy);
    expect(await res.json()).toMatchObject({ ok: true, history: 'kept' });

    // The Recovery card's own routes: what the copy lacks is listed as
    // deleted and comes back, and what it changed keeps its old version.
    const recovery = new Hono().route('/api', vaultHistoryApi(target.vault, { commitNow: () => backup.commitNow() }));
    const deleted = (await (await recovery.request('/api/history/deleted')).json()) as { deleted: { kind: string; id: string }[] };
    expect(deleted.deleted.map((d) => `${d.kind}/${d.id}`).sort()).toEqual(['notes/Gone', 'studies/Old']);
    const versions = (await (await recovery.request('/api/history/doc/studies/Shared')).json()) as { versions: { sha: string }[] };
    const contents = await Promise.all(
      versions.versions.map(async (v) => ((await (await recovery.request(`/api/history/at/${v.sha}/studies/Shared`)).json()) as { content: string }).content),
    );
    expect(contents).toEqual(['theirs\n', 'mine, edited\n', 'mine\n']);

    // And the whole vault, the parts no history holds included, comes back.
    expect((await undo()).status).toBe(200);
    expect(everything(target.vault)).toEqual(before);
    await backup.commitNow();
    const log = execFileSync('git', ['--git-dir', join(target.vault, '.history.git'), 'log', '--format=%s'], { encoding: 'utf-8' });
    expect(log).toMatch(/^vault restore undone .*\nvault restored from a copy .*\n/);
    const after = (await (await recovery.request('/api/history/deleted')).json()) as { deleted: { id: string }[] };
    // Undone: the copy's documents are the ones gone now.
    expect(after.deleted.map((d) => d.id)).toContain('Najdorf');
  });

  it('gives a new vault the copy\'s history, made up as a repo of its own', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const sourceBackup = await startVaultBackup(source.vault, 50);
    put(source.vault, 'studies/Najdorf.pgn', 'second version\n');
    await sourceBackup.commitNow();
    put(source.vault, 'studies/Najdorf.pgn', 'third version\n');
    await sourceBackup.commitNow();
    await sourceBackup.stop();
    // What a copy should never be able to bring: a hook, a config that
    // names a program, an alternate pointing at another object store.
    const sourceGit = join(source.vault, '.history.git');
    writeFileSync(join(sourceGit, 'hooks', 'post-commit'), '#!/bin/sh\necho planted > planted.txt\n');
    writeFileSync(join(sourceGit, 'config'), `${readFileSync(join(sourceGit, 'config'), 'utf-8')}[core]\n\tfsmonitor = echo planted\n`);
    writeFileSync(join(sourceGit, 'objects', 'info', 'alternates'), join(tmpdir(), 'elsewhere'));
    const copy = await download(source.vault);

    const target = scratch('target');
    put(target.vault, 'studies/Welcome.pgn', 'welcome\n');
    const backup = await startVaultBackup(target.vault, 50);
    backups.push(backup);
    const { restore, state } = restorer(target.vault, { history: async () => backup });
    expect((await state()).history).toBe('adopt');
    expect(await (await restore(copy)).json()).toMatchObject({ ok: true, history: 'adopted' });

    const recovery = new Hono().route('/api', vaultHistoryApi(target.vault, { commitNow: () => backup.commitNow() }));
    const versions = (await (await recovery.request('/api/history/doc/studies/Najdorf')).json()) as { versions: { sha: string }[] };
    const contents = await Promise.all(
      versions.versions.map(async (v) => ((await (await recovery.request(`/api/history/at/${v.sha}/studies/Najdorf`)).json()) as { content: string }).content),
    );
    // Newest first: the restore putting it back, then the copy's own three.
    expect(contents).toEqual(['third version\n', 'third version\n', 'second version\n', '[Event "Najdorf"]\n\n1. e4 c5 *\n']);
    // The new vault's one document was carried over before the swap.
    const deleted = (await (await recovery.request('/api/history/deleted')).json()) as { deleted: { id: string }[] };
    expect(deleted.deleted.map((d) => d.id)).toEqual(['Welcome']);

    const gitDir = join(target.vault, '.history.git');
    expect(readFileSync(join(gitDir, 'config'), 'utf-8')).not.toContain('planted');
    expect(existsSync(join(gitDir, 'hooks', 'post-commit'))).toBe(false);
    expect(existsSync(join(gitDir, 'objects', 'info', 'alternates'))).toBe(false);
    expect(readFileSync(join(gitDir, 'info', 'exclude'), 'utf-8')).toContain('.restore/');
    // And the safety net goes on writing to it.
    put(target.vault, 'notes/After.md', 'after\n');
    await backup.commitNow();
    expect(execFileSync('git', ['--git-dir', gitDir, 'show', 'HEAD:notes/After.md'], { encoding: 'utf-8' })).toBe('after\n');
    expect(existsSync(join(target.vault, 'planted.txt'))).toBe(false);
  });

  it('keeps a vault\'s own history when it has one, and leaves the copy\'s out', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const sourceBackup = await startVaultBackup(source.vault, 50);
    await sourceBackup.stop();
    const sourceHead = execFileSync('git', ['--git-dir', join(source.vault, '.history.git'), 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    const copy = await download(source.vault);

    const target = scratch('target');
    fillTarget(target.vault);
    const backup = await startVaultBackup(target.vault, 50);
    backups.push(backup);
    put(target.vault, 'notes/Second.md', 'second save\n');
    await backup.commitNow();
    const gitDir = join(target.vault, '.history.git');
    const ownHead = execFileSync('git', ['--git-dir', gitDir, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

    expect(await (await restorer(target.vault, { history: async () => backup }).restore(copy)).json()).toMatchObject({ history: 'kept' });
    const log = execFileSync('git', ['--git-dir', gitDir, 'log', '--format=%H'], { encoding: 'utf-8' });
    expect(log).toContain(ownHead);
    expect(log).not.toContain(sourceHead);
  });

  it('answers from the restored files at once, even one with the old file\'s size and second', async () => {
    const second = 1_700_000_000;
    const source = scratch('source');
    put(source.vault, 'notes/Same.md', 'BBBB copy\n', second);
    const copy = await download(source.vault);

    const target = scratch('target');
    put(target.vault, 'notes/Same.md', 'AAAA mine\n', second);
    const notes = new Hono().route('/api', studiesApi(join(target.vault, 'notes'), 'notes', '.md'));
    const excerpt = async (): Promise<string> =>
      ((await (await notes.request('/api/notes')).json()) as { studies: { excerpt: string }[] }).studies[0]!.excerpt;
    expect(await excerpt()).toBe('AAAA mine');

    expect((await restorer(target.vault).restore(copy)).status).toBe(200);
    expect(statSync(join(target.vault, 'notes', 'Same.md')).mtimeMs).toBe(second * 1000);
    expect(await excerpt()).toBe('BBBB copy');
  });

  it('refuses while a build reads the files, and a copy larger than the free space', async () => {
    const target = scratch('target');
    fillTarget(target.vault);
    const before = everything(target.vault);
    const busy = await restorer(target.vault, { busy: () => 'A database build is reading the vault’s files.' }).restore(vaultWith());
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe('A database build is reading the vault’s files.');
    const full = await restorer(target.vault, { free: async () => 1024 }).restore(vaultWith(), { 'content-length': String(vaultWith().length) });
    expect(full.status).toBe(507);
    expect((await full.json()).error).toBe('The server does not have enough free space for this copy.');
    expect(everything(target.vault)).toEqual(before);
    expect(leftovers(target.vault)).toEqual([]);
  });

  it('takes a body as a stream, chunk by chunk', async () => {
    const source = scratch('source');
    fillSource(source.vault);
    const copy = await download(source.vault);
    const target = scratch('target');
    // Pieces of 1,000 bytes: never a whole block, never on a boundary.
    const pieces = Readable.toWeb(Readable.from((function* () {
      for (let at = 0; at < copy.length; at += 1000) yield copy.subarray(at, at + 1000);
    })())) as ReadableStream<Uint8Array>;
    expect((await restorer(target.vault).restore(pieces)).status).toBe(200);
    expect(tree(target.vault)).toEqual(tree(source.vault));
  });

  it('is behind the session like every other vault route', async () => {
    const target = scratch('target');
    fillTarget(target.vault);
    const before = everything(target.vault);
    const app = new Hono();
    app.use('/api/*', requireAuth(() => 'a password is set', join(target.vault, 'sessions.json')));
    app.route('/api', restoreApi(target.vault));
    const res = await app.request('/api/storage/restore', { method: 'POST', body: new Uint8Array(vaultWith()) });
    expect(res.status).toBe(401);
    expect((await app.request('/api/storage/restore/keep', { method: 'POST' })).status).toBe(401);
    expect(everything(target.vault)).toEqual(before);
  });
});
