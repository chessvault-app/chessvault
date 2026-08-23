import {
  BookText,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileUp,
  Grid3x3,
  Hash,
  ListOrdered,
  Maximize2,
  MoveHorizontal,
  SquarePen,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getNode } from '@shared/tree';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { NoMatchArt } from '@/components/empty-art';
import { BOARD_HELD_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { Panel, PanelHeader } from '@/components/panel';
import { PaneTabs } from '@/components/pane-tabs';
import { PromptDialog } from '@/components/prompt-dialog';
import { ResizablePane } from '@/components/resizable-pane';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { EditorView } from '@/editor/EditorView';
import { EngineBlock } from '@/engine/EnginePane';
import { useElementWidth } from '@/hooks/use-element-width';
import { usePinchZoom, ZOOM_MAX } from '@/hooks/use-pinch-zoom';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useWideLayout } from '@/lib/media';
import { navigate, up } from '@/lib/router';
import { cn } from '@/lib/utils';
import { loadPlacements, type BookSummary } from '@/puzzles/books/data';
import { useAnalysis } from '@/store/analysis';

import { loadBooks, removeBook, saveReadingPage, type LibraryBook } from './data';
import { DiagramHotspots, usePageDiagrams, type KnownDiagram } from './DiagramHotspots';
import { PdfScroller, useBookPdf } from './pdfViewer';
import { UploadBookDialog } from './UploadBookDialog';

/**
 * A book open beside a board.
 *
 * The second "pane beside a board" workbench after the puzzle corrector:
 * the PDF in a resizable pane on the left, and on the right the board
 * page's own shape — the analysis board (the same store the Board page
 * drives, so a position set up here is the one you find there) with the
 * moves panel beside it, or under it when the room left beside the PDF
 * is too narrow for both. On a phone it IS the board page's stacked
 * shape: board on top, then the pane switcher — Book, Moves, Engine —
 * with the book as one of the panes.
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
/**
 * Below this much room beside the PDF, the moves panel goes UNDER the
 * board instead of beside it. The board page's own side column is 38% of
 * its row with a 27rem cap; beside a 320px board that is the narrowest
 * pair still worth calling two columns.
 */
