import {
  ChevronRight,
  Eye,
  Lightbulb,
  Loader2,
  Puzzle,
  RotateCw,
  Swords,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Color, Role } from 'chessops/types';
import { parseSquare, squareRank } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { BOARD_MAX_W } from '@/board/boardSize';
import { Board } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { SideDot } from '@/ui/SideDot';
import { ThemesPage, themeLabel } from './ThemesPage';
import {
  judgeMove,
  positionAt,
  positionWith,
  sanLine,
  solverColor,
  startAt,
  type ApiPuzzle,
  type PuzzlePosition,
} from './puzzle';

interface UserState {
  rating: number;
  attempts: number;
  wins: number;
  streak: number;
}

interface Meta {
  ready: boolean;
  puzzles?: number;
  themes?: { theme: string; count: number }[];
  user: UserState;
}

/** What the solver is doing right now. */
type Phase =
  | 'loading'
  | 'setup' // opponent's first move is about to play
  | 'solving'
  | 'opponent' // correct — opponent reply pending
  | 'wrong' // off-script move shown briefly before rollback
  | 'done';

interface Attempt {
  win: boolean;
  delta: number;
}

/**
 * Routes: #/puzzles trains across all themes, #/puzzles/themes is the
 * category page, #/puzzles/theme/<t> trains one theme. The trainer is
 * keyed by theme so switching category boots a clean state machine.
 */
export function PuzzlesView({ params = [] }: { params?: string[] }) {
  if (params[0] === 'themes') return <ThemesPage />;
  if (params[0] === 'failed') return <Trainer key="failed" theme="" mode="failed" />;
  const theme = params[0] === 'theme' ? (params[1] ?? '') : '';
  return <Trainer key={theme} theme={theme} mode="fresh" />;
}

/**
 * `fresh` trains rated puzzles near the user's rating; `failed` replays
 * puzzles whose latest attempt was a loss — unrated practice that removes
 * a puzzle from the pool once solved cleanly.
 */
