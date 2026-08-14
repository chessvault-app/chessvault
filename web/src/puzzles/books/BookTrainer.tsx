import {
  BarChart3,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
  LayoutGrid,
  Pencil,
  Check,
  Eye,
  Loader2,
  RotateCcw,
  RotateCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { parseFen } from 'chessops/fen';

import { parseSquare, squareRank } from 'chessops/util';
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

import { cn } from '@/lib/cn';

import { navigate } from '@/lib/router';
import { useAnalysis } from '@/store/analysis';

import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { MobileActionBar } from '@/ui/MobileActionBar';

import { Panel, PanelHeader } from '@/ui/Panel';

import { judgeBookMove, type BookSolution } from '../bookJudge';

import { movePasses } from '@/engine/adjudicate';
import { AnswerPanel } from '../AnswerPanel';

import { t } from '@/lib/i18n';
import {
  type BookDetail,
  type PuzzleProgress,
  type PuzzleSolution,
  PROVENANCE_META,
  loadBook,
  loadSolutions,
  patchProgress,
  usePuzzleEvidence,
} from './data';
import { useWideLayout } from './layout';
import { EvidencePeek } from './evidence';
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
    const send = (): Promise<Response | null> =>
      fetch(`/api/puzzlebooks/${encodeURIComponent(slug)}/attempt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: puzzle.id, win }),
      }).catch(() => null);
    // One quiet retry — same reasoning as the trainer's report(): a blip
    // at the moment of solving must not silently lose the attempt.
    let res = await send();
    if (!res?.ok) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await send();
    }
    // Fold the server's own new entry into the cache, so the grid and
    // "next unsolved" are right on the next puzzle without a refetch.
    if (res?.ok) {
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

  // The verdict is a coloured line in the panel; say it out loud too
  // (see ui/announce — same treatment as the Lichess trainer's verdicts).
  useEffect(() => {
    if (phase === 'done') {
      announce(won ? t('Solved!') : helped ? t('Solved with help.') : t('Not this time.'));
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

  if (book === null || !puzzle || !tree || !node || !pos) {
    // A puzzle needs BOTH the book and the solutions, which arrive in two
    // requests — so "no such puzzle" may only be said once both are in.
    // Judging it on `puzzle` alone flashed the message at every puzzle
    // that does exist, in the gap between the two.
    const missing = book !== null && solutions !== null && (index < 0 || !answer);
    return (
      <div className="text-subtle grid h-full place-items-center text-sm">
        {missing ? t('That puzzle does not exist.') : <Loader2 className="size-5 animate-spin" />}
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
        title={t('Back to the book')}
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
              <span title={`${t(meta.label)} — ${t(meta.title)}`} className="shrink-0 cursor-help">
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
        title={t('Correct this puzzle against the book scan')}
        onClick={() => navigate('puzzles', 'books', slug, 'fix', puzzle.id)}
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 stacked:gap-2 stacked:overflow-y-auto wide:flex-row wide:gap-4 wide:p-4 wide:mx-auto wide:w-full wide:max-w-[76rem]">
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
            <Modal
              title="All puzzles in this book"
              icon={LayoutGrid}
              onClose={() => setShowNav(false)}
            >
              <PuzzleGrid slug={slug} puzzles={book.puzzles} progress={book.progress} currentId={puzzleId} />
            </Modal>
          )}
          <div className="flex flex-col gap-3 p-3">
            <div className="flex flex-col gap-0.5">
              {phase === 'done' ? (
                <p className={cn('text-sm font-semibold', won ? 'text-good' : 'text-bad')}>
                  {won ? t('Solved!') : helped ? t('Solved with help.') : t('Not this time.')}
                </p>
              ) : (
                <p className="text-fg text-xl font-bold tracking-tight">
                  {solverSide === 'white' ? t('White to play') : t('Black to play')}
                </p>
              )}
              <p className="text-muted text-xs leading-relaxed">
                {phase === 'checking'
                  ? t('Checking your answer…')
                  : phase === 'done'
                    ? helped
                      ? t('That is the book line. Retry it clean later.')
                      : won
                        ? engineApproved
                          ? t('Off the book at the end — but the engine approves. Solved.')
                          : t('Exactly as the book has it.')
                        : wrong
                          ? t('Not quite — the marked move is where it goes wrong.')
                          : t('Correct so far, but the book line goes further.')
                    : t('Explore freely — only the mainline is judged on submit.')}
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
                      {t('Next unsolved')}
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" className={next ? '' : 'flex-1'} onClick={retry}>
                    <RotateCcw className="size-3.5" />
                    {t('Retry')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={analyse}>
                    {t('Analyse')}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    disabled={phase !== 'solving' || !hasMoves}
                    title={t('Grade the mainline — this is the only judged moment')}
                    onClick={() => void submit()}
                  >
                    {phase === 'checking' ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    {t('Submit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={phase !== 'solving'}
                    onClick={showSolution}
                    title={t('Counts as a failed attempt')}
                  >
                    <Eye className="size-3.5" />
                    {t('Solution')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('puzzles', 'books', slug)}
                  >
                    <X className="size-3.5" />
                    {t('Skip')}
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
          emptyText={t('Nothing entered yet — find the first move on the board.')}
        />
      </div>

      {/* Phones: the bottom band navigates the entered line, like every
          other board page. The solver's actions (Submit, Solution, Skip)
          live in the Puzzle panel above — no duplicates here. */}
      <MobileActionBar>
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
      </MobileActionBar>
    </div>
  );
}
