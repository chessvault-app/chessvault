import { Hono } from 'hono';
import { open, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { VAULT } from './paths.ts';

/**
 * A copy of the vault, as one tar file, over the API.
 *
 * The Danger zone has said "back up first" since the first release, and
 * the only way to do it was a shell beside the vault folder, which the
 * phone client does not have and CLAUDE.md does not allow. This is the
 * backup verb: one request, one file, every document and the history
 * git-dir, in a format every OS opens without this app.
 *
 * Tar rather than zip because it needs nothing: a ustar header is 512
 * bytes of fixed fields, so the archive is written here in fifty lines
 * with no dependency, and it streams, so a vault of books never sits in
 * memory. Not compressed: the bulk of a big vault is PDFs, which do not
 * compress, and a tar of plain PGN and markdown is small already.
 *
 * What is left out, deliberately: config.json and sessions.json. The
 * config holds the password hash, the 2FA secret and the Lichess token,
 * and a backup lands in a Downloads folder, on a phone, in a cloud
 * drive; a copy of the documents must not carry the credentials. The
 * card says so. Everything else under the folder goes, dotfiles aside,
 * except `.history.git`, which recovery reads and which the walk names
 * first.
 */

const SKIP_FILES = new Set(['config.json', 'sessions.json']);
const HISTORY = '.history.git';

/** A ustar header for one entry. `name` is the archive path, `/`-joined. */
function header(name: string, size: number, mode: number, mtime: number, type: '0' | '5' | 'L'): Buffer {
  const buf = Buffer.alloc(512);
  const put = (text: string, at: number, len: number): void => {
    buf.write(text.slice(0, len), at, 'latin1');
  };
  const num = (n: number, at: number, len: number): void => {
    put(n.toString(8).padStart(len - 1, '0'), at, len - 1);
  };
  // A name over 100 bytes goes in a GNU long-name entry ahead of the file,
  // read by every tar since the eighties; the header then carries a stub.
  // Written as UTF-8 bytes, not characters: a Korean title is three bytes
  // a letter, and tar knows nothing but bytes.
  Buffer.from(name, 'utf-8').copy(buf, 0, 0, 100);
  num(mode, 100, 8);
  num(0, 108, 8);
  num(0, 116, 8);
  num(size, 124, 12);
  num(Math.floor(mtime / 1000), 136, 12);
  put('        ', 148, 8); // checksum is computed over spaces
  put(type, 156, 1);
  put('ustar', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const byte of buf) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return buf;
}

const pad = (size: number): Buffer => Buffer.alloc((512 - (size % 512)) % 512);

async function* entries(root: string, rel: string[]): AsyncGenerator<Buffer> {
  const dir = resolve(root, ...rel);
  let names: import('node:fs').Dirent[];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  names.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of names) {
    if (rel.length === 0 && entry.name.startsWith('.') && entry.name !== HISTORY) continue;
    if (rel.length === 0 && SKIP_FILES.has(entry.name)) continue;
    const path = [...rel, entry.name];
    const name = path.join('/');
    const full = resolve(root, ...path);
    if (entry.isDirectory()) {
      let mtime = Date.now();
      try {
        mtime = (await stat(full)).mtimeMs;
      } catch {
        continue;
      }
      yield* longName(`${name}/`);
      yield header(`${name}/`, 0, 0o755, mtime, '5');
      yield* entries(root, path);
    } else if (entry.isFile()) {
      let handle: import('node:fs/promises').FileHandle;
      try {
        handle = await open(full, 'r');
      } catch {
        continue;
      }
      try {
        // The size in the header is the size that is written, so it is
        // read from the open handle, not from a stat that a save could
        // have outdated; a file that grows while it is read is cut at
        // the size announced.
        const info = await handle.stat();
        yield* longName(name);
        yield header(name, info.size, 0o644, info.mtimeMs, '0');
        let left = info.size;
        const chunk = Buffer.alloc(Math.min(left, 1 << 16) || 1);
        while (left > 0) {
          const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, left));
          if (bytesRead === 0) {
            yield Buffer.alloc(left);
            break;
          }
          yield Buffer.from(chunk.subarray(0, bytesRead));
          left -= bytesRead;
        }
        yield pad(info.size);
      } finally {
        await handle.close();
      }
    }
  }
}

/** The GNU long-name entry ahead of a header whose name will not fit. */
function* longName(name: string): Generator<Buffer> {
  const bytes = Buffer.from(name, 'utf-8');
  if (bytes.length <= 100) return;
  const body = Buffer.concat([bytes, Buffer.alloc(1)]);
  yield header('././@LongLink', body.length, 0o644, Date.now(), 'L');
  yield body;
  yield pad(body.length);
}

/** The whole archive as a stream: the entries, then two zero blocks. */
export function tarVault(vault: string): Readable {
  const gen = (async function* () {
    yield* entries(vault, []);
    yield Buffer.alloc(1024);
  })();
  return Readable.from(gen);
}

/** The name the file is offered under: the vault's name, else its
    folder's, and the day, so two copies sort themselves. */
export function backupFilename(vault: string, name: string | null, today = new Date()): string {
  const folder = vault.split(/[\\/]/).filter(Boolean).pop() ?? 'vault';
  const base = (name?.trim() || folder).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${base} ${today.toISOString().slice(0, 10)}.tar`;
}

export function backupApi(vault: string = VAULT, vaultName: () => string | null = () => null): Hono {
  const api = new Hono();
  api.get('/storage/backup', (c) => {
    const filename = backupFilename(vault, vaultName());
    const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    c.header('Content-Type', 'application/x-tar');
    // Both forms: the plain one for what cannot read RFC 5987, the
    // encoded one so a Korean vault name survives.
    c.header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    c.header('Cache-Control', 'no-store');
    return c.body(Readable.toWeb(tarVault(vault)) as ReadableStream);
  });
  return api;
}
