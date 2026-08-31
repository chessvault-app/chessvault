/**
 * A synchronous in-memory filesystem, shaped like the parts of `node:fs`
 * the vault routes use.
 *
 * The static demo runs the REAL server route modules in the browser: the
 * demo build aliases `node:fs` to this file, so `server/studies.ts` is the
 * same code answering the same requests, with its bytes in a Map instead of
 * on a disk. That is the whole point — a demo built from a second
 * implementation of the vault API would agree with the app today and lie
 * about it in a month.
 *
 * Nothing persists. A visitor may rename, annotate and delete freely; a
 * reload brings the seed back. That is the entire storage design, and it is
 * why the demo needs no quotas, no reset timer and no server to attack.
 */

interface Entry {
  /** Directories hold no bytes; files hold exactly these. */
  content?: string;
  /**
   * A file that is not text.
   *
   * The vault is PGN, markdown and JSON, so this shim stored strings and
   * nothing else — and that is why a book puzzle in the demo could not
   * carry the page it was printed on. An evidence image is read with
   * `new Uint8Array(readFileSync(path))`, and a string put through that
   * comes out empty: a broken image rather than an error, which is the
   * worst way for it to fail. Bytes now go in and come back out as bytes.
   */
  bytes?: Uint8Array;
  mtimeMs: number;
}

const files = new Map<string, Entry>();

