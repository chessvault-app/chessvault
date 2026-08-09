import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  BarChart3,
  ChevronRight,
  FlipVertical2,
  Settings2,
  Eye,
  LayoutGrid,
  Lightbulb,
  Loader2,
  Puzzle,
  RotateCw,
  Swords,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color, Role } from 'chessops/types';
import { parseSquare, squareRank } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { BOARD_MAX_W } from '@/board/boardSize';
import { AnalysisBoard, BoardControls } from '@/board/AnalysisBoard';
import { Board } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { MoveActions, StatusBar } from '@/analysis/AnalysisView';
import { MoveTreePane } from '@/analysis/MoveTreePane';
import { mainlineFrom } from '@shared/tree';
import { EngineBlock } from '@/engine/EnginePane';
import { cn } from '@/lib/cn';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { MobileActionBar } from '@/ui/MobileActionBar';
import { Panel, PanelHeader } from '@/ui/Panel';
import { BooksView } from './BooksView';
import { DashboardPage } from './DashboardPage';
import { ThemesPage, themeLabel } from './ThemesPage';
import { AnswerPanel } from './AnswerPanel';
import {
  judgeMove,
  positionAt,
  positionWith,
  puzzleTree,
  solverColor,
  type ApiPuzzle,
  type PuzzlePosition,
} from './puzzle';

