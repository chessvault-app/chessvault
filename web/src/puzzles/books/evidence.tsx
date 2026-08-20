import {
  Maximize2,
  Minimize2,
  Eye,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';

import { Button } from '@/ui/Button';

import { PaneTabs } from '@/ui/PaneTabs';

import { t } from '@/lib/i18n';
import {
  type BookEvidence,
  type SourceRect,
  diagramUrl,
} from './data';

/**
 * The correction sidebar: the book's own scans, right where the board is
 * being fixed. Diagram tab = the page cropped to this puzzle's diagram;
 * Solutions tab = the solutions page covering its number.
 */
const SOURCE_PANE_WIDTH_KEY = 'vault:panel-w:book-source';
const SOURCE_PANE_DEFAULT_W = 340;

export function SourcePane({
  slug,
  evidence,
  maxWidth,
}: {
  slug: string;
  evidence: BookEvidence;
  /** The most the pane may take of the row it shares with the editor —
      a width dragged out on a big monitor must not squeeze the editor
      off a smaller one. The STORED width survives untouched, so the big
      monitor gets it back. */
  maxWidth?: number;
}) {
  const [tab, setTab] = useState<'diagram' | 'solutions'>('diagram');
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SOURCE_PANE_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : SOURCE_PANE_DEFAULT_W;
  });
  const shown = Math.max(280, Math.min(width, maxWidth ?? width));
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    if (width === SOURCE_PANE_DEFAULT_W) localStorage.removeItem(SOURCE_PANE_WIDTH_KEY);
    else localStorage.setItem(SOURCE_PANE_WIDTH_KEY, String(Math.round(width)));
  }, [width]);
  return (
    <div className="flex min-h-0 shrink-0">
      <aside className="flex flex-col gap-2 overflow-y-auto p-4" style={{ width: shown }}>
      {evidence.solutionPage && (
        <PaneTabs
          className="mb-1"
          tabs={[
            { id: 'diagram' as const, label: 'Diagram' },
            { id: 'solutions' as const, label: 'Solutions' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === 'diagram' && evidence.page ? (
        <>
          <SourceCrop slug={slug} page={evidence.page} rect={evidence.rect} width={shown - 32} />
          <p className="text-subtle text-sm leading-relaxed">
            {t('The book’s own scan — make the board match it.')}
          </p>
        </>
      ) : tab === 'solutions' && evidence.solutionPage ? (
        <ZoomablePage
          src={diagramUrl(slug, evidence.solutionPage)}
          alt={t('solutions page')}
          width={shown - 32}
        />
      ) : null}
      </aside>
      <div
        title={t('Drag to resize · double-click to reset')}
        onDoubleClick={() => {
          drag.current = null;
          setWidth(SOURCE_PANE_DEFAULT_W);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          // From the width on SCREEN, not the stored one — dragging a
          // clamped pane must not jump to where the big monitor left it.
          drag.current = { x: e.clientX, w: shown };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || (e.buttons & 1) === 0) return;
          const next = drag.current.w + e.clientX - drag.current.x;
          setWidth(
            Math.min(Math.max(next, 280), Math.min(820, maxWidth ?? Infinity, window.innerWidth * 0.55)),
          );
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        className={cn(
          'border-line/60 hover:bg-surface-2 flex w-2.5 shrink-0 touch-none',
          'cursor-col-resize items-center justify-center border-l transition-colors',
        )}
      >
        {/* The grip, centred on the divider line — same idiom as the
            panels' bottom-edge resize. */}
        <div className="bg-line h-8 w-[3px] rounded-full" />
      </div>
    </div>
  );
}

/**
 * The correction aid: the scanned source page, cropped to THIS diagram
 * (with a little margin), expandable inline to the whole page — the
 * evidence lives inside the entry/correction flow where it is actually
 * used, never in a lookup popup. Rects are page fractions; the crop is
 * plain pixel math once the image's natural size is known.
 */
/** How much room under the eye a peek wants before it opens downwards: the
    crop is 252px wide and a diagram crop runs about that tall again, plus
    the box's own padding. Under this, and only then, it opens upwards. */
const PEEK_NEEDS_BELOW = 300;

/** The book-scan peek beside a puzzle: hovers open on a mouse, and TAPS open
    on touch (the hover-only version did nothing on a phone). Tap the eye again
    or anywhere else to close.

    On the BODY and position-fixed, not absolute where it is written. The eye
    sits in a panel header, and a panel clips what does not fit — it is a
    scrolling column, so `overflow` is the point of it. An absolutely
    positioned peek was therefore cut off at the panel's edge: measured in the
    book trainer at 1280px, 148px of the 270px-wide box was over the panel's
    left edge and simply not drawn. A floating layer has no business living
    inside the thing it floats over; Select's list learnt this first, and this
    is the same fix. */
export function EvidencePeek({ slug, page, rect }: { slug: string; page: string; rect?: SourceRect }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  const shown = open || hover;
  // Measured as it appears, and again never — a peek is a held gesture, so
  // anything that MOVES the eye underneath it closes it instead (below).
  useLayoutEffect(() => {
    setBox(shown ? (anchor.current?.getBoundingClientRect() ?? null) : null);
  }, [shown]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent): void => {
      if (!(e.target as HTMLElement).closest('[data-peek]')) {
        setOpen(false);
        // A dismissing tap must only dismiss, not press what's underneath.
        if (e.type === 'touchstart') suppressNextClick();
      }
    };
    // touchstart too: iOS taps on dead space never synthesize click for
    // document-level listeners, so touch alone could not close the peek.
    document.addEventListener('click', onDown, true);
    document.addEventListener('touchstart', onDown, true);
    return () => {
      document.removeEventListener('click', onDown, true);
      document.removeEventListener('touchstart', onDown, true);
    };
  }, [open]);
  // A fixed box is pinned to where the eye WAS. Scrolling the panel or
  // resizing the window moves the eye out from under it, so put it away
  // rather than leave it floating over nothing.
  useEffect(() => {
    if (!shown) return;
    const drop = (): void => {
      setOpen(false);
      setHover(false);
    };
    window.addEventListener('scroll', drop, true);
    window.addEventListener('resize', drop);
    return () => {
      window.removeEventListener('scroll', drop, true);
      window.removeEventListener('resize', drop);
    };
  }, [shown]);
  const below = box ? window.innerHeight - box.bottom : 0;
  const up = box ? below < PEEK_NEEDS_BELOW && box.top > below : false;
  return (
    <span
      ref={anchor}
      data-peek
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative grid size-7 shrink-0 place-items-center pointer-coarse:size-9"
    >
      <button
        type="button"
        title={t('Peek at the book scan')}
        onClick={(e) => {
          if (window.matchMedia('(pointer: coarse)').matches) {
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
        className="grid size-full place-items-center"
      >
        <Eye className="text-subtle group-hover:text-fg size-3.5 transition-colors pointer-coarse:size-4.5" />
      </button>
      {shown &&
        box &&
        createPortal(
          <span
            aria-hidden
            style={{
              // Hugging the eye's right edge, but never past the window's
              // own — a peek beside a control near the right rail would
              // otherwise trade a panel's clipping for the screen's.
              right: Math.max(8, window.innerWidth - box.right),
              ...(up ? { bottom: window.innerHeight - box.top + 4 } : { top: box.bottom + 4 }),
            }}
            className="pointer-events-none fixed z-50 block"
          >
            <span className="bg-surface border-line block rounded-xl border p-2 shadow-[var(--shadow-pop)]">
              <SourceCrop
                slug={slug}
                page={page}
                rect={rect}
                // Never wider than the window it floats in: the same box is
                // what a phone opens by tapping the eye.
                width={Math.min(252, window.innerWidth - 40)}
                plain
              />
            </span>
          </span>,
          document.body,
        )}
    </span>
  );
}

/** Live width of a rendered element (ResizeObserver) — the stacked
    evidence views size to their actual container, not a guess from
    window.innerWidth that left dead space beside the box. A CALLBACK ref:
    the measured pane mounts only when its tab is active, so a static ref
    bound once on mount would never see it. */
export function useElementWidth(): [(el: HTMLDivElement | null) => void, number] {
  const [width, setWidth] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    ro.current = observer;
  }, []);
  return [attach, width];
}

const ZOOM_MIN = 0.75;
const ZOOM_MAX = 3;

/**
 * Two-finger pinch on `ref` multiplies the zoom. A NATIVE non-passive
 * touchmove listener: React's own is passive, so preventDefault would be
 * ignored and the page would scroll/zoom underneath the gesture.
 */
function usePinchZoom(
  ref: React.RefObject<HTMLDivElement | null>,
  apply: (factor: number) => void,
  /** Include anything that swaps the DOM node under the ref (e.g. the
      crop/full-page toggle) — the listeners must move to the new element. */
  rebind?: unknown,
): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last: number | null = null;
    const dist = (t: TouchList): number =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onStart = (e: TouchEvent): void => {
      if (e.touches.length === 2) last = dist(e.touches);
    };
    const onMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || last === null) return;
      e.preventDefault();
      const d = dist(e.touches);
      if (d > 0 && last > 0) applyRef.current(d / last);
      last = d;
    };
    const onEnd = (): void => {
      last = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, rebind]);
}