/** Posix-normalise: the shim works in one separator and knows no drives. */
function norm(path: string): string {
  const parts: string[] = [];
  for (const segment of String(path).split(/[\\/]+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return `/${parts.join('/')}`;
}

const parentOf = (path: string): string => norm(path).split('/').slice(0, -1).join('/') || '/';

export function seedFile(path: string, content: string, mtimeMs: number): void {
  const key = norm(path);
  makeParents(key, mtimeMs);
  files.set(key, { content, mtimeMs });
}

/** The same, for a file that is not text — see `Entry.bytes`. */
export function seedBytes(path: string, bytes: Uint8Array, mtimeMs: number): void {
  const key = norm(path);
  makeParents(key, mtimeMs);
  files.set(key, { bytes, mtimeMs });
}

function makeParents(key: string, mtimeMs: number): void {
  for (let dir = parentOf(key); dir !== '/' && !files.has(dir); dir = parentOf(dir)) {
    files.set(dir, { mtimeMs });
  }
}

export function existsSync(path: string): boolean {
  return files.has(norm(path));
}

export function mkdirSync(path: string, _options?: unknown): void {
  const key = norm(path);
  const now = Date.now();
  const segments = key.split('/').filter(Boolean);
  let at = '';
  for (const segment of segments) {
    at += `/${segment}`;
    if (!files.has(at)) files.set(at, { mtimeMs: now });
  }
}

/**
 * Node returns a Buffer when no encoding is given and a string when one
 * is, and this follows that for the files it has bytes for: the routes
 * that read an image ask for no encoding, and every route that reads a
 * document asks for utf-8.
 */
export function readFileSync(path: string, encoding?: unknown): string {
  const entry = files.get(norm(path));
  if (entry?.bytes !== undefined && !encoding) {
    return entry.bytes as unknown as string;
  }
  if (entry?.content === undefined) {
    const error = new Error(`ENOENT: no such file, open '${path}'`) as Error & { code: string };
    error.code = 'ENOENT';
    throw error;
  }
  return entry.content;
}

export function writeFileSync(path: string, content: string, _options?: unknown): void {
  mkdirSync(parentOf(path));
  files.set(norm(path), { content: String(content), mtimeMs: Date.now() });
}

export function readdirSync(
  path: string,
  options?: { recursive?: boolean; withFileTypes?: boolean },
): unknown[] {
  const base = norm(path);
  const prefix = base === '/' ? '/' : `${base}/`;
  const names = new Set<string>();
  for (const key of files.keys()) {
    if (!key.startsWith(prefix) || key === base) continue;
    const rest = key.slice(prefix.length);
    names.add(options?.recursive ? rest : rest.split('/')[0]!);
  }
  const sorted = [...names].sort();
  if (!options?.withFileTypes) return sorted;
  return sorted.map((name) => {
    const entry = files.get(norm(`${prefix}${name}`));
    return {
      name,
      isFile: () => entry?.content !== undefined || entry?.bytes !== undefined,
      isDirectory: () =>
        entry !== undefined && entry.content === undefined && entry.bytes === undefined,
    };
  });
}

export function statSync(path: string): {
  isFile: () => boolean;
  isDirectory: () => boolean;
  size: number;
  mtime: Date;
  mtimeMs: number;
} {
  const key = norm(path);
  const entry = files.get(key);
  if (!entry) {
    const error = new Error(`ENOENT: no such file, stat '${path}'`) as Error & { code: string };
    error.code = 'ENOENT';
    throw error;
  }
  return {
    isFile: () => entry.content !== undefined || entry.bytes !== undefined,
    isDirectory: () => entry.content === undefined && entry.bytes === undefined,
    // Bytes, not characters: a multi-byte comment must not under-report.
    size:
      entry.bytes?.byteLength ??
      (entry.content === undefined ? 0 : new TextEncoder().encode(entry.content).length),
    mtime: new Date(entry.mtimeMs),
    mtimeMs: entry.mtimeMs,
  };
}

export function renameSync(from: string, to: string): void {
  const source = norm(from);
  const target = norm(to);
  // A directory rename has to drag its contents, exactly as a real one does.
  for (const [key, entry] of [...files]) {
    if (key !== source && !key.startsWith(`${source}/`)) continue;
    files.delete(key);
    files.set(target + key.slice(source.length), entry);
  }
}

export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
  const key = norm(path);
  if (!files.has(key) && !options?.force) {
    const error = new Error(`ENOENT: no such file, unlink '${path}'`) as Error & { code: string };
    error.code = 'ENOENT';
    throw error;
  }
  for (const existing of [...files.keys()]) {
    if (existing === key || existing.startsWith(`${key}/`)) files.delete(existing);
  }
}

export function rmdirSync(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function unlinkSync(path: string): void {
  rmSync(path);
}

export function appendFileSync(path: string, content: string): void {
  const key = norm(path);
  const existing = files.get(key)?.content ?? '';
  files.set(key, { content: existing + String(content), mtimeMs: Date.now() });
}

export function copyFileSync(from: string, to: string): void {
  writeFileSync(to, readFileSync(from));
}

/**
 * Descriptors, for the one route that reads a file's HEAD rather than all
 * of it.
 *
 * The shelf listings show each document a preview — a first sentence, or
 * the position its first chapter opens on — and reading whole files to
 * build a listing would make the listing cost whatever the longest note
 * happens to be. So `server/studies.ts` opens, reads PREVIEW_BYTES, and
 * closes, and the demo has to answer that the same way: it is the real
 * route module running in the browser, not a second implementation of it.
 *
 * A number handed back and looked up in a Map is the whole of it. Nothing
 * here is concurrent, so the table can never grow beyond the one
 * descriptor a preview holds for the length of a try/finally.
 */
const encoder = new TextEncoder();
const openFds = new Map<number, string>();
// 0, 1 and 2 belong to the standard streams on a real system; starting
// above them keeps a stray 0 from ever looking like a valid descriptor.
let nextFd = 3;

export function openSync(path: string, _flags?: string): number {
  const key = norm(path);
  const entry = files.get(key);
  if (!entry || entry.content === undefined) {
    const error = new Error(`ENOENT: no such file, open '${path}'`) as Error & { code?: string };
    error.code = 'ENOENT';
    throw error;
  }
  const fd = nextFd++;
  openFds.set(fd, key);
  return fd;
}

/** Bytes, not characters — the caller asked for a byte window. */
export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset = 0,
  length = buffer.length,
  position = 0,
): number {
  const key = openFds.get(fd);
  if (key === undefined) {
    const error = new Error('EBADF: bad file descriptor, read') as Error & { code?: string };
    error.code = 'EBADF';
    throw error;
  }
  const bytes = encoder.encode(files.get(key)?.content ?? '');
  const from = position ?? 0;
  const count = Math.max(0, Math.min(length, bytes.length - from));
  if (count > 0) buffer.set(bytes.subarray(from, from + count), offset);
  return count;
}

export function closeSync(fd: number): void {
  openFds.delete(fd);
}

export default {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  renameSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  appendFileSync,
  copyFileSync,
  openSync,
  readSync,
  closeSync,
};