const STACK_BELOW = 720;

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
  // position, or from the moves header with what is on the board now.
  const [editing, setEditing] = useState<string | null>(null);
  const boardFen = useAnalysis((s) => getNode(s.tree, s.cursorId).fen);
  const loadFen = useAnalysis((s) => s.loadFen);

  const known = useKnownDiagrams(id);
  const [shown, setShown] = useState<number[]>([]);
  const diagramsOn = usePageDiagrams(id, doc, shown);

  const [tab, setTab] = useState<'book' | 'moves' | 'engine'>('book');
  const [goingTo, setGoingTo] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [stackedPane, stackedPaneW] = useElementWidth();
  const [wideRow, wideRowW] = useElementWidth();
  const [region, regionW] = useElementWidth();
  const stackBoard = regionW > 0 && regionW < STACK_BELOW;

  const overlayFor = (n: number) => (
    <DiagramHotspots
      diagrams={diagramsOn(n)}
      known={known.get(n) ?? []}
      onEdit={setEditing}
    />
  );

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
      onScrolledTo={setPageNo}
      bumpZoom={bumpZoom}
      setZoom={setZoom}
      onGoTo={() => setGoingTo(true)}
      overlayFor={overlayFor}
      onVisible={setShown}
    />
  );

  // The moves panel: the Board page's, with the position loader and the
  // editor in its header — the reader's two ways of putting a position on
  // the board that did not come from a diagram.
  const movesPanel = (className?: string, engineDocked = true) => (
    <Panel flush className={cn('min-h-0 flex-1', className)}>
      {engineDocked && <EngineBlock />}
      <PanelHeader
        title={t('Moves')}
        actions={
          <>
            <SidelinesToggle />
            <LoadPositionButton open={loadOpen} onOpenChange={setLoadOpen} />
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Fix this position in the editor')}
              onClick={() => setEditing(boardFen)}
            >
              <SquarePen className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Open on the board page')}
              onClick={() => {
                useAnalysis.setState({ handoff: true });
                navigate('board');
              }}
            >
              <Grid3x3 className="size-3.5" />
            </Button>
            <MoveActions allowReset={false} />
            <MovesOverflow allowReset={false} onLoadPosition={() => setLoadOpen(true)} />
          </>
        }
      />
      <MoveTreePane />
      <BoardControls className="border-border border-t max-md:hidden" keyboard={false} />
    </Panel>
  );

  const editor = editing !== null && (
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

  const header = (
    <ReaderHeader
      title={book?.title ?? ''}
      onBack={() => up('books')}
      menu={book ? <ReaderMenu book={book} onChanged={() => void load(true)} /> : null}
    />
  );

  const gotoDialog = goingTo && (
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
  );

  if (wide) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
        {header}
        <div ref={wideRow} className="flex min-h-0 flex-1">
          <ResizablePane
            storageKey={PANE_KEY}
            defaultWidth={PANE_DEFAULT_W}
            minWidth={320}
            hardMax={1200}
            maxWidth={wideRowW > 0 ? Math.max(280, wideRowW - 640) : undefined}
            className="flex min-h-0 flex-col"
          >
            {(shownW) => pdfPane(shownW, false)}
          </ResizablePane>
          <div ref={region} className="min-h-0 min-w-0 flex-1">
            {editor ||
              (stackBoard ? (
                // Not enough room beside the PDF for board and panel
                // side by side: the panel goes under the board and the
                // column scrolls. The board column gives up its wide:flex-1
                // here — in a column it would take the height the panel
                // needs.
                <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 wide:[&>*:first-child]:flex-none">
                  <AnalysisBoard />
                  {movesPanel('min-h-[18rem] shrink-0')}
                </div>
              ) : (
                <div className={BOARD_HELD_SHELL}>
                  <AnalysisBoard />
                  <div
                    className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden ${BOARD_WIDE_SIDE}`}
                  >
                    <div className="hidden h-9 shrink-0 wide:block" />
                    {movesPanel()}
                  </div>
                </div>
              ))}
          </div>
        </div>
        {gotoDialog}
      </div>
    );
  }

  // Stacked: the board page's own shape, the book as one of the panes.
  return (
    <div className={BOARD_HELD_SHELL}>
      {header}
      {editor || (
        <>
          <AnalysisBoard />
          <div
            className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:min-h-40 stacked:gap-2 ${BOARD_WIDE_SIDE}`}
          >
            <PaneTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'book', label: t('Book'), icon: BookText },
                { id: 'moves', label: t('Moves'), icon: ListOrdered },
                { id: 'engine', label: 'Engine', icon: Cpu },
              ]}
            />
            <div
              ref={stackedPane}
              className={cn('flex min-h-0 flex-1 flex-col', tab !== 'book' && 'hidden')}
            >
              {pdfPane(stackedPaneW, true)}
            </div>
            {movesPanel(cn(tab !== 'moves' && 'hidden'), false)}
            <Panel flush className={cn('min-h-0 flex-1', tab !== 'engine' && 'hidden')}>
              <EngineBlock standalone />
            </Panel>
          </div>
        </>
      )}
      <MobileActionBar>
        <BoardControls keyboard={false} className="py-1.5" />
      </MobileActionBar>
      {gotoDialog}
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
 * same title (through the same window that adds a book), or the book out
 * of the library altogether. Removing a book does not touch any puzzle
 * book read from it — that is its own thing on its own shelf.
 */
