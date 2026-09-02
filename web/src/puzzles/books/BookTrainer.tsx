import { BarChart3, Check, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, Cpu, Eye, FlipVertical2, History, Info, LayoutGrid, ListOrdered, Pencil, RotateCcw, RotateCw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BOARD_HELD_SHELL, BOARD_WIDE_COLUMN, BOARD_WIDE_SIDE } from '@/components/layout';
import { AnalysisBoard, BoardControls, ColumnControls } from '@/board/AnalysisBoard';
import { AnalysisMovesPanel } from '@/analysis/AnalysisMovesPanel';
import { EngineBlock } from '@/engine/EnginePane';
import { PaneTabs } from '@/components/pane-tabs';
import { usePaneSwipe } from '@/hooks/use-pane-swipe';
import { useEngine } from '@/store/engine';

import { parseFen } from 'chessops/fen';

import { roleToChar } from 'chessops/util';
import type { Color } from 'chessops/types';
import {
  addUci,
  createTree,
  getNode,
  legalDests,
  mainlineFrom,
  moveSquares,
  positionAt,
  promoteToMainline,
  updateNode,
} from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { Board, boardAnimMs } from '@/board/Board';
import { EvalBarSlot } from '@/engine/EvalBar';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { announce } from '@/lib/announce';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { MobileActionBar } from '@/components/mobile-action-bar';

import { Panel, PanelHeader } from '@/components/panel';
import { SkeletonBoard, useSlowLoad } from '@/components/skeletons';

import { judgeBookMove, type BookSolution } from '../bookJudge';

import { movePasses, releaseAdjudicator } from '@/engine/adjudicate';
import { AnswerPanel } from '../AnswerPanel';

import { t } from '@/lib/i18n';
import { TitleTip } from '@/components/title-tip';
import {
  type BookDetail,
  type CycleWindow,
  type PuzzleProgress,
  type PuzzleSolution,
  PROVENANCE_META,
  dueBookPuzzles,
  loadBook,
  loadSolutions,
  nextInCycle,
  openCycle,
  patchProgress,
  usePuzzleEvidence,
} from './data';
import { useWideLayout } from '@/lib/media';
import { EvidencePeek } from './evidence';
import { outcomeTone } from '../outcome';
import { PuzzleGrid } from './PuzzleList';

// ---------------------------------------------------------------------------
// Strict trainer, submit-model (lanph3re's design): the answer is a real move
// tree, explored exactly like the analysis tab — go back anywhere, try
// side lines as pencil memos, nothing judged and nothing penalised while
// thinking. On Submit only the MAINLINE is graded (memos are ignored),
// through the fairness tiers: wildcards, narrow transpositions, any-mate,
// and engine adjudication where the book text cannot decide.

type Phase = 'loading' | 'solving' | 'checking' | 'done';

