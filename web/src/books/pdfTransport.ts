/**
 * How the reader feeds pdf.js a library book: from a warm set of the
 * bytes an open needs, fetched in one request, and then by range for
 * whatever else a page asks for.
 *
 * pdf.js's own URL loader would make the open 470 sequential range
 * requests on a big scan (shared/pdfWarm.ts has the arithmetic). Through
 * a `PDFDataRangeTransport` the reader answers each of those from the
 * warm set instead, so the open is one round trip plus the parse. The
 * server records the set by opening the book once; a server that cannot
 * (the demo, a book pdf.js itself cannot read) answers with an error and
 * the reader falls back to fetching every range, which is what it did
 * before.
 */
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { PDF_OPTIONS, type loadPdfjs } from '@/puzzles/ocr/pdfPage';
import { PDF_RANGE_CHUNK, chunkBytes, decodeWarm } from '../../../shared/pdfWarm';

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>;

const RETRIES = 3;

export async function openBookPdf(
  pdfjs: Pdfjs,
  urls: { pdf: string; warm: string },
  signal: AbortSignal,
): Promise<PDFDocumentLoadingTask> {
  let warm: { length: number; chunks: Map<number, Uint8Array> };
  try {
    const res = await fetch(urls.warm, { signal });
    if (!res.ok) throw new Error(String(res.status));
    const set = decodeWarm(new Uint8Array(await res.arrayBuffer()));
    if (set.chunk !== PDF_RANGE_CHUNK || !set.chunks.has(0)) throw new Error('unusable warm set');
    warm = set;
  } catch (e) {
    if (signal.aborted) throw e;
    // No recording: the first chunk alone, and its content-range for the
    // length, which is what pdf.js's own loader starts from.
    const res = await fetch(urls.pdf, { headers: { range: `bytes=0-${PDF_RANGE_CHUNK - 1}` }, signal });
    const total = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1];
    if (res.status !== 206 || !total) throw new Error(`could not open (${res.status})`);
    warm = { length: Number(total), chunks: new Map([[0, new Uint8Array(await res.arrayBuffer())]]) };
  }
  const { length, chunks } = warm;

  class Transport extends pdfjs.PDFDataRangeTransport {
    override requestDataRange(begin: number, end: number): void {
      end = Math.min(end, length);
      const first = Math.floor(begin / PDF_RANGE_CHUNK);
      const parts: Uint8Array[] = [];
      for (let i = first; i * PDF_RANGE_CHUNK < end; i++) {
        const c = chunks.get(i);
        if (!c || c.length !== chunkBytes(PDF_RANGE_CHUNK, length, i)) {
          parts.length = 0;
          break;
        }
        parts.push(c);
      }
      if (parts.length) {
        // From memory, but not inside the call: pdf.js expects an answer
        // the way a network gives one.
        const out = new Uint8Array(end - begin);
        let at = 0;
        for (const p of parts) {
          out.set(p, at);
          at += p.length;
        }
        queueMicrotask(() => this.onDataRange(begin, out.subarray(0, end - begin)));
        return;
      }
      void this.fetchRange(begin, end);
    }
    private async fetchRange(begin: number, end: number): Promise<void> {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(urls.pdf, { headers: { range: `bytes=${begin}-${end - 1}` }, signal });
          if (res.status !== 206) throw new Error(`range answered ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.length !== end - begin) throw new Error('short range');
          this.onDataRange(begin, bytes);
          return;
        } catch (e) {
          // pdf.js has no channel for a failed range; a read that never
          // lands leaves that page's spinner up, which is the same as the
          // URL loader's behaviour on a lost connection. A few tries
          // first, since a phone's link drops and comes back.
          if (signal.aborted || attempt >= RETRIES) return;
          await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
          if (signal.aborted) return;
          void e;
        }
      }
    }
  }

  return pdfjs.getDocument({
    // A copy: pdf.js transfers the initial data to its worker, which
    // leaves the caller's array empty, and chunk 0 is asked for again.
    range: new Transport(length, chunks.get(0)!.slice()),
    rangeChunkSize: PDF_RANGE_CHUNK,
    disableAutoFetch: true,
    ...PDF_OPTIONS,
  });
}