/**
 * A whole scan page in a fixed-width viewport: the buttons and a pinch
 * zoom the IMAGE inside, panning by scroll — the box itself never grows
 * (the old zoom inflated the element, shoving the layout around).
 */
export function ZoomablePage({ src, alt, width }: { src: string; alt: string; width: number }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const bump = (f: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));
  usePinchZoom(viewport, bump);
  return (
    <div className="relative" style={{ width }}>
      <span className="absolute left-1.5 top-1.5 z-10 flex gap-1">
        <Button variant="secondary" size="icon-sm" title={t('Zoom out')} disabled={zoom <= ZOOM_MIN} onClick={() => bump(1 / 1.25)} className="shadow-md">
          <ZoomOut className="size-3.5" />
        </Button>
        <Button variant="secondary" size="icon-sm" title={t('Zoom in')} disabled={zoom >= ZOOM_MAX} onClick={() => bump(1.25)} className="shadow-md">
          <ZoomIn className="size-3.5" />
        </Button>
      </span>
      <div
        ref={viewport}
        className="border-line max-h-[calc(100dvh-12rem)] overflow-auto overscroll-contain rounded-md border [touch-action:pan-x_pan-y]"
      >
        <img src={src} alt={alt} className="max-w-none" style={{ width: Math.round(width * zoom) }} />
      </div>
    </div>
  );
}

