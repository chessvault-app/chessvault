import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DiagramRect } from './data';

/**
 * Text search over an open PDF.
 *
 * pdf.js hands back each page's text as positioned runs; a query is
 * matched case-insensitively against each page's runs joined in order,
 * and every hit becomes a box on the page (the run's box, cut down to
 * the matched characters by proportion — good to a glyph or so, which
 * is what a highlight needs). Pages are read one at a time, in order,
 * and hits arrive as they are found, so a long book shows its first
 * matches while the rest is still being read. A scanned book with no
 * text layer finds nothing, and says so.
 *
 * Boxes are fractions of the unrotated page, like the diagram rects, so
 * the reader rotates them with everything else.
 */

export interface SearchHit {
  page: number;
  /** The matched text's boxes on the page — one per run it spans. */
  rects: DiagramRect[];
}

export interface PdfSearch {
  query: string;
  hits: SearchHit[];
  /** Index into `hits` of the hit being shown, or -1. */
  current: number;
  /** The page being read while a search runs; null when idle. */
  scanning: number | null;
  run: (query: string) => void;
  clear: () => void;
  next: () => void;
  prev: () => void;
  /** Hits on one page, for its highlight layer. */
  onPage: (page: number) => SearchHit[];
}

export function usePdfSearch(
  doc: PDFDocumentProxy | null,
  /** Called with the page to show when the current hit changes. */
  onJump: (page: number) => void,
): PdfSearch {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [current, setCurrent] = useState(-1);
  const [scanning, setScanning] = useState<number | null>(null);
  // A newer search cancels the one running.
  const token = useRef(0);

  useEffect(() => {
    token.current += 1;
    setHits([]);
    setCurrent(-1);
    setScanning(null);
  }, [doc]);

  const run = useCallback(
    (q: string) => {
      const needle = q.trim().toLowerCase();
      setQuery(q);
      setHits([]);
      setCurrent(-1);
      const mine = ++token.current;
      if (!doc || !needle) {
        setScanning(null);
        return;
      }
      void (async () => {
        const found: SearchHit[] = [];
        let jumped = false;
        for (let n = 1; n <= doc.numPages; n++) {
          if (token.current !== mine) return;
          setScanning(n);
          let pageHits: SearchHit[] = [];
          try {
            pageHits = await searchPage(doc, n, needle);
          } catch {
            pageHits = [];
          }
          if (token.current !== mine) return;
          if (pageHits.length > 0) {
            found.push(...pageHits);
            setHits([...found]);
            if (!jumped) {
              jumped = true;
              setCurrent(0);
              onJump(pageHits[0]!.page);
            }
          }
          // Let the page paint between reads; a text layer is quick, but
          // three hundred of them back to back would hold the main thread.
          await new Promise((r) => setTimeout(r, 0));
        }
        if (token.current === mine) setScanning(null);
      })();
    },
    [doc, onJump],
  );

  const clear = useCallback(() => {
    token.current += 1;
    setQuery('');
    setHits([]);
    setCurrent(-1);
    setScanning(null);
  }, []);

  const step = (delta: number): void => {
    if (hits.length === 0) return;
    const i = (current + delta + hits.length) % hits.length;
    setCurrent(i);
    onJump(hits[i]!.page);
  };

  return {
    query,
    hits,
    current,
    scanning,
    run,
    clear,
    next: () => step(1),
    prev: () => step(-1),
    onPage: (page) => hits.filter((h) => h.page === page),
  };
}

interface Run {
  str: string;
  /** Box in unrotated viewport px at scale 1. */
  box: [number, number, number, number];
}

async function searchPage(doc: PDFDocumentProxy, n: number, needle: string): Promise<SearchHit[]> {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const runs: Run[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const [a, b, c, d, e, f] = item.transform as number[];
    // The run's box in user space: origin at the baseline, the font's
    // height above it, the advance to the right — through the run's own
    // transform for rotated or sheared text.
    const w = item.width;
    const h = item.height;
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ].map(([x, y]) => viewport.convertToViewportPoint(a! * x! + c! * y! + e!, b! * x! + d! * y! + f!));
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    runs.push({ str: item.str, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
  // Runs joined with a space between: pdf.js splits at line and word
  // boundaries, and a query that crosses one should still match.
  let text = '';
  const starts: number[] = [];
  for (const r of runs) {
    starts.push(text.length);
    text += r.str + ' ';
  }
  const hay = text.toLowerCase();
  const hits: SearchHit[] = [];
  let at = hay.indexOf(needle);
  while (at >= 0) {
    const end = at + needle.length;
    const rects: DiagramRect[] = [];
    for (let i = 0; i < runs.length; i++) {
      const s = starts[i]!;
      const len = runs[i]!.str.length;
      const e = s + len;
      if (e <= at || s >= end) continue;
      const from = Math.max(0, at - s) / Math.max(1, len);
      const to = Math.min(len, end - s) / Math.max(1, len);
      const [x1, y1, x2, y2] = runs[i]!.box;
      const bw = x2 - x1;
      rects.push({
        x: (x1 + bw * from) / viewport.width,
        y: y1 / viewport.height,
        w: (bw * (to - from)) / viewport.width,
        h: (y2 - y1) / viewport.height,
      });
    }
    if (rects.length > 0) hits.push({ page: n, rects });
    at = hay.indexOf(needle, end);
  }
  return hits;
}
