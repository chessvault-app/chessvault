/**
 * Reading a tar back, for "Restore from a copy" (server/restore.ts).
 *
 * The reader is the other half of server/backup.ts, and has to take every
 * shape that writer has ever produced, not only today's. There are two:
 *
 *   - Since 0.12.0, a name that is not ASCII or is over 100 bytes travels
 *     in a pax `x` header (a UTF-8 `path` record) ahead of its entry, and
 *     the ustar name field holds an ASCII stand-in.
 *   - Before that, the ustar name field held the name's raw UTF-8 bytes,
 *     cut at 100 (mid-character, for a long Korean title), and a name over
 *     100 bytes came in a GNU `L` entry ahead of the header, its body the
 *     UTF-8 bytes and a NUL. A name of exactly 100 bytes filled the field
 *     with no terminator at all.
 *
 * What GNU tar and bsdtar write is read too (the ustar prefix field, the
 * GNU magic, base-256 sizes, pax `size` and `mtime`), so a copy somebody
 * opened and packed again by hand still comes back. That is a courtesy;
 * the two shapes above are the promise.
 *
 * Everything else is refused, and refused for the whole archive rather
 * than skipped: a copy is the user's data, and a reader that quietly
 * dropped what it did not understand would put back a vault with holes in
 * it and call that a restore. So a checksum that does not add up, a
 * header that does not parse, an archive that ends before its end marker,
 * a link, a device, a FIFO, a sparse file, and any path that could land
 * outside the folder it is unpacked into all throw TarError, and the
 * caller throws the half-unpacked copy away.
 *
 * A path is held to more than "no `..`", because the folder it lands in
 * is on whatever filesystem the server has, and Windows reads a name in
 * ways a tar does not: a backslash is a separator there, a colon names a
 * drive or an alternate data stream (`config.json::$DATA` is the file
 * itself), a trailing dot or space is silently stripped (`config.json.`
 * is `config.json`), and CON, NUL, COM1 and the rest open a device
 * whatever their extension. Each is a way for an archive entry to mean a
 * different file than the one it names, and none is a name this app ever
 * writes (shared/vaultNames.ts refuses all of them), so none is lost by
 * refusing it. A dot-segment (`./studies`) is dropped rather than refused:
 * it is what `tar -cf copy.tar .` writes, and means nothing.
 *
 * Streaming, like the writer: an entry's body is handed over in the
 * chunks it arrived in, so a copy with gigabytes of books in it never sits
 * in memory. Only the metadata bodies (a pax header, a GNU long name) are
 * buffered, and those are capped.
 */

export type TarFault =
  /** The very first block is not a tar header: the file is something else. */
  | 'not-tar'
  /** A header's checksum does not add up. */
  | 'checksum'
  /** A header, or a pax record, does not parse. */
  | 'malformed'
  /** The input ended before the archive's end marker. */
  | 'truncated'
  /** A path that could land outside the folder it is unpacked into. */
  | 'unsafe-path'
  /** An entry that is neither a regular file nor a directory. */
  | 'unsupported-entry';

export class TarError extends Error {
  constructor(
    readonly fault: TarFault,
    message: string,
  ) {
    super(message);
    this.name = 'TarError';
  }
}

export interface TarEntry {
  /** The entry's path, split on `/`, every segment checked (see archivePath). */
  segments: string[];
  type: 'file' | 'directory';
  /** Bytes of body: what the body iterable yields in all. */
  size: number;
  /** When it was last modified, in seconds since the epoch, as recorded. */
  mtime: number;
}

const BLOCK = 512;
/** The largest pax header or GNU long name body read into memory. A path
    is at most a few kilobytes; a megabyte leaves room for the extended
    attributes some writers add, and stops a forged size at that. */
const MAX_META = 1 << 20;

/**
 * The bytes coming in, read as blocks for headers and as chunks for bodies.
 *
 * A body is handed on in the pieces the input arrived in (subarrays, never
 * copied), so a file of any size passes through in constant memory.
 */
class Input {
  private queue: Buffer[] = [];
  private queued = 0;
  private ended = false;

