import {
  Eye,
  Lightbulb,
  Loader2,
  RotateCw,
  Swords,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Color, Role } from 'chessops/types';
import { parseSquare, squareRank } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { BOARD_MAX_W } from '@/board/boardSize';
import { Board } from '@/board/Board';
import { PromotionPicker } from '@/board/PromotionPicker';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { SideDot } from '@/ui/SideDot';
import {
  judgeMove,
  positionAt,
  positionWith,
  solverColor,
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

export function PuzzlesView() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [theme, setTheme] = useState('');
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
  useEffect(() => void refreshMeta(), [refreshMeta]);

  const report = useCallback(
    async (id: string, win: boolean) => {
      if (reported.current) return;
      reported.current = true;
      const res = await fetch('/api/puzzles/attempt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, win }),
      });
      if (res.ok) {
        const data = (await res.json()) as { user: UserState; delta: number };
        setAttempt({ win, delta: data.delta });
        setMeta((m) => (m ? { ...m, user: data.user } : m));
      }
    },
    [],
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

      const query = selectedTheme ? `?theme=${encodeURIComponent(selectedTheme)}` : '';
      const res = await fetch(`/api/puzzles/next${query}`);
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const { puzzle: next } = (await res.json()) as { puzzle: ApiPuzzle };
      setPuzzle(next);
      setPlies(0);
      setView(positionAt(next, 0));
      setPhase('setup');
      // Let the position register, then play the opponent's setup move.
      after(700, () => {
        setPlies(1);
        setView(positionAt(next, 1));
        setPhase('solving');
      });
    },
    [],
  );

  useEffect(() => {
    void loadNext(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!puzzle || !view || phase !== 'solving') return;
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
    if (!view) return;
    useAnalysis.getState().loadFen(view.fen);
    navigate('analysis');
  };

  const orientation: Color = puzzle ? solverColor(puzzle) : 'white';
  const hintShapes: DrawShape[] =
    puzzle && phase === 'solving' && hint > 0
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
            {view ? (
              <Board
                fen={view.fen}
                orientation={orientation}
                dests={phase === 'solving' ? view.dests : new Map()}
                lastMove={view.lastMove}
                check={view.check}
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
            {phase === 'wrong' && <MoveBadge kind="bad" view={view} orientation={orientation} />}
            {phase === 'done' && !failed && (
              <MoveBadge kind="good" view={view} orientation={orientation} />
            )}
          </div>
          <StatusStrip phase={phase} failed={failed} orientation={orientation} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 stacked:gap-2 wide:min-h-0 wide:w-[min(27rem,38%)] wide:flex-none wide:overflow-y-auto">
        <Panel flush className="shrink-0">
          <PanelHeader title="Your rating" />
          <div className="flex items-baseline gap-3 px-3 py-2.5">
            <span className="text-fg font-mono text-2xl font-bold tabular-nums">
              {meta?.user.rating ?? '…'}
            </span>
            {attempt && (
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
            <span className="text-subtle ml-auto text-xs">
              {meta ? `${meta.user.wins}/${meta.user.attempts} solved` : ''}
              {meta && meta.user.streak > 1 ? ` · streak ${meta.user.streak}` : ''}
            </span>
          </div>
        </Panel>

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

        <Panel flush className="shrink-0">
          <PanelHeader title="Theme" />
          <div className="p-3">
            <select
              value={theme}
              onChange={(e) => {
                setTheme(e.target.value);
                void loadNext(e.target.value);
              }}
              className={cn(
                'bg-surface-inset border-line h-8 w-full rounded-md border px-2 text-xs',
                'outline-none focus:border-primary/50',
              )}
            >
              <option value="">Any theme</option>
              {meta?.themes?.map((t) => (
                <option key={t.theme} value={t.theme}>
                  {t.theme} ({t.count.toLocaleString()})
                </option>
              ))}
            </select>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Fixed-height strip under the board: whose move, and how it's going. */
function StatusStrip({
  phase,
  failed,
  orientation,
}: {
  phase: Phase;
  failed: boolean;
  orientation: Color;
}) {
  const text =
    phase === 'loading'
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
