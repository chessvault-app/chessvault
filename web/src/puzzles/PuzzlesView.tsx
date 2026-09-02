import {
  BarChart3,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Eye,
  FlipVertical2,
  Info,
  LayoutGrid,
  Lightbulb,
  ExternalLink,
  ListOrdered,
  RotateCcw,
  RotateCw,
  Settings2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from 'chessops/types';
import { roleToChar } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { AnalysisBoard, BoardControls, ColumnControls } from '@/board/AnalysisBoard';
import { Board, boardAnimMs } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';
import { PaneTabs } from '@/components/pane-tabs';
import { usePaneSwipe } from '@/hooks/use-pane-swipe';
import { mainlineFrom } from '@shared/tree';
import { EngineBlock } from '@/engine/EnginePane';
import { EvalBarSlot } from '@/engine/EvalBar';
import { AnalysisMovesPanel } from '@/analysis/AnalysisMovesPanel';
import { api, apiErrorMessage } from '@/lib/api';
import { SquareBadge } from '@/board/square-overlay';
import { outcomeTone } from './outcome';
import { cn } from '@/lib/utils';
import { BOARD_HELD_SHELL, BOARD_WIDE_COLUMN, BOARD_WIDE_SIDE } from '@/components/layout';
import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useWideLayout } from '@/lib/media';
import { announce } from '@/lib/announce';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { Panel, PanelHeader } from '@/components/panel';
import { Skeleton } from '@/components/skeletons';
import { BooksView } from './BooksView';
import { DashboardPage } from './DashboardPage';
import { HubPage } from './HubPage';
import { PuzzleDbSetup, PuzzleDbSetupPlaceholder } from './PuzzleDbSetup';

/** See dbWasReady below: '1', '0' or absent, absent as "no database". */
const DB_READY_KEY = 'vault:puzzle-db-ready';
import { ThemesPage, themeLabel } from './ThemesPage';
import { AnswerPanel } from './AnswerPanel';
import {
  DIFFICULTIES,
  bandOf,
  difficultyQuery,
  setDifficulty as rememberDifficulty,
  storedDifficulty,
  type DifficultyId,
} from './bands';
import { consumePendingPuzzle } from './handoff';
import { fetchSolvedToday } from './today';
import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';
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
 * What is actually being withheld while you solve.
 *
 * The panel used to say the difficulty and themes both stay hidden until
 * the end, which is true only when the trainer chose them. You can pick
 * either yourself — and being told that the thing you just selected is a
 * secret reads as the app having lost track of what you asked for. So
 * the sentence names only what you do not already know, and says nothing
 * at all when you know both.
 */
function hiddenNote(pickedDifficulty: boolean, pickedTheme: boolean): string {
  if (pickedDifficulty && pickedTheme) return 'Find the best move.';
  if (pickedDifficulty) return 'Find the best move. The themes stay hidden until you finish.';
  if (pickedTheme) return 'Find the best move. The difficulty stays hidden until you finish.';
  return 'Find the best move. The difficulty and themes stay hidden until you finish.';
}

/** What the solver is doing right now. */
type Phase =
  | 'loading'
  | 'setup' // opponent's first move is about to play
  | 'solving'
  | 'opponent' // correct — opponent reply pending
  | 'wrong' // off-script move shown briefly before rollback
  | 'done';

/**
 * Routes: #/puzzles trains across all themes, #/puzzles/hub is the
 * phone's launcher (and the dashboard above phone width), #/puzzles/themes
 * is the category page, #/puzzles/theme/<t> trains one theme,
 * #/puzzles/failed reviews previously failed puzzles (uncounted). The
 * trainer is keyed so switching category boots a clean state machine.
 */
