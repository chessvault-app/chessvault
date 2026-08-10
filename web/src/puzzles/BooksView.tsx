import {
  BadgeCheck,
  BarChart3,
  BookMarked,
  BookOpenCheck,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
  LayoutGrid,
  FileUp,
  CircleHelp,
  Cpu,
  Maximize2,
  Minimize2,
  Pencil,
  ScanSearch,
  Check,
  Eye,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseSquare, parseUci, squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import {
  addUci,
  createTree,
  getNode,
  legalDests,
  mainlineFrom,
  positionAt,
  promoteToMainline,
  updateNode,
} from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { BOARD_MAX_W } from '@/board/boardSize';
import { Board } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { EditorView } from '@/editor/EditorView';
import { cn } from '@/lib/cn';
import { suppressNextClick } from '@/lib/suppressNextClick';
import { ConfirmPopover } from '@/ui/ConfirmPopover';
import { SkeletonRows } from '@/ui/Skeleton';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { Input } from '@/ui/Input';
import { Panel, PanelHeader } from '@/ui/Panel';
import { SideDot } from '@/ui/SideDot';
import { judgeBookMove, type BookSolution } from './bookJudge';
import { Suspense, lazy } from 'react';

const PdfImport = lazy(() => import('./PdfImport').then((m) => ({ default: m.PdfImport })));
import { useImportJob } from './importJob';
import {
  classifyBoard,
  harvestTemplates,
  isValidTemplate,
  labelsToFen,
  type Template,
} from './ocr/classify';
import { boardFromImage, featuresFromImage, loadImage } from './ocr/browser';
import { classifyBoardNet, loadCellNet } from './ocr/cellnet';
import { ChipRow } from '@/ui/ChipRow';
import { FilterChip } from '@/ui/FilterChip';
import { PaneTabs } from '@/ui/PaneTabs';
import { ProgressBar } from '@/ui/ProgressBar';
import { evaluateWhitePov, movePasses } from '@/engine/adjudicate';
import { AnswerPanel } from './AnswerPanel';
import { formatScore } from '@/engine/uci';

/**
 * Book puzzles (lanph3re's long-wanted feature): positions transcribed from
 * paper books, trained STRICTLY — the solver enters every move of the
 * solution, both sides, no auto-replies — with per-book progress. v1 is
 * manual board entry; diagram OCR is the planned v2.
 *
 * Routes: #/puzzles/books (shelf), /books/<slug> (book), /books/<slug>/<id>
 * (trainer).
 */

interface BookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
  cover?: boolean;
}

/**
 * A puzzle AS THE GRID KNOWS IT. The position and its solution are not
 * here: a book's list exists to draw numbered tiles, and shipping every
 * position and line to do that is most of what a big book weighs. They
 * come from /solutions the moment something actually solves.
 */
interface BookPuzzle {
  id: string;
  /** Auto-imported puzzles carry their book number, fidelity tier and the
   *  source page (with the diagram's bounds as page fractions) so the
   *  original context is one click away. */
  number?: number;
  provenance?:
    | 'book-parsed'
    | 'engine-corroborated'
    | 'engine-only'
    | 'engine-unverified'
    | 'corrected'
    | 'draft';
  evidence?: BookEvidence;
}

/** The half of a puzzle only the solver and the corrector need. */
interface PuzzleSolution {
  fen: string;
  uci: string[];
  san: string[];
  wildcards?: number[];
}

type SourceRect = { x: number; y: number; w: number; h: number };

interface BookEvidence {
  page?: string;
  rect?: SourceRect;
  /** The solutions page covering this puzzle's number (page-level match). */
  solutionPage?: string;
}

interface PuzzleProgress {
  tries: number;
  wins: number;
  last: 'win' | 'loss';
  at: string;
}

interface BookDraft {
  id: string;
  image: string;
  fen: string | null;
  number?: number;
  evidence?: BookEvidence;
}

interface BookDetail {
  slug: string;
  title: string;
  puzzles: BookPuzzle[];
  progress: Record<string, PuzzleProgress>;
  drafts?: BookDraft[];
}

async function bookTemplates(slug: string): Promise<Template[]> {
  try {
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/ocr`);
    if (!res.ok) return [];
    return ((await res.json()) as { templates: unknown[] }).templates.filter(isValidTemplate);
  } catch {
    return [];
  }
}

const diagramUrl = (slug: string, file: string): string =>
  `/api/puzzlebooks/${encodeURIComponent(slug)}/diagrams/${file}`;

export function BooksView({ params }: { params: string[] }) {
  // Route segments arrive URL-encoded ("Test%20Book").
  const slug = params[0] ? decodeURIComponent(params[0]) : null;
  const puzzleId = params[1] ? decodeURIComponent(params[1]) : null;
  // /books/<slug>/fix/<id>: correct an existing puzzle through entry flow.
  if (slug && puzzleId === 'fix' && params[2]) {
    return (
      <PuzzleCorrector
        key={`${slug}/fix/${params[2]}`}
        slug={slug}
        puzzleId={decodeURIComponent(params[2])}
      />
    );
  }
  if (slug && puzzleId) {
    return <BookTrainer key={`${slug}/${puzzleId}`} slug={slug} puzzleId={puzzleId} />;
  }
  if (slug) return <BookPage key={slug} slug={slug} />;
  return <Shelf />;
}

/**
 * One book detail per slug, shared by the shelf page, the solver and the
 * corrector. Stepping between puzzles remounts the trainer (it is keyed on
 * the puzzle id), which used to re-download the WHOLE book — every puzzle's
 * position, solution and evidence — just to show the next one.
 *
 * Integrity: the only field that changes while a book is open is progress,
 * and the attempt route returns the updated entry, so it is patched in
 * exactly rather than guessed. Anything that rewrites puzzles or drafts
 * (import, re-read, a correction, a delete) calls forgetBook, so the next
 * read is fresh. A reload starts empty.
 */
const bookCache = new Map<string, BookDetail>();

/** Positions and lines, fetched once per book when something solves. */
const solutionCache = new Map<string, Record<string, PuzzleSolution>>();

function forgetBook(slug?: string): void {
  if (slug === undefined) {
    bookCache.clear();
    solutionCache.clear();
  } else {
    bookCache.delete(slug);
    solutionCache.delete(slug);
  }
}

/**
 * The book's positions and solutions — one request, cached like the book.
 *
 * One request rather than one per puzzle on purpose: stepping between
 * puzzles has to stay instant, and the goal is to keep this weight off the
 * path that merely OPENS a book, not to trade one wait for a hundred.
 */
async function loadSolutions(slug: string): Promise<Record<string, PuzzleSolution>> {
  const hit = solutionCache.get(slug);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/solutions`);
    if (!res.ok) return {};
    const body = (await res.json()) as { solutions?: Record<string, PuzzleSolution> };
    const solutions = body.solutions ?? {};
    solutionCache.set(slug, solutions);
    return solutions;
  } catch {
    return {};
  }
}

