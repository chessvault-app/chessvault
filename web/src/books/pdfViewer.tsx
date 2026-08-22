import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { loadPdfjs, PDF_OPTIONS } from '@/puzzles/ocr/pdfPage';

import { pdfUrl } from './data';

/**
 * The pdf.js half of the book reader: opening a library book by URL and
 * drawing one page of it.
 *
 * By URL, not by bytes: pdf.js asks the server for the ranges a page
 * needs when that page is shown (the server honours Range and says so on
 * the first response), so page 300 of a scanned book costs page 300 and
 * the file is never held whole in a phone's memory. `disableAutoFetch`
 * keeps it from quietly downloading the rest in the background once the
 * first page is up.
 */
export function useBookPdf(
  id: string,
  /** The file's size, which versions its URL; null until the shelf has
      said, so the open waits for it. */
  bytes: number | null,
): {
  doc: PDFDocumentProxy | null;
  error: string | null;
  retry: () => void;
} {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null;
    setDoc(null);
    setError(null);
    if (bytes === null) return;
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (!live) return;
        task = pdfjs.getDocument({
          url: pdfUrl(id, bytes),
          rangeChunkSize: 256 * 1024,
          disableAutoFetch: true,
          ...PDF_OPTIONS,
        });
        const opened = await task.promise;
        if (!live) {
          void task.destroy();
          return;
        }
        setDoc(opened);
      } catch (e) {
        if (live) setError((e as Error).message || 'could not open');
      }
    })();
    return () => {
      live = false;
      void task?.destroy();
    };
  }, [id, bytes, attempt]);
  return { doc, error, retry: () => setAttempt((n) => n + 1) };
}

/**
 * The most pixels one page's canvas may hold. iOS refuses a canvas past
 * about 16.7 M pixels (and a phone has no use for one), so a tall page at
 * a high zoom on a 3× screen is drawn at a lower device ratio instead of
 * not at all.
 */
const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;

/**
 * One page, drawn to fit `width` CSS pixels times `zoom`.
 *
 * The canvas is rendered offscreen and copied over in one step, so a
 * page turn or a zoom never shows a blank frame — the old page stays up
 * until the new one is ready. A render still in flight when the inputs
 * change is cancelled; pdf.js reports that as an exception, which is the
 * expected outcome and not an error. One canvas only: the reader never
 * keeps a hidden page rendered, because on a phone that is the memory
 * that decides whether the tab survives.
 *
 * `overlay` is drawn over the page at the page's own size — the diagram
 * hotspots, positioned in page fractions.
 */
export function PdfPage({
  doc,
  pageNo,
  width,
  zoom,
  overlay,
  onSize,
  className,
}: {
  doc: PDFDocumentProxy;
  pageNo: number;
  width: number;
  zoom: number;
  overlay?: ReactNode;
  /** The page's CSS size once known — the viewport centres a narrow page. */
  onSize?: (size: { w: number; h: number }) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const taskRef = useRef<RenderTask | null>(null);

  useEffect(() => {
    if (width <= 0) return;
    let live = true;
    void (async () => {
      const page = await doc.getPage(pageNo);
      if (!live) return;
      const base = page.getViewport({ scale: 1 });
      const cssW = Math.max(1, Math.round(width * zoom));
      const cssH = Math.max(1, Math.round((base.height / base.width) * cssW));
      let ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (cssW * cssH * ratio * ratio > MAX_CANVAS_PIXELS) {
        ratio = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
      }
      const viewport = page.getViewport({ scale: (cssW * ratio) / base.width });
      const off = document.createElement('canvas');
      off.width = Math.round(viewport.width);
      off.height = Math.round(viewport.height);
      taskRef.current?.cancel();
      const task = page.render({
        canvas: off,
        canvasContext: off.getContext('2d')!,
        viewport,
      });
      taskRef.current = task;
      try {
        await task.promise;
      } catch {
        // Cancelled by a newer render — the expected way out.
        return;
      }
      if (!live) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.getContext('2d')!.drawImage(off, 0, 0);
      setSize({ w: cssW, h: cssH });
      onSize?.({ w: cssW, h: cssH });
    })();
    return () => {
      live = false;
    };
    // onSize is a callback identity the caller may not memoise; the size
    // is reported whenever a render lands, which is what it is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNo, width, zoom]);

  useEffect(() => () => taskRef.current?.cancel(), []);

  return (
    <div
      className={cn('relative', className)}
      style={size ? { width: size.w, height: size.h } : undefined}
    >
      <canvas ref={canvasRef} className="block bg-white shadow-sm" />
      {size && overlay && <div className="absolute inset-0">{overlay}</div>}
    </div>
  );
}