export function BookTrainer({ slug, puzzleId }: { slug: string; puzzleId: string }) {
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
  /**
   * Analysing in place, the way the puzzle trainer already does it: the
   * page stays, the board becomes the analysis board and the panel above
   * the moves becomes the engine. Navigating to Board instead left the
   * book behind — the way back was the browser's, and the puzzle you had
   * just failed was three taps away.
   *
   * The engine is switched ON by the act of asking to analyse, and off
   * again on the way out, including by unmount.
   */
  const [analysing, setAnalysing] = useState(false);
  /** Which pane the phone shows. A desktop shows all of them. */
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
  // The shared gate (board/usePromotion); the chosen piece re-enters the
  // ordinary free-entry path below.
  const promotion = usePromotion((orig, dest, role) => applyMove(orig, dest, roleToChar(role)));
  const reported = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // Leaving mid-check must not leave the engine adjudicating for nobody,
  // nor report an attempt the solver never saw graded: submit() bails at
  // this flag after its await, and the shared worker is freed (it reboots
  // lazily on the next engine verdict).
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
    releaseAdjudicator();
  }, []);
  const wide = useWideLayout();

  const index = book?.puzzles.findIndex((p) => p.id === puzzleId) ?? -1;
  // The list entry knows the puzzle's identity; its position and line come
  // from the solutions request, which is cached per book — so this is one
  // fetch when the first puzzle opens, not one per puzzle.
  const [solutions, setSolutions] = useState<Record<string, PuzzleSolution> | null>(null);
  const entry = index >= 0 ? book!.puzzles[index]! : null;
  const answer = entry && solutions ? solutions[entry.id] : undefined;
  // The scan this puzzle came off, for the peek button beside the board.
  // It travels separately from the book now, so the solver asks for its
  // own — without this the button vanished from every layout.
  const evidence = usePuzzleEvidence(slug, entry?.id);
  const puzzle = entry && answer ? { ...entry, ...answer, evidence } : null;
  const solution: BookSolution | null = puzzle
    ? { fen: puzzle.fen, uci: puzzle.uci, ...(puzzle.wildcards ? { wildcards: puzzle.wildcards } : {}) }
    : null;

  useEffect(() => {
    // Latest wins, like every other fetch effect: this trainer is keyed
    // on slug and puzzle id, so a remount can happen while the old
    // instance's requests are still out — an answer for a book already
    // left must not land in the state of the one now open.
    let live = true;
    void loadBook(slug).then((b) => {
      if (live) setBook(b);
    });
    void loadSolutions(slug).then((s) => {
      if (live) setSolutions(s);
    });
    return () => {
      live = false;
    };
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
    // null is "the request failed"; a success with no body settles to {}.
    const send = (): Promise<{ progress?: PuzzleProgress; cycles?: CycleWindow[] } | null> =>
      api<{ progress?: PuzzleProgress; cycles?: CycleWindow[] } | undefined>(
        `/api/puzzlebooks/${encodeURIComponent(slug)}/attempt`,
        { method: 'POST', json: { id: puzzle.id, win } },
      )
        .then((body) => body ?? {})
        .catch(() => null);
    // One quiet retry — same reasoning as the trainer's report(): a blip
    // at the moment of solving must not silently lose the attempt.
    let body = await send();
    if (!body) {
      await new Promise((r) => setTimeout(r, 2000));
      body = await send();
    }
    // Fold the server's own new entry into the cache, so the grid and
    // "next unsolved" are right on the next puzzle without a refetch.
    // The cycles ride along: this attempt may have closed the open pass.
    if (body?.progress) {
      const next = patchProgress(slug, puzzle.id, body.progress, body.cycles);
      // The cache is patched either way; the STATE is only touched while
      // this trainer is still mounted — the retry means the answer can
      // arrive seconds after the solver has already moved on.
      if (next && alive.current) setBook(next);
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
    if (phase !== 'solving' || !pos || !node) return;
    if (promotion.maybeStart(node.fen, pos.turn, orig, dest)) return;
    applyMove(orig, dest);
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
        if (!alive.current) return;
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
      // One animation's grace before `done`: that is what swaps this board
      // for the analysis one, and a swap mounts a fresh chessground at the
      // final position — so the last move of the line arrived without ever
      // being played. Every move but the last one animated (lanph3re).
      else timers.current.push(setTimeout(() => setPhase('done'), boardAnimMs()));
    };
    timers.current.push(setTimeout(step, 400));
  };

  const analyse = (): void => {
    if (!node || !tree) return;
    // The tree as played, not just the position: the solution's moves stay
    // navigable behind the cursor, which is the whole point of analysing a
    // puzzle you have just seen the answer to.
    useAnalysis.setState({
      tree,
      cursorId,
      orientation,
      pendingPromotion: null,
      loadError: null,
      gameHeaders: null,
    });
    useEngine.getState().setEnabled(true);
    setAnalysing(true);
  };

  /**
   * A solved puzzle analyses itself — there is no Analyse button on either
   * layout now. The phone STAYS on the puzzle's own pane, though: it was
   * moved to the engine on the theory that the evaluation is what you came
   * back for, and what it actually did was answer the puzzle by replacing
   * the panel that says whether you got it right (lanph3re). The engine
   * tab is one tap away and is now a choice. Leaving the puzzle undoes all
   * of it, engine included: an evaluation still up while the next one is
   * being solved IS the next one's answer.
   */
  useEffect(() => {
    if (phase === 'done' && node && !analysing) {
      analyse();
    }
    if (phase !== 'done' && analysing) {
      setAnalysing(false);
      setPane('info');
      useEngine.getState().setEnabled(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, node, analysing]);

  const nextUnsolved = (): string | null => {
    if (!book) return null;
    const after = book.puzzles.slice(index + 1).concat(book.puzzles.slice(0, index));
    return after.find((p) => book.progress[p.id]?.last !== 'win')?.id ?? null;
  };

  /**
   * The next puzzle whose review date has come, if any — computed after
   * the attempt lands (report() patches the book), so the puzzle just
   * answered has already been rescheduled out of the queue and this
   * chains through the rest of it. The current id is excluded anyway:
   * if the report was lost to the network, "next" must still not mean
   * "this one again".
   */
  const nextReview = (): string | null => {
    if (!book) return null;
    return dueBookPuzzles(book).find((id) => id !== puzzleId) ?? null;
  };

  // The verdict is a coloured line in the panel; say it out loud too
  // (see lib/announce — same treatment as the Lichess trainer's verdicts).
  useEffect(() => {
    if (phase === 'done') {
      announce(won ? t('Solved') : helped ? t('Solved with help') : t('Not solved'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Sound per rendered position (see PuzzlesView for the mechanism).
  const prevPieces = useRef<number | null>(null);
  useEffect(() => {
    if (!node || !pos) return;
    const pieces = node.fen.split(' ')[0]!.replace(/[^a-zA-Z]/g, '').length;
    const prev = prevPieces.current;
    prevPieces.current = pieces;
    if (prev === null || !node.uci) return;
    playSound(pieces < prev ? 'capture' : 'move');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.fen]);

  // Declared before the early return below — hooks must run in the same
  // order every render, and the branch it feeds is one of the returns.
  const pending = useSlowLoad(book === null || !puzzle || !tree || !node || !pos);

  // One list for the strip and for the swipe that turns it — see the
  // puzzle trainer, the same column and the same reason. Above the early
  // return for the same reason `pending` is.
  const panes = [
    { id: 'info' as const, label: t('Puzzle'), icon: Info },
    { id: 'moves' as const, label: t('Moves'), icon: ListOrdered },
    // The engine is what a puzzle is FOR — offered when the answer
    // is in, not while it is being looked for.
    ...(analysing ? [{ id: 'engine' as const, label: 'Engine', icon: Cpu }] : []),
  ];
  const paneSwipe = usePaneSwipe({
    panes,
    value: shownPane,
    onChange: setPane,
    enabled: !wide,
  });

  if (book === null || !puzzle || !tree || !node || !pos) {
    // A puzzle needs BOTH the book and the solutions, which arrive in two
    // requests — so "no such puzzle" may only be said once both are in.
    // Judging it on `puzzle` alone flashed the message at every puzzle
    // that does exist, in the gap between the two.
    const missing = book !== null && solutions !== null && (index < 0 || !answer);
    if (missing) {
      return (
        <div className="text-muted-foreground optical-center h-full text-base">
          {t('That puzzle does not exist.')}
        </div>
      );
    }
    // The trainer is a board beside its panel, so the wait is that shape
    // rather than a spinner in the middle of an empty page — the columns
    // settle before the position arrives instead of snapping when it does.
    return <div className="h-full">{pending && <SkeletonBoard />}</div>;
  }

  const solverSide = parseFen(puzzle.fen).unwrap().turn;
  /**
   * The board as the book printed it, not as the side to move.
   *
   * A scanned diagram is read white-at-bottom (importJob passes
   * blackAtBottom: false, and that is the only reading a page diagram
   * gets), so the FEN IS the picture on the page. Orienting a
   * black-to-play puzzle from Black's side turned that picture upside
   * down relative to the scan sitting beside it in the peek, which is
   * exactly the comparison this screen exists to make. Whose move it is
   * is said in words under the board, and the flip button is still there
   * for anyone who wants the other view.
   */
  const orientation: Color = flipped ? 'black' : 'white';
  const next = nextUnsolved();
  const review = nextReview();
  // An open Woodpecker pass owns the walk: while one runs, "what now" is
  // the first puzzle the pass has not reached — computed after the
  // attempt lands, so the one just answered is already inside the window.
  const cycle = openCycle(book);
  const cycleNext = cycle ? nextInCycle(book, cycle) : null;
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
        title={t('Back to the book')}
        onClick={() => navigate('puzzles', 'books', slug)}
      >
        <ChevronLeft className="size-3.5" />
      </Button>
      {/* The puzzle number IS the title; the tier collapses to its icon
          (tooltip explains). */}
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-foreground font-mono text-base font-semibold">
          #{puzzle.number ?? index + 1}
        </span>
        {puzzle.provenance &&
          puzzle.provenance in PROVENANCE_META &&
          (() => {
            const meta = PROVENANCE_META[puzzle.provenance as keyof typeof PROVENANCE_META];
            return (
              <TitleTip title={`${t(meta.label)}: ${t(meta.title)}`}>
                <span
                  role="img"
                  aria-label={`${t(meta.label)}: ${t(meta.title)}`}
                  className="shrink-0 cursor-help"
                >
                  <meta.icon className={cn('size-3.5', meta.iconClass)} aria-hidden />
                </span>
              </TitleTip>
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
        title={t('Correct this puzzle against the book scan')}
        onClick={() => navigate('puzzles', 'books', slug, 'fix', puzzle.id)}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );



  /**
   * The two panels, named so a desktop can stack them and a phone can
   * show one at a time — the puzzle trainer's arrangement, which this
   * screen is a sibling of.
   */
  // The Puzzle panel, in the lichess trainer's shape: status and the
  // solver's own actions live HERE (Submit is the book trainer's grading
  // moment), and the puzzle grid reveals from the header the way the
  // trainer reveals its difficulty row.
  const puzzlePanel = (
  // No `grow`, on either layout — see the note on the puzzle trainer's
  // panel, which is this one's sibling and changed with it. The panel is
  // the height of what it says; it grows with its content to the column's
  // floor and then its BODY scrolls, and the space it does not need is
  // left to the page rather than drawn as empty panel.
  <Panel>
    <PanelHeader
      title={t('Puzzle')}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Previous puzzle')}
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
            title={t('Next puzzle')}
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
            title={t('All puzzles in this book')}
            onClick={() => setShowNav((v) => !v)}
          >
            <LayoutGrid className="size-3.5" />
          </Button>
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
    {/* A window, not a drawer above the puzzle: a book's grid is
        hundreds of tiles, and opened in place it pushed the position
        being solved off the screen. On a phone it is a bottom
        sheet. */}
    {showNav && (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setShowNav(false);
        }}
      >
        <DialogContent title="All puzzles in this book" icon={LayoutGrid}>
          <PuzzleGrid slug={slug} puzzles={book.puzzles} progress={book.progress} currentId={puzzleId} />
        </DialogContent>
      </Dialog>
    )}
    {/* `grow` so the body owns the panel's full height rather than
        stopping at its text, and `overflow-y-auto` so that the height is
        a ceiling and not a promise: the status text can run taller than
        the band a phone has under the board, and without this the panel
        ran past the column with Panel's overflow-hidden cutting whatever
        hung off the end. `min-h-0` because a flex item will not shrink
        below its content without it, which is exactly the overflow being
        fixed. */}
    <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-(--card-spacing)">
      <div className="flex flex-col gap-0.5">
        {/* Three sentences, so three tones. This branched on `won` alone,
            which painted "Solved with help" the same red as "Not solved"
            — and the other trainer calls the same thing amber. */}
        {phase === 'done' ? (
          <p
            className={cn(
              'text-base font-semibold',
              outcomeTone(won ? 'solved' : helped ? 'helped' : 'missed'),
            )}
          >
            {won ? t('Solved') : helped ? t('Solved with help') : t('Not solved')}
          </p>
        ) : (
          <p className="text-foreground text-2xl font-bold tracking-tight">
            {solverSide === 'white' ? t('White to play') : t('Black to play')}
          </p>
        )}
        <p className="text-muted-foreground text-sm leading-relaxed">
          {phase === 'checking'
            ? t('Checking your answer…')
            : phase === 'done'
              ? helped
                ? t('That is the book line. Retry it without hints to count it.')
                : won
                  ? engineApproved
                    ? t('Off the book at the end, but the engine approves.')
                    : t('Exactly as the book has it.')
                  : wrong
                    ? t('The marked move is where the line goes wrong.')
                    : t('Correct so far, but the book line goes further.')
              : t('Explore freely. Only the mainline is judged on submit.')}
        </p>
      </div>

      {/* The row is IN the body, and scrolls with it (lanph3re), as the
          other trainer's does: pinned to the panel's floor it held its
          place while the status text moved behind it, which reads as two
          panels in one — and on a short window the pinning is what
          squeezed the text to keep a row nobody was reaching for on
          screen. It follows what it answers to instead.

          justify-end, gap-2, the primary one LAST — the row every window
          in this app ends on (components/prompt-dialog), and what the other trainer
          does. The primary used to LEAD and stretch across the row
          (lanph3re: a left-biased cluster looks unbalanced, centring is
          worse), which put Submit and Next puzzle at the opposite edge
          from the puzzle trainer's Next puzzle — two screens maintained
          as siblings, disagreeing about where the button you press is.
          Ending the line is what fixes the imbalance the stretch was
          for.

          shadcn's CardFooter, the panel's own floor — the slot a card keeps
          for its actions. Still the last child of the scrolling body, not
          pinned outside it: mt-auto rests it on the floor while the text
          is short and lets it scroll with the text when it is not; the
          negative margins take back the body's p-3 so the band spans the
          panel edge to edge. */}
      <CardFooter className="-mx-(--card-spacing) mt-auto flex-wrap justify-end gap-2">
        {phase === 'done' ? (
          <>
            <Button variant="secondary" size="sm" onClick={retry}>
              <RotateCcw className="size-3.5" data-icon="inline-start" />
              {t('Retry')}
            </Button>
            {cycle && cycleNext ? (
              // Mid-pass, the pass IS the walk: one primary action, the
              // next puzzle the cycle has not reached. Review and "next
              // unsolved" come back when the pass is over.
              <Button
                variant="default"
                size="sm"
                onClick={() => navigate('puzzles', 'books', slug, cycleNext)}
              >
                <RotateCw className="size-3.5" data-icon="inline-start" />
                {t('Next in cycle')}
              </Button>
            ) : (
              <>
                {/* The review queue, chained: solving a due puzzle leads to
                    the next one due, without a trip back to the book page. */}
                {review && (
                  <Button
                    variant="secondary"
                    size="sm"
                    title={t('The next puzzle whose review date has come')}
                    onClick={() => navigate('puzzles', 'books', slug, review)}
                  >
                    <History className="size-3.5" data-icon="inline-start" />
                    {t('Next review')}
                  </Button>
                )}
                {next && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => navigate('puzzles', 'books', slug, next)}
                  >
                    <RotateCw className="size-3.5" data-icon="inline-start" />
                    {t('Next puzzle')}
                  </Button>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={phase !== 'solving'}
              onClick={showSolution}
              title={t('Counts as a failed attempt')}
            >
              <Eye className="size-3.5" data-icon="inline-start" />
              {t('Solution')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('puzzles', 'books', slug)}
            >
              <X className="size-3.5" data-icon="inline-start" />
              {t('Skip')}
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={phase !== 'solving' || !hasMoves}
              title={t('Grade the mainline. This is the only judged moment.')}
              onClick={() => void submit()}
            >
              {phase === 'checking' ? (
                <Spinner className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              )}
              {t('Submit')}
            </Button>
          </>
        )}
      </CardFooter>
    </div>
  </Panel>
  );
  const movesPanel = analysing ? (
    // min-h-32 over the panel's own `min-h-min` — see the note on the
    // puzzle trainer's, which is the same panel in the same column.
    <AnalysisMovesPanel engine={wide} className="min-h-32 flex-auto" />
  ) : (
  <AnswerPanel
    // Takes the column's spare height, so the panel under it sits on the
    // board's bottom edge instead of floating above it — but not below
    // `min-h-32`, the floor the analysing branch's panel already keeps,
    // for the same reason: a phone in landscape is a `wide` layout with
    // 390px of height, and with no floor this panel took the whole squeeze
    // and was drawn shorter than its own header and toolbar, with nothing
    // to scroll because a panel hides what does not fit. With the floor the
    // squeeze goes to the puzzle panel below, whose body is a scroller, and
    // past that to the column, which is one too.
    className="min-h-32 flex-1 shrink"
    tree={tree}
    cursorId={cursorId}
    onSelect={setCursorId}
    onPromote={
      phase === 'solving' ? (id) => setTree(promoteToMainline(tree, id)) : undefined
    }
    onFlip={() => setFlipped((f) => !f)}
    emptyText={t('Nothing entered yet. Find the first move on the board.')}
  />
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
      {/* Stacked: the identity bar stays glued to the top of the page,
          above the board (lanph3re's spec) — wide keeps it in the side column. */}
      {!wide && header}
      {/* Once the puzzle is over the board becomes the analysis board, so
          the pieces move freely and the eval bar is the one every other
          board page draws. */}
      {analysing ? (
        <AnalysisBoard />
      ) : (
        <div className={BOARD_WIDE_COLUMN}>
          <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
            <div className="hidden w-full items-end wide:flex wide:h-10" />
            {/* The eval bar's width, held open before there is an eval bar:
                when the puzzle ends this board is replaced by AnalysisBoard,
                which draws one, and without the same reservation here the
                board lost 24px and stepped right at exactly that moment. */}
            <div className="flex w-full items-stretch gap-2">
              <EvalBarSlot />
              <div className="relative min-w-0 flex-1">
                <Board
                  fen={node.fen}
                  orientation={orientation}
                  dests={dests}
                  lastMove={moveSquares(node)}
                  check={pos.isCheck()}
                  onMove={onMove}
                />
                {promotion.pending && (
                  <PromotionPicker
                    color={promotion.pending.color}
                    dest={promotion.pending.dest}
                    orientation={orientation}
                    onSelect={promotion.complete}
                    onCancel={promotion.cancel}
                  />
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
        {/* The same h-9 band every other board page opens its column with:
            h-9 plus the column's gap-3 equals the board's h-10 strip plus
            its gap-2, which is what puts the first panel level with the
            board. This one sized to its content — 28px — and started the
            panels eight pixels high. */}
        {wide && <div className="flex h-9 shrink-0 items-center gap-2">{header}</div>}

        {/* Moves above the puzzle on a desktop, because they are what you
            read while solving and the engine docks on top of them the
            moment it is over. One at a time on a phone, behind the
            switcher. */}
        {!wide && <PaneTabs value={shownPane} onChange={setPane} tabs={panes} />}
        {(wide || paneSwipe.shows('moves')) && movesPanel}
        {!wide && analysing && paneSwipe.shows('engine') && (
          <Panel className="min-h-0 flex-1">
            <EngineBlock standalone />
          </Panel>
        )}
        {(wide || paneSwipe.shows('info')) && puzzlePanel}
        {/* Once the puzzle is over — see the puzzle trainer's copy. */}
        {analysing && <ColumnControls className="wide:hidden" />}

      </div>

      {/* Phones: the bottom band navigates the entered line, like every
          other board page. The solver's actions (Submit, Solution, Skip)
          live in the Puzzle panel above — no duplicates here.

          Once the puzzle is over the board is AnalysisBoard, driven by the
          analysis store rather than this component's tree, so these
          buttons moved nothing — the same dead bar the puzzle trainer had.
          AnalysisBoard itself owns the arrow keys. */}
      <MobileActionBar>
        {analysing ? (
          <BoardControls className="py-1.5" />
        ) : (
        <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
          <Button variant="ghost" size="icon" disabled={atRoot} onClick={() => goTo(tree.rootId)} title={t('Start')}>
            <ChevronFirst className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={atRoot} onClick={() => goTo(node.parentId ?? undefined)} title={t('Back')}>
            <ChevronLeft className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={node.children.length === 0} onClick={() => goTo(node.children[0])} title={t('Forward')}>
            <ChevronRight className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={cursorId === tipId} onClick={() => goTo(tipId)} title={t('Latest')}>
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
