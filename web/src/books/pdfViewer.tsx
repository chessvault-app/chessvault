import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { Spinner } from '@/components/ui/spinner';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useSlowLoad } from '@/components/skeletons';

import type { PinchLive, PinchPoint } from '@/hooks/use-pinch-zoom';
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
export type Rotation = 0 | 90 | 180 | 270;

export function PdfPage({
  doc,
  pageNo,
  width,
  zoom,
  rotation = 0,
  overlay,
  onSize,
  className,
}: {
  doc: PDFDocumentProxy;
  pageNo: number;
  width: number;
  zoom: number;
  rotation?: Rotation;
  overlay?: ReactNode;
  /** The page's CSS size once known — the viewport centres a narrow page. */
  onSize?: (size: { w: number; h: number }) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  /**
   * The page's shape at rotation 0, learned from the first raster. It is
   * what lets a zoom change resize the box SYNCHRONOUSLY: the old bitmap
   * stretches to the new size for the beat until the fresh raster lands,
   * instead of sitting at its old size inside the new layout — which read
   * as a flicker every time a pinch was released. A rotation only flips
   * it, so the box is right through a turn as well.
   */
  const [aspect0, setAspect0] = useState<number | null>(null);
  const taskRef = useRef<RenderTask | null>(null);
  // A page that is slow to arrive — the first of a book over a slow link,
  // a heavy scan — shows a spinner in its slot rather than a blank.
  const slow = useSlowLoad(size === null);

  useEffect(() => {
    if (width <= 0) return;
    let live = true;
    // A beat before rendering: a page that scrolls past in a flick is
    // mounted and unmounted inside this, and never costs a raster.
    const timer = setTimeout(() => void (async () => {
      const page = await doc.getPage(pageNo);
      if (!live) return;
      const base = page.getViewport({ scale: 1, rotation });
      const cssW = Math.max(1, Math.round(width * zoom));
      const cssH = Math.max(1, Math.round((base.height / base.width) * cssW));
      // Device pixels: up to 2× on a fine pointer, 1.5× on a touch screen —
      // a scan at a phone's width is legible at 1.5× and the raster is
      // half the pixels of 2×, which is what scrolling waits on.
      const coarse = matchMedia('(pointer: coarse)').matches;
      let ratio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      if (cssW * cssH * ratio * ratio > MAX_CANVAS_PIXELS) {
        ratio = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
      }
      const viewport = page.getViewport({ scale: (cssW * ratio) / base.width, rotation });
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
      canvas.getContext('2d')!.drawImage(off, 0, 0);
      setAspect0(rotation % 180 === 0 ? cssH / cssW : cssW / cssH);
      setSize({ w: cssW, h: cssH });
      onSize?.({ w: cssW, h: cssH });
    })(), 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // onSize is a callback identity the caller may not memoise; the size
    // is reported whenever a render lands, which is what it is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNo, width, zoom, rotation]);

  useEffect(() => () => taskRef.current?.cancel(), []);

  // The box, from this render's own width and zoom — not from the raster,
  // which is a beat behind them.
  const cssW = Math.max(1, Math.round(width * zoom));
  const aspect = aspect0 === null ? null : rotation % 180 === 0 ? aspect0 : 1 / aspect0;
  const box = aspect !== null ? { w: cssW, h: Math.max(1, Math.round(cssW * aspect)) } : size;

  return (
    <div
      className={cn('relative', !box && 'h-full', className)}
      style={box ? { width: box.w, height: box.h } : undefined}
    >
      {/* translateZ(0): the canvas keeps its OWN compositor layer, and a
          released pinch becomes layer geometry — the existing GPU texture
          moved and stretched — instead of a re-raster of the column's
          tiles. Without it, iOS destroyed the pinch preview's layer and
          re-tiled every visible page in the same frame the layout
          changed, and any tile not ready by the next frame painted as
          WebKit's blank white: the release flash lanph3re saw on the
          phone, invisible in Chromium, which reuses canvas textures
          across relayout on its own. */}
      <canvas
        ref={canvasRef}
        className={cn(
          'block h-full w-full bg-white shadow-sm [transform:translateZ(0)]',
          !size && 'invisible',
        )}
      />
      {!size && slow && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="text-muted-foreground size-5" />
        </div>
      )}
      {box && overlay && <div className="absolute inset-0">{overlay}</div>}
    </div>
  );
}

/** Space between pages in the scroller, in CSS px. */
const PAGE_GAP = 12;
/** Pages kept rendered either side of the visible ones. */
const RENDER_MARGIN = 1;

/**
 * The whole book as one scrolling column, the way a PDF reader scrolls:
 * every page has its slot at its own height, and only the slots in and
 * just around the viewport hold a rendered canvas — the rest are blank
 * boxes of the right size, so a 600-page scan costs three pages of
 * memory and a scrollbar that tells the truth.
 *
 * Heights come from the pages' own shapes: the first page's on open, each
 * page's own once it has rendered. The page "being read" is the slot
 * under the top third of the viewport; the caller hears of it as it
 * changes, and can ask for a page, which scrolls the slot into place. A
 * zoom keeps the point of the page under the fingers — or, from a button,
 * under the viewport's centre — where it was; it used to put the page
 * being read back at the top, which made every zoom a jump.
 */
export function PdfScroller({
  doc,
  pages,
  width,
  zoom,
  rotation = 0,
  pageNo,
  onPageChange,
  overlayFor,
  onPainted,
  viewportRef,
  zoomAnchor,
  pinch = null,
  onKeyDown,
  className,
}: {
  doc: PDFDocumentProxy;
  pages: number;
  /** The page's width at zoom 1. */
  width: number;
  zoom: number;
  rotation?: Rotation;
  /** The page the reader wants shown; a change scrolls there. */
  pageNo: number;
  /** The page under the reader's eyes changed by scrolling. */
  onPageChange: (page: number) => void;
  /** The hotspot layer for a rendered page. */
  overlayFor: (page: number) => ReactNode;
  /** A page's raster landed — any page, every time; the caller keeps the
      "first paint" bit itself. The opening treatment stays up until then. */
  onPainted?: () => void;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Where the next zoom change should hold still, relative to the
      viewport — with the scroll offsets AS THEY WERE when the zoom was
      asked for, captured before the relayout: a zoom out shrinks the
      column, and the browser clamps a scrollTop past the new end the
      moment the style lands, before any effect can read it. Read and
      cleared when the zoom changes. Null: the centre, current offsets. */
  zoomAnchor?: React.RefObject<(PinchPoint & { top?: number; left?: number }) | null>;
  /** A pinch under way: the column is scaled about its centre by CSS,
      and nothing is re-rastered until the zoom itself changes. */
  pinch?: PinchLive | null;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  const [aspects, setAspects] = useState<Map<number, number>>(() => new Map());
  const [baseAspect, setBaseAspect] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    // A rotation turns every page's shape: the measured ones are forgotten
    // and the first page's is read again the new way round.
    setAspects(new Map());
    setBaseAspect(null);
    void doc.getPage(1).then((p) => {
      if (!live) return;
      const v = p.getViewport({ scale: 1, rotation });
      setBaseAspect(v.height / v.width);
    });
    return () => {
      live = false;
    };
  }, [doc, rotation]);

  const pageW = Math.max(1, Math.round(width * zoom));
  // The column's geometry at a given page width — the current one for the
  // render, an old one for the zoom anchor below, which needs to know
  // where a point WAS to keep it still. O(pages) per call; a
  // thousand-page book is a thousand additions.
  const layoutFor = (w: number): { tops: number[]; heightOf: (n: number) => number } => {
    const heightOf = (n: number): number => Math.round(w * (aspects.get(n) ?? baseAspect ?? 1.4142));
    const tops: number[] = [];
    let acc = PAGE_GAP;
    for (let n = 1; n <= pages; n++) {
      tops.push(acc);
      acc += heightOf(n) + PAGE_GAP;
    }
    tops.push(acc);
    return { tops, heightOf };
  };
  const { tops, heightOf } = layoutFor(pageW);
  const total = tops[pages] ?? PAGE_GAP;

  // What the viewport shows, re-read on scroll and when the layout changes.
  const [view, setView] = useState({ top: 0, height: 0 });
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let frame = 0;
    const read = (): void => {
      frame = 0;
      setView({ top: el.scrollTop, height: el.clientHeight });
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    read();
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [viewportRef]);

  const slotAt = (y: number): number => {
    // First slot whose bottom is below y.
    let lo = 0;
    let hi = pages - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid]! + heightOf(mid + 1) < y) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  // `view` is the scroll reader's last word — which, on the render that
  // IS the zoom commit, is from before the relayout, while the tops it is
  // about to be compared against are the new layout's. Deep in a book
  // that maps to the WRONG pages: the slot under the eyes fell out of the
  // rendered range for one commit, its PdfPage unmounted with its bitmap,
  // and the layout effect's corrected offsets then remounted it as a
  // fresh component that sat dark for the 120 ms raster delay plus the
  // raster — the released pinch's page-long flicker (lanph3re's clip;
  // reproduced at 40% of a 126-page book, where the canvas after release
  // was a new node). Scaling the stale offset by the layout's own growth
  // keeps the range on the same pages through the commit — approximately,
  // since the page gaps do not scale, which RENDER_MARGIN absorbs. After
  // the commit's layout effects run, lastPageW is current and this is
  // exactly view.top again.
  // (Declared here rather than beside lastZoom below: this render reads it.)
  const lastPageW = useRef(pageW);
  const staleness = pageW / lastPageW.current;
  const viewTop = view.top * staleness;
  const first = pages > 0 ? slotAt(viewTop) : 1;
  const last = pages > 0 ? slotAt(viewTop + view.height) : 1;
  const current = pages > 0 ? slotAt(viewTop + view.height * 0.35) : 1;

  // Tell the reader where it is — once per change, and never for a page
  // the reader itself just asked for.
  // The page the reader is known to be on, and the page it has asked for
  // but not yet reached. Scrolling to a slot can be refused while the
  // column is still short (pages sized by a guess, slots not yet laid
  // out) — so a request stays pending, is re-issued every render, and is
  // only done when the viewport actually sits on it. Until then nothing
  // the scroll reader sees is believed: a fresh viewport says "page 1"
  // before it has been moved anywhere.
  const reported = useRef<number | null>(null);
  const target = useRef<number | null>(pageNo > 0 ? pageNo : null);
  useEffect(() => {
    if (pageNo > 0 && pageNo !== reported.current) target.current = pageNo;
  }, [pageNo]);
  // The first page's real shape, or a zoom: the page being read keeps its
  // place, which means asking for it again at its new offset.
  useEffect(() => {
    if (baseAspect !== null && reported.current !== null) target.current = reported.current;
  }, [baseAspect]);
  const lastZoom = useRef(zoom);
  // Before paint (layout effect): done after it, the browser showed one
  // frame at the new size but the old scroll offset — half the released
  // pinch's flicker.
  useLayoutEffect(() => {
    if (lastZoom.current === zoom) return;
    const ratio = zoom / lastZoom.current;
    lastZoom.current = zoom;
    const el = viewportRef.current;
    if (!el) return;
    // The column's slots are laid out at the new size by now. The point
    // that was under the anchor is mapped through the SLOTS, not scaled
    // wholesale: the gaps between pages do not scale with the zoom, and
    // a plain ratio moves a point deep in a book by every gap above it —
    // page 114 sits above 1,300 px of gaps, and a zoom there jumped the
    // page by a few hundred pixels (the zoom-out flicker; zoom-in jumped
    // too, into pages already on screen, which read as less wrong).
    // While a page is still being asked for, that wins.
    if (target.current !== null) return;
    const a = zoomAnchor?.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    if (zoomAnchor) zoomAnchor.current = null;
    const oldTop = a.top ?? el.scrollTop;
    const oldLeft = a.left ?? el.scrollLeft;
    // The width the old layout was actually built with — REMEMBERED, not
    // reconstructed from the ratio: rounding `pageW / ratio` was 1 px off
    // as often as not, and a 1 px width error compounds through every
    // slot's height above the anchor — ~1.4 px a page, a triple-digit
    // jump deep in a book, and exactly the zoom-out flicker that survived
    // the first fix (zoom-in tended to land on the same rounding).
    const old = layoutFor(lastPageW.current);
    const oldY = oldTop + a.y;
    // The slot the point was in, and how far through. The page scales,
    // the 12 px gap under it does not — mapped as one span the gap's
    // share skews the fraction, by more the smaller the page gets, which
    // was the last of the zoom-out drift.
    let n = 1;
    while (n < pages && (old.tops[n] ?? Infinity) <= oldY) n++;
    const into = oldY - (old.tops[n - 1] ?? 0);
    const oldH = old.heightOf(n);
    const newInto = into <= oldH ? (into / oldH) * heightOf(n) : heightOf(n) + (into - oldH);
    el.scrollTop = (tops[n - 1] ?? 0) + newInto - a.y;
    el.scrollLeft = (oldLeft + a.x) * ratio - a.x;
    // The pages the smaller layout now shows were not all mounted at the
    // old zoom — a zoom OUT uncovers slots that would sit blank until the
    // scroll listener's next frame. Re-read the viewport now, before
    // paint, so they mount in this same commit.
    setView({ top: el.scrollTop, height: el.clientHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);
  // After the anchor has used it: what this render laid out with.
  useLayoutEffect(() => {
    lastPageW.current = pageW;
  });
  // A rotation too: every slot changes height, and the page being read
  // must be asked for again at its new offset before the scroll reader
  // gets a word in.
  const lastRotation = useRef(rotation);
  useEffect(() => {
    if (lastRotation.current === rotation) return;
    lastRotation.current = rotation;
    if (reported.current !== null) target.current = reported.current;
  }, [rotation]);
  useEffect(() => {
    const p = target.current;
    const el = viewportRef.current;
    if (p === null || !el || pages === 0) return;
    // The page's own edge at the viewport's top: the viewport starts on
    // the board's line beside it (see the reader's toolbar), so a page
    // turned to shares the board's top edge.
    const top = tops[p - 1] ?? 0;
    el.scrollTo({ top });
    const reachable = top <= el.scrollHeight - el.clientHeight + 1;
    if (reachable && Math.abs(el.scrollTop - top) < 2) {
      target.current = null;
      reported.current = p;
    }
  });
  useEffect(() => {
    if (view.height === 0 || target.current !== null) return;
    // From the element, not from the render's `view`: the effect above may
    // have just scrolled this commit (a page re-asked for after a zoom or
    // a turn), and the render's position is the one from before it.
    const el = viewportRef.current;
    const live = el ? slotAt(el.scrollTop + el.clientHeight * 0.35) : current;
    if (reported.current !== null && live !== reported.current) {
      reported.current = live;
      onPageChange(live);
    }
    // onPageChange is a setter; the page is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, view.height]);

  const from = Math.max(1, first - RENDER_MARGIN);
  const to = Math.min(pages, last + RENDER_MARGIN);
  const rendered = useMemo(() => {
    const list: number[] = [];
    for (let n = from; n <= to; n++) list.push(n);
    return list;
  }, [from, to]);

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        // The scrollbar's gutter on both edges, so the centred page is centred
        // in the pane and not in the pane less a scrollbar.
        'bg-muted/40 min-h-0 flex-1 overflow-auto overscroll-contain outline-none [touch-action:pan-x_pan-y] [scrollbar-gutter:stable_both-edges]',
        'focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset',
        className,
      )}
    >
      <div
        className="relative mx-auto"
        style={{
          height: total,
          width: pageW,
          // A pinch in progress: scaled about the point under the fingers,
          // which the commit then holds still, so the column does not move
          // when the transform comes off. The column sits centred when it
          // is narrower than the viewport, so its origin is offset by that.
          ...(pinch && viewportRef.current
            ? {
                transform: `scale(${pinch.scale})`,
                transformOrigin: `${pinch.x - Math.max(0, (viewportRef.current.clientWidth - pageW) / 2) + viewportRef.current.scrollLeft}px ${pinch.y + viewportRef.current.scrollTop}px`,
                willChange: 'transform',
              }
            : null),
        }}
      >
        {rendered.map((n) => (
          <div
            key={n}
            className="absolute left-0"
            style={{ top: tops[n - 1], width: pageW, height: heightOf(n) }}
          >
            <PdfPage
              doc={doc}
              pageNo={n}
              width={width}
              zoom={zoom}
              rotation={rotation}
              overlay={overlayFor(n)}
              onSize={({ w, h }) => {
                onPainted?.();
                const a = h / w;
                setAspects((prev) => {
                  if (Math.abs((prev.get(n) ?? 0) - a) < 0.001) return prev;
                  const next = new Map(prev);
                  next.set(n, a);
                  return next;
                });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
