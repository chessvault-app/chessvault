import {
  BookText,
  ChevronLeft,
  ChevronRight,
  FileUp,
  Grid3x3,
  Hash,
  Maximize2,
  MoveHorizontal,
  SquarePen,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { AnalysisMovesPanel } from '@/analysis/AnalysisMovesPanel';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { getNode } from '@shared/tree';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { NoMatchArt } from '@/components/empty-art';
import { BOARD_HELD_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { PaneTabs } from '@/components/pane-tabs';
import { PromptDialog } from '@/components/prompt-dialog';
import { ResizablePane } from '@/components/resizable-pane';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useElementWidth } from '@/hooks/use-element-width';
import { EditorView } from '@/editor/EditorView';
import { usePinchZoom, ZOOM_MAX } from '@/hooks/use-pinch-zoom';
import { apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWideLayout } from '@/lib/media';
import { navigate, up } from '@/lib/router';
import { cn } from '@/lib/utils';
import { loadPlacements, type BookSummary } from '@/puzzles/books/data';
import { api } from '@/lib/api';
import { useAnalysis } from '@/store/analysis';

import {
  MAX_PDF_BYTES,
  loadBooks,
  removeBook,
  replaceBookPdf,
  saveReadingPage,
  type LibraryBook,
} from './data';
import { DiagramHotspots, usePageDiagrams, type KnownDiagram } from './DiagramHotspots';
import { PdfPage, useBookPdf } from './pdfViewer';

/**
 * A book open beside a board.
 *
 * The second "pane beside a board" workbench after the puzzle corrector:
 * the PDF in a resizable pane on the left, the analysis board — the same
 * store the Board page drives, so a position set up here is the one you
 * find there — on the right. On a phone the two are tabs, and the bottom
 * bar turns pages on one and steps moves on the other.
 *
 * The board is not reset on entering (Studies' precedent): a reader comes
 * and goes from the board page with a position in hand, and throwing it
 * away on arrival would be the wrong surprise.
 */

const PANE_KEY = 'vault:panel-w:book-reader';
const PANE_DEFAULT_W = 520;
/** Lower than the evidence viewers' floor: a whole tall page in a short
    pane is a quarter of its fit-to-width size, and "fit the page" must
    be able to get there. */
const ZOOM_MIN = 0.25;

export function BookReader({ id, page }: { id: string; page?: string }) {
  const wide = useWideLayout();
  const [book, setBook] = useState<LibraryBook | null | undefined>(undefined);
  const { doc, error, retry } = useBookPdf(id, book?.bytes ?? null);
  const pages = doc?.numPages ?? book?.pages ?? 0;

  // The book's row from the shelf: its title, and where reading stopped.
  const load = useCallback(async (force = false): Promise<void> => {
    try {
      let books = await loadBooks(force);
      // Not in the remembered shelf: ask again before saying it is gone —
      // a book uploaded from another tab, or a link followed straight in,
      // is newer than what this tab last drew.
      if (!force && !books.some((b) => b.id === id)) books = await loadBooks(true);
      setBook(books.find((b) => b.id === id) ?? null);
    } catch {
      setBook(null);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  // The page: the route's, else where the reader left off, else the first.
  const [pageNo, setPageNo] = useState<number>(() => {
    const fromRoute = Number(page);
    return Number.isInteger(fromRoute) && fromRoute > 0 ? fromRoute : 0;
  });
  useEffect(() => {
    if (pageNo === 0 && book) setPageNo(book.lastPage ?? 1);
  }, [book, pageNo]);
  const goTo = useCallback(
    (n: number): void => {
      const max = pages || Infinity;
      setPageNo(Math.min(Math.max(1, Math.round(n)), max));
    },
    [pages],
  );
  // Where the reader is, saved a second after it settles and when leaving.
  const pending = useRef<number | null>(null);
  useEffect(() => {
    if (pageNo <= 0) return;
    pending.current = pageNo;
    const timer = setTimeout(() => {
      if (pending.current !== null) saveReadingPage(id, pending.current);
      pending.current = null;
    }, 1000);
    return () => clearTimeout(timer);
  }, [id, pageNo]);
  useEffect(
    () => () => {
      if (pending.current !== null) saveReadingPage(id, pending.current);
    },
    [id],
  );

  const [zoom, setZoom] = useState(1);
  const bumpZoom = (f: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));

  // The editor in the board's place, for a diagram the reader misread or
  // a position to adjust: opened from a hotspot's chooser with the read
  // position, or from the board's own header with what is on it now.
  const [editing, setEditing] = useState<string | null>(null);
  const boardFen = useAnalysis((s) => getNode(s.tree, s.cursorId).fen);
  const loadFen = useAnalysis((s) => s.loadFen);
  const openEditor = (fen: string): void => {
    setEditing(fen);
    if (!wide) setTab('board');
  };

  const known = useKnownDiagrams(id);
  const diagrams = usePageDiagrams(id, doc, pageNo);

  const [tab, setTab] = useState<'book' | 'board'>('book');
  const [goingTo, setGoingTo] = useState(false);
  const [stackedPane, stackedPaneW] = useElementWidth();
  const [wideRow, wideRowW] = useElementWidth();

  // A position landing on the board: on a phone, go and look at it.
  const onSet = (): void => {
    if (!wide) setTab('board');
  };

  const pdfPane = (width: number, compact: boolean) => (
    <PdfPane
      doc={doc}
      error={error}
      retry={retry}
      pageNo={pageNo}
      pages={pages}
      zoom={zoom}
      width={width}
      compact={compact}
      goTo={goTo}
      bumpZoom={bumpZoom}
      setZoom={setZoom}
      onGoTo={() => setGoingTo(true)}
      overlay={
        <DiagramHotspots
          diagrams={diagrams}
          known={known.get(pageNo) ?? []}
          onSet={onSet}
          onEdit={openEditor}
        />
      }
    />
  );

  const boardSide = editing !== null ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
          <ChevronLeft data-icon="inline-start" />
          {t('Back to the board')}
        </Button>
        <span className="text-muted-foreground truncate text-sm">
          {t('Fix the position, then use it on the board.')}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <EditorView
          key={editing}
          initialFen={editing}
          useLabel={t('Use on the board')}
          onUse={(fen) => {
            if (loadFen(fen)) setEditing(null);
          }}
        />
      </div>
    </div>
  ) : (
    <div className={BOARD_HELD_SHELL}>
      <AnalysisBoard />
      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 ${BOARD_WIDE_SIDE}`}
      >
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">
          <LoadPositionButton />
          <Button variant="ghost" size="sm" onClick={() => openEditor(boardFen)} title={t('Fix this position in the editor')}>
            <SquarePen data-icon="inline-start" />
            {t('Edit position')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              useAnalysis.setState({ handoff: true });
              navigate('board');
            }}
          >
            <Grid3x3 data-icon="inline-start" />
            {t('Open on the board page')}
          </Button>
        </div>
        <AnalysisMovesPanel />
      </div>
    </div>
  );

  if (book === null) {
    return (
      <div className="mx-auto flex h-full w-full max-w-[96rem] flex-col">
        <ReaderHeader title={t('Books')} onBack={() => up('books')} />
        <EmptyState
          art={<NoMatchArt />}
          title={t('That book is not in the library')}
          body={t('It may have been removed. The shelf has what is there.')}
          action={<Button onClick={() => navigate('books')}>{t('Back to Books')}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
      <ReaderHeader
        title={book?.title ?? ''}
        onBack={() => up('books')}
        menu={book ? <ReaderMenu book={book} onChanged={() => void load(true)} /> : null}
      />
      {wide ? (
        <div ref={wideRow} className="flex min-h-0 flex-1">
          <ResizablePane
            storageKey={PANE_KEY}
            defaultWidth={PANE_DEFAULT_W}
            // A page narrower than this is not readable, and the toolbar
            // above it wraps.
            minWidth={320}
            hardMax={1200}
            maxWidth={wideRowW > 0 ? Math.max(280, wideRowW - 640) : undefined}
            className="flex min-h-0 flex-col"
          >
            {(shown) => pdfPane(shown, false)}
          </ResizablePane>
          <div className="min-h-0 min-w-0 flex-1">{boardSide}</div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <PaneTabs
            className="mx-4 mt-2"
            tabs={[
              { id: 'book' as const, label: 'Book', icon: BookText },
              { id: 'board' as const, label: 'Board', icon: Grid3x3 },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="relative min-h-0 min-w-0 flex-1">
            <div ref={stackedPane} className={cn('flex h-full flex-col', tab !== 'book' && 'hidden')}>
              {pdfPane(stackedPaneW, true)}
            </div>
            {/* The board stays mounted behind the book tab: the analysis
                store is shared, but the board's own measured layout is
                not, and remounting it on every tab change cost a blank
                frame each time. */}
            <div className={cn('h-full', tab !== 'board' && 'hidden')}>{boardSide}</div>
          </div>
        </div>
      )}
      <MobileActionBar>
        {tab === 'book' ? (
          <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
            <Button variant="ghost" size="icon" disabled={pageNo <= 1} onClick={() => goTo(pageNo - 1)} title={t('Previous page')}>
              <ChevronLeft className="size-[1.1rem]" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground min-w-[5rem] tabular-nums"
              title={t('Go to page')}
              onClick={() => setGoingTo(true)}
            >
              {pages > 0 ? `${pageNo} / ${pages}` : pageNo}
            </Button>
            <Button variant="ghost" size="icon" disabled={pages > 0 && pageNo >= pages} onClick={() => goTo(pageNo + 1)} title={t('Next page')}>
              <ChevronRight className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={zoom <= ZOOM_MIN} onClick={() => bumpZoom(1 / 1.25)} title={t('Zoom out')}>
              <ZoomOut className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={zoom >= ZOOM_MAX} onClick={() => bumpZoom(1.25)} title={t('Zoom in')}>
              <ZoomIn className="size-[1.1rem]" />
            </Button>
          </div>
        ) : editing !== null ? null : (
          <div className="flex flex-1 items-center">
            <BoardControls keyboard={false} className="flex-1 py-1.5" />
            <Button variant="ghost" size="icon" title={t('Edit position')} onClick={() => openEditor(boardFen)}>
              <SquarePen className="size-[1.1rem]" />
            </Button>
          </div>
        )}
      </MobileActionBar>
      {goingTo && (
        <PromptDialog
          label={t('Go to page')}
          initial={String(pageNo || 1)}
          submitLabel="Go"
          onSubmit={(value) => {
            setGoingTo(false);
            const n = Number(value);
            if (Number.isFinite(n)) goTo(n);
          }}
          onClose={() => setGoingTo(false)}
        />
      )}
    </div>
  );
}

/** The same borderless header every workbench page opens with. */
function ReaderHeader({
  title,
  onBack,
  menu,
}: {
  title: string;
  onBack: () => void;
  menu?: React.ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 px-4">
      <Button variant="ghost" size="icon-sm" title={t('Back to Books')} onClick={onBack}>
        <ChevronLeft className="size-3.5" />
      </Button>
      <h1 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
      {menu}
    </div>
  );
}

/**
 * The header's two verbs over a book being read: a better file behind the
 * same title, or the book out of the library altogether. Removing a book
 * does not touch any puzzle book read from it — that is its own thing on
 * its own shelf.
 */
function ReaderMenu({ book, onChanged }: { book: LibraryBook; onChanged: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const replace = async (file: File): Promise<void> => {
    setNote(null);
    if (file.size > MAX_PDF_BYTES) {
      setNote(t('That PDF is too big — the limit is {mb} MB.', { mb: MAX_PDF_BYTES / (1024 * 1024) }));
      return;
    }
    setBusy(t('Uploading…'));
    try {
      await replaceBookPdf(book.id, file, (sent, total) =>
        setBusy(t('Uploading… {pct}%', { pct: Math.round((sent / total) * 100) })),
      );
      // The file changed under the open document: reload the page so
      // pdf.js opens the new one rather than asking the old for ranges.
      window.location.reload();
    } catch (e) {
      setNote(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {busy && <span className="text-muted-foreground text-xs">{busy}</span>}
      {note && <span className="text-destructive text-xs">{note}</span>}
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void replace(file);
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Replace PDF')}
        disabled={busy !== null}
        onClick={() => fileInput.current?.click()}
      >
        <FileUp className="size-3.5" />
      </Button>
      <ConfirmDialog
        icon={Trash2}
        triggerTitle={t('Remove from library')}
        question={t('Remove “{title}” from the library? The PDF is deleted; any puzzle book read from it is kept.', {
          title: book.title,
        })}
        confirmLabel={t('Remove')}
        onConfirm={() => {
          void removeBook(book.id)
            .then(() => navigate('books'))
            .catch((e) => setNote(apiErrorMessage(e)));
          onChanged();
        }}
      />
    </>
  );
}

/**
 * Positions this book's pages already hold, by page: every puzzle book
 * read from this PDF knows where its puzzles were printed and who is to
 * move, so those diagrams need no reading and no asking.
 */
function useKnownDiagrams(id: string): Map<number, KnownDiagram[]> {
  const [known, setKnown] = useState<Map<number, KnownDiagram[]>>(() => new Map());
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const { books } = await api<{ books: BookSummary[] }>('/api/puzzlebooks');
        const linked = books.filter((b) => b.pdfBook === id);
        const map = new Map<number, KnownDiagram[]>();
        for (const b of linked) {
          for (const p of await loadPlacements(b.slug)) {
            if (!p.rect) continue;
            const list = map.get(p.page) ?? [];
            list.push({ rect: p.rect, fen: p.fen });
            map.set(p.page, list);
          }
        }
        if (live) setKnown(map);
      } catch {
        // No puzzle shelf, no known positions: the reader reads instead.
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);
  return known;
}

/**
 * The PDF side: a toolbar, and the page in a scrolling viewport that the
 * buttons and a pinch zoom the page INSIDE of — the box itself never
 * grows. Arrow keys turn pages while the viewport has focus, and stop
 * there, so the board's own arrow keys are untouched elsewhere.
 */
function PdfPane({
  doc,
  error,
  retry,
  pageNo,
  pages,
  zoom,
  width,
  compact,
  goTo,
  bumpZoom,
  setZoom,
  onGoTo,
  overlay,
}: {
  doc: ReturnType<typeof useBookPdf>['doc'];
  error: string | null;
  retry: () => void;
  pageNo: number;
  pages: number;
  zoom: number;
  width: number;
  /** Phones: the bottom bar carries the paging, so the toolbar stays lean. */
  compact: boolean;
  goTo: (n: number) => void;
  bumpZoom: (f: number) => void;
  setZoom: (z: number) => void;
  /** Open the go-to-page prompt. */
  onGoTo: () => void;
  overlay: React.ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  usePinchZoom(viewport, bumpZoom);
  const [typed, setTyped] = useState<string | null>(null);
  const slow = useSlowLoad(doc === null && error === null);
  // The page's width at zoom 1: the pane less its padding.
  const pageW = Math.max(0, width - 24);
  // Fit the whole page: the zoom at which the page's height fills the
  // viewport. Needs the viewport's height and the page's shape, both
  // measured as they come; the toggle remembers the zoom it set so it can
  // tell "fit the page" from a zoom the buttons reached on their own.
  const [vpH, setVpH] = useState(0);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpH(el.clientHeight));
    ro.observe(el);
    setVpH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const [aspect, setAspect] = useState<number | null>(null);
  // Never past the width fit: "the whole page" means all of it on screen,
  // and a tall pane would otherwise zoom IN to fill its height and push
  // the page's sides off.
  const fitZoomFor = (height: number): number | null =>
    aspect && pageW > 0 && height > 0
      ? Math.min(1, Math.max(ZOOM_MIN, (height - 24) / (pageW * aspect)))
      : null;
  const fitPageZoom = fitZoomFor(vpH);
  const fitted = fitPageZoom !== null && Math.abs(zoom - fitPageZoom) < 0.005;
  const toggleFit = (): void => {
    if (fitted) {
      setZoom(1);
      return;
    }
    // From the element itself, not the observed height: a resize the
    // observer has not reported yet (a background tab gets none) must
    // not fit the page to a viewport that is gone.
    const live = fitZoomFor(viewport.current?.clientHeight ?? vpH);
    if (live !== null) setZoom(live);
  };
  const fitButton = (size: 'icon' | 'icon-sm', iconClass: string) => (
    <Button
      variant="ghost"
      size={size}
      disabled={fitPageZoom === null}
      title={fitted ? t('Fit the width') : t('Fit the whole page')}
      onClick={toggleFit}
    >
      {fitted ? <MoveHorizontal className={iconClass} /> : <Maximize2 className={iconClass} />}
    </Button>
  );
  // Back to the top on a page turn, where reading continues.
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [pageNo]);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => goTo(pageNo + 1),
      PageDown: () => goTo(pageNo + 1),
      ArrowLeft: () => goTo(pageNo - 1),
      PageUp: () => goTo(pageNo - 1),
      Home: () => goTo(1),
      End: () => goTo(pages),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 px-3">
        {!compact && (
          <>
            <Button variant="ghost" size="icon-sm" disabled={pageNo <= 1} onClick={() => goTo(pageNo - 1)} title={t('Previous page')}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <Input
              inputSize="sm"
              className="w-14 text-center tabular-nums"
              value={typed ?? String(pageNo || '')}
              inputMode="numeric"
              aria-label={t('Page')}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => {
                if (typed !== null && typed.trim() !== '') goTo(Number(typed));
                setTyped(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setTyped(null);
                  e.currentTarget.blur();
                }
              }}
            />
            <span className="text-muted-foreground text-sm tabular-nums">
              {pages > 0 ? t('of {n}', { n: pages }) : ''}
            </span>
            <Button variant="ghost" size="icon-sm" disabled={pages > 0 && pageNo >= pages} onClick={() => goTo(pageNo + 1)} title={t('Next page')}>
              <ChevronRight className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onGoTo} title={t('Go to page')}>
              <Hash className="size-3.5" />
            </Button>
            <span className="flex-1" />
            {fitButton('icon-sm', 'size-3.5')}
            <Button variant="ghost" size="icon-sm" disabled={zoom <= ZOOM_MIN} onClick={() => bumpZoom(1 / 1.25)} title={t('Zoom out')}>
              <ZoomOut className="size-3.5" />
            </Button>
            {/* The percentage only where the row has room for it; a narrow
                pane keeps the buttons and wraps nothing. */}
            {width >= 420 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground w-12 tabular-nums"
                onClick={() => setZoom(1)}
                title={t('Reset zoom')}
              >
                {Math.round(zoom * 100)}%
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" disabled={zoom >= ZOOM_MAX} onClick={() => bumpZoom(1.25)} title={t('Zoom in')}>
              <ZoomIn className="size-3.5" />
            </Button>
          </>
        )}
        {compact && (
          <>
            {fitButton('icon-sm', 'size-3.5')}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground w-12 tabular-nums"
              onClick={() => setZoom(1)}
              title={t('Reset zoom')}
            >
              {Math.round(zoom * 100)}%
            </Button>
          </>
        )}
      </div>
      <div
        ref={viewport}
        tabIndex={0}
        onKeyDown={onKey}
        className="bg-muted/40 min-h-0 flex-1 overflow-auto overscroll-contain outline-none [touch-action:pan-x_pan-y] focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:ring-inset"
      >
        {error ? (
          <EmptyState
            art={<NoMatchArt />}
            title={t('The PDF could not be opened')}
            body={error}
            action={<Button onClick={retry}>{t('Try again')}</Button>}
          />
        ) : doc && pageNo > 0 && pageW > 0 ? (
          <div className="flex min-h-full justify-center p-3">
            <PdfPage
              doc={doc}
              pageNo={pageNo}
              width={pageW}
              zoom={zoom}
              overlay={overlay}
              onSize={({ w, h }) => setAspect(h / w)}
            />
          </div>
        ) : slow ? (
          <div className="flex min-h-full justify-center p-3">
            <Skeleton className="aspect-[3/4] rounded-md" style={{ width: pageW || '100%' }} />
          </div>
        ) : null}
      </div>
    </>
  );
}