export function PuzzlesView({ params = [] }: { params?: string[] }) {
  if (params[0] === 'hub') return <HubPage />;
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
  // Not a clean solve: a wrong move, or the solution shown. Both count
  // the same for reporting, and read very differently to the solver.
  const [failed, setFailed] = useState(false);
  // The solution was SHOWN. Kept apart from `failed` because the finished
  // message used to be "solved with help" for both, so finding the move
  // yourself on the second try was reported back as having been given the
  // answer — and the Hint button, which says it is not counted, never set
  // either of these.
  const [revealed, setRevealed] = useState(false);
  const [hint, setHint] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [difficulty, setDifficulty] = useState<DifficultyId>(storedDifficulty);
  // Stacked: the difficulty row hides behind the Puzzle panel's gear.
  const [showDifficulty, setShowDifficulty] = useState(false);
  // The shared gate (board/usePromotion): the apply callback closes over
  // applyUserMove from the same render the picker's choice arrives in.
  const promotion = usePromotion((orig, dest, role) => applyUserMove(orig + dest + roleToChar(role)));
  // Reviewing an earlier ply of the line (null = live), via the panel's
  // toolbar; any machine progress snaps back to live.
  const [review, setReview] = useState<number | null>(null);
  // Manual board flip (the bottom bar's flip button); resets per puzzle so
  // each starts oriented to the side you play.
  const [flipped, setFlipped] = useState(false);

  // One attempt per puzzle: recorded at the first mistake or the clean solve.
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Which loadNext call owns the state — see the note inside loadNext.
  const loadSeq = useRef(0);
  const after = (ms: number, fn: () => void): void => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Today's clean solves, counted from the same history the dashboard
  // reads — fetched once, then kept current locally as wins land. This
  // is the trainer's visible session context: without it nothing on the
  // solving screen said how training was going.
  const [solvedToday, setSolvedToday] = useState<number | null>(null);
  const refreshToday = useCallback(async () => {
    const n = await fetchSolvedToday();
    // null is "the server did not answer", not "nought solved" — the line
    // simply stays as it was, which before the first answer is absent.
    if (n !== null) setSolvedToday(n);
  }, []);

  /**
   * Whether meta has answered at all, which is not the same as what it
   * said.
   *
   * The setup gate below reads `meta && !meta.ready`, so a meta that has
   * not arrived — or that failed and left this null — falls through to the
   * TRAINER. The trainer then asks for a puzzle, is told there is no
   * database, and offers "No puzzle database yet — build it from the
   * Puzzles page" beside a Try again button: the setup screen's own
   * message, in the one place that cannot act on it, on a page that was
   * one answer away from showing the real thing.
   */
  const [metaAnswered, setMetaAnswered] = useState(false);
  /**
   * Whether this device last saw the vault WITH a puzzle database — which
   * of the two entirely different pages the wait for meta stands before.
   * The trainer used to be drawn for everyone, and a vault without the
   * database (the dump is a 300 MB opt-in; nothing seeds it) watched the
   * board, the panels and the action bar be replaced wholesale by the
   * centred setup card on every visit until the build was run. The same
   * bargain as the home reservations: a paint hint, never the authority,
   * corrected by the answer one beat later. A device that has never met
   * the vault reads absent as "no database", for the checklist floor's
   * reason — that is certain for a fresh vault, and the ready bit flips
   * once and never back.
   */
  const [dbWasReady] = useState(() => localStorage.getItem(DB_READY_KEY) === '1');
  const refreshMeta = useCallback(async () => {
    // Meta is decoration around the trainer (counts, the setup gate); if
    // the server is away, loadNext will say so where it can be acted on.
    try {
      const next = await api<Meta>('/api/puzzles/meta');
      setMeta(next);
      localStorage.setItem(DB_READY_KEY, next.ready ? '1' : '0');
    } catch {
      /* the puzzle fetch reports the outage, with a retry */
    } finally {
      setMetaAnswered(true);
    }
  }, []);

  const report = useCallback(
    async (id: string, win: boolean) => {
      if (reported.current) return;
      reported.current = true;
      const send = (): Promise<{ user: UserState } | null> =>
        api<{ user: UserState }>('/api/puzzles/attempt', {
          method: 'POST',
          json: { id, win, counted: mode === 'fresh' },
        }).catch(() => null);
      // One quiet retry a moment later: a blip at exactly the "Solved!"
      // moment used to lose the attempt for good — streak and history
      // under-counted with nothing said (and a thrown fetch escaped as an
      // unhandled rejection besides).
      let data = await send();
      if (!data) {
        await new Promise((r) => setTimeout(r, 2000));
        data = await send();
      }
      if (data) {
        const { user } = data;
        setMeta((m) => (m ? { ...m, user } : m));
        if (win && mode === 'fresh') setSolvedToday((n) => (n === null ? n : n + 1));
      }
    },
    [mode],
  );

  /**
   * Put a puzzle on the board and start its clock.
   *
   * Split out of loadNext because a puzzle now arrives two ways — fetched,
   * or handed over by the hub — and both must set up identically. `seq`
   * is the caller's sequence number: a load that has been superseded
   * while it was away must not write to state (see loadNext).
   */
  const show = useCallback((next: ApiPuzzle, seq: number) => {
    if (seq !== loadSeq.current) return;
    setPuzzle(next);
    setPlies(0);
    setReview(null);
    setFlipped(false);
    setView(positionAt(next, 0));
    setPhase('setup');
    // Let the position register, then play the opponent's setup move.
    after(700, () => {
      if (seq !== loadSeq.current) return;
      setPlies(1);
      setView(positionAt(next, 1));
      setPhase('solving');
    });
    // `after` is a stable closure over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadNext = useCallback(
    async (selectedTheme: string, selectedDifficulty: DifficultyId) => {
      // Clearing the timers does not clear a fetch already in flight: two
      // quick Skips used to leave load A's continuation running after load
      // B took over, so A's puzzle landed in state — or A's 700 ms setup
      // timer positioned the board on A while `puzzle` was B, and a
      // correct move was then graded (and reported) against the wrong
      // puzzle. Whoever holds the latest sequence number owns the state.
      const seq = ++loadSeq.current;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPhase('loading');
      setPuzzle(null);
      setFailed(false);
      setRevealed(false);
      setHint(0);
      setError(null);
      promotion.cancel();
      reported.current = false;

      // The hub may have drawn this puzzle already and be showing it on a
      // board. Take that one rather than drawing again, or the position
      // somebody just pressed would be replaced by a different one.
      // consume() clears, so this only ever applies to the first load —
      // Skip and Next go to the server like always.
      if (mode !== 'single') {
        const handed = consumePendingPuzzle(mode);
        if (handed) {
          show(handed, seq);
          return;
        }
      }

      const url =
        mode === 'single'
          ? `/api/puzzles/by-id/${encodeURIComponent(puzzleId ?? '')}`
          : mode === 'failed'
            ? '/api/puzzles/next?mode=failed'
            : `/api/puzzles/next${difficultyQuery(selectedDifficulty, selectedTheme)}`;
      // A request that FAILS — server down, network gone, an error
      // status — used to fall straight through this function, leaving
      // the phase on 'loading' and the board on a spinner that nothing
      // would ever stop. An error is a state the trainer must be able to
      // be in. api() folds the network and status cases into one throw,
      // carrying the same wording each branch used to build by hand —
      // and only the sequence holder may write it.
      let next: ApiPuzzle;
      try {
        ({ puzzle: next } = await api<{ puzzle: ApiPuzzle }>(url));
      } catch (e) {
        if (seq !== loadSeq.current) return;
        setError(apiErrorMessage(e));
        return;
      }
      if (seq !== loadSeq.current) return;
      show(next, seq);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, puzzleId],
  );

  // One boot per real mount: StrictMode replays effects, and without the
  // guard the page fetched (and briefly showed) two different puzzles.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void refreshMeta();
    if (mode === 'fresh') void refreshToday();
    void loadNext(theme, difficulty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickDifficulty = (id: DifficultyId): void => {
    setDifficulty(id);
    rememberDifficulty(id);
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

  // The verdicts are drawn over the board and printed in the panel; a
  // screen reader saw neither. Announced at the two moments that matter.
  useEffect(() => {
    if (phase === 'wrong') announce(t('Wrong move. The board rolls back.'));
    else if (phase === 'done') {
      announce(revealed ? t('Solution shown') : failed ? t('Solved after a wrong try') : t('Solved'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

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
    playSound(pieces < prev ? 'capture' : 'move');
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
    if (promotion.maybeStart(view.fen, view.turn, orig, dest)) return;
    applyUserMove(orig + dest);
  };

  const viewSolution = (): void => {
    if (!puzzle || phase === 'done') return;
    setFailed(true);
    setRevealed(true);
    void report(puzzle.id, false);
    const moves = puzzle.moves.split(' ');
    let at = plies;
    setPhase('opponent');
    const step = (): void => {
      at++;
      setPlies(at);
      setView(positionAt(puzzle, at));
      if (at < moves.length) after(650, step);
      // One animation's grace before `done`, which is what swaps this board
      // for the analysis one — and a swap mounts a fresh chessground at the
      // final position, so the last move of the line arrived without ever
      // being played. Every move but the last one animated (lanph3re).
      else after(boardAnimMs(), () => setPhase('done'));
    };
    step();
  };

  /**
   * The same puzzle again, from the top.
   *
   * Practice, not a second attempt: `reported.current` is left alone, so
   * nothing is sent. The attempt that counts was decided the first time
   * through — a win reported after the solution has been seen would put a
   * clean solve in the history for a puzzle that was given away, and add
   * to a streak the same way.
   *
   * `show` takes a fresh sequence number and the timers are cleared, for
   * the same reason loadNext does it: a retry pressed while the scripted
   * reply is still stepping must own the board from here on.
   */
  const retry = (): void => {
    if (!puzzle) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setFailed(false);
    setRevealed(false);
    setHint(0);
    setError(null);
    promotion.cancel();
    show(puzzle, ++loadSeq.current);
  };

  // In-place analysis (lanph3re's call: no jump to the Analysis tab): the final
  // position loads into the shared analysis store and the trainer swaps to
  // the real analysis board + merged engine/moves panel. Entering is an
  // explicit "analyse" act, so the engine comes on; leaving turns it off.
  const [analysing, setAnalysing] = useState(false);
  /** Which pane the phone is showing. A desktop shows all three at once. */
  const [pane, setPane] = useState<'info' | 'moves' | 'engine'>('info');
  /**
   * And which one it can actually show. The engine pane exists only once
   * the answer is in, so a phone left on it when the next one starts falls
   * back rather than facing an empty column — the effect above resets the
   * choice, and this is what makes the render between the two harmless.
   */
  const shownPane = !analysing && pane === 'engine' ? 'info' : pane;
  const analysingRef = useRef(false);
  analysingRef.current = analysing;
  useEffect(
    () => () => {
      if (analysingRef.current) useEngine.getState().setEnabled(false);
    },
    [],
  );

  const wide = useWideLayout();

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

  /**
   * A finished puzzle on a desktop analyses itself. There is room for the
   * engine beside the board there, so waiting to be asked only costs a
   * click — and the panel it would appear in is already on screen.
   */
  useEffect(() => {
    if (phase === 'done' && puzzle && !analysing) {
      analyse();
      // A phone STAYS on the puzzle's own pane. It used to be moved to the
      // engine — the answer being what you came back for — but that panel
      // is also where the verdict, the difficulty and the themes are, and
      // swapping it out at the exact moment the puzzle resolves answers a
      // question with a different one (lanph3re). The engine tab is one
      // tap away, and now it is a choice.
    }
    // A new puzzle un-does all of it, engine included: an evaluation on
    // screen while the next one is being solved IS the next one's answer.
    if (phase !== 'done' && analysing) {
      setAnalysing(false);
      setPane('info');
      useEngine.getState().setEnabled(false);
    }
    // analyse() closes over the current puzzle; the guards above are what
    // keep this from re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, puzzle, analysing]);



  const solverSide: Color = puzzle ? solverColor(puzzle) : 'white';
  const title =
    mode === 'single'
      ? t('Replay #{id}', { id: puzzleId ?? '' })
      : mode === 'failed'
        ? t('Review')
        : t('Puzzles');
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

  // One list, read by the strip and by the swipe that turns it: the two
  // are the same row, and an array written twice is an order that drifts.
  // Above the early return below — a hook must run in the same order on
  // every render, the database-setup screen included.
  const panes = [
    { id: 'info' as const, label: t('Puzzle'), icon: Info },
    { id: 'moves' as const, label: t('Moves'), icon: ListOrdered },
    // The engine is what a puzzle is FOR — offered when the answer
    // is in, not while it is being looked for.
    ...(analysing ? [{ id: 'engine' as const, label: 'Engine', icon: Cpu }] : []),
  ];
  // Swipe the column sideways to turn to the next pane — the strip's own
  // page turn, made where the thumb already is. Only where the panes ARE
  // a row: a wide layout stands them all in the column at once.
  const paneSwipe = usePaneSwipe({
    panes,
    value: shownPane,
    onChange: setPane,
    enabled: !wide,
  });

  // The setup card's place while meta is in the air, where the stored
  // hint says that is the page coming — see dbWasReady. `metaAnswered`
  // keeps a FAILED meta on the trainer path, whose retry can act.
  if (meta === null && !metaAnswered && !dbWasReady) return <PuzzleDbSetupPlaceholder />;

  if (meta && !meta.ready) {
    return (
      <PuzzleDbSetup
        onReady={() => {
          // Both, and the second one is the point. Arriving here means the
          // boot already tried to load a puzzle and failed — there was no
          // database to load one from — so the error state is set and no puzzle is
          // in hand. Refreshing the meta alone flipped ready to true and
          // handed the trainer straight back that stale failure, under a
          // Try again button that worked: the build had succeeded and the
          // page was reporting the last thing that went wrong before it.
          void refreshMeta();
          void loadNext(theme, difficulty);
        }}
      />
    );
  }


  /**
   * The panels this page is made of, named rather than written inline.
   * A desktop stacks all three down the column; a phone shows one at a
   * time behind a switcher. Writing them twice is how the two layouts
   * would drift apart, which is the whole reason they are values here.
   */
  const dockEngine = wide && analysing;
  const movesPanel = analysing ? (
    // min-h-32 overrides the panel's own `min-h-min`, which is what cut the
    // Puzzle panel off below a short window: min-content there is the
    // engine's three lines plus the move list plus the board controls —
    // some 360px that would not give any of it back — so everything the
    // column was short by came out of the panel underneath, and on a
    // 1042x630 window 258px of it hung past the column's edge behind a
    // hidden scrollbar. A move list is the one thing here built to
    // scroll: it shrinks to 8rem and scrolls, and the puzzle's own panel
    // keeps the height its text needs.
    <AnalysisMovesPanel engine={dockEngine} className="min-h-32 flex-auto" />
  ) : answerTree ? (
    <AnswerPanel
      // The panel that takes the column's spare height, so the puzzle panel
      // under it sits on the board's bottom edge rather than floating above
      // it — the same job EngineBlock's panel does once the puzzle is over.
      // `min-h-32` is the floor the analysing branch above already keeps,
      // and for the same reason: with none, a short `wide` window (a phone
      // in landscape) squeezed this panel below its own header and toolbar
      // with nothing to scroll.
      className="min-h-32 flex-1 shrink"
      tree={answerTree}
      cursorId={answerIds[(review ?? plies) - 1] ?? answerTree.rootId}
      onSelect={(id) => goToPly(id === answerTree.rootId ? 0 : answerIds.indexOf(id) + 1)}
      onFlip={() => setFlipped((f) => !f)}
    />
  ) : (
    <Panel className="shrink-0">
      <PanelHeader title={t('Moves')} />
      <p className="text-muted-foreground px-3 py-2.5 text-sm">{t('Finding a puzzle…')}</p>
    </Panel>
  );
  /**
   * What THIS session is, where it is not the ordinary one.
   *
   * It had a panel of its own — Training, above the puzzle's — which spent
   * a header, a border and a dashboard button on one sentence, and put it
   * a panel away from the line it qualifies (lanph3re). It is the same
   * kind of sentence as "Find the best move…": what you are looking at and
   * what to do about it. So it stands in that line's place, and in review
   * or a replay it is the more useful of the two — a hidden difficulty is
   * a detail, being told the attempt is not counted is not.
   */
  const modeNote =
    mode === 'failed'
      ? t('Reviewing, not counted. Each clean solve spaces the puzzle further out, and enough in a row retire it.')
      : mode === 'single'
        ? t('Replaying puzzle #{id}, not counted. A clean solve still retires it from the review list.', {
            id: puzzleId ?? '',
          })
        : null;
  const puzzlePanel = (
  // No `grow`, on either layout: the panel is the height of what it says.
  // A phone had it stretched to the bottom bar (f1e1757) so the column
  // would not end in a band of page background — but a panel that is one
  // line of status and a button, drawn a screen tall, is a worse thing to
  // look at than the band was, and lanph3re has called it. Blank surface
  // under the text belongs to the page, not inside a border.
  //
  // It still SHRINKS, which is the half of that change worth keeping: a
  // solved puzzle's text (verdict, difficulty, plays, a wrapped row of
  // themes, the game link) is taller than the band a 375x812 phone has
  // left under the board, and a panel that could not shrink ran past the
  // column's edge with its actions cut in half. So it grows with its
  // content up to the column's floor — the bottom bar — and there it
  // stops and its BODY scrolls instead.
  <Panel>
    <PanelHeader
      title={t('Puzzle')}
      actions={
        <>
          {puzzle && phase === 'done' && (
            <span className="text-muted-foreground font-mono text-xs">#{puzzle.id}</span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Dashboard')}
            onClick={() => navigate('puzzles', 'dashboard')}
          >
            <BarChart3 className="size-3.5" />
          </Button>
        </>
      }
    />
    {/* A window, not a drawer above the board's own panel: opened in
        place it pushed the puzzle down the screen, which is the one
        thing a trainer must not do to the position being solved. On
        a phone it is a bottom sheet. */}
    {showDifficulty && mode === 'fresh' && (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setShowDifficulty(false);
        }}
      >
        <DialogContent title="Puzzle settings" icon={Settings2}>
          <DifficultyRow active={difficulty} onPick={pickDifficulty} />
          {/* Theme picker folded in beside difficulty — both answer
              "which puzzles", so they share the one window. */}
          {/* The registry's Button, and the same one DifficultyChip is —
              which is the row this pairs with, and whose comment already
              said the two matched. They did not: this was a hand-rolled
              `<button>` sized by padding and a line box, 42px on every
              pointer, standing beside a DifficultyRow of size="sm"
              Buttons that are 28px under a mouse and 36 under a thumb. A
              settings row that states a value and opens the thing that
              changes it is a Button in this app; there is no reason for
              this one to have been the exception. */}
          <Button
            variant="secondary"
            size="sm"
            className="w-full min-w-0 justify-start"
            onClick={() => navigate('puzzles', 'themes')}
          >
            <LayoutGrid className="size-3.5" data-icon="inline-start" />
            <span className="text-muted-foreground shrink-0">{t('Theme')}</span>
            <span className="ml-auto truncate">{theme ? themeLabel(theme) : t('All themes')}</span>
            <ChevronRight className="text-muted-foreground size-3.5" data-icon="inline-end" />
          </Button>
        </DialogContent>
      </Dialog>
    )}
    {/* `grow` so the body owns the panel's full height rather than
        stopping at its text, and `overflow-y-auto` so that the height is
        a ceiling and not a promise: a puzzle with eight themes is taller
        than the band a phone has under the board, and without this the
        panel ran past the column with Panel's overflow-hidden cutting
        whatever hung off the end. `min-h-0` because a flex item will not
        shrink below its content without it, which is exactly the overflow
        being fixed. */}
    <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-(--card-spacing)">
      {phase === 'done' && puzzle ? (
        <>
          <p
            className={cn(
              'text-base font-semibold',
              // Green for a clean solve, amber for one that took a
              // second go — it was still found — and red only where
              // the answer was handed over. Shared with the book
              // trainer, which had the middle case painted as failure.
              outcomeTone(revealed ? 'missed' : failed ? 'helped' : 'solved'),
            )}
          >
            {revealed
              ? t('Solution shown')
              : failed
                ? t('Solved after a wrong try')
                : t('Solved')}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {/* The band, not the number: a rating is how the trainer
                picks puzzles, not a verdict to hand back to whoever
                just solved one. The dashboard has always shown it
                this way; this panel had not. */}
            <dt className="text-muted-foreground">{t('Difficulty')}</dt>
            <dd className="text-foreground">{t(bandOf(puzzle.rating))}</dd>
            <dt className="text-muted-foreground">{t('Played')}</dt>
            <dd className="text-foreground font-mono">{puzzle.plays.toLocaleString()}</dd>
            <dt className="text-muted-foreground">{t('Themes')}</dt>
            <dd className="flex flex-wrap gap-1">
              {puzzle.themes.split(' ').map((t) => (
                <span
                  key={t}
                  className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-xs"
                >
                  {themeLabel(t)}
                </span>
              ))}
            </dd>
          </dl>
        </>
      ) : (
        <div className="flex flex-col gap-0.5">
          {puzzle && phase !== 'loading' && (
            <p className="text-foreground text-2xl font-bold tracking-tight">
              {solverSide === 'white' ? t('White to play') : t('Black to play')}
            </p>
          )}
          <p className={cn('text-sm leading-relaxed', phase === 'wrong' ? 'text-destructive' : 'text-muted-foreground')}>
            {phase === 'wrong'
              ? t('Wrong move. The board rolls back.')
              : phase === 'setup' || phase === 'opponent'
              ? t('Opponent is moving…')
              : phase === 'loading'
              ? t('Finding a puzzle…')
              : failed
                ? t('Find the best move.')
                : (modeNote ??
                  t(hiddenNote(difficulty !== 'any' && difficulty !== 'adaptive', Boolean(theme))))}
          </p>
        </div>
      )}

      {/* The actions and the settings row are IN the body, and scroll with
          it (lanph3re): pinned to the panel's floor they held their place
          while the text moved behind them, which reads as two panels in
          one — and on a short window the pinning is what squeezed the text
          to a couple of lines to keep a row nobody was reaching for on
          screen. They follow what they answer to instead. */}
      {/* What is being trained — difficulty and theme — as the
          panel's own last row, and the way into the window that
          changes it. It sat on the header for a while, where a
          labelled control among icon buttons read as chrome
          (lanph3re's call: into the body). */}
      {mode === 'fresh' && (
        <DifficultyChip
          difficulty={difficulty}
          theme={theme}
          onOpen={() => setShowDifficulty(true)}
        />
      )}

      {/* shadcn's CardFooter, the panel's own floor — the slot a card keeps
          for its actions, and what the other trainer and the repertoire
          stand theirs on too. It is still the LAST child of the scrolling
          body, not pinned outside it: mt-auto rests it on the floor while
          the text is short and lets it scroll with the text when it is not,
          which is the whole reason the row was put in the body (above).
          The negative margins take back the body's p-3 so the band spans
          the panel edge to edge.

          justify-end, gap-2, the primary one LAST — the row every window
          in this app ends on (components/prompt-dialog, and the repertoire's New
          game). A finished puzzle's row is read along a line and finishes
          on the action, which is why the link out to the game it came
          from leads and Next closes.

          Both phases, not just the finished one (lanph3re's call): this is
          one row that changes what it holds, and alignment that moved with
          the phase made it read as two different rows swapping places on
          the panel's floor. Hint, Solution and Skip end on Skip, which is
          the one that leaves this puzzle. */}
      <CardFooter className="-mx-(--card-spacing) mt-auto flex-wrap justify-end gap-2">
        {phase === 'done' ? (
          <>
            {/* An anchor, not a button that navigates: it goes out of the
                app, to lichess, and middle click and the context menu are
                how a link is used. */}
            {puzzle?.game_url && (
              <Button
                variant="ghost"
                size="sm"
                nativeButton={false}
                render={
                  <TitleTip title={t('Opens lichess (needs internet)')}>
                    <a
                      href={puzzle.game_url}
                      target="_blank"
                      rel="noreferrer"
                    />
                  </TitleTip>
                }
              >
                <ExternalLink className="size-3.5" />
                {t('From this game')}
              </Button>
            )}
            {/* Practice, not a second attempt — see retry(). */}
            <Button variant="secondary" size="sm" onClick={retry}>
              <RotateCcw className="size-3.5" data-icon="inline-start" />
              {t('Retry')}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() =>
                mode === 'single' ? navigate('puzzles', 'dashboard') : void loadNext(theme, difficulty)
              }
            >
              <RotateCw className="size-3.5" data-icon="inline-start" />
              {t(mode === 'single' ? 'Back to dashboard' : 'Next puzzle')}
            </Button>
          </>
        ) : (
          <>
            {/* Skip sits at the far end, away from Solution, and is first
                in the DOM so the reading order is the order on screen.
                The three used to be one right-aligned run: Hint, then
                Solution, then Skip, touching, with the two that END the
                puzzle side by side under the thumb — and neither asks
                first, because neither should have to. Solution is the
                consequential one (it records a failed attempt), Skip
                costs nothing but the puzzle, and having them adjacent
                meant one mis-tap could not be told from the other. `me-auto`
                is all the separation this needs; a confirm on either would
                be a question asked hundreds of times to catch a slip. */}
            {mode !== 'single' && (
              <Button
                variant="ghost"
                size="sm"
                className="me-auto"
                onClick={() => void loadNext(theme, difficulty)}
              >
                <X className="size-3.5" data-icon="inline-start" />
                {t('Skip')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={phase !== 'solving'}
              onClick={() => setHint((h) => Math.min(h + 1, 2))}
              title={t('First press marks the piece, second the move (not counted as a fail)')}
            >
              <Lightbulb className="size-3.5" data-icon="inline-start" />
              {t('Hint')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={phase !== 'solving'}
              onClick={viewSolution}
              title={t('Counts as a failed attempt')}
            >
              <Eye className="size-3.5" data-icon="inline-start" />
              {t('Solution')}
            </Button>
          </>
        )}
      </CardFooter>
    </div>
  </Panel>
  );

  return (
    // BOARD_HELD_SHELL, not BOARD_SCROLL_SHELL: the side column below owns
    // the scrolling, so this shell has always fitted the screen exactly
    // and its own scrollbar could never appear. What it kept were that
    // scrollbar's allowances — 32px of bottom padding so a scrolled last
    // panel could finish clear of the bottom bar, and a reserved gutter at
    // the right. Neither was doing anything but holding the panel 32px off
    // the navigation and the column 4px left of centre.
    <div className={BOARD_HELD_SHELL}>
      {/* Stacked layouts lead with the header, convention-style; on wide
          the band lives in the side column so it aligns with the board. */}
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          // Back to where a phone came FROM, which is the hub — this
          // chevron pointed at the dashboard for as long as the tab did.
          // The trainer claims the bottom bar, so it is the only way out.
          title={t('Back to puzzles')}
          onClick={() => navigate('puzzles', 'hub')}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-foreground text-base font-semibold">{title}
        </h1>
      </div>
      {/* Board column, matching the shared budget so the board sits where
          every other view puts it. Once the puzzle is over it becomes the
          analysis board itself, so the pieces move freely and the eval bar
          is the one every other board page draws. */}
      {analysing ? (
        <AnalysisBoard />
      ) : (
        <div className={BOARD_WIDE_COLUMN}>
          <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
            <div className="hidden w-full items-end wide:flex wide:h-10" />
          {/* The eval bar's width, held open before there is an eval bar.
              When the puzzle ends this board is replaced by AnalysisBoard,
              which draws one — and without the same reservation here the
              board narrowed by 20px and stepped right at the exact moment
              the answer appeared (lanph3re's two screenshots). */}
          <div className="flex w-full items-stretch gap-2">
            <EvalBarSlot />
            <div className="relative min-w-0 flex-1">
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
              ) : error && metaAnswered ? (
                // What happened, and a way to go again — a dead end here
                // used to need a full page reload to recover from.
                <div className="bg-card grid aspect-square w-full place-items-center rounded-xl ring-1 ring-border">
                  <div className="flex max-w-[80%] flex-col items-center gap-3 text-center">
                    <p className="text-muted-foreground text-sm">{error}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadNext(theme, difficulty)}
                    >
                      <RotateCw className="size-3.5" data-icon="inline-start" />
                      {t('Try again')}
                    </Button>
                  </div>
                </div>
              ) : (
                // The bare Skeleton and not SkeletonBoard: the page around
                // this is already drawn — its header, its panel, its bottom
                // band — and only the board itself is still missing. A whole
                // page's skeleton dropped into a board's slot would draw a
                // second header inside the first.
                // `board-box`, like the Board that replaces it: the box
                // rounds its width down to a whole number of squares and
                // centres in what is left, so a w-full square was 2px
                // wider and started a pixel further left than the board.
                <Skeleton className="board-box aspect-square rounded-xl" />
              )}
              {promotion.pending && (
                <PromotionPicker
                  color={promotion.pending.color}
                  dest={promotion.pending.dest}
                  orientation={orientation}
                  onSelect={promotion.complete}
                  onCancel={promotion.cancel}
                />
              )}
              {!reviewing && phase === 'wrong' && (
                <MoveBadge kind="bad" view={view} orientation={orientation} />
              )}
              {!reviewing && phase === 'done' && !failed && (
                <MoveBadge kind="good" view={view} orientation={orientation} />
              )}
            </div>
          </div>
          </div>
        </div>
      )}

      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 ${BOARD_WIDE_SIDE}`}
        {...paneSwipe.column}
      >
        {/* The column header band: h-9 + the column's gap-3 equals the
            board's h-10 strip + its gap-2, so the first panel's top edge
            aligns with the board's (lanph3re's call, matching studies/games). */}
        {/* pr-[13px] on the right only: the title outdents to the column
            edge like every other page's, but the session line is a VALUE,
            and read down the column it sat 13px right of every value in
            the panels below it — a panel's own text starts inside its
            border (1px) and its padding (p-3), so that is the line the
            eye follows. */}
        <div className="hidden h-9 shrink-0 items-center gap-2 pr-[13px] wide:flex">
            <h1 className="text-foreground text-base font-semibold">{title}
          </h1>
          <span className="min-w-0 flex-1" />
          {/* How much has been done, and nothing about how well.
              A "Run: n" of consecutive correct answers stood here too, and
              it was a score of the same family as the dashboard's old win
              rate — worse in one way, because a count that only survives
              while you do not fail is a reason to pick puzzles you will
              get right, and the useful session is the one you fail in. It
              was persisted rather than per-session besides, so a long run
              was something to protect rather than spend. The server still
              keeps the number; nothing shows it. */}
          {mode === 'fresh' && solvedToday !== null && (
            <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
              {t('Solved today: {n}', { n: solvedToday })}
            </span>
          )}
        </div>
        {/* Fresh training folds this panel into two icons on the Puzzle
            panel header (lanph3re: same treatment on desktop as mobile); it only
            renders for the modes that need their explanatory text. */}
        {/* One at a time on a phone, all three down the column on a
            desktop. The switcher is the phone's whole navigation here:
            analysing used to replace the page, and going back for the
            puzzle's own text meant leaving the analysis. */}
        {!wide && <PaneTabs value={shownPane} onChange={setPane} tabs={panes} />}
        {(wide || paneSwipe.shows('moves')) && movesPanel}
        {!wide && analysing && paneSwipe.shows('engine') && (
          <Panel className="min-h-0 flex-1">
            <EngineBlock standalone />
          </Panel>
        )}
        {(wide || paneSwipe.shows('info')) && puzzlePanel}
        {/* One strip at the column's floor while the panes are tabs, and
            only once the puzzle is over: until then the board is this
            component's own tree, not the analysis store these buttons
            drive (see AnswerPanel), and the answer panel carries its own
            navigation. */}
        {analysing && <ColumnControls className="wide:hidden" />}




      </div>

      {/* Phones: the bottom bar steps through the moves played so far, like
          every other board page. The puzzle's own actions (hint, solution,
          skip, next) live in the panel above — no duplicates here.

          Once the puzzle is over the board below is AnalysisBoard and the
          line lives in the analysis store, so the buttons that drive
          `review` drive nothing: all four sat there dead (Forward and
          Latest permanently disabled, since `review` never leaves null),
          and so did Flip. The analysis pages' own control strip is what
          moves that board, and AnalysisBoard itself owns the arrow
          keys. */}
      <MobileActionBar>
        {analysing ? (
          <BoardControls className="py-1.5" />
        ) : (
        <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
          <Button variant="ghost" size="icon" disabled={plies === 0} onClick={() => goToPly(1)} title={t('First move')}>
            <ChevronFirst className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={plies === 0} onClick={() => goToPly((review ?? plies) - 1)} title={t('Back')}>
            <ChevronLeft className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly((review ?? plies) + 1)} title={t('Forward')}>
            <ChevronRight className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly(plies)} title={t('Latest')}>
            <ChevronLast className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setFlipped((f) => !f)} title={t('Flip board')}>
            <FlipVertical2 className="size-[1.1rem]" />
          </Button>
        </div>
        )}
      </MobileActionBar>
    </div>
  );
}

/** Fixed-height strip under the board: whose move, and how it's going. */
/** The difficulty chips inside the Puzzle settings window. No padding of
    their own: the window's gap spaces them, and their edges align with
    the theme row below — the old p-2.5 inset them 10px on every side. */
function DifficultyRow({
  active,
  onPick,
}: {
  active: DifficultyId;
  onPick: (id: DifficultyId) => void;
}) {
  return (
    // Six options no longer fit one row; two rows of three.
    <div className="flex flex-wrap gap-1">
      {DIFFICULTIES.map((d) => (
        <Button
          key={d.id}
          size="sm"
          variant={active === d.id ? 'default' : 'secondary'}
          className="min-w-0 flex-1 basis-[30%] px-0"
          title={'hint' in d ? t('Difficulty {hint}', { hint: t(d.hint) }) : t('Any difficulty')}
          onClick={() => onPick(d.id)}
        >
          {t(d.label)}
        </Button>
      ))}
    </div>
  );
}

/**
 * The active difficulty (and theme), visible while solving.
 *
 * It only existed inside the gear window before — nothing on the solving
 * screen said what was being trained. The chip states it and opens the
 * window that changes it.
 */
function DifficultyChip({
  difficulty,
  theme,
  onOpen,
}: {
  difficulty: DifficultyId;
  theme: string;
  onOpen: () => void;
}) {
  const label = DIFFICULTIES.find((d) => d.id === difficulty)?.label ?? 'Any';
  return (
    <Button
      variant="secondary"
      size="sm"
      // A settings row, not a chip: it owns the panel's width, states the
      // current pick on the left and carries the "opens something" mark
      // on the right, like the theme row inside the window it opens.
      className="w-full min-w-0 justify-start"
      title={t('Puzzle settings')}
      onClick={onOpen}
    >
      <Settings2 className="size-3.5 shrink-0" />
      <span className="truncate">
        {difficulty === 'any' ? t('Any difficulty') : t(label)}
        {theme && ` · ${themeLabel(theme)}`}
      </span>
      <ChevronRight className="text-muted-foreground ml-auto size-3.5 shrink-0" />
    </Button>
  );
}

/**
 * The verdict on the move just played, pinned to its destination square.
 *
 * The app's own notation, not a quiz's: `!` for the move that solves it,
 * `??` for one that throws it away. It was ✓ and ✗ — marks a chess player
 * meets on a worksheet and nowhere on a board — while the analysis board
 * two files over was already drawing the same disc, in the same two
 * colours, with `!` and `??` on it. A reader who knows what a `??` on e4
 * means had to learn a second alphabet to be told the same thing by the
 * trainer.
 *
 * The glyph AND the fill are BOARD_NAGS' own pairs: `!` on --nag-good,
 * `??` on --nag-blunder. So the colours do not move — green still means
 * found it and red still means lost it, as the colour grammar requires —
 * and the marks now agree with the board they sit on.
 */
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
  return (
    <SquareBadge
      square={dest}
      orientation={orientation}
      className={kind === 'good' ? 'bg-nag-good' : 'bg-nag-blunder'}
    >
      {kind === 'good' ? '!' : '??'}
    </SquareBadge>
  );
}
