import {
  ArrowLeft,
  BookMarked,
  Check,
  Eye,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseSquare, parseUci, squareRank } from 'chessops/util';
import type { Color, Role } from 'chessops/types';
import { BOARD_MAX_W } from '@/board/boardSize';
import { Board } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { EditorView } from '@/editor/EditorView';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { SideDot } from '@/ui/SideDot';
import {
  boardStateOf,
  judgeBookMove,
  scriptedFen,
  type BookSolution,
  type PlayedMove,
} from './bookJudge';
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
}

interface BookPuzzle {
  id: string;
  fen: string;
  uci: string[];
  san: string[];
  wildcards?: number[];
}

interface PuzzleProgress {
  tries: number;
  wins: number;
  last: 'win' | 'loss';
  at: string;
}

interface BookDetail {
  slug: string;
  title: string;
  puzzles: BookPuzzle[];
  progress: Record<string, PuzzleProgress>;
}

export function BooksView({ params }: { params: string[] }) {
  // Route segments arrive URL-encoded ("Test%20Book").
  const slug = params[0] ? decodeURIComponent(params[0]) : null;
  const puzzleId = params[1] ? decodeURIComponent(params[1]) : null;
  if (slug && puzzleId) {
    return <BookTrainer key={`${slug}/${puzzleId}`} slug={slug} puzzleId={puzzleId} />;
  }
  if (slug) return <BookPage key={slug} slug={slug} />;
  return <Shelf />;
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
          <Button variant="ghost" size="icon-sm" title="Back to training" onClick={() => navigate('puzzles')}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg flex-1 text-base font-semibold">Puzzle books</h1>
          <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            New book
          </Button>
        </div>

        {creating && (
          <div className="bg-surface border-line mb-4 flex items-center gap-2 rounded-xl border p-3">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') setCreating(false);
              }}
              placeholder="Book title, e.g. “1001 Winning Chess Sacrifices”"
              className="bg-surface-inset border-line text-fg h-9 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus:border-primary/50"
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
          <p className="text-subtle text-sm">Loading…</p>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {books.map((b) => (
              <button
                key={b.slug}
                type="button"
                onClick={() => navigate('puzzles', 'books', b.slug)}
                className="bg-surface border-line hover:border-line-strong hover:bg-surface-2 group flex flex-col gap-3 rounded-xl border p-4 text-left transition-colors duration-100"
              >
                <BookMarked className="text-subtle group-hover:text-primary size-5 transition-colors" />
                <span className="min-w-0">
                  <span className="text-fg block truncate text-sm font-medium">{b.title}</span>
                  <span className="text-subtle block text-xs">
                    {b.puzzles} puzzle{b.puzzles === 1 ? '' : 's'}
                    {b.puzzles > 0 ? ` · ${b.solved} solved` : ''}
                  </span>
                </span>
                {b.puzzles > 0 && (
                  <span className="bg-surface-inset flex h-1.5 w-full overflow-hidden rounded-full">
                    <span
                      className="bg-nag-good h-full"
                      style={{ width: `${(100 * b.solved) / b.puzzles}%` }}
                    />
                    <span
                      className="bg-nag-blunder h-full"
                      style={{ width: `${(100 * b.failed) / b.puzzles}%` }}
                    />
                  </span>
                )}
              </button>
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

  const load = useCallback(async () => {
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}`);
    if (!res.ok) {
      setMissing(true);
      return;
    }
    setBook((await res.json()) as BookDetail);
  }, [slug]);
  useEffect(() => void load(), [load]);

  const deleteBook = async (): Promise<void> => {
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    navigate('puzzles', 'books');
  };

  if (missing) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-muted text-sm">That book does not exist.</p>
      </div>
    );
  }

  if (adding) {
    return (
      <PuzzleEntry
        slug={slug}
        number={(book?.puzzles.length ?? 0) + 1}
        onDone={() => {
          setAdding(false);
          void load();
        }}
        onCancel={() => setAdding(false)}
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
            <ArrowLeft className="size-3.5" />
          </Button>
          <h1 className="text-fg min-w-0 flex-1 truncate text-base font-semibold">
            {book?.title ?? slug}
          </h1>
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Add puzzle
          </Button>
          <TwoStepDelete onConfirm={() => void deleteBook()} />
        </div>

        {book === null ? (
          <p className="text-subtle text-sm">Loading…</p>
        ) : book.puzzles.length === 0 ? (
          <div className="bg-surface border-line rounded-xl border p-6 text-center">
            <p className="text-muted text-sm">
              Empty book. “Add puzzle” sets up the position on a board and
              records the full solution — both sides' moves.
            </p>
          </div>
        ) : (
          <>
            <p className="text-subtle mb-3 text-xs">
              {solvedCount}/{book.puzzles.length} solved — tap a number to train it.
            </p>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
              {book.puzzles.map((p, i) => {
                const last = book.progress[p.id]?.last;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => navigate('puzzles', 'books', slug, p.id)}
                    title={last ? `Last attempt: ${last}` : 'Not attempted'}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-lg border font-mono text-sm font-semibold transition-colors duration-100',
                      last === 'win'
                        ? 'bg-nag-good/15 border-nag-good/40 text-nag-good'
                        : last === 'loss'
                          ? 'bg-nag-blunder/15 border-nag-blunder/40 text-nag-blunder'
                          : 'bg-surface border-line text-muted hover:border-line-strong hover:bg-surface-2',
                    )}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Delete armed on first click, fires on the second within 4 s. */
function TwoStepDelete({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Button
      variant={armed ? 'primary' : 'ghost'}
      size={armed ? 'sm' : 'icon-sm'}
      title="Delete this book and its progress"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        onConfirm();
      }}
    >
      <Trash2 className="size-3.5" />
      {armed ? 'Really delete?' : null}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Entry: position via the embedded editor, then record the solution

function PuzzleEntry({
  slug,
  number,
  onDone,
  onCancel,
}: {
  slug: string;
  number: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fen, setFen] = useState<string | null>(null);

  if (fen === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
          <Button variant="ghost" size="icon-sm" title="Back to the book" onClick={onCancel}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <p className="text-muted text-sm">
            Puzzle #{number} — set up the diagram, then record the solution.
          </p>
        </div>
        <div className="min-h-0 flex-1">
          <EditorView useLabel="Record solution" onUse={setFen} />
        </div>
      </div>
    );
  }

  return (
    <SolutionRecorder
      slug={slug}
      number={number}
      fen={fen}
      onBack={() => setFen(null)}
      onDone={onDone}
    />
  );
}

function SolutionRecorder({
  slug,
  number,
  fen,
  onBack,
  onDone,
}: {
  slug: string;
  number: number;
  fen: string;
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
      const mover: Color = i % 2 === 0 ? solverSide : solverSide === 'white' ? 'black' : 'white';
      if (mover !== solverSide) continue;
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
    const res = await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fen,
        uci: line.map((m) => m.uci),
        san: line.map((m) => m.san),
        wildcards: [...wildcards],
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable] stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" title="Back to the position" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <span className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
            Puzzle #{number} — solution
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
          {line.some((_, i) => i % 2 === 1) && (
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
// Strict trainer, submit-model (lanph3re's design): enter the FULL answer
// freely — any legal moves, both sides, undo at will, nothing judged and
// nothing penalised while thinking — then Submit once. Grading walks the
// answer through the fairness tiers (wildcards, transpositions, any-mate,
// engine adjudication) and the verdict lands in one piece.

type Phase = 'loading' | 'solving' | 'checking' | 'done';

function BookTrainer({ slug, puzzleId }: { slug: string; puzzleId: string }) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [answer, setAnswer] = useState<PlayedMove[]>([]);
  // Reviewing an earlier entered position (null = live), via the toolbar.
  const [review, setReview] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [won, setWon] = useState(false);
  const [helped, setHelped] = useState(false);
  const [firstWrong, setFirstWrong] = useState<number | null>(null);
  const [engineApproved, setEngineApproved] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const puzzle = book?.puzzles.find((p) => p.id === puzzleId) ?? null;
  const index = book && puzzle ? book.puzzles.indexOf(puzzle) : -1;
  const solution: BookSolution | null = puzzle
    ? { fen: puzzle.fen, uci: puzzle.uci, ...(puzzle.wildcards ? { wildcards: puzzle.wildcards } : {}) }
    : null;

  useEffect(() => {
    void fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
      .then((d: BookDetail) => setBook(d))
      .catch(() => setBook(null));
  }, [slug]);

  useEffect(() => {
    if (!puzzle) return;
    setAnswer([]);
    setReview(null);
    setPhase('solving');
    setWon(false);
    setHelped(false);
    setFirstWrong(null);
    setEngineApproved(false);
    reported.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, puzzleId]);

  const reviewing = review !== null;
  const liveFen = answer.at(-1)?.fen ?? puzzle?.fen;
  const currentFen = reviewing
    ? (review === 0 ? puzzle?.fen : answer[review - 1]?.fen)
    : liveFen;
  const lastUci = reviewing
    ? (review > 0 ? answer[review - 1]?.uci : undefined)
    : answer.at(-1)?.uci;
  // chessops rejects nonsense positions loudly — never construct the view
  // before the puzzle has loaded.
  const view = currentFen ? boardStateOf(currentFen, lastUci) : null;

  const report = async (win: boolean): Promise<void> => {
    if (reported.current || !puzzle) return;
    reported.current = true;
    await fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/attempt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: puzzle.id, win }),
    });
  };

  /** Entry is free: any legal move goes on the answer, nothing is judged. */
  const applyMove = (orig: string, dest: string, promotion?: string): void => {
    if (!view || !currentFen || phase !== 'solving' || reviewing) return;
    const pos = Chess.fromSetup(parseFen(currentFen).unwrap()).unwrap();
    const uci = orig + dest + (promotion ?? '');
    const move = parseUci(uci);
    if (!move || !pos.isLegal(move)) return;
    const san = makeSanAndPlay(pos, move);
    setAnswer((prev) => [...prev, { uci, san, fen: makeFen(pos.toSetup()) }]);
  };

  const onMove = (orig: string, dest: string): void => {
    if (phase !== 'solving' || !view || reviewing) return;
    const to = parseSquare(dest);
    const lastRank = view.turn === 'white' ? 7 : 0;
    const pos = Chess.fromSetup(parseFen(view.fen).unwrap()).unwrap();
    const piece = pos.board.get(parseSquare(orig)!);
    if (piece?.role === 'pawn' && to !== undefined && squareRank(to) === lastRank) {
      setPendingPromotion({ orig, dest, color: view.turn });
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

  /** Step the review cursor; landing on the newest ply resumes live play. */
  const goToPly = (target: number): void => {
    const clamped = Math.max(0, Math.min(target, answer.length));
    setReview(clamped >= answer.length ? null : clamped);
  };

  const undo = (): void => {
    if (phase !== 'solving' || answer.length === 0) return;
    setReview(null);
    setAnswer((prev) => prev.slice(0, -1));
  };

  /**
   * The moment of truth: replay the whole answer through the judge. The
   * engine is consulted only where the book text cannot decide.
   */
  const submit = async (): Promise<void> => {
    if (!solution || !puzzle || answer.length === 0 || phase !== 'solving') return;
    setPhase('checking');
    setReview(null);

    let fen = solution.fen;
    let cursor = 0;
    let completed = false;
    let usedEngine = false;
    let wrongAt: number | null = null;

    for (let i = 0; i < answer.length && !completed; i++) {
      const m = answer[i]!;
      const mover: Color = fen.split(' ')[1] === 'b' ? 'black' : 'white';
      const verdict = judgeBookMove(
        solution,
        fen,
        cursor,
        m.uci.slice(0, 2),
        m.uci.slice(2, 4),
        m.uci.slice(4) || undefined,
      );
      if (verdict.kind === 'wrong') {
        wrongAt = i;
        break;
      }
      if (verdict.kind === 'engine') {
        const passes = await movePasses(m.fen, mover);
        if (!passes) {
          wrongAt = i;
          break;
        }
        usedEngine = true;
        completed = true; // engine verdicts only arise where the script ends
      } else {
        cursor = verdict.cursor;
        if (verdict.kind === 'complete') completed = true;
      }
      fen = m.fen;
    }

    const win = wrongAt === null && completed && !helped;
    setFirstWrong(wrongAt);
    setEngineApproved(usedEngine && wrongAt === null && completed);
    setWon(win);
    setPhase('done');
    // An incomplete-but-correct answer still counts as a miss: the book
    // wanted the whole line.
    void report(win);
  };

  const retry = (): void => {
    timers.current.forEach(clearTimeout);
    setAnswer([]);
    setReview(null);
    setPhase('solving');
    setWon(false);
    setHelped(false);
    setFirstWrong(null);
    setEngineApproved(false);
    reported.current = false;
  };

  const showSolution = (): void => {
    if (!solution || phase === 'done' || phase === 'checking') return;
    setHelped(true);
    void report(false);
    timers.current.forEach(clearTimeout);
    setReview(null);
    // Replay the scripted line from the start, one move per beat.
    const total = solution.uci.length;
    let at = 0;
    setAnswer([]);
    const step = (): void => {
      at++;
      const fenAt = scriptedFen(solution, at);
      const uciAt = solution.uci[at - 1]!;
      setAnswer((prev) => [
        ...prev.slice(0, at - 1),
        { uci: uciAt, san: puzzle?.san[at - 1] ?? '?', fen: fenAt },
      ]);
      if (at < total) timers.current.push(setTimeout(step, 650));
      else {
        setWon(false);
        setPhase('done');
      }
    };
    timers.current.push(setTimeout(step, 400));
  };

  const analyse = (): void => {
    if (!view) return;
    if (!useAnalysis.getState().loadFen(view.fen)) return;
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
    if (!view) return;
    const pieces = view.fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    const prev = prevPieces.current;
    prevPieces.current = pieces;
    if (prev === null || !view.lastMove) return;
    playSound(view.check ? 'check' : pieces < prev ? 'capture' : 'move');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.fen]);

  if (book === null || !puzzle || !view) {
    return (
      <div className="text-subtle grid h-full place-items-center text-sm">
        {!puzzle && book !== null ? 'That puzzle does not exist.' : <Loader2 className="size-5 animate-spin" />}
      </div>
    );
  }

  const orientation = parseFen(puzzle.fen).unwrap().turn;
  const next = nextUnsolved();

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          <div className="relative w-full">
            <Board
              fen={view.fen}
              orientation={orientation}
              dests={phase === 'solving' && !reviewing ? view.dests : new Map()}
              lastMove={view.lastMove}
              check={view.check}
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
          <div className="flex h-6 w-full items-center gap-2 px-0.5 text-xs">
            <SideDot side={view.turn} />
            <span
              className={cn(
                phase === 'done' && won
                  ? 'text-good'
                  : phase === 'done' && !helped
                    ? 'text-bad'
                    : 'text-muted',
              )}
            >
              {reviewing
                ? 'Reviewing — jump to the newest move to continue.'
                : phase === 'checking'
                  ? 'Checking your answer…'
                  : phase === 'done'
                    ? helped
                      ? 'That is the book line. Retry it clean later.'
                      : won
                        ? engineApproved
                          ? 'Off the book at the end — but the engine approves. Solved.'
                          : 'Exactly as the book has it.'
                        : firstWrong !== null
                          ? 'Not quite — the marked move is where it goes wrong.'
                          : 'Correct so far, but the book line goes further.'
                    : 'Enter your FULL answer — both sides — then submit.'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto [scrollbar-gutter:stable] stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            title="Back to the book"
            onClick={() => navigate('puzzles', 'books', slug)}
          >
            <ArrowLeft className="size-3.5" />
          </Button>
          <span className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
            {book.title} · #{index + 1}
          </span>
        </div>

        <AnswerPanel
          title={`Your answer · ${answer.length} plies`}
          fen={puzzle.fen}
          sans={answer.map((m) => m.san)}
          current={review ?? answer.length}
          wrongAt={phase === 'done' ? firstWrong : null}
          emptyText="Nothing entered yet — find the first move on the board."
          onSelect={goToPly}
        />

        <div className="flex shrink-0 flex-wrap gap-2">
          {phase === 'done' ? (
            <>
              {next && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('puzzles', 'books', slug, next)}
                >
                  <RotateCw className="size-3.5" />
                  Next unsolved
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={retry}>
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
                disabled={phase !== 'solving' || answer.length === 0}
                title="Grade the answer — this is the only judged moment"
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
                disabled={phase !== 'solving' || answer.length === 0}
                title="Take back the last move (no penalty)"
                onClick={undo}
              >
                <Undo2 className="size-3.5" />
                Undo
              </Button>
              <Button variant="ghost" size="sm" disabled={phase !== 'solving'} onClick={showSolution} title="Counts as a failed attempt">
                <Eye className="size-3.5" />
                Solution
              </Button>
              <Button variant="ghost" size="sm" onClick={retry}>
                <RotateCcw className="size-3.5" />
                Restart
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
    </div>
  );
}
