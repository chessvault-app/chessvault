/**
 * The bytes an open of a PDF needs, in one piece.
 *
 * pdf.js reads a document a chunk at a time, and finishes opening it by
 * fetching the LAST page, which walks the page tree. In a scanned book
 * that tree is one flat list of page objects, a few hundred bytes each,
 * spread evenly through the file, and pdf.js fetches them one after
 * another: each object's chunk is asked for only once the previous one
 * has arrived and been parsed. Opening a 448-page, 400 MB scan is 470
 * range requests in a row, so the cold open costs 470 round trips
 * whatever the link's bandwidth (24 s at 40 ms, 62 s over the same link
 * with 256 KB chunks; the bytes were never the problem).
 *
 * The server can find out which chunks an open touches by opening the
 * book itself once, recording the reads, and it hands the reader all of
 * them in one response before pdf.js asks. The reader then answers every
 * one of pdf.js's requests from memory and the open costs one round
 * trip. The recording is a property of the file, so it is kept beside it
 * and rebuilt only when the file changes.
 *
 * The chunk is 1 KB, and the reader and the recording MUST use the same
 * one: pdf.js asks for whole chunks, and a chunk the recording holds only
 * part of would have to be fetched whole anyway. At 1 KB the scan above
 * warms with 0.6 MB (595 chunks); at 8 KB it took 3.9 MB for the same
 * 470 objects. Page turns do not pay for the small chunk: pdf.js groups
 * the chunks a contiguous read needs into one range request, so a page's
 * image is still one request.
 *
 * Layout, little-endian: 'PDFW', u32 version, u32 chunk size, f64 file
 * length, f64 file mtime (the server's cache key; the reader ignores
 * it), u32 count, u32 chunk index × count in ascending order, then each
 * chunk's bytes in that order. The last chunk of the file may be short.
 */
export const PDF_RANGE_CHUNK = 1024;

const MAGIC = 0x57464450; // 'PDFW'
const VERSION = 1;
const HEADER = 4 + 4 + 4 + 8 + 8 + 4;

export type WarmSet = {
  chunk: number;
  length: number;
  mtimeMs: number;
  /** Chunk index → that chunk's bytes. */
  chunks: Map<number, Uint8Array>;
};

export function chunkBytes(chunk: number, length: number, index: number): number {
  return Math.max(0, Math.min(chunk, length - index * chunk));
}

export function encodeWarm(set: WarmSet): Uint8Array {
  const indices = [...set.chunks.keys()].sort((a, b) => a - b);
  let total = HEADER + 4 * indices.length;
  for (const i of indices) total += chunkBytes(set.chunk, set.length, i);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, set.chunk, true);
  view.setFloat64(12, set.length, true);
  view.setFloat64(20, set.mtimeMs, true);
  view.setUint32(28, indices.length, true);
  let at = HEADER;
  for (const i of indices) {
    view.setUint32(at, i, true);
    at += 4;
  }
  for (const i of indices) {
    const bytes = set.chunks.get(i)!;
    const want = chunkBytes(set.chunk, set.length, i);
    if (bytes.length !== want) throw new Error(`chunk ${i} holds ${bytes.length} bytes, expected ${want}`);
    out.set(bytes, at);
    at += want;
  }
  return out;
}

/** Throws on anything that is not a warm set this code wrote. */
export function decodeWarm(buf: Uint8Array): WarmSet {
  if (buf.length < HEADER) throw new Error('warm set truncated');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a warm set');
  if (view.getUint32(4, true) !== VERSION) throw new Error('warm set of another version');
  const chunk = view.getUint32(8, true);
  const length = view.getFloat64(12, true);
  const mtimeMs = view.getFloat64(20, true);
  const count = view.getUint32(28, true);
  if (buf.length < HEADER + 4 * count) throw new Error('warm set truncated');
  const chunks = new Map<number, Uint8Array>();
  let at = HEADER + 4 * count;
  for (let n = 0; n < count; n++) {
    const i = view.getUint32(HEADER + 4 * n, true);
    const want = chunkBytes(chunk, length, i);
    if (at + want > buf.length) throw new Error('warm set truncated');
    chunks.set(i, buf.subarray(at, at + want));
    at += want;
  }
  return { chunk, length, mtimeMs, chunks };
}
