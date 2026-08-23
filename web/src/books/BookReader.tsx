import {
  BookText,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileUp,
  Grid3x3,
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
import { BOARD_MAX_W } from '@/board/boardSize';
import { MoveActions, MovesOverflow } from '@/analysis/AnalysisView';
import { MoveTreePane, SidelinesToggle } from '@/analysis/MoveTreePane';
import { LoadPositionButton } from '@/analysis/PositionLoader';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EmptyState } from '@/components/empty-state';
import { NoMatchArt } from '@/components/empty-art';
import { BOARD_HELD_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { Panel, PanelHeader } from '@/components/panel';
import { PageHeader } from '@/components/page-header';
import { PaneTabs } from '@/components/pane-tabs';
import { ResizablePane } from '@/components/resizable-pane';
import { Skeleton, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditorView } from '@/editor/EditorView';
import { EngineBlock } from '@/engine/EnginePane';
import { useElementWidth } from '@/hooks/use-element-width';
import { usePinchZoom, ZOOM_MAX } from '@/hooks/use-pinch-zoom';
import { api, apiErrorMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useMediaQuery, useWideLayout } from '@/lib/media';
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
  // The board-over-panel arrangement beside the PDF: one pane at a time
  // under the board, as the phone does, rather than a panel that scrolls.
  const [loadOpen, setLoadOpen] = useState(false);
  const [stackedPane, stackedPaneW] = useElementWidth();
  const [wideRow, wideRowW] = useElementWidth();
  // The editor takes the board side; where that is too narrow for its
  // board and panel side by side, it stacks (see `force-stacked`).
  const [region, regionW] = useElementWidth();
  const stackEditor = regionW > 0 && regionW < 720;

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
      overlayFor={overlayFor}
      onVisible={setShown}
    />
  );

  // The moves panel: the Board page's, with the position loader and the
  // editor in its header — the reader's two ways of putting a position on
  // the board that did not come from a diagram.
  const movesPanel = (className?: string, engineDocked = true, nav = true) => (
    <Panel flush className={cn('min-h-0 flex-1', className)}>
      {engineDocked && <EngineBlock />}
      <PanelHeader
        title={t('Moves')}
        actions={
          <>
            <SidelinesToggle />
            {/* Stacked only: at wide these live on the board's toolbar. */}
            <LoadPositionButton
              open={loadOpen}
              onOpenChange={setLoadOpen}
              triggerClassName="wide:hidden"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="wide:hidden"
              title={t('Fix this position in the editor')}
              onClick={() => setEditing(boardFen)}
            >
              <SquarePen className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="wide:hidden"
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
      {nav && <BoardControls className="border-border border-t max-md:hidden" keyboard={false} />}
    </Panel>
  );

  // The editor takes the board's place. Where the board and its panel are
  // stacked for want of room, the editor is stacked too: `force-stacked`
  // makes its subtree lay out as on a narrow viewport (see index.css).
  const editor = editing !== null && (
    <div className="flex h-full min-h-0 flex-col">
      {/* The same band as the toolbars over the PDF and the board — outside
          the force-stacked box below, whose `wide:` classes are off. */}
      <div className="flex h-9 shrink-0 items-center gap-2 px-4 md:px-6 wide:mt-4 wide:mb-3">
        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
          <ChevronLeft data-icon="inline-start" />
          {t('Back to the board')}
        </Button>
        <span className="text-muted-foreground truncate text-sm">
          {t('Fix the position, then use it on the board.')}
        </span>
      </div>
      <div className={cn('min-h-0 flex-1', stackEditor && 'force-stacked')}>
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
        <BoardControls keyboard={false} className="-my-1" />
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
            maxWidth={wideRowW > 0 ? Math.max(280, wideRowW - 640) : undefined}
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

  // Stacked: the board page's own shape, the book as one of the panes.
  return (
    <div className={BOARD_HELD_SHELL}>
      {header(true)}
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
    </div>
  );
}

/**
 * The app's page header on PageShell's own insets — 16px, 24 from md —
 * and the toolbars, page and board under it keep the same inset, so the
 * chevron, the page's left edge and the bin stand on one line. The band
 * under it (wide:mt-4) is the shell's gap-4. The chevron is a phone's,
 * as on every page: on a desktop the reader is a top-level page, reached
 * and left through the sidebar's Books.
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
  /** Inside the stacked board shell, which pads the page itself. */
  flush?: boolean;
}) {
  return (
    <div className={cn('flex shrink-0 items-center', !flush && 'px-4 pt-4 md:px-6 md:pt-6')}>
      <PageHeader
        className="min-w-0 flex-1"
        title={title}
        back={onBack}
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
        // The bin in the destructive colour: it is the one thing in this
        // header that loses something, and it should look it.
        triggerClassName="text-destructive hover:text-destructive"

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
  overlayFor: (page: number) => React.ReactNode;
  onVisible: (pages: number[]) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  usePinchZoom(viewport, bumpZoom);
  const slow = useSlowLoad(doc === null && error === null);
  // The page's width at zoom 1: the pane less the header's inset a side —
  // none on a phone, where the pane is already inside the shell's padding
  // and the page's edges should be the board's.
  const md = useMediaQuery('(min-width: 48rem)');
  const pageW = Math.max(0, width - (compact ? 0 : md ? 48 : 32));
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
  // The page number is a field: typing one and pressing Enter goes there,
  // which is the go-to every reader knows without a label.
  const [typed, setTyped] = useState<string | null>(null);
  const size = compact ? 'icon' : 'icon-sm';
  return (
    <>
      {/* One group, centred: what the page is and how it is shown. The same
          h-9 band every board page opens its side column with, and the same
          rhythm around it at wide — 16px above (the row's p-4), 12px below
          (the column's gap-3): that is what puts a first panel on the
          board's top edge there, and here it puts the viewport — the line
          the page is cut on when it scrolls, the top edge of a page just
          turned to — on the board's line beside it. */}
      <div className="flex h-9 shrink-0 items-center justify-center gap-0.5 px-4 md:px-6 wide:mt-4 wide:mb-3">
        <Button variant="ghost" size={size} disabled={pageNo <= 1} onClick={() => goTo(pageNo - 1)} title={t('Previous page')}>
          <ChevronLeft className={icon} />
        </Button>
        <Input
          inputSize="sm"
          inputMode="numeric"
          className="w-12 text-center tabular-nums"
          value={typed ?? String(pageNo || 1)}
          aria-label={t('Go to page')}
          title={t('Go to page')}
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
        <span className="text-muted-foreground px-1 text-sm tabular-nums">
          {pages > 0 ? `/ ${pages}` : ''}
        </span>
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