  constructor(private readonly source: AsyncIterator<Uint8Array>) {}

  private async pull(): Promise<boolean> {
    if (this.ended) return false;
    const next = await this.source.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    const chunk = next.value;
    if (chunk.byteLength > 0) {
      this.queue.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      this.queued += chunk.byteLength;
    }
    return true;
  }

  private take(n: number): Buffer {
    const head = this.queue[0]!;
    if (head.length >= n) {
      if (head.length === n) this.queue.shift();
      else this.queue[0] = head.subarray(n);
      this.queued -= n;
      return head.subarray(0, n);
    }
    const out = Buffer.allocUnsafe(n);
    let at = 0;
    while (at < n) {
      const first = this.queue[0]!;
      const part = Math.min(first.length, n - at);
      first.copy(out, at, 0, part);
      at += part;
      if (part === first.length) this.queue.shift();
      else this.queue[0] = first.subarray(part);
    }
    this.queued -= n;
    return out;
  }

  /** Exactly `n` bytes; null when the input ended before any of them. */
  async read(n: number): Promise<Buffer | null> {
    while (this.queued < n && (await this.pull()));
    if (this.queued === 0) return null;
    if (this.queued < n) throw new TarError('truncated', 'the archive ends part way through a block');
    return this.take(n);
  }

  /** Between 1 and `max` bytes, as they come. */
  async chunk(max: number): Promise<Buffer> {
    while (this.queued === 0) {
      if (!(await this.pull())) throw new TarError('truncated', 'the archive ends part way through a file');
    }
    return this.take(Math.min(max, this.queue[0]!.length));
  }

  async skip(n: number): Promise<void> {
    for (let left = n; left > 0; ) left -= (await this.chunk(left)).length;
  }
}

const isZero = (block: Buffer): boolean => block.every((byte) => byte === 0);

const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeName(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new TarError('malformed', 'a name that is not UTF-8');
  }
}

/** A NUL-terminated field, or the whole field when it is full. */
function field(block: Buffer, at: number, length: number): Buffer {
  const slice = block.subarray(at, at + length);
  const nul = slice.indexOf(0);
  return nul < 0 ? slice : slice.subarray(0, nul);
}

/**
 * A numeric field: octal digits padded with NULs or spaces, or, when the
 * first byte has its high bit set, a big-endian base-256 number (GNU's
 * form for a size past 8 GiB). Negative base-256 is refused: no size or
 * time here can be negative.
 */
function numeric(block: Buffer, at: number, length: number): number {
  const first = block[at]!;
  if (first & 0x80) {
    if (first & 0x40) throw new TarError('malformed', 'a negative number in a header');
    let value = first & 0x3f;
    for (let i = at + 1; i < at + length; i += 1) {
      value = value * 256 + block[i]!;
      if (value > Number.MAX_SAFE_INTEGER) throw new TarError('malformed', 'a number too large in a header');
    }
    return value;
  }
  const text = block.toString('latin1', at, at + length).replace(/^[\0 ]+|[\0 ]+$/g, '');
  if (text === '') return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarError('malformed', 'a header number that is not octal');
  return parseInt(text, 8);
}

/** Whether a header's stored checksum matches its bytes. Both the
    unsigned sum POSIX asks for and the signed one some old tars wrote. */