function Trainer({ theme, mode }: { theme: string; mode: 'fresh' | 'failed' }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [puzzle, setPuzzle] = useState<ApiPuzzle | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [plies, setPlies] = useState(0);
  const [view, setView] = useState<PuzzlePosition | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [hint, setHint] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);

  // Reviewing earlier plies of the line (null = live position).
  const [review, setReview] = useState<number | null>(null);

  // One attempt per puzzle: recorded at the first mistake or the clean solve.
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = (ms: number, fn: () => void): void => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const refreshMeta = useCallback(async () => {
    const res = await fetch('/api/puzzles/meta');
    setMeta((await res.json()) as Meta);
  }, []);

  const report = useCallback(
    async (id: string, win: boolean) => {
      if (reported.current) return;
      reported.current = true;
      const res = await fetch('/api/puzzles/attempt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, win, rated: mode === 'fresh' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { user: UserState; delta: number };
        setAttempt({ win, delta: data.delta });
        setMeta((m) => (m ? { ...m, user: data.user } : m));
      }
    },
    [mode],
  );

  const loadNext = useCallback(
    async (selectedTheme: string) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase('loading');
      setPuzzle(null);
      setAttempt(null);
      setFailed(false);
      setHint(0);
      setError(null);
      setPendingPromotion(null);
      reported.current = false;

      const query =
        mode === 'failed'
          ? '?mode=failed'
          : selectedTheme
            ? `?theme=${encodeURIComponent(selectedTheme)}`
            : '';
      const res = await fetch(`/api/puzzles/next${query}`);
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const { puzzle: next } = (await res.json()) as { puzzle: ApiPuzzle };
      setPuzzle(next);
      setPlies(0);
      setReview(null);
      setView(positionAt(next, 0));
      setPhase('setup');
      // Let the position register, then play the opponent's setup move.
      after(700, () => {
        setPlies(1);
        setView(positionAt(next, 1));
        setPhase('solving');
      });
    },
    [mode],
  );

  // One boot per real mount: StrictMode replays effects, and without the
  // guard the page fetched (and briefly showed) two different puzzles.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void refreshMeta();
    void loadNext(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the board actually shows: the live machine position, or an
  // earlier ply while reviewing the move list.
  const displayed = review !== null && puzzle ? positionAt(puzzle, review) : view;
  const reviewing = review !== null;

  // Sound per rendered position (live or review). No SAN here, so a capture
  // is detected by the piece count dropping; a fresh puzzle stays silent.
  const prevPieces = useRef<number | null>(null);
  useEffect(() => {
    if (!displayed) {
      prevPieces.current = null;
      return;
    }
    const pieces = displayed.fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    const prev = prevPieces.current;
    prevPieces.current = pieces;
    if (prev === null || !displayed.lastMove) return;
    playSound(displayed.check ? 'check' : pieces < prev ? 'capture' : 'move');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayed?.fen]);

  // Any progress of the solving machine snaps the board back to live.
  useEffect(() => setReview(null), [plies, phase]);

  /** Step the review cursor; landing on the newest ply resumes live play. */
  const goToPly = useCallback(
    (target: number): void => {
      if (!puzzle) return;
      const clamped = Math.max(1, Math.min(target, plies));
      setReview(clamped >= plies ? null : clamped);
    },
    [puzzle, plies],
  );

  // Wheel over the board walks the line, like the analysis board. Manual
  // listener: React's synthetic wheel handler is passive.
  const boardColumn = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boardColumn.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 24) return;
      const direction = acc > 0 ? 1 : -1;
      acc = 0;
      setReview((current) => {
        const at = current ?? pliesRef.current;
        const next = Math.max(1, Math.min(at + direction, pliesRef.current));
        return next >= pliesRef.current ? null : next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const pliesRef = useRef(plies);
  pliesRef.current = plies;

  const finish = (p: ApiPuzzle, finalPlies: number): void => {
    setPhase('done');
    setView(positionAt(p, finalPlies));
    void report(p.id, !failed);
  };

  const applyUserMove = (uci: string): void => {
    if (!puzzle || phase !== 'solving') return;
    const verdict = judgeMove(puzzle, plies, uci);

    if (verdict === 'wrong') {
      setFailed(true);
      setView(positionWith(puzzle, plies, uci));
      setPhase('wrong');
      void report(puzzle.id, false);
      after(650, () => {
        setView(positionAt(puzzle, plies));
        setPhase('solving');
      });
      return;
    }

    const moves = puzzle.moves.split(' ');
    const played = uci === moves[plies] ? plies + 1 : plies; // off-script mate keeps plies
    if (verdict === 'complete') {
      if (uci === moves[plies]) {
        finish(puzzle, played);
      } else {
        // Off-script mate: show the user's own move as the final position.
        setPhase('done');
        setView(positionWith(puzzle, plies, uci));
        void report(puzzle.id, !failed);
      }
      return;
    }

    // Correct, more to come: show it, then the scripted reply.
    setPlies(played);
    setView(positionAt(puzzle, played));
    setPhase('opponent');
    setHint(0);
    after(450, () => {
      setPlies(played + 1);
      setView(positionAt(puzzle, played + 1));
      setPhase('solving');
    });
  };

  const onMove = (orig: string, dest: string): void => {
    if (!puzzle || !view || phase !== 'solving' || reviewing) return;
    // A pawn reaching the last rank needs the picker before it can be judged.
    const to = parseSquare(dest);
    const lastRank = view.turn === 'white' ? 7 : 0;
    if (to !== undefined && squareRank(to) === lastRank && isPawnMove(view.fen, orig)) {
      setPendingPromotion({ orig, dest, color: view.turn });
      return;
    }
    applyUserMove(orig + dest);
  };

  const completePromotion = (role: Role): void => {
    if (!pendingPromotion) return;
    const letter = { queen: 'q', rook: 'r', bishop: 'b', knight: 'n', king: '', pawn: '' }[role];
    applyUserMove(pendingPromotion.orig + pendingPromotion.dest + letter);
    setPendingPromotion(null);
  };

  const viewSolution = (): void => {
    if (!puzzle || phase === 'done') return;
    setFailed(true);
    void report(puzzle.id, false);
    const moves = puzzle.moves.split(' ');
    let at = plies;
    setPhase('opponent');
    const step = (): void => {
      at++;
      setPlies(at);
      setView(positionAt(puzzle, at));
      if (at < moves.length) after(650, step);
      else setPhase('done');
    };
    step();
  };

  const analyse = (): void => {
    if (!displayed) return;
    if (!useAnalysis.getState().loadFen(displayed.fen)) return;
    useAnalysis.setState({ handoff: true });
    navigate('analysis');
  };

  const orientation: Color = puzzle ? solverColor(puzzle) : 'white';
  const hintShapes: DrawShape[] =
    puzzle && phase === 'solving' && !reviewing && hint > 0
      ? (() => {
          const uci = puzzle.moves.split(' ')[plies]!;
          const orig = uci.slice(0, 2) as DrawShape['orig'];
          return hint === 1
            ? [{ orig, brush: 'blue' }]
            : [{ orig, dest: uci.slice(2, 4) as DrawShape['orig'], brush: 'blue' }];
        })()
      : [];

  if (meta && !meta.ready) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <p className="text-fg mb-2 text-sm font-semibold">No puzzle database yet</p>
          <p className="text-muted text-xs leading-relaxed">
            Download the Lichess dump and build it once:
          </p>
          <code className="bg-surface-inset border-line text-subtle mt-3 block rounded-md border p-3 text-left font-mono text-[0.6875rem] leading-relaxed">
            curl -L -o data/lichess_db_puzzle.csv.zst \<br />
            &nbsp;&nbsp;https://database.lichess.org/lichess_db_puzzle.csv.zst
            <br />
            npm run build:puzzles
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4">
      {/* Board column, matching the shared budget so the board sits where
          every other view puts it. */}
      <div className="flex min-h-0 shrink-0 flex-col items-center gap-2 wide:flex-1 wide:justify-start">
        <div className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          <div className="relative w-full">
            {displayed ? (
              <Board
                fen={displayed.fen}
                orientation={orientation}
                dests={phase === 'solving' && !reviewing ? displayed.dests : new Map()}
                lastMove={displayed.lastMove}
                check={displayed.check}
                autoShapes={hintShapes}
                onMove={onMove}
              />
            ) : (
              <div className="bg-surface border-line grid aspect-square w-full place-items-center rounded-xl border">
                {error ? (
                  <p className="text-muted max-w-[80%] text-center text-xs">{error}</p>
                ) : (
                  <Loader2 className="text-subtle size-6 animate-spin" />
                )}
              </div>
            )}
            {pendingPromotion && (
              <PromotionPicker
                color={pendingPromotion.color}
                dest={pendingPromotion.dest}
                orientation={orientation}
                onSelect={completePromotion}
                onCancel={() => setPendingPromotion(null)}
              />
            )}
            {!reviewing && phase === 'wrong' && (
              <MoveBadge kind="bad" view={view} orientation={orientation} />
            )}
            {!reviewing && phase === 'done' && !failed && (
              <MoveBadge kind="good" view={view} orientation={orientation} />
            )}
          </div>
          <StatusStrip phase={phase} failed={failed} reviewing={reviewing} orientation={orientation} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 stacked:gap-2 wide:min-h-0 wide:w-[min(27rem,38%)] wide:flex-none wide:overflow-y-auto">
        <Panel flush className="shrink-0">
          <PanelHeader title="Your rating" />
          <div className="flex items-baseline gap-3 px-3 py-2.5">
            <span className="text-fg font-mono text-2xl font-bold tabular-nums">
              {meta?.user.rating ?? '…'}
            </span>
            {attempt && mode === 'fresh' && (
              <span
                className={cn(
                  'font-mono text-sm font-semibold tabular-nums',
                  attempt.delta >= 0 ? 'text-good' : 'text-bad',
                )}
              >
                {attempt.delta >= 0 ? '+' : ''}
                {attempt.delta}
              </span>
            )}
            {mode === 'failed' && (
              <span className="bg-surface-2 text-subtle rounded px-1.5 py-0.5 text-[0.625rem]">
                practice · unrated
              </span>
            )}
            <span className="text-subtle ml-auto text-xs">
              {meta ? `${meta.user.wins}/${meta.user.attempts} solved` : ''}
              {meta && meta.user.streak > 1 ? ` · streak ${meta.user.streak}` : ''}
            </span>
          </div>
        </Panel>

        {puzzle && plies > 0 && (
          <Panel flush className="shrink-0">
            <PanelHeader title="Moves" />
            <div className="max-h-36 overflow-y-auto px-3 py-2 text-sm leading-relaxed">
              <MoveLine
                puzzle={puzzle}
                plies={plies}
                current={review ?? plies}
                onSelect={goToPly}
              />
            </div>
          </Panel>
        )}

        <Panel flush className="min-h-min flex-1">
          <PanelHeader
            title="Puzzle"
            actions={
              puzzle &&
              phase === 'done' && (
                <span className="text-subtle font-mono text-[0.6875rem]">#{puzzle.id}</span>
              )
            }
          />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {phase === 'done' && puzzle ? (
              <>
                <p className={cn('text-sm font-semibold', failed ? 'text-bad' : 'text-good')}>
                  {failed ? 'Solved with help.' : 'Solved!'}
                </p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-subtle">Rating</dt>
                  <dd className="text-fg font-mono">{puzzle.rating}</dd>
                  <dt className="text-subtle">Played</dt>
                  <dd className="text-fg font-mono">{puzzle.plays.toLocaleString()}</dd>
                  <dt className="text-subtle">Themes</dt>
                  <dd className="flex flex-wrap gap-1">
                    {puzzle.themes.split(' ').map((t) => (
                      <span
                        key={t}
                        className="bg-surface-2 text-muted rounded px-1.5 py-0.5 text-[0.6875rem]"
                      >
                        {t}
                      </span>
                    ))}
                  </dd>
                </dl>
                {puzzle.game_url && (
                  <a
                    href={puzzle.game_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary text-xs hover:underline"
                  >
                    From this game ↗
                  </a>
                )}
              </>
            ) : (
              <p className="text-muted text-xs leading-relaxed">
                {phase === 'loading'
                  ? 'Finding a puzzle near your rating…'
                  : failed
                    ? 'Keep looking — find the best move.'
                    : 'Find the best move. The rating and themes stay hidden until you finish.'}
              </p>
            )}

            <div className="mt-auto flex flex-wrap gap-2">
              {phase === 'done' ? (
                <>
                  <Button variant="primary" size="sm" onClick={() => void loadNext(theme)}>
                    <RotateCw className="size-3.5" />
                    Next puzzle
                  </Button>
                  <Button variant="secondary" size="sm" onClick={analyse}>
                    <Swords className="size-3.5" />
                    Analyse
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={phase !== 'solving'}
                    onClick={() => setHint((h) => Math.min(h + 1, 2))}
                    title="First press marks the piece, second the move (no rating penalty)"
                  >
                    <Lightbulb className="size-3.5" />
                    Hint
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={phase !== 'solving'}
                    onClick={viewSolution}
                    title="Counts as a failed attempt"
                  >
                    <Eye className="size-3.5" />
                    Solution
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void loadNext(theme)}>
                    Skip
                  </Button>
                </>
              )}
            </div>
          </div>
        </Panel>

        {/* Category — a card linking to the themes page, not a dropdown. */}
        <button
          type="button"
          onClick={() => navigate('puzzles', 'themes')}
          className={cn(
            'bg-surface border-line hover:border-line-strong hover:bg-surface-2 group flex shrink-0',
            'items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors duration-100',
          )}
        >
          <Puzzle className="text-subtle group-hover:text-primary size-4 shrink-0 transition-colors" />
          <span className="min-w-0 flex-1">
            <span className="text-subtle block text-[0.625rem] font-semibold uppercase tracking-[0.08em]">
              Category
            </span>
            <span className="text-fg block truncate text-xs font-medium">
              {mode === 'failed' ? 'Failed puzzles' : theme ? themeLabel(theme) : 'All themes'}
            </span>
          </span>
          <ChevronRight className="text-subtle size-3.5 shrink-0" />
        </button>
      </div>
    </div>
  );
}