function ReaderMenu({ book, onChanged }: { book: LibraryBook; onChanged: () => void }) {
  const [replacing, setReplacing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <>
      {note && <span className="text-destructive text-xs">{note}</span>}
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Replace PDF')}
        onClick={() => setReplacing(true)}
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
      {replacing && (
        <UploadBookDialog
          replace={{ id: book.id, title: book.title }}
          onClose={() => setReplacing(false)}
          onUploaded={() => {
            setReplacing(false);
            // The shelf row's size changes with the file, and the PDF's URL
            // is versioned by it — so a fresh row is a fresh document.
            onChanged();
          }}
        />
      )}
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
 * The PDF side: one centred row of controls — page, go-to, fit, zoom —
 * over the book scrolling as one column. Arrow keys turn pages while
 * the viewport has focus, and stop there, so the board's own arrow keys
 * are untouched elsewhere.
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
  onScrolledTo,
  bumpZoom,
  setZoom,
  onGoTo,
  overlayFor,
  onVisible,
}: {
  doc: ReturnType<typeof useBookPdf>['doc'];
  error: string | null;
  retry: () => void;
  pageNo: number;
  pages: number;
  zoom: number;
  width: number;
  /** Phones: a leaner row. */
  compact: boolean;
  goTo: (n: number) => void;
  /** The page the scroller arrived at on its own. */
  onScrolledTo: (n: number) => void;
  bumpZoom: (f: number) => void;
  setZoom: (z: number) => void;
  /** Open the go-to-page prompt. */
  onGoTo: () => void;
  overlayFor: (page: number) => React.ReactNode;
  onVisible: (pages: number[]) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  usePinchZoom(viewport, bumpZoom);
  const slow = useSlowLoad(doc === null && error === null);
  // The page's width at zoom 1: the pane less its padding.
  const pageW = Math.max(0, width - 24);
  // Fit the whole page: the zoom at which the first page's height fills
  // the viewport — never past the width fit ("the whole page" means all
  // of it on screen; a tall pane would otherwise zoom IN). Read from the
  // element when pressed, so a resize the observer has not reported yet
  // (a background tab gets none) cannot fit the page to a viewport that
  // is gone.
  const [aspect, setAspect] = useState<number | null>(null);
  useEffect(() => {
    if (!doc) return;
    let live = true;
    void doc.getPage(1).then((p) => {
      if (!live) return;
      const v = p.getViewport({ scale: 1 });
      setAspect(v.height / v.width);
    });
    return () => {
      live = false;
    };
  }, [doc]);
  const fitZoomFor = (height: number): number | null =>
    aspect && pageW > 0 && height > 0
      ? Math.min(1, Math.max(ZOOM_MIN, (height - 24) / (pageW * aspect)))
      : null;
  const [vpH, setVpH] = useState(0);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVpH(el.clientHeight));
    ro.observe(el);
    setVpH(el.clientHeight);
    return () => ro.disconnect();
  }, [doc]);
  const fitPageZoom = fitZoomFor(vpH);
  const fitted = fitPageZoom !== null && fitPageZoom < 1 && Math.abs(zoom - fitPageZoom) < 0.005;
  const toggleFit = (): void => {
    if (fitted) {
      setZoom(1);
      return;
    }
    const live = fitZoomFor(viewport.current?.clientHeight ?? vpH);
    if (live !== null) setZoom(live);
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => goTo(pageNo + 1),
      ArrowLeft: () => goTo(pageNo - 1),
      Home: () => goTo(1),
      End: () => goTo(pages),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  };
  const icon = compact ? 'size-[1.1rem]' : 'size-3.5';
  const size = compact ? 'icon' : 'icon-sm';
  return (
    <>
      {/* One group, centred: what the page is and how it is shown. */}
      <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 px-3">
        <Button variant="ghost" size={size} disabled={pageNo <= 1} onClick={() => goTo(pageNo - 1)} title={t('Previous page')}>
          <ChevronLeft className={icon} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground min-w-[4.5rem] tabular-nums"
          title={t('Go to page')}
          onClick={onGoTo}
        >
          {pages > 0 ? `${pageNo || 1} / ${pages}` : pageNo || 1}
          <Hash className="size-3 opacity-60" />
        </Button>
        <Button variant="ghost" size={size} disabled={pages > 0 && pageNo >= pages} onClick={() => goTo(pageNo + 1)} title={t('Next page')}>
          <ChevronRight className={icon} />
        </Button>
        <span className="bg-border mx-1 h-4 w-px" />
        <Button
          variant="ghost"
          size={size}
          disabled={fitPageZoom === null || (fitPageZoom >= 1 && !fitted)}
          title={fitted ? t('Fit the width') : t('Fit the whole page')}
          onClick={toggleFit}
        >
          {fitted ? <MoveHorizontal className={icon} /> : <Maximize2 className={icon} />}
        </Button>
        <Button variant="ghost" size={size} disabled={zoom <= ZOOM_MIN} onClick={() => bumpZoom(1 / 1.25)} title={t('Zoom out')}>
          <ZoomOut className={icon} />
        </Button>
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
        <Button variant="ghost" size={size} disabled={zoom >= ZOOM_MAX} onClick={() => bumpZoom(1.25)} title={t('Zoom in')}>
          <ZoomIn className={icon} />
        </Button>
      </div>
      {error ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            art={<NoMatchArt />}
            title={t('The PDF could not be opened')}
            body={error}
            action={<Button onClick={retry}>{t('Try again')}</Button>}
          />
        </div>
      ) : doc && pageNo > 0 && pageW > 0 ? (
        <PdfScroller
          doc={doc}
          pages={doc.numPages}
          width={pageW}
          zoom={zoom}
          pageNo={pageNo}
          onPageChange={onScrolledTo}
          overlayFor={overlayFor}
          onVisible={onVisible}
          viewportRef={viewport}
          onKeyDown={onKey}
        />
      ) : (
        <div className="bg-muted/40 min-h-0 flex-1 overflow-auto">
          {slow && (
            <div className="flex min-h-full justify-center p-3">
              <Skeleton className="aspect-[3/4] rounded-md" style={{ width: pageW || '100%' }} />
            </div>
          )}
        </div>
      )}
    </>
  );
}