async function loadBook(slug: string, force = false): Promise<BookDetail | null> {
  if (!force) {
    const hit = bookCache.get(slug);
    if (hit) return hit;
  }
  const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}`);
  if (!res.ok) return null;
  const detail = (await res.json()) as BookDetail;
  bookCache.set(slug, detail);
  return detail;
}

/** Fold a recorded attempt into the cached book, so the grid and
    "next unsolved" stay correct without a refetch. */
function patchProgress(slug: string, id: string, progress: PuzzleProgress): BookDetail | null {
  const hit = bookCache.get(slug);
  if (!hit) return null;
  const next = { ...hit, progress: { ...hit.progress, [id]: progress } };
  bookCache.set(slug, next);
  return next;
}

/** Load the puzzle, then reuse the standard entry flow to replace it. */
function PuzzleCorrector({ slug, puzzleId }: { slug: string; puzzleId: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  useEffect(() => {
    void loadBook(slug).then(setBook);
  }, [slug]);
  const puzzle = book?.puzzles.find((p) => p.id === puzzleId);
  if (!book) {
    return (
      <div className="text-subtle grid h-full place-items-center">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!puzzle) {
    return <div className="text-muted grid h-full place-items-center text-sm">Puzzle not found.</div>;
  }
  return (
    <PuzzleEntry
      slug={slug}
      number={puzzle.number ?? book.puzzles.indexOf(puzzle) + 1}
      replace={puzzle}
      onDone={() => navigate('puzzles', 'books', slug, puzzle.id)}
      onCancel={() => navigate('puzzles', 'books', slug, puzzle.id)}
    />
  );
}

// ---------------------------------------------------------------------------
// Shelf

function Shelf() {
  const [books, setBooks] = useState<BookSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/puzzlebooks');
    setBooks(((await res.json()) as { books: BookSummary[] }).books);
  }, []);
  useEffect(() => void load(), [load]);

  const removeBook = async (slug: string): Promise<void> => {
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    forgetBook(slug);
    void load();
  };


  const create = async (): Promise<void> => {
    const res = await fetch('/api/puzzlebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const body = (await res.json()) as { slug?: string; error?: string };
    if (!res.ok || !body.slug) {
      setError(body.error ?? 'could not create the book');
      return;
    }
    navigate('puzzles', 'books', body.slug);
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 pb-8">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            title="Back to the dashboard"
            onClick={() => navigate('puzzles', 'dashboard')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg flex-1 text-base font-semibold">Puzzle books</h1>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New book
          </Button>
        </div>

        {creating && (
          <div className="bg-surface border-line mb-4 flex items-center gap-2 rounded-xl border p-3">
            <Input
              autoFocus
              inputSize="lg"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') setCreating(false);
              }}
              placeholder="Book title, e.g. “1001 Winning Chess Sacrifices”"
              className="flex-1"
            />
            <Button variant="primary" size="sm" disabled={!title.trim()} onClick={() => void create()}>
              Create
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        )}
        {error && <p className="text-bad mb-3 text-xs">{error}</p>}

        {books === null ? (
          <SkeletonRows rows={3} className="p-0" />
        ) : books.length === 0 && !creating ? (
          <div className="bg-surface border-line rounded-xl border p-6 text-center">
            <BookMarked className="text-subtle mx-auto mb-2 size-6" />
            <p className="text-muted text-sm">
              No puzzle books yet. Create one per paper book, then enter its
              puzzles from the board — solutions and progress live here, not
              in the back of the book.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {books.map((b) => (
              <div key={b.slug} className="group relative">
                <button
                  type="button"
                  onClick={() => navigate('puzzles', 'books', b.slug)}
                  className="bg-surface border-line hover:border-line-strong hover:bg-surface-2 flex w-full items-stretch gap-3 rounded-xl border p-3 text-left transition-colors duration-100"
                >
                  {b.cover ? (
                    <img
                      src={diagramUrl(b.slug, 'cover.jpg')}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="border-line h-24 w-[4.5rem] shrink-0 rounded-md border object-cover object-top"
                    />
                  ) : (
                    <span className="bg-surface-inset border-line grid h-24 w-[4.5rem] shrink-0 place-items-center rounded-md border">
                      <BookMarked className="text-subtle group-hover:text-primary size-5 transition-colors" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
                    {/* pr keeps long titles clear of the delete overlay */}
                    <span className="min-w-0 pr-7">
                      <span className="text-fg block truncate text-sm font-medium">{b.title}</span>
                      <span className="text-subtle block text-xs">
                        {b.puzzles} puzzle{b.puzzles === 1 ? '' : 's'}
                      </span>
                    </span>
                    <ProgressBar total={b.puzzles} solved={b.solved} failed={b.failed} />
                  </span>
                </button>
                {/* Hover-revealed on mouse; always present under a thumb. */}
                <ConfirmPopover
                  icon={Trash2}
                  triggerTitle="Delete this book and its progress"
                  triggerClassName="absolute right-2 top-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
                  question="Delete this book and its progress?"
                  confirmLabel="Delete"
                  onConfirm={() => void removeBook(b.slug)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Book page: numbered grid coloured by result, entry flow

function BookPage({ slug }: { slug: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [adding, setAdding] = useState(false);
  const [missing, setMissing] = useState(false);
  const [importing, setImporting] = useState(false);
  const importJob = useImportJob();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState<BookDraft | null>(null);
  const [rereading, setRereading] = useState(false);

  useEffect(() => {
    void bookTemplates(slug).then(setTemplates);
  }, [slug, adding, draft]);

  /** Re-run recognition on every stored draft with the current font. */
  const rereadDrafts = async (): Promise<void> => {
    if (!book?.drafts?.length) return;
    setRereading(true);
    try {
      const current = await bookTemplates(slug);
      const net = await loadCellNet();
      const updates: { id: string; fen: string | null }[] = [];
      for (const d of book.drafts) {
        const img = await loadImage(diagramUrl(slug, d.image));
        const cells = net
          ? classifyBoardNet(net, boardFromImage(img))
          : classifyBoard(featuresFromImage(img), current);
        updates.push({
          id: d.id,
          fen: labelsToFen(
            cells.map((c) => c.label),
            false,
          ),
        });
      }
      forgetBook(slug);
      await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      await load();
    } finally {
      setRereading(false);
    }
  };

  // The shelf page always re-reads: it is where imports, re-reads and
  // deletes land, and it is entered rarely.
  const load = useCallback(async () => {
    const detail = await loadBook(slug, true);
    if (!detail) {
      setMissing(true);
      return;
    }
    setBook(detail);
  }, [slug]);
  useEffect(() => void load(), [load]);

  const resetProgress = async (): Promise<void> => {
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/progress`, { method: 'DELETE' });
    forgetBook(slug);
    void load();
  };

  if (missing) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-muted text-sm">That book does not exist.</p>
      </div>
    );
  }

  if (adding || draft) {
    return (
      <PuzzleEntry
        slug={slug}
        number={(book?.puzzles.length ?? 0) + 1}
        draft={draft ? { ...draft, imageUrl: diagramUrl(slug, draft.image) } : undefined}
        onDone={() => {
          setAdding(false);
          setDraft(null);
          void load();
        }}
        onCancel={() => {
          setAdding(false);
          setDraft(null);
        }}
      />
    );
  }

  const solvedCount = book
    ? book.puzzles.filter((p) => book.progress[p.id]?.last === 'win').length
    : 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 pb-8">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="All books"
            onClick={() => navigate('puzzles', 'books')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg min-w-0 flex-1 truncate text-base font-semibold">
            {book?.title ?? slug}
          </h1>
          {/* A background scan for THIS book announces itself here; the
              chip reopens the dialog with the live results. */}
          {!importing && importJob.slug === slug && importJob.status !== 'idle' && (
            <button
              type="button"
              onClick={() => setImporting(true)}
              className="bg-primary-soft text-primary border-primary/40 flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
            >
              {importJob.status === 'scanning' ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <FileUp className="size-3" />
              )}
              {importJob.status === 'scanning'
                ? `p.${importJob.page}/${importJob.pages || '…'} · ${importJob.found.length}`
                : `${importJob.found.length} found`}
            </button>
          )}
          {/* Stacked headers drop the button labels — five labelled
              controls in a phone-width row read as clutter. */}
          {(book?.drafts?.length ?? 0) > 0 && templates.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              disabled={rereading}
              title="Re-run recognition on every draft with the learned font"
              onClick={() => void rereadDrafts()}
            >
              {rereading ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />}
              <span className="hidden wide:inline">Read diagrams</span>
            </Button>
          )}
          <Button variant="secondary" size="sm" title="Import a book PDF" onClick={() => setImporting(true)}>
            <FileUp className="size-3.5" />
            <span className="hidden wide:inline">Import PDF</span>
          </Button>
          <Button variant="primary" size="sm" title="Add a puzzle" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            <span className="hidden wide:inline">Add puzzle</span>
          </Button>
          <ConfirmPopover
            icon={RotateCcw}
            triggerTitle="Reset all progress in this book"
            question="Reset all progress in this book?"
            confirmLabel="Reset"
            onConfirm={() => void resetProgress()}
          />
        </div>

        {importing && (
          <Suspense fallback={null}>
        <PdfImport
            slug={slug}
            templates={templates}
            existing={(book?.puzzles.length ?? 0) + (book?.drafts?.length ?? 0)}
            onDone={() => {
              setImporting(false);
              void load();
            }}
            onClose={() => setImporting(false)}
          />
        </Suspense>
        )}

        {book === null ? (
          <SkeletonRows rows={5} className="p-0" />
        ) : book.puzzles.length === 0 && (book.drafts?.length ?? 0) === 0 ? (
          <div className="bg-surface border-line rounded-xl border p-6 text-center">
            <p className="text-muted text-sm">
              Empty book. “Add puzzle” sets up the position on a board and
              records the full solution — both sides' moves.
            </p>
          </div>
        ) : (
          <PuzzleList
            slug={slug}
            puzzles={book.puzzles}
            drafts={book.drafts ?? []}
            progress={book.progress}
            solvedCount={solvedCount}
            onDraft={(d) => setDraft(d)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The correction sidebar: the book's own scans, right where the board is
 * being fixed. Diagram tab = the page cropped to this puzzle's diagram;
 * Solutions tab = the solutions page covering its number.
 */
/** JS mirror of the CSS `wide` variant (index.css): side-by-side layouts. */
const WIDE_MQ = '(min-width: 64rem), (orientation: landscape) and (min-width: 44rem)';

function useWideLayout(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_MQ);
    const update = (): void => setWide(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return wide;
}

const SOURCE_PANE_WIDTH_KEY = 'vault:panel-w:book-source';
const SOURCE_PANE_DEFAULT_W = 340;

function SourcePane({ slug, evidence }: { slug: string; evidence: BookEvidence }) {
  const [tab, setTab] = useState<'diagram' | 'solutions'>('diagram');
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(SOURCE_PANE_WIDTH_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : SOURCE_PANE_DEFAULT_W;
  });
  const drag = useRef<{ x: number; w: number } | null>(null);
  useEffect(() => {
    if (width === SOURCE_PANE_DEFAULT_W) localStorage.removeItem(SOURCE_PANE_WIDTH_KEY);
    else localStorage.setItem(SOURCE_PANE_WIDTH_KEY, String(Math.round(width)));
  }, [width]);
  return (
    <div className="flex min-h-0 shrink-0">
      <aside className="flex flex-col gap-2 overflow-y-auto p-4" style={{ width }}>
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
          <SourceCrop slug={slug} page={evidence.page} rect={evidence.rect} width={width - 32} />
          <p className="text-subtle text-xs leading-relaxed">
            The book&rsquo;s own scan — make the board match it.
          </p>
        </>
      ) : tab === 'solutions' && evidence.solutionPage ? (
        <ZoomablePage
          src={diagramUrl(slug, evidence.solutionPage)}
          alt="solutions page"
          width={width - 32}
        />
      ) : null}
      </aside>
      <div
        title="Drag to resize · double-click to reset"
        onDoubleClick={() => {
          drag.current = null;
          setWidth(SOURCE_PANE_DEFAULT_W);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          drag.current = { x: e.clientX, w: width };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current || (e.buttons & 1) === 0) return;
          const next = drag.current.w + e.clientX - drag.current.x;
          setWidth(Math.min(Math.max(next, 280), Math.min(820, window.innerWidth * 0.55)));
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
 * The book's puzzle grid, revealed from the Puzzle panel's header the way
 * the lichess trainer reveals its difficulty row — a jump pad, not a
 * permanent panel. Cards show number, tier and state; the current puzzle
 * is highlighted and scrolled into view.
 */
function PuzzleGrid({
  slug,
  puzzles,
  progress,
  currentId,
}: {
  slug: string;
  puzzles: BookPuzzle[];
  progress: Record<string, PuzzleProgress>;
  currentId: string;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  // puzzles.length in the deps: the book loads async, so the row to scroll
  // to may not exist on the first run.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, [currentId, puzzles.length]);
  const go = (index: number): void => {
    const target = puzzles[index];
    if (target) navigate('puzzles', 'books', slug, target.id);
  };
  return (
    <div className="max-h-60 overflow-y-auto overscroll-contain p-2">
        {/* Same card language as the book page, at panel scale: state
            colours the tile, the corner icon is the fidelity tier, and the
            current puzzle wears the primary ring. */}
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(2.5rem,1fr))]">
          {puzzles.map((p, i) => {
            const last = progress[p.id]?.last;
            const current = p.id === currentId;
            const meta =
              p.provenance && p.provenance in PROVENANCE_META
                ? PROVENANCE_META[p.provenance as keyof typeof PROVENANCE_META]
                : null;
            const prog = progress[p.id];
            return (
              <button
                key={p.id}
                ref={current ? currentRef : undefined}
                type="button"
                onClick={() => go(i)}
                title={[
                  meta ? `${meta.label} — ${meta.title}` : null,
                  prog ? `${prog.wins}/${prog.tries} tries` : 'not attempted',
                ]
                  .filter(Boolean)
                  .join('\n')}
                className={cn(
                  'relative flex aspect-square items-center justify-center rounded-lg border font-mono text-[0.6875rem] font-semibold transition-colors duration-100 [content-visibility:auto]',
                  current && 'ring-primary/60 ring-2',
                  last === 'win'
                    ? 'bg-nag-good/15 border-nag-good/40 text-nag-good'
                    : last === 'loss'
                      ? 'bg-nag-blunder/15 border-nag-blunder/40 text-nag-blunder'
                      : 'bg-surface border-line text-muted hover:border-line-strong hover:bg-surface-2',
                )}
              >
                {p.number ?? i + 1}
                {meta && (
                  <meta.icon
                    className={cn('absolute right-1 top-1 size-2.5', meta.iconClass)}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
    </div>
  );
}

/**
 * The book's puzzles as an information-dense, filterable list: number,
 * fidelity tier, goal, attempt history — filters double as the tier
 * legend (each chip carries its description as a tooltip).
 */
function PuzzleList({
  slug,
  puzzles,
  drafts,
  progress,
  solvedCount,
  onDraft,
}: {
  slug: string;
  puzzles: BookPuzzle[];
  drafts: BookDraft[];
  progress: Record<string, PuzzleProgress>;
  solvedCount: number;
  onDraft: (d: BookDraft) => void;
}) {
  const [stateFilter, setStateFilter] = useState<'all' | 'new' | 'failed' | 'solved'>('all');
  // Tier filtering groups by label, so provenances sharing a tier
  // ('book-parsed' + 'corrected') count and filter as one chip.
  const [tierFilter, setTierFilter] = useState<'all' | string>('all');

  // Drafts live in the same list, as their own 'Draft' tier — rendered as
  // pseudo-puzzles so one grid/filter machinery serves both. A click on a
  // draft routes to the editor (see onClick), not the solver.
  const stateOf = (p: BookPuzzle): 'new' | 'failed' | 'solved' => {
    const last = progress[p.id]?.last;
    return last === 'win' ? 'solved' : last === 'loss' ? 'failed' : 'new';
  };
  const metaOf = (p: BookPuzzle) =>
    p.provenance && p.provenance in PROVENANCE_META
      ? PROVENANCE_META[p.provenance as keyof typeof PROVENANCE_META]
      : null;
  type TierMeta = (typeof PROVENANCE_META)[keyof typeof PROVENANCE_META];

  // One pass builds the merged list AND its tier/state tallies — this list
  // can be ~1,000 entries, and the old shape scanned it once per tier plus
  // once per tile for numbering.
  const draftIds = useMemo(() => new Set(drafts.map((d) => d.id)), [drafts]);
  const { items, tiers, stateCounts } = useMemo(() => {
    const merged: BookPuzzle[] = [
      ...puzzles,
      ...drafts.map((d) => ({
        id: d.id,
        number: d.number,
        fen: d.fen ?? '',
        uci: [],
        san: [],
        provenance: 'draft' as const,
        evidence: d.evidence,
      })),
    ].sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER));

    const tierTally = new Map<string, { meta: TierMeta; count: number }>();
    const states = { all: merged.length, new: 0, failed: 0, solved: 0 };
    for (const p of merged) {
      states[stateOf(p)]++;
      const meta = metaOf(p);
      if (!meta) continue;
      const entry = tierTally.get(meta.label);
      if (entry) entry.count += 1;
      else tierTally.set(meta.label, { meta, count: 1 });
    }
    // Tier chips render in PROVENANCE_META's key order (confidence order),
    // exactly as the per-key scans produced before.
    const ordered = new Map<string, { meta: TierMeta; count: number }>();
    for (const key of Object.keys(PROVENANCE_META) as (keyof typeof PROVENANCE_META)[]) {
      const label = PROVENANCE_META[key].label;
      const entry = tierTally.get(label);
      if (entry && !ordered.has(label)) ordered.set(label, entry);
    }
    return { items: merged, tiers: ordered, stateCounts: states };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzles, drafts, progress]);
  // Unnumbered entries fall back to their list ordinal; a Map beats an
  // indexOf per rendered tile.
  const ordinalOf = useMemo(() => new Map(items.map((p, i) => [p.id, i + 1])), [items]);

  const visible = items.filter(
    (p) =>
      (stateFilter === 'all' || stateOf(p) === stateFilter) &&
      (tierFilter === 'all' || metaOf(p)?.label === tierFilter),
  );

  return (
    <>
      <ProgressBar
        total={puzzles.length}
        solved={solvedCount}
        failed={stateCounts.failed}
        className="mb-3"
      />
      <ChipRow className="mb-2">
        {(
          [
            ['all', 'All'],
            ['new', 'New'],
            ['failed', 'Failed'],
            ['solved', 'Solved'],
          ] as const
        ).map(([id, label]) => (
          <FilterChip
            key={id}
            label={label}
            count={stateCounts[id]}
            active={stateFilter === id}
            onClick={() => setStateFilter(id)}
          />
        ))}
        {tiers.size > 0 && <span className="border-line mx-1 h-4 border-l" />}
        {/* Map insertion follows meta-key order = confidence order. Each
            chip wears its tier icon so tile marks are matchable to names. */}
        {[...tiers.values()].map(({ meta, count }) => (
          <FilterChip
            key={meta.label}
            label={
              <span className="inline-flex items-center gap-1">
                <meta.icon className={cn('size-3', meta.iconClass)} aria-hidden />
                {meta.label}
              </span>
            }
            count={count}
            title={meta.title}
            active={tierFilter === meta.label}
            onClick={() => setTierFilter(tierFilter === meta.label ? 'all' : meta.label)}
          />
        ))}
      </ChipRow>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {visible.map((p) => {
          const state = stateOf(p);
          const meta =
            p.provenance && p.provenance in PROVENANCE_META
              ? PROVENANCE_META[p.provenance as keyof typeof PROVENANCE_META]
              : null;
          const prog = progress[p.id];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                const d = draftIds.has(p.id) ? drafts.find((x) => x.id === p.id) : null;
                if (d) onDraft(d);
                else navigate('puzzles', 'books', slug, p.id);
              }}
              title={[
                meta ? `${meta.label} — ${meta.title}` : null,
                prog ? `${prog.wins}/${prog.tries} tries` : 'not attempted',
              ]
                .filter(Boolean)
                .join('\n')}
              className={cn(
                // content-visibility: ~1,000 offscreen tiles skip render
                // work entirely — phones feel it.
                'relative flex aspect-square items-center justify-center rounded-lg border font-mono text-sm font-semibold transition-colors duration-100 [content-visibility:auto]',
                state === 'solved'
                  ? 'bg-nag-good/15 border-nag-good/40 text-nag-good'
                  : state === 'failed'
                    ? 'bg-nag-blunder/15 border-nag-blunder/40 text-nag-blunder'
                    : 'bg-surface border-line text-muted hover:border-line-strong hover:bg-surface-2',
              )}
            >
              {p.number ?? ordinalOf.get(p.id)}
              {meta && (
                <meta.icon
                  className={cn('absolute right-2 top-2 size-3', meta.iconClass)}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
      {visible.length === 0 && (
        <p className="text-subtle p-4 text-center text-xs">Nothing matches these filters.</p>
      )}
    </>
  );
}

/**
 * Where a puzzle's solution came from, in words a stranger can read.
 * Key order IS the confidence order — filter chips render in it. Tile
 * markers are shape-coded icons on a hue ladder that stays clear of the
 * solved/failed green and red: blue (trusted) → teal (corroborated) →
 * purple (plain engine) → amber (caution).
 *
 * 'book-parsed' and 'corrected' share one tier: both are the book's
 * exact solution, one read by the importer and one entered by a human
 * (lanph3re's call — same guarantee, same tag).
 */
const BOOK_TIER = {
  label: 'Book solution',
  title: "The book's exact solution — parsed and verified, or entered by hand",
  icon: BookOpenCheck,
  iconClass: 'text-info',
} as const;

const PROVENANCE_META = {
  'book-parsed': BOOK_TIER,
  corrected: BOOK_TIER,
  'engine-corroborated': {
    label: 'Engine + book',
    title: 'Engine solution, corroborated by the book text',
    icon: BadgeCheck,
    iconClass: 'text-nag-brilliant',
  },
  'engine-only': {
    label: 'Engine solution',
    title: 'Engine solution (decisive line, no text corroboration)',
    icon: Cpu,
    iconClass: 'text-nag-interesting',
  },
  'engine-unverified': {
    label: 'Engine guess',
    title: 'Engine best line only — nothing decisive found; check the source if it feels off',
    icon: CircleHelp,
    iconClass: 'text-warn',
  },
  // Least confident of all: an imported diagram with no solution yet. Opening
  // one goes to the draft editor, not the solver.
  draft: {
    label: 'Draft',
    title: 'Imported diagram awaiting a solution — open it to enter one',
    icon: Pencil,
    iconClass: 'text-subtle',
  },
} as const;

/**
 * The correction aid: the scanned source page, cropped to THIS diagram
 * (with a little margin), expandable inline to the whole page — the
 * evidence lives inside the entry/correction flow where it is actually
 * used, never in a lookup popup. Rects are page fractions; the crop is
 * plain pixel math once the image's natural size is known.
 */
/** The book-scan peek beside a puzzle: hovers open on a mouse, and TAPS open
    on touch (the hover-only version did nothing on a phone). Tap the eye again
    or anywhere else to close. */
function EvidencePeek({ slug, page, rect }: { slug: string; page: string; rect?: SourceRect }) {
  const [open, setOpen] = useState(false);
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
  return (
    <span data-peek className="group relative grid size-7 shrink-0 place-items-center pointer-coarse:size-9">
      <button
        type="button"
        title="Peek at the book scan"
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
      <span
        className={cn(
          'pointer-events-none absolute right-0 top-8 z-40 group-hover:block',
          open ? 'block' : 'hidden',
        )}
      >
        <span className="bg-surface border-line block rounded-xl border p-2 shadow-[var(--shadow-pop)]">
          <SourceCrop slug={slug} page={page} rect={rect} width={252} plain />
        </span>
      </span>
    </span>
  );
}

/** Live width of a rendered element (ResizeObserver) — the stacked
    evidence views size to their actual container, not a guess from
    window.innerWidth that left dead space beside the box. A CALLBACK ref:
    the measured pane mounts only when its tab is active, so a static ref
    bound once on mount would never see it. */
function useElementWidth(): [(el: HTMLDivElement | null) => void, number] {
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
function ZoomablePage({ src, alt, width }: { src: string; alt: string; width: number }) {
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const bump = (f: number): void =>
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * f)));
  usePinchZoom(viewport, bump);
  return (
    <div className="relative" style={{ width }}>
      <span className="absolute left-1.5 top-1.5 z-10 flex gap-1">
        <Button variant="secondary" size="icon-sm" title="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => bump(1 / 1.25)} className="shadow-md">
          <ZoomOut className="size-3.5" />
        </Button>
        <Button variant="secondary" size="icon-sm" title="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => bump(1.25)} className="shadow-md">
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

function SourceCrop({
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
        title="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => bump(1 / 1.25)}
        className="shadow-md"
      >
        <ZoomOut className="size-3.5" />
      </Button>
      <Button
        variant="secondary"
        size="icon-sm"
        title="Zoom in"
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
            <img src={src} alt="book page" className="w-full" />
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
          title="Back to the diagram"
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
            alt="book diagram in its page"
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
          title="Show the whole page"
          onClick={() => setFull(true)}
          className="absolute right-1.5 top-1.5 shadow-md"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry: position via the embedded editor, then record the solution

function PuzzleEntry({
  slug,
  number,
  draft,
  replace,
  onDone,
  onCancel,
}: {
  slug: string;
  number: number;
  /** Entering an imported diagram: shown for eyeballing, deleted on save. */
  draft?: { id: string; imageUrl: string; fen: string | null; evidence?: BookDraft['evidence'] };
  /** Correcting an existing puzzle: prefilled, replaced in place on save. */
  replace?: BookPuzzle;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fen, setFen] = useState<string | null>(null);
  // The position being corrected is not part of the book list any more, so
  // it arrives with the solutions rather than with the puzzle. Re-keying the
  // editor on it is what makes it land.
  const [prefill, setPrefill] = useState<string | null>(draft?.fen ?? null);
  const replaceFenId = replace?.id;
  useEffect(() => {
    if (!replaceFenId) return;
    let live = true;
    void loadSolutions(slug).then((all) => {
      const fen = all[replaceFenId]?.fen;
      if (live && fen) setPrefill(fen);
    });
    return () => {
      live = false;
    };
  }, [slug, replaceFenId]);
  const wide = useWideLayout();
  const [stackedView, setStackedView] = useState<'board' | 'diagram' | 'solutions'>('board');
  // The evidence views span the ACTUAL pane width (measured), not a guess.
  const [stackedPane, stackedPaneW] = useElementWidth();

  const confirmPosition = (confirmed: string): void => {
    // Fire-and-forget: template learning must never block puzzle entry.
    void (async () => {
      try {
        if (!draft) return;
        // A draft confirmation teaches the font from its stored crop.
        const img = await loadImage(draft.imageUrl);
        const source = { features: featuresFromImage(img), blackAtBottom: false };
        const existing = await bookTemplates(slug);
        const next = harvestTemplates(
          source.features,
          confirmed,
          source.blackAtBottom,
          existing,
        );
        await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/ocr`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ templates: next }),
        });
      } catch {
        // learning is best-effort
      }
    })();
    setFen(confirmed);
  };

  const finish = (): void => {
    // The saved puzzle replaces its draft.
    if (draft) {
      forgetBook(slug);
      void fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/drafts/${draft.id}`, {
        method: 'DELETE',
      }).finally(onDone);
    } else {
      onDone();
    }
  };

  // ONE persistent layout for both phases — the evidence pane and header
  // stay put while the right side swaps editor <-> recorder (seamless).
  //
  // A puzzle's evidence is NOT part of the book download — it is the
  // heaviest thing a book carries and only ever wanted here — so it is
  // fetched when a puzzle is opened. Drafts still carry theirs inline;
  // there are few enough of them for it not to matter.
  const [fetched, setFetched] = useState<BookEvidence | undefined>(undefined);
  const replaceId = replace?.id;
  useEffect(() => {
    if (!replaceId) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles/${encodeURIComponent(replaceId)}/evidence`,
        );
        if (!res.ok) return;
        const body = (await res.json()) as { evidence?: BookEvidence };
        if (live) setFetched(body.evidence);
      } catch {
        // No evidence pane is a smaller loss than a broken editor.
      }
    })();
    return () => {
      live = false;
    };
  }, [slug, replaceId]);
  const evidence = replace?.evidence ?? fetched ?? draft?.evidence;
  const boardContent =
    fen === null ? (
      <EditorView
        key={prefill ?? 'blank'}
        initialFen={prefill ?? undefined}
        useLabel="Record solution"
        onUse={confirmPosition}
      />
    ) : (
      <SolutionRecorder
        slug={slug}
        fen={fen}
        replaceId={replace?.id}
        onBack={() => setFen(null)}
        onDone={finish}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Same borderless header as everywhere else; image import lives in
          the editor's own Position panel, not up here. */}
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        <Button variant="ghost" size="icon-sm" title="Back to the book" onClick={onCancel}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
          {replace ? 'Fix' : 'Add'} <span className="font-mono">#{number}</span>
        </h1>
      </div>
      {wide ? (
        <div className="flex min-h-0 flex-1">
          {evidence?.page ? (
            <SourcePane slug={slug} evidence={evidence} />
          ) : draft ? (
            <aside className="border-line flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r p-4">
              <img src={draft.imageUrl} alt="book diagram" className="border-line rounded-md border" />
              <p className="text-subtle text-xs leading-relaxed">
                The diagram from the book — make the board match it, then
                record the solution.
              </p>
            </aside>
          ) : null}
          <div className="min-h-0 min-w-0 flex-1">{boardContent}</div>
        </div>
      ) : (
        // Stacked (phone): one element at a time, the BOARD first — the
        // evidence views are one tap away instead of crowding it out.
        <div className="flex min-h-0 flex-1 flex-col">
          {(evidence?.page || draft) && (
            <PaneTabs
              className="mx-4 mt-2"
              tabs={[
                { id: 'board' as const, label: 'Board' },
                { id: 'diagram' as const, label: 'Diagram' },
                ...(evidence?.solutionPage ? [{ id: 'solutions' as const, label: 'Solutions' }] : []),
              ]}
              value={stackedView}
              onChange={setStackedView}
            />
          )}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            {stackedView === 'board' ? (
              boardContent
            ) : stackedView === 'diagram' ? (
              <div ref={stackedPane} className="p-4">
                {evidence?.page && stackedPaneW > 0 ? (
                  <SourceCrop
                    slug={slug}
                    page={evidence.page}
                    rect={evidence.rect}
                    width={stackedPaneW - 32}
                  />
                ) : draft ? (
                  <img src={draft.imageUrl} alt="book diagram" className="border-line w-full rounded-md border" />
                ) : null}
              </div>
            ) : evidence?.solutionPage ? (
              <div ref={stackedPane} className="p-4">
                {stackedPaneW > 0 && (
                  <ZoomablePage
                    src={diagramUrl(slug, evidence.solutionPage)}
                    alt="solutions page"
                    width={stackedPaneW - 32}
                  />
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function SolutionRecorder({
  slug,
  fen,
  replaceId,
  onBack,
  onDone,
}: {
  slug: string;
  fen: string;
  /** When set, the save REPLACES this puzzle instead of appending. */
  replaceId?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [line, setLine] = useState<{ uci: string; san: string; fen: string }[]>([]);
  const [wildcards, setWildcards] = useState<ReadonlySet<number>>(new Set());
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verdicts, setVerdicts] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const solverSide: Color = parseFen(fen).unwrap().turn;
  const currentFen = line.at(-1)?.fen ?? fen;
  const pos = Chess.fromSetup(parseFen(currentFen).unwrap()).unwrap();
  const dests = chessgroundDests(pos);
  const turn = pos.turn;

  const play = (uci: string): void => {
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return;
    const san = makeSanAndPlay(pos, move);
    playSound(san.includes('#') || san.includes('+') ? 'check' : san.includes('x') ? 'capture' : 'move');
    setLine((prev) => [...prev, { uci, san, fen: makeFen(pos.toSetup()) }]);
    setVerdicts(null);
  };

  const onMove = (orig: string, dest: string): void => {
    const to = parseSquare(dest);
    const lastRank = turn === 'white' ? 7 : 0;
    const piece = to !== undefined ? pos.board.get(parseSquare(orig)!) : undefined;
    if (piece?.role === 'pawn' && to !== undefined && squareRank(to) === lastRank) {
      setPendingPromotion({ orig, dest, color: turn });
      return;
    }
    play(orig + dest);
  };

  const completePromotion = (role: Role): void => {
    if (!pendingPromotion) return;
    const letter = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n', king: '', pawn: '' }[role];
    play(pendingPromotion.orig + pendingPromotion.dest + letter);
    setPendingPromotion(null);
  };

  const undo = (): void => {
    setLine((prev) => prev.slice(0, -1));
    setWildcards((prev) => new Set([...prev].filter((i) => i < line.length - 1)));
    setVerdicts(null);
  };

  const toggleWildcard = (index: number): void => {
    setWildcards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  /**
   * Engine proofread (lanph3re's tier 3): every SOLVER move must keep the
   * position decisively won, and the final position must be decisive.
   * Catches transcription slips and the occasional book misprint.
   */
  const verify = async (): Promise<void> => {
    setVerifying(true);
    const notes: string[] = [];
    for (let i = 0; i < line.length; i++) {
      // Odd plies are the defender's replies — only the solver's moves are judged.
      if (i % 2 === 1) continue;
      const score = await evaluateWhitePov(line[i]!.fen);
      const pov = solverSide === 'white' ? 1 : -1;
      const cp = score.mate !== undefined ? (score.mate * pov > 0 ? 10000 : -10000) : (score.cp ?? 0) * pov;
      if (cp < 150) {
        notes.push(
          `After ${Math.floor(i / 2) + 1}. ${line[i]!.san} the engine sees only ${formatScore(score)} — check the transcription.`,
        );
      }
    }
    if (notes.length === 0) notes.push('Engine agrees: every solver move keeps a decisive advantage.');
    setVerdicts(notes);
    setVerifying(false);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    forgetBook(slug);
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fen,
        uci: line.map((m) => m.uci),
        san: line.map((m) => m.san),
        wildcards: [...wildcards],
        ...(replaceId ? { replaceId } : {}),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'save failed');
      return;
    }
    onDone();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          <div className="relative w-full">
            <Board
              fen={currentFen}
              orientation={solverSide}
              dests={dests}
              lastMove={
                line.at(-1)
                  ? [line.at(-1)!.uci.slice(0, 2), line.at(-1)!.uci.slice(2, 4)]
                  : undefined
              }
              check={pos.isCheck()}
              onMove={onMove}
            />
            {pendingPromotion && (
              <PromotionPicker
                color={pendingPromotion.color}
                dest={pendingPromotion.dest}
                orientation={solverSide}
                onSelect={completePromotion}
                onCancel={() => setPendingPromotion(null)}
              />
            )}
          </div>
          <div className="flex h-6 w-full items-center gap-2 px-0.5 text-xs">
            <SideDot side={turn} />
            <span className="text-muted">Play the solution — every move, both sides.</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" title="Back to the position" onClick={onBack}>
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="text-muted min-w-0 flex-1 truncate text-sm">
            Record the solution — every move, both sides.
          </span>
        </div>

        <Panel flush className="min-h-[10rem] shrink-0">
          <PanelHeader
            title={`Solution · ${line.length} plies`}
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                title="Undo the last move"
                disabled={line.length === 0}
                onClick={undo}
              >
                <Undo2 className="size-3.5" />
              </Button>
            }
          />
          <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5 p-3 text-sm">
            {line.length === 0 ? (
              <p className="text-subtle text-xs">
                No moves yet. The first move you play is the puzzle's first
                move to find.
              </p>
            ) : (
              line.map((m, i) => {
                // Defender plies (the side NOT to move in the diagram) can
                // be marked "any move" — the ~ books use.
                const isDefender = i % 2 === 1;
                return (
                  <span key={i} className="flex items-baseline gap-0.5 font-mono text-[0.8125rem]">
                    {i % 2 === 0 ? (
                      <span className="text-subtle">
                        {Math.floor(i / 2) + 1}
                        {solverSide === 'black' && i === 0 ? '…' : '.'}
                      </span>
                    ) : null}
                    {isDefender ? (
                      <button
                        type="button"
                        onClick={() => toggleWildcard(i)}
                        title={
                          wildcards.has(i)
                            ? 'Any move accepted here (click to require this exact move)'
                            : 'Click to accept ANY move here (the book\u2019s K~)'
                        }
                        className={cn(
                          'rounded px-1 transition-colors duration-100',
                          wildcards.has(i)
                            ? 'bg-primary-soft text-primary'
                            : 'hover:bg-surface-2',
                        )}
                      >
                        {wildcards.has(i) ? `${m.san.charAt(0)}~` : m.san}
                      </button>
                    ) : (
                      <span className="px-1">{m.san}</span>
                    )}
                  </span>
                );
              })
            )}
          </div>
          {line.length > 1 && (
            <p className="text-subtle border-line border-t px-3 py-1.5 text-[0.6875rem]">
              Tip: click an opponent move to mark it “any move” (the book's ~).
            </p>
          )}
        </Panel>

        {verdicts && (
          <div className="bg-surface border-line shrink-0 rounded-xl border p-3 text-xs">
            {verdicts.map((note, i) => (
              <p key={i} className={note.startsWith('Engine agrees') ? 'text-good' : 'text-warn'}>
                {note}
              </p>
            ))}
          </div>
        )}
        {error && <p className="text-bad text-xs">{error}</p>}

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={line.length === 0 || saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Save puzzle
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={line.length === 0 || verifying}
            title="Ask Stockfish whether every solver move really wins"
            onClick={() => void verify()}
          >
            {verifying ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            Verify
          </Button>
          <Button variant="ghost" size="sm" disabled={line.length === 0} onClick={() => { setLine([]); setWildcards(new Set()); setVerdicts(null); }}>
            <RotateCcw className="size-3.5" />
            Start over
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Strict trainer, submit-model (lanph3re's design): the answer is a real move
// tree, explored exactly like the analysis tab — go back anywhere, try
// side lines as pencil memos, nothing judged and nothing penalised while
// thinking. On Submit only the MAINLINE is graded (memos are ignored),
// through the fairness tiers: wildcards, narrow transpositions, any-mate,
// and engine adjudication where the book text cannot decide.

type Phase = 'loading' | 'solving' | 'checking' | 'done';

function BookTrainer({ slug, puzzleId }: { slug: string; puzzleId: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [tree, setTree] = useState<MoveTree | null>(null);
  const [cursorId, setCursorId] = useState<NodeId>('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [won, setWon] = useState(false);
  const [helped, setHelped] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [engineApproved, setEngineApproved] = useState(false);
  const [flipped, setFlipped] = useState(false);
  // The puzzle grid reveals from the Puzzle panel header, like the lichess
  // trainer's difficulty row.
  const [showNav, setShowNav] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const wide = useWideLayout();

  const index = book?.puzzles.findIndex((p) => p.id === puzzleId) ?? -1;
  // The list entry knows the puzzle's identity; its position and line come
  // from the solutions request, which is cached per book — so this is one
  // fetch when the first puzzle opens, not one per puzzle.
  const [solutions, setSolutions] = useState<Record<string, PuzzleSolution>>({});
  const entry = index >= 0 ? book!.puzzles[index]! : null;
  const answer = entry ? solutions[entry.id] : undefined;
  const puzzle = entry && answer ? { ...entry, ...answer } : null;
  const solution: BookSolution | null = puzzle
    ? { fen: puzzle.fen, uci: puzzle.uci, ...(puzzle.wildcards ? { wildcards: puzzle.wildcards } : {}) }
    : null;

  useEffect(() => {
    void loadBook(slug).then(setBook);
    void loadSolutions(slug).then(setSolutions);
  }, [slug]);

  useEffect(() => {
    if (!puzzle) return;
    const fresh = createTree(puzzle.fen);
    setTree(fresh);
    setCursorId(fresh.rootId);
    setPhase('solving');
    setWon(false);
    setHelped(false);
    setWrong(false);
    setEngineApproved(false);
    setFlipped(false);
    reported.current = false;
    // Keyed on the PUZZLE, not the book object. Recording an attempt folds
    // the server's new progress into the cached book, which is a new object
    // every time — so depending on `book` here meant submitting an answer
    // rebuilt the tree and threw you back to the start of the puzzle you
    // had just solved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzleId, puzzle?.fen]);

  const node = tree ? getNode(tree, cursorId) : null;
  // One position replay per cursor move, not one per render.
  const pos = useMemo(() => (tree ? positionAt(tree, cursorId) : null), [tree, cursorId]);
  const dests = useMemo(
    () => (tree && phase === 'solving' ? legalDests(tree, cursorId) : new Map<string, string[]>()),
    [tree, cursorId, phase],
  );

  const report = async (win: boolean): Promise<void> => {
    if (reported.current || !puzzle) return;
    reported.current = true;
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/attempt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: puzzle.id, win }),
    });
    // Fold the server's own new entry into the cache, so the grid and
    // "next unsolved" are right on the next puzzle without a refetch.
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { progress?: PuzzleProgress } | null;
      if (body?.progress) {
        const next = patchProgress(slug, puzzle.id, body.progress);
        if (next) setBook(next);
      }
    }
  };

  /**
   * Entry is free: any legal move goes into the tree at the cursor. A move
   * played from an earlier position becomes a variation — a memo.
   */
  const applyMove = (orig: string, dest: string, promotion?: string): void => {
    if (!tree || phase !== 'solving') return;
    const result = addUci(tree, cursorId, orig + dest + (promotion ?? ''));
    if (!result) return;
    setTree(result.tree);
    setCursorId(result.nodeId);
  };

  const onMove = (orig: string, dest: string): void => {
    if (phase !== 'solving' || !pos) return;
    const from = parseSquare(orig);
    const to = parseSquare(dest);
    const piece = from !== undefined ? pos.board.get(from) : undefined;
    const lastRank = pos.turn === 'white' ? 7 : 0;
    if (piece?.role === 'pawn' && to !== undefined && squareRank(to) === lastRank) {
      setPendingPromotion({ orig, dest, color: pos.turn });
      return;
    }
    applyMove(orig, dest);
  };

  const completePromotion = (role: Role): void => {
    if (!pendingPromotion) return;
    const letter = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n', king: '', pawn: '' }[role];
    applyMove(pendingPromotion.orig, pendingPromotion.dest, letter);
    setPendingPromotion(null);
  };

  /**
   * The moment of truth: grade the mainline (memos are ignored) through
   * the judge, consulting the engine only where the book cannot decide.
   * The first wrong move gets a ?? glyph and the cursor lands on it.
   */
  const submit = async (): Promise<void> => {
    if (!tree || !solution || !puzzle || phase !== 'solving') return;
    const mainline = mainlineFrom(tree, tree.rootId);
    if (mainline.length === 0) return;
    setPhase('checking');

    let fen = solution.fen;
    let cursor = 0;
    let completed = false;
    let usedEngine = false;
    let wrongId: NodeId | null = null;

    for (const id of mainline) {
      if (completed) break;
      const move = getNode(tree, id);
      const uci = move.uci!;
      const mover: Color = fen.split(' ')[1] === 'b' ? 'black' : 'white';
      const verdict = judgeBookMove(
        solution,
        fen,
        cursor,
        uci.slice(0, 2),
        uci.slice(2, 4),
        uci.slice(4) || undefined,
      );
      if (verdict.kind === 'wrong') {
        wrongId = id;
        break;
      }
      if (verdict.kind === 'engine') {
        const passes = await movePasses(move.fen, mover);
        if (!passes) {
          wrongId = id;
          break;
        }
        usedEngine = true;
        completed = true; // engine verdicts only arise where the script ends
      } else {
        cursor = verdict.cursor;
        if (verdict.kind === 'complete') completed = true;
      }
      fen = move.fen;
    }

    if (wrongId) {
      setTree(updateNode(tree, wrongId, { nags: [4] }));
      setCursorId(wrongId);
    } else {
      setCursorId(mainline.at(-1)!);
    }
    const win = wrongId === null && completed && !helped;
    setWrong(wrongId !== null);
    setEngineApproved(usedEngine && wrongId === null && completed);
    setWon(win);
    setPhase('done');
    // An incomplete-but-correct answer still counts as a miss: the book
    // wanted the whole line.
    void report(win);
  };

  const retry = (): void => {
    if (!puzzle) return;
    timers.current.forEach(clearTimeout);
    const fresh = createTree(puzzle.fen);
    setTree(fresh);
    setCursorId(fresh.rootId);
    setPhase('solving');
    setWon(false);
    setHelped(false);
    setWrong(false);
    setEngineApproved(false);
    reported.current = false;
  };

  const showSolution = (): void => {
    if (!solution || !puzzle || phase !== 'solving') return;
    setHelped(true);
    void report(false);
    timers.current.forEach(clearTimeout);
    // Replay the scripted line from a clean board, one move per beat.
    let replay = createTree(puzzle.fen);
    let at = replay.rootId;
    setTree(replay);
    setCursorId(at);
    let i = 0;
    const step = (): void => {
      const result = addUci(replay, at, solution.uci[i]!);
      if (!result) {
        setPhase('done');
        return;
      }
      replay = result.tree;
      at = result.nodeId;
      i++;
      setTree(replay);
      setCursorId(at);
      if (i < solution.uci.length) timers.current.push(setTimeout(step, 650));
      else setPhase('done');
    };
    timers.current.push(setTimeout(step, 400));
  };

  const analyse = (): void => {
    if (!node) return;
    if (!useAnalysis.getState().loadFen(node.fen)) return;
    useAnalysis.setState({ handoff: true });
    navigate('analysis');
  };

  const nextUnsolved = (): string | null => {
    if (!book) return null;
    const after = book.puzzles.slice(index + 1).concat(book.puzzles.slice(0, index));
    return after.find((p) => book.progress[p.id]?.last !== 'win')?.id ?? null;
  };

  // Sound per rendered position (see PuzzlesView for the mechanism).
  const prevPieces = useRef<number | null>(null);
  useEffect(() => {
    if (!node || !pos) return;
    const pieces = node.fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    const prev = prevPieces.current;
    prevPieces.current = pieces;
    if (prev === null || !node.uci) return;
    playSound(pos.isCheck() ? 'check' : pieces < prev ? 'capture' : 'move');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.fen]);

  if (book === null || !puzzle || !tree || !node || !pos) {
    return (
      <div className="text-subtle grid h-full place-items-center text-sm">
        {!puzzle && book !== null ? 'That puzzle does not exist.' : <Loader2 className="size-5 animate-spin" />}
      </div>
    );
  }

  const solverSide = parseFen(puzzle.fen).unwrap().turn;
  const orientation: Color = flipped ? (solverSide === 'white' ? 'black' : 'white') : solverSide;
  const next = nextUnsolved();
  const hasMoves = getNode(tree, tree.rootId).children.length > 0;
  // Bottom-band navigation over the entered line (view-only stepping).
  const tipId = mainlineFrom(tree, tree.rootId).at(-1) ?? tree.rootId;
  const atRoot = cursorId === tree.rootId;
  const goTo = (id: NodeId | undefined): void => {
    if (id) setCursorId(id);
  };

  const header = (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="ghost"
        size="icon-sm"
        title="Back to the book"
        onClick={() => navigate('puzzles', 'books', slug)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      {/* The puzzle number IS the title; the tier collapses to its icon
          (tooltip explains). */}
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-fg font-mono text-sm font-semibold">
          #{puzzle.number ?? index + 1}
        </span>
        {puzzle.provenance &&
          puzzle.provenance in PROVENANCE_META &&
          (() => {
            const meta = PROVENANCE_META[puzzle.provenance as keyof typeof PROVENANCE_META];
            return (
              <span title={`${meta.label} — ${meta.title}`} className="shrink-0 cursor-help">
                <meta.icon className={cn('size-3.5', meta.iconClass)} aria-hidden />
              </span>
            );
          })()}
      </span>
      <span className="min-w-0 flex-1" />
      {puzzle.evidence?.page && (
        <EvidencePeek slug={slug} page={puzzle.evidence.page} rect={puzzle.evidence.rect} />
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Correct this puzzle against the book scan"
        onClick={() => navigate('puzzles', 'books', slug, 'fix', puzzle.id)}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      {/* Stacked: the identity bar stays glued to the top of the page,
          above the board (lanph3re's spec) — wide keeps it in the side column. */}
      {!wide && header}
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          <div className="relative w-full">
            <Board
              fen={node.fen}
              orientation={orientation}
              dests={dests}
              lastMove={node.uci ? [node.uci.slice(0, 2), node.uci.slice(2, 4)] : undefined}
              check={pos.isCheck()}
              onMove={onMove}
            />
            {pendingPromotion && (
              <PromotionPicker
                color={pendingPromotion.color}
                dest={pendingPromotion.dest}
                orientation={orientation}
                onSelect={completePromotion}
                onCancel={() => setPendingPromotion(null)}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        {wide && header}

        {/* The Puzzle panel, in the lichess trainer's shape: status and the
            solver's own actions live HERE (Submit is the book trainer's
            grading moment), and the puzzle grid reveals from the header the
            way the trainer reveals its difficulty row. */}
        <Panel flush className="shrink-0">
          <PanelHeader
            title="Puzzle"
            actions={
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Previous puzzle"
                  disabled={index <= 0}
                  onClick={() => {
                    const target = book.puzzles[index - 1];
                    if (target) navigate('puzzles', 'books', slug, target.id);
                  }}
                >
                  <ChevronLeft className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Next puzzle"
                  disabled={index < 0 || index >= book.puzzles.length - 1}
                  onClick={() => {
                    const target = book.puzzles[index + 1];
                    if (target) navigate('puzzles', 'books', slug, target.id);
                  }}
                >
                  <ChevronRight className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  active={showNav}
                  title="All puzzles in this book"
                  onClick={() => setShowNav((v) => !v)}
                >
                  <LayoutGrid className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Dashboard"
                  onClick={() => navigate('puzzles', 'dashboard')}
                >
                  <BarChart3 className="size-3.5" />
                </Button>
              </>
            }
          />
          {showNav && (
            <div className="border-line border-b">
              <PuzzleGrid slug={slug} puzzles={book.puzzles} progress={book.progress} currentId={puzzleId} />
            </div>
          )}
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-col gap-0.5">
              {phase === 'done' ? (
                <p className={cn('text-sm font-semibold', won ? 'text-good' : 'text-bad')}>
                  {won ? 'Solved!' : helped ? 'Solved with help.' : 'Not this time.'}
                </p>
              ) : (
                <p className="text-fg text-xl font-bold tracking-tight">
                  {solverSide === 'white' ? 'White' : 'Black'} to play
                </p>
              )}
              <p className="text-muted text-xs leading-relaxed">
                {phase === 'checking'
                  ? 'Checking your answer…'
                  : phase === 'done'
                    ? helped
                      ? 'That is the book line. Retry it clean later.'
                      : won
                        ? engineApproved
                          ? 'Off the book at the end — but the engine approves. Solved.'
                          : 'Exactly as the book has it.'
                        : wrong
                          ? 'Not quite — the marked move is where it goes wrong.'
                          : 'Correct so far, but the book line goes further.'
                    : 'Explore freely — only the mainline is judged on submit.'}
              </p>
            </div>

            {/* The primary action stretches to fill the row (lanph3re: a
                left-biased cluster looks unbalanced, centring is worse) —
                secondaries sit compactly at its right. */}
            <div className="flex flex-wrap gap-2">
              {phase === 'done' ? (
                <>
                  {next && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate('puzzles', 'books', slug, next)}
                    >
                      <RotateCw className="size-3.5" />
                      Next unsolved
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" className={next ? '' : 'flex-1'} onClick={retry}>
                    <RotateCcw className="size-3.5" />
                    Retry
                  </Button>
                  <Button variant="secondary" size="sm" onClick={analyse}>
                    Analyse
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    disabled={phase !== 'solving' || !hasMoves}
                    title="Grade the mainline — this is the only judged moment"
                    onClick={() => void submit()}
                  >
                    {phase === 'checking' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    Submit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={phase !== 'solving'}
                    onClick={showSolution}
                    title="Counts as a failed attempt"
                  >
                    <Eye className="size-3.5" />
                    Solution
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('puzzles', 'books', slug)}
                  >
                    <X className="size-3.5" />
                    Skip
                  </Button>
                </>
              )}
            </div>
          </div>
        </Panel>

        <AnswerPanel
          tree={tree}
          cursorId={cursorId}
          onSelect={setCursorId}
          onPromote={
            phase === 'solving' ? (id) => setTree(promoteToMainline(tree, id)) : undefined
          }
          emptyText="Nothing entered yet — find the first move on the board."
        />
      </div>

      {/* Phones: the bottom band navigates the entered line, like every
          other board page. The solver's actions (Submit, Solution, Skip)
          live in the Puzzle panel above — no duplicates here. */}
      <MobileActionBar>
        <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
          <Button variant="ghost" size="icon" disabled={atRoot} onClick={() => goTo(tree.rootId)} title="Start">
            <ChevronFirst className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={atRoot} onClick={() => goTo(node.parentId ?? undefined)} title="Back">
            <ChevronLeft className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={node.children.length === 0} onClick={() => goTo(node.children[0])} title="Forward">
            <ChevronRight className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={cursorId === tipId} onClick={() => goTo(tipId)} title="Latest">
            <ChevronLast className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setFlipped((f) => !f)} title="Flip board">
            <FlipVertical2 className="size-[1.1rem]" />
          </Button>
        </div>
      </MobileActionBar>
    </div>
  );
}