/** Fixed-height strip under the board: whose move, and how it's going. */
function StatusStrip({
  phase,
  failed,
  reviewing,
  orientation,
}: {
  phase: Phase;
  failed: boolean;
  reviewing: boolean;
  orientation: Color;
}) {
  const text = reviewing
    ? 'Reviewing — scroll or click the last move to come back.'
    : phase === 'loading'
      ? '…'
      : phase === 'setup' || phase === 'opponent'
        ? 'Opponent is moving…'
        : phase === 'wrong'
          ? 'That is not it — it rolls back, try again.'
          : phase === 'done'
            ? failed
              ? 'Done. On to the next one.'
              : 'Well played.'
            : `Your move — you play ${orientation}.`;
  return (
    <div className="flex h-6 w-full items-center gap-2 px-0.5 text-xs">
      <SideDot side={orientation} />
      <span
        className={cn(
          phase === 'wrong' ? 'text-bad' : phase === 'done' && !failed ? 'text-good' : 'text-muted',
        )}
      >
        {text}
      </span>
    </div>
  );
}

/** ✓/✗ pinned to the destination square of the last move, NAG-badge style. */
function MoveBadge({
  kind,
  view,
  orientation,
}: {
  kind: 'good' | 'bad';
  view: PuzzlePosition | null;
  orientation: Color;
}) {
  const dest = view?.lastMove?.[1];
  if (!dest) return null;
  const file = dest.charCodeAt(0) - 97;
  const rank = dest.charCodeAt(1) - 49;
  const column = orientation === 'white' ? file : 7 - file;
  const rowFromTop = orientation === 'white' ? 7 - rank : rank;
  return (
    <span
      aria-hidden
      style={{
        left: `calc(${(column + 1) * 12.5}% - 0.85rem)`,
        top: `calc(${rowFromTop * 12.5}% - 0.4rem)`,
      }}
      className={cn(
        'pointer-events-none absolute z-30 grid size-6 place-items-center rounded-full',
        'text-nag-fg text-sm font-bold shadow-md',
        kind === 'good' ? 'bg-nag-good' : 'bg-nag-blunder',
      )}
    >
      {kind === 'good' ? '✓' : '✗'}
    </span>
  );
}

