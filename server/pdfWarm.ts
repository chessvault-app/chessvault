/**
 * The recording of which bytes opening a book needs (shared/pdfWarm.ts
 * says why): made by opening the file with pdf.js here, once, through a
 * transport that reads from disk and notes every chunk it was asked for.
 *
 * Kept beside the book as `open.bin`, keyed on the file's length and
 * mtime, so a replaced PDF is recorded again on its next open and an
 * unchanged one never is. Two readers opening a book that has no
 * recording yet share one build.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { renameRetrying } from './atomic.ts';
import { PDF_RANGE_CHUNK, chunkBytes, decodeWarm, encodeWarm } from '../shared/pdfWarm.ts';

const building = new Map<string, Promise<Uint8Array>>();

export async function warmSet(pdfPath: string, cachePath: string): Promise<Uint8Array> {
  const stat = statSync(pdfPath);
  if (existsSync(cachePath)) {
    try {
      const bytes = readFileSync(cachePath);
      const head = decodeWarm(bytes);
      if (head.length === stat.size && head.mtimeMs === stat.mtimeMs && head.chunk === PDF_RANGE_CHUNK) {
        return bytes;
      }
    } catch {
      // Not a recording this code wrote: made again below.
    }
  }
  let job = building.get(cachePath);
  if (!job) {
    job = record(pdfPath, stat.size, stat.mtimeMs)
      .then((bytes) => {
        const tmp = `${cachePath}.tmp`;
        writeFileSync(tmp, bytes);
        renameRetrying(tmp, cachePath);
        return bytes;
      })
      .finally(() => building.delete(cachePath));
    building.set(cachePath, job);
  }
  return job;
}

async function record(pdfPath: string, length: number, mtimeMs: number): Promise<Uint8Array> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const fd = openSync(pdfPath, 'r');
  const chunks = new Map<number, Uint8Array>();
  const read = (begin: number, end: number): Uint8Array => {
    const out = new Uint8Array(end - begin);
    let got = 0;
    while (got < out.length) {
      const n = readSync(fd, out, got, out.length - got, begin + got);
      if (n <= 0) break;
      got += n;
    }
    return out;
  };
  const take = (index: number): void => {
    if (chunks.has(index)) return;
    const begin = index * PDF_RANGE_CHUNK;
    chunks.set(index, read(begin, begin + chunkBytes(PDF_RANGE_CHUNK, length, index)));
  };
  class Recorder extends pdfjs.PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      for (let i = Math.floor(begin / PDF_RANGE_CHUNK); i * PDF_RANGE_CHUNK < end; i++) take(i);
      // Asynchronously, as a network answer would be; pdf.js does not
      // expect the data inside the call.
      queueMicrotask(() => this.onDataRange(begin, read(begin, Math.min(end, length))));
    }
  }
  try {
    take(0);
    // A copy: pdf.js transfers the initial data to its worker, which
    // leaves the caller's array empty.
    const transport = new Recorder(length, chunks.get(0)!.slice());
    const task = pdfjs.getDocument({
      range: transport,
      rangeChunkSize: PDF_RANGE_CHUNK,
      disableAutoFetch: true,
      useWasm: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    });
    try {
      const doc = await task.promise;
      // What the reader asks for on the frame it opens, beyond the open
      // itself: the first and last pages' dictionaries and the outline.
      await doc.getPage(1);
      await doc.getPage(doc.numPages);
      await doc.getOutline().catch(() => null);
    } finally {
      await task.destroy();
    }
  } finally {
    closeSync(fd);
  }
  return encodeWarm({ chunk: PDF_RANGE_CHUNK, length, mtimeMs, chunks });
}