interface UserState {
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

/**
 * No rating system — the app is single-user (lanph3re's call). Difficulty is
 * an explicit puzzle-rating range instead, remembered across sessions.
 */
const DIFFICULTIES = [
  { id: 'any', label: 'Any', query: {} },
  { id: 'easy', label: 'Easy', query: { max: 1400 }, hint: 'up to 1400' },
  { id: 'medium', label: 'Medium', query: { min: 1400, max: 1800 }, hint: '1400–1800' },
  { id: 'hard', label: 'Hard', query: { min: 1800, max: 2200 }, hint: '1800–2200' },
  { id: 'expert', label: 'Expert', query: { min: 2200 }, hint: '2200+' },
] as const;
type DifficultyId = (typeof DIFFICULTIES)[number]['id'];
const DIFFICULTY_KEY = 'vault:puzzle-difficulty';

/** What the solver is doing right now. */
type Phase =
  | 'loading'
  | 'setup' // opponent's first move is about to play
  | 'solving'
  | 'opponent' // correct — opponent reply pending
  | 'wrong' // off-script move shown briefly before rollback
  | 'done';

/**
 * Routes: #/puzzles trains across all themes, #/puzzles/themes is the
 * category page, #/puzzles/theme/<t> trains one theme, #/puzzles/failed
 * reviews previously failed puzzles (uncounted). The trainer is keyed so
 * switching category boots a clean state machine.
 */
export function PuzzlesView({ params = [] }: { params?: string[] }) {
  if (params[0] === 'themes') return <ThemesPage />;
  if (params[0] === 'dashboard') return <DashboardPage />;
  if (params[0] === 'books') return <BooksView params={params.slice(1)} />;
  if (params[0] === 'failed') return <Trainer key="failed" theme="" mode="failed" />;
  if (params[0] === 'id' && params[1]) {
    return <Trainer key={`id-${params[1]}`} theme="" mode="single" puzzleId={params[1]} />;
  }
  const theme = params[0] === 'theme' ? (params[1] ?? '') : '';
  return <Trainer key={theme} theme={theme} mode="fresh" />;
}

/**
 * `fresh` trains unseen puzzles; `failed` cycles the review pool;
 * `single` replays one specific puzzle (from the dashboard). Only fresh
 * attempts count — the other modes still update the review pool through
 * the history.
 */
function Trainer({
  theme,
  mode,
  puzzleId,
}: {
  theme: string;
  mode: 'fresh' | 'failed' | 'single';
  puzzleId?: string;
}) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [puzzle, setPuzzle] = useState<ApiPuzzle | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [plies, setPlies] = useState(0);
  const [view, setView] = useState<PuzzlePosition | null>(null);
  const [failed, setFailed] = useState(false);
  const [hint, setHint] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyId>(() => {
    const stored = localStorage.getItem(DIFFICULTY_KEY);
    return DIFFICULTIES.some((d) => d.id === stored) ? (stored as DifficultyId) : 'any';
  });
  // Stacked: the difficulty row hides behind the Puzzle panel's gear.
  const [showDifficulty, setShowDifficulty] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{
    orig: string;
    dest: string;
    color: Color;
  } | null>(null);
  // Reviewing an earlier ply of the line (null = live), via the panel's
  // toolbar; any machine progress snaps back to live.
  const [review, setReview] = useState<number | null>(null);
  // Manual board flip (the bottom bar's flip button); resets per puzzle so
  // each starts oriented to the side you play.
  const [flipped, setFlipped] = useState(false);

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
        body: JSON.stringify({ id, win, counted: mode === 'fresh' }),
      });
      if (res.ok) {
        const data = (await res.json()) as { user: UserState };
        setMeta((m) => (m ? { ...m, user: data.user } : m));
      }
    },
    [mode],
  );

  const loadNext = useCallback(
    async (selectedTheme: string, selectedDifficulty: DifficultyId) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase('loading');
      setPuzzle(null);
      setFailed(false);
      setHint(0);
      setError(null);
      setPendingPromotion(null);
      reported.current = false;

      let url: string;
      if (mode === 'single') {
        url = `/api/puzzles/by-id/${encodeURIComponent(puzzleId ?? '')}`;
      } else {
        const query = new URLSearchParams();
        if (mode === 'failed') query.set('mode', 'failed');
        else {
          if (selectedTheme) query.set('theme', selectedTheme);
          const range = DIFFICULTIES.find((d) => d.id === selectedDifficulty)?.query ?? {};
          if ('min' in range) query.set('min', String(range.min));
          if ('max' in range) query.set('max', String(range.max));
        }
        const qs = query.toString();
        url = `/api/puzzles/next${qs ? `?${qs}` : ''}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const { puzzle: next } = (await res.json()) as { puzzle: ApiPuzzle };
      setPuzzle(next);
      setPlies(0);
      setReview(null);
      setFlipped(false);
      setView(positionAt(next, 0));
      setPhase('setup');
      // Let the position register, then play the opponent's setup move.
      after(700, () => {
        setPlies(1);
        setView(positionAt(next, 1));
        setPhase('solving');
      });
    },
    [mode, puzzleId],
  );

  // One boot per real mount: StrictMode replays effects, and without the
  // guard the page fetched (and briefly showed) two different puzzles.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void refreshMeta();
    void loadNext(theme, difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickDifficulty = (id: DifficultyId): void => {
    setDifficulty(id);
    localStorage.setItem(DIFFICULTY_KEY, id);
    void loadNext(theme, id);
  };

  // What the board shows: the live machine position, or a reviewed ply.
  const displayed = review !== null && puzzle ? positionAt(puzzle, review) : view;
  const reviewing = review !== null;

  // The played line as a move tree, so the panel renders exactly like the
  // analysis tab's table. Rebuilt per ply; puzzle lines are short.
  // Built from ply 0 so the Moves panel exists (empty) from the very
  // first frame instead of popping in after the setup move.
  const answerTree = useMemo(() => (puzzle ? puzzleTree(puzzle, plies).tree : null), [puzzle, plies]);
  const answerIds = useMemo(
    () => (answerTree ? mainlineFrom(answerTree, answerTree.rootId) : []),
    [answerTree],
  );

  // Any machine progress snaps the board back to live.
  useEffect(() => setReview(null), [plies, phase]);

  const goToPly = (target: number): void => {
    if (!puzzle) return;
    const clamped = Math.max(1, Math.min(target, plies));
    setReview(clamped >= plies ? null : clamped);
  };

  // Sound per rendered position (live or review). No SAN here, so a
  // capture is detected by the piece count dropping; a fresh puzzle (no
  // lastMove) stays silent.
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

  const finish = (p: ApiPuzzle, finalPlies: number): void => {
    setPhase('done');
    setPlies(finalPlies);
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

  // In-place analysis (lanph3re's call: no jump to the Analysis tab): the final
  // position loads into the shared analysis store and the trainer swaps to
  // the real analysis board + merged engine/moves panel. Entering is an
  // explicit "analyse" act, so the engine comes on; leaving turns it off.
  const [analysing, setAnalysing] = useState(false);
  const analysingRef = useRef(false);
  analysingRef.current = analysing;
  useEffect(
    () => () => {
      if (analysingRef.current) useEngine.getState().setEnabled(false);
    },
    [],
  );

  const analyse = (): void => {
    if (!puzzle) return;
    // Seed the analysis tree with the whole played line (lanph3re's call), so
    // the puzzle moves are navigable, with the cursor on the final
    // position. An off-script mating finish isn't in the scripted line and
    // is left out — the engine will show the mate anyway.
    const { tree, lastId } = puzzleTree(puzzle, plies);
    useAnalysis.setState({
      tree,
      cursorId: lastId,
      orientation,
      pendingPromotion: null,
      loadError: null,
      gameHeaders: null,
    });
    useEngine.getState().setEnabled(true);
    setAnalysing(true);
  };

  const backToPuzzle = (): void => {
    useEngine.getState().setEnabled(false);
    setAnalysing(false);
  };

  const nextFromAnalysis = (): void => {
    backToPuzzle();
    void loadNext(theme, difficulty);
  };

  const solverSide: Color = puzzle ? solverColor(puzzle) : 'white';
  const orientation: Color = flipped ? (solverSide === 'white' ? 'black' : 'white') : solverSide;
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
      <div className="flex h-full flex-col items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-md text-center">
          <p className="text-fg mb-2 text-sm font-semibold">No puzzle database yet</p>
          <p className="text-muted text-xs leading-relaxed">
            Download the Lichess dump and build it once:
          </p>
          <code className="bg-surface-inset border-line text-subtle mt-3 block overflow-x-auto rounded-md border p-3 text-left font-mono text-[0.6875rem] leading-relaxed">
            curl -L -o data/lichess_db_puzzle.csv.zst \<br />
            &nbsp;&nbsp;https://database.lichess.org/lichess_db_puzzle.csv.zst
            <br />
            npm run build:puzzles
          </code>
        </div>
      </div>
    );
  }

  if (analysing && puzzle) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:[scrollbar-gutter:stable_both-edges] wide:flex-row wide:gap-4 wide:p-4">
        <AnalysisBoard />
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="icon-sm" title="Back to the puzzle" onClick={backToPuzzle}>
              <ChevronLeft className="size-3.5" />
            </Button>
            <span className="text-fg min-w-0 flex-1 truncate text-sm font-semibold">
              Analysing #{puzzle.id}
            </span>
            <Button variant="primary" size="sm" onClick={nextFromAnalysis}>
              <RotateCw className="size-3.5" />
              Next puzzle
            </Button>
          </div>
          <Panel flush className="min-h-min flex-1">
            <EngineBlock />
            <PanelHeader title="Moves" actions={<MoveActions allowReset={false} />} />
            <MoveTreePane />
            <BoardControls className="border-line border-t max-md:hidden" keyboard={false} />
            <StatusBar />
          </Panel>
        </div>
        {/* Phones: move nav in the bottom bar while analysing. */}
        <MobileActionBar>
          <BoardControls keyboard={false} className="py-1.5" />
        </MobileActionBar>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto stacked:[scrollbar-gutter:stable_both-edges] wide:flex-row wide:gap-4 wide:p-4">
      {/* Stacked layouts lead with the header, convention-style; on wide
          the band lives in the side column so it aligns with the board. */}
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          title="Back to the dashboard"
          onClick={() => navigate('puzzles', 'dashboard')}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <Puzzle className="text-subtle size-4" aria-hidden />
        <h1 className="text-fg text-sm font-semibold">
          {mode === 'single'
            ? `Replay #${puzzleId}`
            : mode === 'failed'
              ? 'Review'
              : 'Puzzles'}
        </h1>
      </div>
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
          <StatusStrip phase={phase} failed={failed} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 wide:w-[min(27rem,38%)] wide:flex-none">
        {/* The column header band: h-9 + the column's gap-3 equals the
            board's h-10 strip + its gap-2, so the first panel's top edge
            aligns with the board's (lanph3re's call, matching studies/games). */}
        <div className="hidden h-9 shrink-0 items-center gap-2 wide:flex">
          <Puzzle className="text-subtle size-4" aria-hidden />
          <h1 className="text-fg text-sm font-semibold">
            {mode === 'single'
              ? `Replay #${puzzleId}`
              : mode === 'failed'
                ? 'Review'
                : 'Puzzles'}
          </h1>
        </div>
        {/* Fresh training folds this panel into two icons on the Puzzle
            panel header (lanph3re: same treatment on desktop as mobile); it only
            renders for the modes that need their explanatory text. */}
        {mode !== 'fresh' && (
        <Panel flush className="shrink-0">
          <PanelHeader
            title="Training"
            actions={
              <Button
                variant="ghost"
                size="icon-sm"
                title="Dashboard"
                onClick={() => navigate('puzzles', 'dashboard')}
              >
                <BarChart3 className="size-3.5" />
              </Button>
            }
          />
          {mode === 'single' ? (
            <p className="text-muted px-3 py-2.5 text-xs leading-relaxed">
              Replaying puzzle #{puzzleId} — not counted; a clean solve still retires it from the
              review list.
            </p>
          ) : mode === 'failed' ? (
            <p className="text-muted px-3 py-2.5 text-xs leading-relaxed">
              Reviewing puzzles you failed before — not counted, and a clean solve retires the
              puzzle from this list.
            </p>
          ) : null}
        </Panel>
        )}

        <Panel flush className="shrink-0">
          <PanelHeader
            title="Puzzle"
            actions={
              <>
                {puzzle && phase === 'done' && (
                  <span className="text-subtle font-mono text-[0.6875rem]">#{puzzle.id}</span>
                )}
                {/* Stand-ins for the folded Training panel. */}
                <span className="flex items-center gap-1">
                  {mode === 'fresh' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      active={showDifficulty}
                      title="Difficulty"
                      onClick={() => setShowDifficulty((v) => !v)}
                    >
                      <Settings2 className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="Dashboard"
                    onClick={() => navigate('puzzles', 'dashboard')}
                  >
                    <BarChart3 className="size-3.5" />
                  </Button>
                </span>
              </>
            }
          />
          {showDifficulty && mode === 'fresh' && (
            <div className="border-line border-b">
              <DifficultyRow active={difficulty} onPick={pickDifficulty} />
              {/* Theme picker folded in beside difficulty — both answer
                  "which puzzles", so they share the one reveal. Styled as a
                  chip button to match the difficulty row above it. */}
              <div className="px-2.5 pb-2.5">
                <button
                  type="button"
                  onClick={() => navigate('puzzles', 'themes')}
                  className={cn(
                    'bg-surface-2 hover:bg-surface-3 group flex w-full items-center gap-2 rounded-md',
                    'border-line border px-2.5 py-2 text-left transition-colors duration-100',
                  )}
                >
                  <LayoutGrid className="text-subtle group-hover:text-primary size-3.5 shrink-0 transition-colors" />
                  <span className="text-subtle shrink-0 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                    Theme
                  </span>
                  <span className="text-fg ml-auto truncate text-xs font-medium">
                    {theme ? themeLabel(theme) : 'All themes'}
                  </span>
                  <ChevronRight className="text-subtle size-3.5 shrink-0" />
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-3 p-3">
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
                        {themeLabel(t)}
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
              <div className="flex flex-col gap-0.5">
                {puzzle && phase !== 'loading' && (
                  <p className="text-fg text-xl font-bold tracking-tight">
                    {solverSide === 'white' ? 'White' : 'Black'} to play
                  </p>
                )}
                <p className="text-muted text-xs leading-relaxed">
                  {phase === 'loading'
                    ? 'Finding a puzzle…'
                    : failed
                      ? 'Keep looking — find the best move.'
                      : 'Find the best move. The rating and themes stay hidden until you finish.'}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {phase === 'done' ? (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      mode === 'single' ? navigate('puzzles', 'dashboard') : void loadNext(theme, difficulty)
                    }
                  >
                    <RotateCw className="size-3.5" />
                    {mode === 'single' ? 'Back to dashboard' : 'Next puzzle'}
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
                    title="First press marks the piece, second the move (not counted as a fail)"
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
                  {mode !== 'single' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadNext(theme, difficulty)}
                    >
                      Skip
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Panel>


        {answerTree ? (
          <AnswerPanel
            tree={answerTree}
            cursorId={answerIds[(review ?? plies) - 1] ?? answerTree.rootId}
            onSelect={(id) => goToPly(id === answerTree.rootId ? 0 : answerIds.indexOf(id) + 1)}
          />
        ) : (
          <Panel flush className="shrink-0">
            <PanelHeader title="Moves" />
            <p className="text-subtle px-3 py-2.5 text-xs">Finding a puzzle…</p>
          </Panel>
        )}

      </div>

      {/* Phones: the bottom bar steps through the moves played so far, like
          every other board page. The puzzle's own actions (hint, solution,
          skip, next) live in the panel above — no duplicates here. */}
      <MobileActionBar>
        <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
          <Button variant="ghost" size="icon" disabled={plies === 0} onClick={() => goToPly(1)} title="First move">
            <ChevronFirst className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={plies === 0} onClick={() => goToPly((review ?? plies) - 1)} title="Back">
            <ChevronLeft className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly((review ?? plies) + 1)} title="Forward">
            <ChevronRight className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly(plies)} title="Latest">
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

/** Fixed-height strip under the board: whose move, and how it's going. */
/** The four difficulty chips — shared by the Training panel (wide) and
    the Puzzle panel's gear reveal (stacked). */
function DifficultyRow({
  active,
  onPick,
}: {
  active: DifficultyId;
  onPick: (id: DifficultyId) => void;
}) {
  return (
    <div className="flex gap-1 p-2.5">
      {DIFFICULTIES.map((d) => (
        <Button
          key={d.id}
          size="sm"
          variant={active === d.id ? 'primary' : 'secondary'}
          className="min-w-0 flex-1 px-0"
          title={'hint' in d ? `Difficulty ${d.hint}` : 'Any difficulty'}
          onClick={() => onPick(d.id)}
        >
          {d.label}
        </Button>
      ))}
    </div>
  );
}

function StatusStrip({
  phase,
  failed,
}: {
  phase: Phase;
  failed: boolean;
}) {
  // The side to move now lives big in the Puzzle panel, so the strip only
  // carries transient status; during plain solving it stays empty.
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
            : '';
  // Empty during plain solving — render nothing so the board sits flush
  // against the panel (the side-to-move is in the panel now).
  if (!text) return null;
  return (
    <div className="flex h-6 w-full items-center gap-2 px-0.5 text-xs">
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