/** Is the piece on `orig` a pawn? (For promotion detection.) */
function isPawnMove(fen: string, orig: string): boolean {
  const board = fen.split(' ')[0]!;
  const rows = board.split('/');
  const file = orig.charCodeAt(0) - 97;
  const rank = Number(orig[1]) - 1;
  const row = rows[7 - rank];
  if (!row) return false;
  let col = 0;
  for (const ch of row) {
    if (/\d/.test(ch)) col += Number(ch);
    else {
      if (col === file) return ch === 'p' || ch === 'P';
      col++;
    }
  }
  return false;
}

/**
 * The played line so far, numbered from the puzzle's real move number —
 * click any move to review that position, the newest to come back live.
 */
function MoveLine({
  puzzle,
  plies,
  current,
  onSelect,
}: {
  puzzle: ApiPuzzle;
  plies: number;
  current: number;
  onSelect: (ply: number) => void;
}) {
  const sans = sanLine(puzzle, plies);
  const { moveNumber, blackToMove } = startAt(puzzle);
  return (
    <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
      {sans.map((san, i) => {
        const isWhiteMove = blackToMove ? i % 2 === 1 : i % 2 === 0;
        const number = moveNumber + Math.floor((i + (blackToMove ? 1 : 0)) / 2);
        return (
          <span key={i} className="flex items-baseline gap-1">
            {i === 0 && blackToMove ? (
              <span className="text-subtle font-mono text-xs">{number}…</span>
            ) : isWhiteMove ? (
              <span className="text-subtle font-mono text-xs">{number}.</span>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(i + 1)}
              className={cn(
                'rounded px-1 font-mono text-[0.8125rem] transition-colors duration-100',
                i + 1 === current
                  ? 'bg-primary-soft text-primary font-semibold'
                  : 'text-fg hover:bg-surface-2',
              )}
            >
              {san}
            </button>
          </span>
        );
      })}
    </div>
  );
}