export function SourceCrop({
  slug,
  page,
  rect,
  width = 288,
  plain = false,
}: {
  slug: string;
  page: string;
  rect?: SourceRect;
  width?: number;
  /** No whole-page toggle — for hover peeks. */
  plain?: boolean;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [full, setFull] = useState(false);
  // Zoom scales the image INSIDE a fixed viewport (buttons or a pinch);
  // pan by scrolling. The element itself never changes size.
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const bump = (f: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));
  usePinchZoom(viewport, bump, full);
  const zoomButtons = !plain && (
    <span className="absolute left-1.5 top-1.5 z-10 flex gap-1">
      <Button
        variant="secondary"
        size="icon-sm"
        title={t('Zoom out')}
        disabled={zoom <= ZOOM_MIN}
        onClick={() => bump(1 / 1.25)}
        className="shadow-md"
      >
        <ZoomOut className="size-3.5" />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        title={t('Zoom in')}
        disabled={zoom >= ZOOM_MAX}
        onClick={() => bump(1.25)}
        className="shadow-md"
      >
        <ZoomIn className="size-3.5" />
      </Button>
    </span>
  );
  const src = diagramUrl(slug, page);
  const r = rect ?? { x: 0, y: 0, w: 1, h: 1 };
  const margin = 0.035;
  const cx = Math.max(0, r.x - margin);
  const cy = Math.max(0, r.y - margin);
  const cw = Math.min(1 - cx, r.w + 2 * margin);
  const ch = Math.min(1 - cy, r.h + 2 * margin);

  if (full) {
    // Whole page fitted to the pane width; zoom scrolls within.
    return (
      <div className="relative" style={{ width }}>
        <div
          ref={viewport}
          className="border-line max-h-[calc(100dvh-12rem)] overflow-auto overscroll-contain rounded-md border [touch-action:pan-x_pan-y]"
        >
          <div className="relative" style={{ width: Math.round(width * zoom) }}>
            <img src={src} alt={t('book page')} className="w-full" />
            <div
              className="border-primary pointer-events-none absolute rounded-sm border-2"
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
            />
          </div>
        </div>
        {zoomButtons}
        <Button
          variant="secondary"
          size="icon-sm"
          title={t('Back to the diagram')}
          onClick={() => setFull(false)}
          className="absolute right-1.5 top-1.5 shadow-md"
        >
          <Minimize2 className="size-3.5" />
        </Button>
      </div>
    );
  }

  // The crop fills the viewport at zoom 1; the viewport KEEPS that size as
  // the content inside scales, scrolling to pan.
  const fit = natural ? width / (cw * natural.w) : 1;
  const scale = fit * zoom;
  return (
    <div className="relative" style={{ width }}>
      {zoomButtons}
      <div
        ref={viewport}
        className="border-line overflow-auto overscroll-contain rounded-md border [touch-action:pan-x_pan-y]"
        style={{ width, height: natural ? Math.round(ch * natural.h * fit) : width }}
      >
        <div
          className="overflow-hidden"
          style={
            natural
              ? { width: cw * natural.w * scale, height: ch * natural.h * scale }
              : undefined
          }
        >
          <img
            src={src}
            alt={t('book diagram in its page')}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            className="max-w-none"
            style={
              natural
                ? {
                    width: natural.w * scale,
                    marginLeft: -cx * natural.w * scale,
                    marginTop: -cy * natural.h * scale,
                  }
                : undefined
            }
          />
        </div>
      </div>
      {!plain && (
        <Button
          variant="secondary"
          size="icon-sm"
          title={t('Show the whole page')}
          onClick={() => setFull(true)}
          className="absolute right-1.5 top-1.5 shadow-md"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
