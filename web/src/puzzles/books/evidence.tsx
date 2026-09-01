import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Eye,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useFloating } from '@/lib/floating';
import { suppressNextClick } from '@/lib/suppressNextClick';

import { Button } from '@/components/ui/button';
import { ResizablePane } from '@/components/resizable-pane';
import { usePinchZoom, ZOOM_MAX, ZOOM_MIN } from '@/hooks/use-pinch-zoom';

import { PaneTabs } from '@/components/pane-tabs';

import { t } from '@/lib/i18n';
import {
  type BookEvidence,
  type SourceRect,
  diagramUrl,
} from './data';
import { isCoarsePointer } from '@/lib/media';

/**
 * The correction sidebar: the book's own scans, right where the board is
 * being fixed. Diagram tab = the page cropped to this puzzle's diagram;
 * Solutions tab = the solutions page covering its number, or the whole
 * answers section for an entry with no number to match on.
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
  return (
    <ResizablePane
      storageKey={SOURCE_PANE_WIDTH_KEY}
      defaultWidth={SOURCE_PANE_DEFAULT_W}
      maxWidth={maxWidth}
      className="flex flex-col gap-2 overflow-y-auto p-4"
    >
      {(shown) => (
        <>
          {hasSolutions(evidence) && (
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
              <p className="text-muted-foreground text-sm leading-relaxed">
                {t('The book’s own scan — make the board match it.')}
              </p>
            </>
          ) : tab === 'solutions' && hasSolutions(evidence) ? (
            <SolutionsView slug={slug} evidence={evidence} width={shown - 32} />
          ) : null}
        </>
      )}
    </ResizablePane>
  );
}

/** Whether there is anything to put behind a Solutions tab. */
export function hasSolutions(evidence: BookEvidence): boolean {
  return Boolean(evidence.solutionPage) || (evidence.solutionPages?.length ?? 0) > 0;
}

/**
 * What a Solutions tab shows.
 *
 * One page when the entry's number was read: the page that number is
 * printed on. Otherwise the whole answers section, a page at a time —
 * which is what an entry with no number can honestly point at, and what
 * finishing it by hand means reading anyway. The pager sits above the
 * page rather than beside it: the pane is a column, and this is the
 * narrowest thing in the app that has ever needed one.
 */
export function SolutionsView({
  slug,
  evidence,
  width,
}: {
  slug: string;
  evidence: BookEvidence;
  width: number;
}) {
  const pages = evidence.solutionPage
    ? [evidence.solutionPage]
    : (evidence.solutionPages ?? []);
  const [at, setAt] = useState(0);
  // A shorter section (a re-import that read more numbers) must not leave
  // the pager pointing past the end.
  const index = Math.min(at, Math.max(0, pages.length - 1));
  const page = pages[index];
  if (!page) return null;
  return (
    <div className="flex flex-col gap-2">
      {pages.length > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon-sm"
            title={t('Previous page')}
            disabled={index === 0}
            onClick={() => setAt(index - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-muted-foreground flex-1 text-center font-mono text-xs">
            {index + 1} / {pages.length}
          </span>
          <Button
            variant="secondary"
            size="icon-sm"
            title={t('Next page')}
            disabled={index === pages.length - 1}
            onClick={() => setAt(index + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      )}
      {/* Keyed on the page: a new image starts at zoom 1 rather than
          inheriting wherever the last one was left. */}
      <ZoomablePage key={page} src={diagramUrl(slug, page)} alt={t('solutions page')} width={width} />
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
  // Touch synthesizes mouseenter on the tapped element, and there is no
  // matching mouseleave until the pointer "moves" — which on a phone it
  // never does. So the first tap set BOTH open and hover, and every way of
  // dismissing (tap the eye again, tap anywhere else) cleared only `open`
  // and left the peek on screen. Hover is a mouse's gesture; a coarse
  // pointer does not get one, exactly as the puzzle preview already had it.
  const fine = (): boolean => !isCoarsePointer();
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
  // Under the eye, above it where there is no room, hugging its right
  // edge and inside the window — from lib/floating, which measures the
  // peek rather than guessing at 300px of it. That guess is what the
  // constant above was: a stand-in for a height nobody had.
  const float = useFloating(box, { side: 'bottom', align: 'end', gap: 4 });
  return (
    <span
      ref={anchor}
      data-peek
      onMouseEnter={() => {
        if (fine()) setHover(true);
      }}
      onMouseLeave={() => {
        if (fine()) setHover(false);
      }}
      className="group relative grid size-7 shrink-0 place-items-center pointer-coarse:size-9"
    >
      {/* aria-label and no tip: a fine pointer answers this hover with the
          scan crop below, which is the whole point of the eye, and a tip
          would be a second floating box over the first. A coarse one taps
          the crop open and never hovers at all. */}
      <button
        type="button"
        aria-label={t('Peek at the book scan')}
        onClick={(e) => {
          if (!fine()) {
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
        className="grid size-full place-items-center"
      >
        <Eye className="text-muted-foreground group-hover:text-foreground size-3.5 transition-colors pointer-coarse:size-4.5" />
      </button>
      {shown &&
        box &&
        createPortal(
          <span
            ref={float.ref}
            aria-hidden
            style={float.style}
            className="pointer-events-none z-50 block"
          >
            <span className="bg-card block rounded-xl ring-1 ring-border p-2 shadow-lg">
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
        <Button variant="secondary" size="icon-sm" title={t('Zoom out')} disabled={zoom <= ZOOM_MIN} onClick={() => bump(1 / 1.25)} className="shadow-sm">
          <ZoomOut className="size-3.5" />
        </Button>
        <Button variant="secondary" size="icon-sm" title={t('Zoom in')} disabled={zoom >= ZOOM_MAX} onClick={() => bump(1.25)} className="shadow-sm">
          <ZoomIn className="size-3.5" />
        </Button>
      </span>
      <div
        ref={viewport}
        className="border-border max-h-[calc(100dvh-12rem)] overflow-auto overscroll-contain rounded-md border [touch-action:pan-x_pan-y]"
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
        className="shadow-sm"
      >
        <ZoomOut className="size-3.5" />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        title={t('Zoom in')}
        disabled={zoom >= ZOOM_MAX}
        onClick={() => bump(1.25)}
        className="shadow-sm"
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
          className="border-border max-h-[calc(100dvh-12rem)] overflow-auto overscroll-contain rounded-md border [touch-action:pan-x_pan-y]"
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
          className="absolute right-1.5 top-1.5 shadow-sm"
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
        className="border-border overflow-auto overscroll-contain rounded-md border [touch-action:pan-x_pan-y]"
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
          className="absolute right-1.5 top-1.5 shadow-sm"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