function checksumMatches(block: Buffer): boolean {
  const text = block.toString('latin1', 148, 156).replace(/^[\0 ]+|[\0 ]+$/g, '');
  if (!/^[0-7]+$/.test(text)) return false;
  const stored = parseInt(text, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    const byte = i >= 148 && i < 156 ? 0x20 : block[i]!;
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return stored === unsigned || stored === signed;
}

/**
 * The records of a pax header: `<length> <key>=<value>\n`, the length
 * counting the whole record. An empty value unsets the key (POSIX says
 * so), which matters only in that it must not be read as an empty path.
 */
function paxRecords(body: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (at < body.length) {
    // A writer may pad the body with NULs; nothing after them is a record.
    if (body[at] === 0) break;
    const space = body.indexOf(0x20, at);
    const lengthText = space < 0 ? '' : body.toString('latin1', at, space);
    if (!/^[1-9][0-9]{0,8}$/.test(lengthText)) throw new TarError('malformed', 'a pax record without its length');
    const length = Number(lengthText);
    const end = at + length;
    if (end > body.length || body[end - 1] !== 0x0a) throw new TarError('malformed', 'a pax record of the wrong length');
    const record = body.subarray(space + 1, end - 1);
    const eq = record.indexOf(0x3d);
    if (eq <= 0) throw new TarError('malformed', 'a pax record without a key');
    const key = decodeName(record.subarray(0, eq));
    const value = decodeName(record.subarray(eq + 1));
    if (value === '') out.delete(key);
    else out.set(key, value);
    at = end;
  }
  return out;
}

/** Characters Windows will not take in a name, or reads as something else
    (`\` a separator, `:` a drive or a stream), and control characters. */
const FORBIDDEN = /[\\:*?"<>|\x00-\x1f\x7f]/;
/** Device names Windows opens whatever the extension: `nul.pgn` is NUL. */
const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\.|$)/i;

/**
 * An archive path as segments that cannot leave the folder they are
 * joined under, or TarError('unsafe-path'). The trailing slash a
 * directory carries is not a segment; neither is `.`.
 */
export function archivePath(path: string): string[] {
  if (path.startsWith('/')) throw new TarError('unsafe-path', `an absolute path: ${path}`);
  const parts = path.split('/');
  if (parts.length > 1 && parts.at(-1) === '') parts.pop();
  const segments: string[] = [];
  for (const segment of parts) {
    if (segment === '.') continue;
    if (segment === '') throw new TarError('unsafe-path', `an empty path segment: ${path}`);
    if (segment === '..') throw new TarError('unsafe-path', `a parent-directory segment: ${path}`);
    if (FORBIDDEN.test(segment)) throw new TarError('unsafe-path', `a character no vault name holds: ${path}`);
    if (/[. ]$/.test(segment)) throw new TarError('unsafe-path', `a name ending in a dot or a space: ${path}`);
    if (DEVICE.test(segment)) throw new TarError('unsafe-path', `a device name: ${path}`);
    if (Buffer.byteLength(segment) > 255) throw new TarError('unsafe-path', `a name too long for a filesystem: ${path}`);
    segments.push(segment);
  }
  return segments;
}

/** What each refused type is, for the message. */
const REFUSED_TYPES: Record<string, string> = {
  '1': 'a hard link',
  '2': 'a symbolic link',
  '3': 'a character device',
  '4': 'a block device',
  '6': 'a FIFO',
  '7': 'a contiguous file',
  K: 'a long link name',
  N: 'an old GNU long name',
  S: 'a sparse file',
  V: 'a volume label',
  M: 'a multi-volume continuation',
  D: 'a GNU directory dump',
};

/**
 * Read a tar from `source`, calling `onEntry` for each regular file and
 * directory in order. `body` yields the file's bytes; whatever `onEntry`
 * leaves unread is skipped. Resolves at the end-of-archive marker (two
 * zero blocks, or one followed by the end of the input) and reads
 * nothing after it; throws TarError for anything it will not vouch for.
 */
export async function readTar(
  source: AsyncIterable<Uint8Array>,
  onEntry: (entry: TarEntry, body: AsyncIterable<Buffer>) => Promise<void>,
): Promise<void> {
  const input = new Input(source[Symbol.asyncIterator]());
  /** What an `x` or `L` header said about the entry after it. */
  let extended: { path?: string; size?: number; mtime?: number } | null = null;
  let first = true;

  for (;;) {
    const block = await input.read(BLOCK);
    if (block === null) {
      throw new TarError(first ? 'not-tar' : 'truncated', first ? 'the file is empty' : 'the archive ends before its end marker');
    }
    if (isZero(block)) {
      if (first) throw new TarError('not-tar', 'the file starts with an empty block');
      if (extended) throw new TarError('malformed', 'an extended header with no entry after it');
      const next = await input.read(BLOCK);
      if (next === null || isZero(next)) return;
      throw new TarError('malformed', 'a lone zero block in the middle of the archive');
    }

    const magic = block.toString('latin1', 257, 263);
    const posix = magic === 'ustar\0';
    const gnu = magic === 'ustar ' && block.toString('latin1', 263, 265) === ' \0';
    if (!posix && !gnu) {
      throw new TarError(first ? 'not-tar' : 'malformed', 'a block that is not a ustar header');
    }
    if (!checksumMatches(block)) {
      throw new TarError(first ? 'not-tar' : 'checksum', 'a header whose checksum does not match');
    }
    first = false;

    const type = block[156] === 0 ? '0' : String.fromCharCode(block[156]!);
    const size = numeric(block, 124, 12);
    const padding = (BLOCK - (size % BLOCK)) % BLOCK;

    if (type === 'x' || type === 'g' || type === 'L') {
      if (size > MAX_META) throw new TarError('malformed', 'an extended header too large to be one');
      const body = size === 0 ? Buffer.alloc(0) : await input.read(size);
      if (body === null) throw new TarError('truncated', 'the archive ends inside an extended header');
      await input.skip(padding);
      // A global header describes every entry after it, and the only
      // record that could change what lands where is a path, which a
      // global header cannot sensibly give. It is read past.
      if (type === 'g') continue;
      extended ??= {};
      if (type === 'L') {
        const nul = body.indexOf(0);
        extended.path = decodeName(nul < 0 ? body : body.subarray(0, nul));
        continue;
      }
      const records = paxRecords(body);
      const path = records.get('path');
      if (path !== undefined) extended.path = path;
      const paxSize = records.get('size');
      if (paxSize !== undefined) {
        if (!/^[0-9]{1,16}$/.test(paxSize)) throw new TarError('malformed', 'a pax size that is not a number');
        extended.size = Number(paxSize);
      }
      const paxMtime = records.get('mtime');
      if (paxMtime !== undefined) {
        if (!/^-?[0-9]{1,16}(\.[0-9]*)?$/.test(paxMtime)) throw new TarError('malformed', 'a pax mtime that is not a number');
        extended.mtime = Number(paxMtime);
      }
      continue;
    }

    // The name a header gives, read only when nothing overrides it: the
    // pre-0.12.0 writer cut a long name at 100 bytes, which can split a
    // Korean character, so the field only parses when it is the name.
    const name =
      extended?.path ??
      (() => {
        const short = decodeName(field(block, 0, 100));
        const prefix = posix ? decodeName(field(block, 345, 155)) : '';
        return prefix ? `${prefix}/${short}` : short;
      })();
    const bodySize = extended?.size ?? size;
    const mtime = extended?.mtime ?? numeric(block, 136, 12);
    extended = null;

    if (type !== '0' && type !== '5') {
      throw new TarError('unsupported-entry', `${REFUSED_TYPES[type] ?? `an entry of type ${JSON.stringify(type)}`}: ${name}`);
    }
    // An old convention, still written by some tars: a regular entry
    // whose name ends in a slash is a directory.
    const directory = type === '5' || name.endsWith('/');
    const segments = archivePath(name);
    if (segments.length === 0 && !directory) throw new TarError('unsafe-path', 'a file with no name');

    let left = bodySize;
    const body = (async function* (): AsyncGenerator<Buffer> {
      while (left > 0) {
        const piece = await input.chunk(Math.min(left, 1 << 20));
        left -= piece.length;
        yield piece;
      }
    })();
    if (directory) {
      // A directory carries no bytes worth reading, whatever its size says.
      if (segments.length > 0) {
        await onEntry({ segments, type: 'directory', size: 0, mtime }, (async function* () {})());
      }
    } else {
      await onEntry({ segments, type: 'file', size: bodySize, mtime }, body);
    }
    if (left > 0) await input.skip(left);
    await input.skip((BLOCK - (bodySize % BLOCK)) % BLOCK);
  }
}
