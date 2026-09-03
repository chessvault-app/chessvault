import { BookText, BookX, ChevronLeft, FileX, ChevronRight, FileUp, Grid3x3, Maximize2, MoreHorizontal, MoveHorizontal, Percent, RotateCcw, RotateCw, Search, SquarePen, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { getNode } from '@shared/tree';
import { AnalysisBoard, BoardControls, PaneControls } from '@/board/AnalysisBoard';
import { AnalysisMoveBox } from '@/board/MoveBox';
import { BOARD_MAX_W } from '@/board/boardSize';
import { MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { ActionMenu, type MenuAction } from '@/components/action-menu';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { BOARD_HELD_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { Panel, PanelHeader } from '@/components/panel';
import { PageHeader } from '@/components/page-header';
import { PaneTabs } from '@/components/pane-tabs';
import { ResizablePane } from '@/components/resizable-pane';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { EditorView } from '@/editor/EditorView';
import { useElementWidth } from '@/hooks/use-element-width';
import { usePinchZoom, ZOOM_MAX, type PinchLive, type PinchPoint } from '@/hooks/use-pinch-zoom';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useMediaQuery, useWideLayout } from '@/lib/media';
import { navigate, up } from '@/lib/router';
import { cn } from '@/lib/utils';
import { loadPlacements, type BookSummary } from '@/puzzles/books/data';
import { useAnalysis } from '@/store/analysis';

import { loadBooks, removeBook, saveReadingPage, type LibraryBook } from './data';
import {
  DiagramHotspots,
  SearchHighlights,
  usePageDiagrams,
  type KnownDiagram,
} from './DiagramHotspots';
import { useDiagramJob } from './diagramJob';
import { usePdfSearch, type PdfSearch } from './pdfSearch';
import { PdfScroller, useBookPdf, type Rotation } from './pdfViewer';
import { UploadBookDialog } from './UploadBookDialog';
import { TitleTip } from '@/components/title-tip';

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
const PANE_DEFAULT_W = 560;
/**
 * The least the board's column may be squeezed to when the book is taking
 * its share of a narrow row.
 *
 * It used to be 640, which is not a board measurement — BOARD_MAX_W's own
 * floor in wide mode is 18rem, and the eval lane and controls around it
 * come to well under a hundred more. What 640 actually did was hand the
 * remainder to the PDF: on a 1120px window the row is ~912, so the pane
 * was capped at 272 and a Letter page rendered its body text at about
 * 4-5px. The page you pressed "Read" to see was the squeezed one.
 */
const BOARD_SIDE_MIN = 420;
/** Lower than the evidence viewers' floor: a whole tall page in a short
    pane is a quarter of its fit-to-width size, and "fit the page" must
    be able to get there. */
const ZOOM_MIN = 0.25;
/** Whether the diagram buttons are drawn; remembered on the device. */
const HOTSPOTS_KEY = 'vault:reader:hotspots';
/**
 * What this device learned about a book's pages last time it was open —
 * the first page's height over its width, and how many there are — so
 * the opening treatment can be the page's own shape and the toolbar can
 * say "/ 128" before the file is back. Measured on the demo: a 3:4 guess
 * stood 164px shorter than the page at 1280px and 36px taller at 390px,
 * and the centred toolbar stepped 8px sideways when the count arrived.
 */
const pageShapeKey = (id: string): string => `vault:book-page:${id}`;
function parsePageShape(raw: string | null): { aspect: number; pages: number } | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as { aspect?: unknown; pages?: unknown };
    if (typeof v.aspect !== 'number' || !(v.aspect > 0) || typeof v.pages !== 'number' || !(v.pages > 0))
      return null;
    return { aspect: v.aspect, pages: v.pages };
  } catch {
    return null;
  }
}
export function BookReader({ id, page }: { id: string; page?: string }) {
  const wide = useWideLayout();
  const [book, setBook] = useState<LibraryBook | null | undefined>(undefined);
  const { doc, error, retry } = useBookPdf(id, book?.bytes ?? null);
  const [reservedPage] = useState(() => parsePageShape(localStorage.getItem(pageShapeKey(id))));
  const pages = doc?.numPages ?? book?.pages ?? reservedPage?.pages ?? 0;
  const rememberPage = useCallback(
    (aspect: number) => {
      if (!doc) return;
      localStorage.setItem(pageShapeKey(id), JSON.stringify({ aspect, pages: doc.numPages }));
    },
    [id, doc],
  );

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
  // Where the next zoom holds still (a pinch's centre), with the scroll
  // offsets as they were when it was asked for; the scroller reads it.
  // Null: the viewport's centre at its current offsets.
  const zoomAnchor = useRef<(PinchPoint & { top?: number; left?: number }) | null>(null);
  const bumpZoom = (f: number, at?: PinchPoint & { top?: number; left?: number }): void => {
    zoomAnchor.current = at ?? null;
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));
  };
  // The diagram buttons can be put away: some books print a diagram's
  // caption or number where the button sits, and the reader wants to see it.
  const [hotspots, setHotspots] = useState(() => localStorage.getItem(HOTSPOTS_KEY) !== 'off');
  const toggleHotspots = (): void =>
    setHotspots((on) => {
      localStorage.setItem(HOTSPOTS_KEY, on ? 'off' : 'on');
      return !on;
    });
  // A quarter turn at a time, for a scan that came in sideways.
  const [rotation, setRotation] = useState<Rotation>(0);
  const rotate = (): void => setRotation((r) => (((r + 90) % 360) as Rotation));

  // Text search: hits are boxes on the pages; the current one is shown.
  const search = usePdfSearch(doc, goTo);

  // The editor in the board's place, for a diagram the reader misread or
  // a position to adjust: opened from a hotspot's chooser with the read
  // position, or from the moves header with what is on the board now.
  const [editing, setEditing] = useState<string | null>(null);
  const boardFen = useAnalysis((s) => getNode(s.tree, s.cursorId).fen);
  const loadFen = useAnalysis((s) => s.loadFen);

  const known = useKnownDiagrams(id);
  const diagramsOn = usePageDiagrams(id, doc);
  // The book's diagram pass, while it is this book's: shown over the page.
  const job = useDiagramJob();
  const reading = job.bookId === id && job.status === 'running' ? job : null;

  const [tab, setTab] = useState<'book' | 'board' | 'editor'>('book');
  // Opening the editor at wide swaps it for the board beside the page; on
  // a phone the editor IS a pane, so opening one is turning to its tab.
  const openEditor = (fen: string) => {
    setEditing(fen);
    if (!wide) setTab('editor');
  };
  // The board-over-panel arrangement beside the PDF: one pane at a time
  // under the board, as the phone does, rather than a panel that scrolls.
  const [loadOpen, setLoadOpen] = useState(false);
  const [stackedPane, stackedPaneW] = useElementWidth();
  const [wideRow, wideRowW] = useElementWidth();
  // The editor takes the board side; where that is too narrow for its
  // board and panel side by side, it stacks (see `force-stacked`).
  const [region, regionW] = useElementWidth();
  const stackEditor = regionW > 0 && regionW < 720;

  const overlayFor = (n: number) => {
    const pageHits = search.onPage(n);
    const currentOnPage = pageHits.findIndex((h) => h === search.hits[search.current]);
    return (
      <>
        {pageHits.length > 0 && (
          <SearchHighlights
            rects={pageHits.map((h) => h.rects)}
            currentIndex={currentOnPage}
            rotation={rotation}
          />
        )}
        {hotspots && (
          <DiagramHotspots
            diagrams={diagramsOn(n)}
            known={known.get(n) ?? []}
            rotation={rotation}
            sheet={!wide}
            onSet={() => {
              if (!wide) setTab('board');
            }}
            onEdit={openEditor}
          />
        )}
      </>
    );
  };

  // On a phone the PDF toolbar lives in the bottom bar, which only exists
  // while the Book tab is up; the pane renders its toolbar into this slot.
  const [barSlot, setBarSlot] = useState<HTMLDivElement | null>(null);
  const pdfPane = (width: number, compact: boolean) => (
    <PdfPane
      doc={doc}
      toolbarInto={compact ? barSlot : null}
      error={error}
      retry={retry}
      pageNo={pageNo}
      pages={pages}
      zoom={zoom}
      rotation={rotation}
      onRotate={rotate}
      search={search}
      width={width}
      compact={compact}
      goTo={goTo}
      onScrolledTo={setPageNo}
      bumpZoom={bumpZoom}
      setZoom={setZoom}
      zoomAnchor={zoomAnchor}
      overlayFor={overlayFor}
      reading={reading}
      hotspots={hotspots}
      onToggleHotspots={toggleHotspots}
      reservedAspect={reservedPage?.aspect ?? null}
      onAspect={rememberPage}
    />
  );

  // The moves panel: the Board page's, with the position loader and the
  // editor in its header — the reader's two ways of putting a position on
  // the board that did not come from a diagram.
  const movesPanel = (className?: string, nav = true) => (
    <Panel className={cn('min-h-0 flex-1', className)}>
      <PanelHeader
        title={t('Moves')}
        actions={
          <>
            <SidelinesToggle />
            {/* The loader's dialog, opened from the ⋯ below; the trigger
                itself is on the board's toolbar (wide) or in the menu. */}
            <LoadPositionButton
              open={loadOpen}
              onOpenChange={setLoadOpen}
              triggerClassName="hidden"
            />
            <MoveActions allowReset={false} allowClear />
            <MovesOverflow
              allowReset={false}
              allowClear
              onLoadPosition={() => setLoadOpen(true)}
              extra={[
                {
                  label: 'Open on the board page',
                  icon: Grid3x3,
                  onSelect: () => {
                    useAnalysis.setState({ handoff: true });
                    navigate('board');
                  },
                },
              ]}
            />
          </>
        }
      />
      <MoveTreePane />
      <AnalysisMoveBox />
      {nav && <PaneControls />}
    </Panel>
  );

  // The editor takes the board's place. Where the board and its panel are
  // stacked for want of room, the editor is stacked too: `force-stacked`
  // makes its subtree lay out as on a narrow viewport (see index.css).
  const editor = editing !== null && (
    <div className="flex h-full min-h-0 flex-col">
      {/* The same band as the toolbars over the PDF and the board — outside
          the force-stacked box below, whose `wide:` classes are off. Inset
          only at wide: stacked, it sits in the board shell's own padding,
          flush like the reader's row there.

          Wide only, now that a phone reaches the editor through the tab
          strip: the strip already names this pane and is already the way
          out of it, so a header saying both again cost the editor a row of
          board for nothing. */}
      {wide && (
        <div className="flex shrink-0 items-center gap-2 wide:h-9 wide:px-4 wide:mt-4 wide:mb-3 wide:md:px-6">
          <Button variant="ghost" size="icon-sm" title={t('Back to the board')} onClick={() => setEditing(null)}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">{t('Edit position')}</h1>
        </div>
      )}
      <div className={cn('min-h-0 flex-1', stackEditor && 'force-stacked')}>
        <EditorView
          key={editing}
          initialFen={editing}
          useLabel={t('Use on the board')}
          onUse={(fen) => {
            if (!loadFen(fen)) return;
            // At wide the editor is standing where the board was, so using
            // a position is closing it; on a phone the board is the tab
            // next door, and the editor stays as it is behind it.
            if (wide) setEditing(null);
            else setTab('board');
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
          icon={BookX}
          title={t('That book is not on the shelf')}
          body={t('It may have been removed. The shelf has what is there.')}
          action={<Button onClick={() => navigate('books')}>{t('Back to Books')}</Button>}
        />
      </div>
    );
  }

  const header = (flush: boolean) => (
    <ReaderHeader
      title={book?.title ?? ''}
      onBack={() => up('books')}
      menu={book ? <ReaderMenu book={book} onChanged={() => void load(true)} /> : null}
      flush={flush}
    />
  );

  // The board side's toolbar at wide — the same band as the PDF's, over
  // the board: a position from elsewhere, the editor, and the board page.
  // It takes the slot the board's player strip would have had (the reader
  // never loads a game), so the board top meets the page top beside it.
  const boardBar = (
    <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 px-4 md:px-6 wide:mt-4 wide:mb-3">
      <LoadPositionButton open={loadOpen} onOpenChange={setLoadOpen} />
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Reset to the starting position')}
        onClick={() => useAnalysis.getState().reset()}
      >
        <RotateCcw className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={t('Fix this position in the editor')}
        onClick={() => openEditor(boardFen)}
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
    </div>
  );

  // The board and its navigation: the whole of the board side at wide. The
  // moves and the engine are the board page's, one press away; what the
  // reader beside a book wants is the position and a way through it.
  const boardOnly = (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 pb-4 md:px-6 md:pb-6 wide:[&>*:first-child]:flex-none wide:[&>*:first-child]:w-full wide:[&>*:first-child]:mx-auto wide:[&>*:first-child]:pr-5">
      {/* The board column is capped (board-col-cap) to what the board can
          use, and as a flex-none item of this column it sat at the left of
          a wider region. An explicit full width (still under the cap) and
          auto margins centre it — and the board, once the eval slot's 20px
          is paid back on the right — on the nav's centre line below.
          (self-center would un-stretch it and collapse it to nothing.) */}
      <AnalysisBoard strip={false} />
      <div className={cn('mx-auto w-full wide:px-5', BOARD_MAX_W)}>
        <BoardControls className="-my-1" />
      </div>
    </div>
  );

  if (wide) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col">
        {header(false)}
        <div ref={wideRow} className="flex min-h-0 flex-1">
          <ResizablePane
            storageKey={PANE_KEY}
            defaultWidth={PANE_DEFAULT_W}
            minWidth={320}
            hardMax={1200}
            /* Two ceilings, whichever bites first: the board keeps
               BOARD_SIDE_MIN, and the book never takes more than 55% of
               the row. The percentage is what makes the book LEAD where
               the space is contested — on a 1120px window it resolves to
               about 490 against the board's 420 — while the fixed default
               above wins on a wide monitor, where a page much past 560
               stops gaining anything and the board would rather have it. */
            maxWidth={
              wideRowW > 0
                ? Math.max(320, Math.min(wideRowW - BOARD_SIDE_MIN, Math.round(wideRowW * 0.55)))
                : undefined
            }
            className="flex min-h-0 flex-col"
          >
            {(shownW) => pdfPane(shownW, false)}
          </ResizablePane>
          <div ref={region} className="flex min-h-0 min-w-0 flex-1 flex-col">
            {editor || (
              <>
                {boardBar}
                {boardOnly}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Stacked (a phone): one thing at a time. The switcher under the header
  // turns the page between the book, filling the screen, and the board
  // with its moves under it — never both; the bottom bar is the board's
  // and only shows with it.
  return (
    <div className={BOARD_HELD_SHELL}>
      {header(true)}
      {
        <>
          <PaneTabs
            value={tab}
            onChange={(id) => {
              // The tab is reached by hand as well as from a diagram, and
              // by hand it has no position of its own: what Edit means
              // with nothing chosen is the board as it stands. Seeded on
              // the way in rather than while rendering, so the key — and
              // with it the editor's state — holds still while the board
              // moves behind the other tabs.
              if (id === 'editor' && editing === null) setEditing(boardFen);
              setTab(id);
            }}
            tabs={[
              { id: 'book', label: t('Book'), icon: BookText },
              { id: 'board', label: t('Board'), icon: Grid3x3 },
              { id: 'editor', label: t('Edit'), icon: SquarePen },
            ]}
          />
          <div
            ref={stackedPane}
            className={cn('flex min-h-0 flex-1 flex-col', tab !== 'book' && 'hidden')}
          >
            {pdfPane(stackedPaneW, true)}
          </div>
          <div className={cn('flex min-h-0 flex-1 flex-col gap-2', tab !== 'board' && 'hidden')}>
            {/* The moves panel below carries the navigation at md, the
                bottom bar under that. */}
            <AnalysisBoard />
            <div
              className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:min-h-40 stacked:gap-2 ${BOARD_WIDE_SIDE}`}
            >
              {movesPanel()}
            </div>
          </div>
          {/* Kept mounted behind the other tabs, as they are behind it: an
              editor unmounted on the way to the page it was read from
              would lose a half-placed position every time. */}
          <div className={cn('flex min-h-0 flex-1 flex-col', tab !== 'editor' && 'hidden')}>
            {editor}
          </div>
        </>
      }
      {/* The bottom bar is the book's page controls on the Book tab, the
          board's navigation on the Board tab. */}
      <MobileActionBar>
        {tab === 'board' ? (
          <BoardControls className="py-1.5" />
        ) : (
          // The editor carries its own toolbar under its board, so the bar
          // holds nothing on that tab — claimed and empty (as a note being
          // written does), which is what keeps the global navigation from
          // coming back under a half-placed position.
          <div
            ref={setBarSlot}
            className={cn('flex flex-1 items-center justify-center', tab === 'editor' && 'hidden')}
          />
        )}
      </MobileActionBar>
    </div>
  );
}

/**
 * The app's page header on PageShell's own insets — 16px, 24 from md —
 * and the toolbars, page and board under it keep the same inset, so the
 * chevron, the page's left edge and the bin stand on one line. The band
 * under it (wide:mt-4) is the shell's gap-4. A top-level page's header
 * on a desktop, chevron included (the sidebar names Books, not this
 * book); on a phone the leaf row the board pages wear — see `flush`.
 */
function ReaderHeader({
  title,
  onBack,
  menu,
  flush = false,
}: {
  title: string;
  onBack: () => void;
  menu?: React.ReactNode;
  /**
   * Inside the stacked board shell (a phone), which pads the page itself:
   * the row the board-family leaf pages open with there — chevron, a
   * text-base title, the actions — rather than the top-level header.
   */
  flush?: boolean;
}) {
  if (flush) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="icon-sm" title={t('Back to Books')} onClick={onBack}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-foreground min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
        {menu}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center px-4 pt-4 md:px-6 md:pt-6">
      <PageHeader
        className="min-w-0 flex-1"
        title={title}
        back={onBack}
        backVisible="always"
        truncate
        actions={menu}
      />
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
      {note && (
        <span className="text-destructive text-xs" role="alert">
          {note}
        </span>
      )}
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
        triggerTitle={t('Remove from the shelf')}
        // The bin in the destructive colour: it is the one thing in this
        // header that loses something, and it should look it.
        triggerClassName="text-destructive hover:text-destructive"

        question={t('Remove “{title}” from the shelf? The PDF is deleted; any puzzle book read from it is kept.', {
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
          onUploaded={(id) => {
            setReplacing(false);
            // The shelf row's size changes with the file, and the PDF's URL
            // is versioned by it — so a fresh row is a fresh document. Its
            // diagrams are read again, now, in the background.
            onChanged();
            void useDiagramJob.getState().start(id);
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
  rotation,
  onRotate,
  search,
  width,
  compact,
  toolbarInto = null,
  goTo,
  onScrolledTo,
  bumpZoom,
  setZoom,
  zoomAnchor,
  overlayFor,
  reading,
  hotspots,
  onToggleHotspots,
  reservedAspect,
  onAspect,
}: {
  doc: ReturnType<typeof useBookPdf>['doc'];
  error: string | null;
  retry: () => void;
  pageNo: number;
  pages: number;
  zoom: number;
  rotation: Rotation;
  onRotate: () => void;
  search: PdfSearch;
  width: number;
  /** Phones: the toolbar goes to the bottom bar, not over the page. */
  compact: boolean;
  /** Where a compact toolbar is rendered (the bottom bar's slot). */
  toolbarInto?: HTMLElement | null;
  goTo: (n: number) => void;
  /** The page the scroller arrived at on its own. */
  onScrolledTo: (n: number) => void;
  bumpZoom: (f: number, at?: PinchPoint & { top?: number; left?: number }) => void;
  setZoom: (z: number) => void;
  zoomAnchor: React.RefObject<(PinchPoint & { top?: number; left?: number }) | null>;
  overlayFor: (page: number) => React.ReactNode;
  /** The diagram pass over this book, while it runs: a line over the page. */
  reading: { page: number; pages: number } | null;
  /** The first page's height over its width from a previous open, for
      the opening treatment before the document is back. */
  reservedAspect: number | null;
  /** The measured first-page shape, unrotated — the reader remembers it. */
  onAspect: (aspect: number) => void;
  /** Whether the diagram buttons are drawn over the pages. */
  hotspots: boolean;
  onToggleHotspots: () => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  // Rebound when the document arrives: the viewport is the scroller's
  // element, which is only rendered once there is a document to scroll —
  // bound at mount alone, the listeners went on nothing and a pinch on a
  // phone did nothing.
  // A pinch is previewed as a CSS scale of the column and committed once
  // when the fingers lift (use-pinch-zoom.ts); the preview is clamped to
  // what the commit will allow, so the page does not grow past the limit
  // and snap back.
  const [pinch, setPinch] = useState<PinchLive | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Every zoom is asked for with the anchor AND the scroll offsets of the
  // moment — captured here, before the commit, because a zoom out can
  // shrink the column past the old scrollTop and the browser clamps it
  // at relayout, before the scroller's own effect gets to read it.
  const anchoredBump = (f: number, at?: PinchPoint): void => {
    const el = viewport.current;
    bumpZoom(
      f,
      el
        ? {
            x: at?.x ?? el.clientWidth / 2,
            y: at?.y ?? el.clientHeight / 2,
            top: el.scrollTop,
            left: el.scrollLeft,
          }
        : at,
    );
  };
  usePinchZoom(viewport, anchoredBump, doc, (p) => {
    if (!p) return setPinch(null);
    const z = zoomRef.current;
    const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * p.scale)) / z;
    setPinch({ ...p, scale });
  });
  // The one opening treatment: the labelled skeleton stays up — over the
  // scroller once the document is open — until the FIRST page has
  // rastered, so an open never shows two kinds of spinner back to back
  // (the labelled one, then the pages' own slot spinners). The slot
  // spinner still exists, but only for jumps deep into an open book.
  const [painted, setPainted] = useState(false);
  useEffect(() => setPainted(false), [doc]);
  const slow = useSlowLoad((doc === null || !painted) && error === null);
  // The page's width at zoom 1: the pane less the header's inset a side.
  // On a phone, the viewport's own content width — measured, so the
  // scrollbar gutters it reserves on both edges (or does not, with
  // overlay scrollbars) are out of it; sized to the pane, the page ran
  // under the gutters and the viewport scrolled sideways.
  const md = useMediaQuery('(min-width: 48rem)');
  const [vpW, setVpW] = useState(0);
  // (The pane's width until the viewport exists to be measured — it is
  // rendered only once a width is known — then the viewport's own.)
  const pageW = compact ? vpW || width : Math.max(0, width - (md ? 48 : 32));
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
      const v = p.getViewport({ scale: 1, rotation });
      setAspect(v.height / v.width);
    });
    return () => {
      live = false;
    };
  }, [doc, rotation]);
  // Remembered for the next open's treatment — unrotated, which is how a
  // book opens.
  useEffect(() => {
    if (aspect === null || rotation !== 0) return;
    onAspect(aspect);
  }, [aspect, rotation, onAspect]);
  const fitZoomFor = (height: number): number | null =>
    aspect && pageW > 0 && height > 0
      ? Math.min(1, Math.max(ZOOM_MIN, (height - 24) / (pageW * aspect)))
      : null;
  const [vpH, setVpH] = useState(0);
  const hasViewport = pageW > 0;
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const read = (): void => {
      setVpH(el.clientHeight);
      setVpW(el.clientWidth);
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
    // The viewport is the scroller's element, rendered only once there is
    // a document AND a width — on a phone the width arrives after the
    // document, so the observer must be bound when the scroller is.
  }, [doc, hasViewport]);
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
  // The page number is a field: typing one and pressing Enter goes there,
  // which is the go-to every reader knows without a label.
  const [typed, setTyped] = useState<string | null>(null);
  const size = compact ? 'icon' : 'icon-sm';
  // A narrow pane cannot hold the whole row: the page field is the one
  // thing that must not squash, so the view controls fold into a "…"
  // menu — a dropdown at wide, the bottom sheet on a phone (ActionMenu).
  // Search stays out: it is the one verb after turning the page. On a
  // phone the bar is always the short row; at a desktop pane it folds
  // under 520 px, where the measured row began to eat the field.
  const fold = compact || width < 520;
  const [moreOpen, setMoreOpen] = useState(false);
  const more: MenuAction[] = fold
    ? [
        ...(!compact
          ? [
              ...(fitPageZoom !== null && (fitPageZoom < 1 || fitted)
                ? [
                    {
                      label: fitted ? 'Fit the width' : 'Fit the whole page',
                      icon: fitted ? MoveHorizontal : Maximize2,
                      onSelect: toggleFit,
                    },
                  ]
                : []),
              { label: 'Zoom in', icon: ZoomIn, onSelect: () => anchoredBump(1.25) },
              { label: 'Zoom out', icon: ZoomOut, onSelect: () => anchoredBump(1 / 1.25) },
              { label: 'Reset zoom', icon: Percent, onSelect: () => anchoredBump(1 / zoom) },
            ]
          : []),
        { label: 'Rotate the page', icon: RotateCw, onSelect: onRotate },
        {
          label: hotspots ? 'Hide the diagram buttons' : 'Show the diagram buttons',
          icon: Grid3x3,
          onSelect: onToggleHotspots,
        },
      ]
    : [];
  const toolbar = (
    <>
      {/* One group, centred: what the page is and how it is shown. The same
          h-9 band every board page opens its side column with, and the same
          rhythm around it at wide — 16px above (the row's p-4), 12px below
          (the column's gap-3): that is what puts a first panel on the
          board's top edge there, and here it puts the viewport — the line
          the page is cut on when it scrolls, the top edge of a page just
          turned to — on the board's line beside it. */}
      <div
        className={
          compact
            ? 'flex flex-1 items-center justify-center gap-0.5 py-1.5'
            : 'flex h-9 shrink-0 items-center justify-center gap-0.5 px-4 md:px-6 wide:mt-4 wide:mb-3'
        }
      >
        <Button variant="ghost" size={size} disabled={pageNo <= 1} onClick={() => goTo(pageNo - 1)} title={t('Previous page')}>
          <ChevronLeft className={icon} />
        </Button>
        <TitleTip title={t('Go to page')}>
          <Input
            inputSize="sm"
            inputMode="numeric"
            className="w-12 text-center tabular-nums"
            value={typed ?? String(pageNo || 1)}
            aria-label={t('Go to page')}
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
        </TitleTip>
        <span className="text-muted-foreground px-1 text-sm tabular-nums">
          {pages > 0 ? `/ ${pages}` : ''}
        </span>
        <Button variant="ghost" size={size} disabled={pages > 0 && pageNo >= pages} onClick={() => goTo(pageNo + 1)} title={t('Next page')}>
          <ChevronRight className={icon} />
        </Button>
        {/* Fit the whole page only where a page can be taller than its
            viewport at the width fit — a desktop pane. A portrait phone
            already shows the whole page at that width, so the button sat
            disabled there; pinch is the phone's zoom. */}
        {!fold && (
          <>
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
          </>
        )}
        {/* Zoom buttons only where there is no pinch: a phone's bar has
            room for page, fit, rotate and search at touch size, and no
            more — the measured row overflowed the screen with them. */}
        {!fold && (
          <>
            <Button variant="ghost" size={size} disabled={zoom <= ZOOM_MIN} onClick={() => anchoredBump(1 / 1.25)} title={t('Zoom out')}>
              <ZoomOut className={icon} />
            </Button>
            {width >= 420 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground w-12 tabular-nums"
                onClick={() => anchoredBump(1 / zoom)}
                title={t('Reset zoom')}
              >
                {Math.round(zoom * 100)}%
              </Button>
            )}
            <Button variant="ghost" size={size} disabled={zoom >= ZOOM_MAX} onClick={() => anchoredBump(1.25)} title={t('Zoom in')}>
              <ZoomIn className={icon} />
            </Button>
            <span className="bg-border mx-1 h-4 w-px" />
          </>
        )}
        {!fold && (
          <>
            <Button variant="ghost" size={size} onClick={onRotate} title={t('Rotate the page')}>
              <RotateCw className={icon} />
            </Button>
            <Button
              variant="ghost"
              size={size}
              aria-pressed={hotspots}
              className={cn(hotspots && 'text-primary')}
              onClick={onToggleHotspots}
              title={hotspots ? t('Hide the diagram buttons') : t('Show the diagram buttons')}
            >
              <Grid3x3 className={icon} />
            </Button>
          </>
        )}
        <SearchPopover search={search} size={size} icon={icon} sheet={compact} />
        {more.length > 0 && (
          <ActionMenu title={t('Page')} actions={more} open={moreOpen} onOpenChange={setMoreOpen}>
            <Button variant="ghost" size={size} title={t('More')} active={moreOpen}>
              <MoreHorizontal className={icon} />
            </Button>
          </ActionMenu>
        )}
      </div>
    </>
  );
  return (
    <>
      {compact ? toolbarInto && createPortal(toolbar, toolbarInto) : toolbar}
      {reading && (
        <div className="text-muted-foreground flex h-7 shrink-0 items-center justify-center gap-1.5 text-xs">
          <Spinner className="size-3 shrink-0" />
          {t('Reading diagrams, page {page} of {pages}', { page: reading.page, pages: reading.pages })}
        </div>
      )}
      {error ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <EmptyState
            icon={FileX}
            title={t('The PDF could not be opened')}
            body={error}
            action={<Button onClick={retry}>{t('Try again')}</Button>}
          />
        </div>
      ) : doc && pageNo > 0 && pageW > 0 ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <PdfScroller
            doc={doc}
            pages={doc.numPages}
            width={pageW}
            zoom={zoom}
            rotation={rotation}
            pageNo={pageNo}
            onPageChange={onScrolledTo}
            overlayFor={overlayFor}
            onPainted={() => setPainted(true)}
            viewportRef={viewport}
            zoomAnchor={zoomAnchor}
            pinch={pinch}
            onKeyDown={onKey}
          />
          {/* Opaque over the scroller while the first raster is on its
              way: the pages underneath lay out (and start rendering) but
              their slots' own spinners never show through an open. */}
          {!painted && (
            <div className="bg-background absolute inset-0 z-10 overflow-hidden">
              <OpeningTreatment show={slow} pageW={pageW} aspect={aspect ?? reservedAspect} />
            </div>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <OpeningTreatment show={slow} pageW={pageW} aspect={reservedAspect} />
        </div>
      )}
    </>
  );
}

/**
 * The one look an opening book has: the page-shaped skeleton with
 * "Opening the book…", shown while the document loads AND until its first
 * page has rastered — `show` gates the content behind the slow-load beat,
 * the ground is painted either way so nothing shows through.
 */
function OpeningTreatment({
  show,
  pageW,
  aspect,
}: {
  show: boolean;
  pageW: number;
  /** The first page's height over its width, where it is known; a 3:4
      page otherwise. */
  aspect: number | null;
}) {
  return (
    <div className="bg-muted/40 h-full overflow-hidden">
      {show && (
        // No padding of its own: the scroller puts its first page on the
        // column's top edge, and the p-3 this wore started the placeholder
        // 12px below where the page lands.
        // items-start, or the flex item stretches to the column's height
        // and the aspect ratio never applies — which is what the old
        // aspect-[3/4] class had been doing all along: the placeholder
        // was always the pane's height, whatever it claimed.
        <div className="relative flex h-full items-start justify-center">
          {/* animate-none: this is a page-sized layer, and a layer that size
              pulsing its opacity is composited in tiles that do not all
              repaint on the same frame. On a phone the seams showed as
              dark rectangles wandering over the placeholder (lanph3re's
              report); a headless capture caught one such frame. The
              spinner beside it is the motion that says loading. */}
          <Skeleton
            className="animate-none rounded-md"
            style={{ width: pageW || '100%', aspectRatio: `1 / ${aspect ?? 4 / 3}` }}
          />
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
            <Spinner />
            {t('Opening the book…')}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The search box: a field, the count, and a way through the hits. Opened
 * from the toolbar (or the phone's bottom bar) and closed by Escape or a
 * tap outside; the hits stay on the pages until the query is cleared.
 */
function SearchPopover({
  search,
  size,
  icon,
  sheet = false,
}: {
  search: PdfSearch;
  size: 'icon' | 'icon-sm';
  icon: string;
  /** A phone: the box is a bottom sheet (the app's Dialog), not a popover
      hanging off a button in the bottom bar. */
  sheet?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(search.query);
  const active = search.query.trim().length > 0;
  const trigger = (
    <Button
      variant="ghost"
      size={size}
      title={t('Search the book')}
      aria-pressed={active}
      className={cn(active && 'text-primary')}
      onClick={sheet ? () => setOpen(true) : undefined}
    >
      <Search className={icon} />
    </Button>
  );
  const body = (
    <>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() === search.query.trim() && search.hits.length > 0) search.next();
            else search.run(draft);
          }}
        >
          <Input
            inputSize="sm"
            autoFocus
            value={draft}
            placeholder={t('Search the book…')}
            aria-label={t('Search the book…')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="secondary" size="icon-sm" title={t('Search')}>
            <Search className="size-3.5" />
          </Button>
        </form>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" disabled={search.hits.length === 0} onClick={search.prev} title={t('Previous match')}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={search.hits.length === 0} onClick={search.next} title={t('Next match')}>
            <ChevronRight className="size-3.5" />
          </Button>
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm tabular-nums">
            {search.scanning !== null
              ? t('{n} found, reading page {page}…', { n: search.hits.length, page: search.scanning })
              : active
                ? search.hits.length > 0
                  ? t('{k} of {n}', { k: search.current + 1, n: search.hits.length })
                  : t('No matches')
                : ''}
          </span>
          {active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                search.clear();
                setDraft('');
              }}
            >
              {t('Clear')}
            </Button>
          )}
        </div>
    </>
  );
  if (sheet) {
    return (
      <>
        {trigger}
        {open && (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) setOpen(false);
            }}
          >
            <DialogContent size="sm" title={t('Search the book')} icon={Search}>
              {body}
            </DialogContent>
          </Dialog>
        )}
      </>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="flex w-72 flex-col gap-2 p-2">
        {body}
      </PopoverContent>
    </Popover>
  );
}
