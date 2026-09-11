import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Crown,
  Info,
  ListOrdered,
  RotateCcw,
  RotateCw,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from 'chessops/types';
import { parseUci, roleToChar } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { AnalysisBoard, BoardControls, ColumnControls } from '@/board/AnalysisBoard';
import { Board, boardAnimMs } from '@/board/Board';
import { MoveBox } from '@/board/MoveBox';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';
import { SquareBadge } from '@/board/square-overlay';
import { PaneTabs } from '@/components/pane-tabs';
import { usePaneSwipe } from '@/hooks/use-pane-swipe';
import { addMove, createTree, getNode, mainlineFrom } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { EngineBlock } from '@/engine/EnginePane';
import { EvalBarSlot } from '@/engine/EvalBar';
import { AnalysisMovesPanel } from '@/analysis/AnalysisMovesPanel';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { useWideLayout } from '@/lib/media';
import { navigate } from '@/lib/router';
import { announce } from '@/lib/announce';
import { cn } from '@/lib/utils';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { BOARD_HELD_SHELL, BOARD_WIDE_COLUMN, BOARD_WIDE_SIDE } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { ListRow } from '@/components/list-row';
import { MobileActionBar } from '@/components/mobile-action-bar';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Panel, PanelHeader } from '@/components/panel';
import { Skeleton } from '@/components/skeletons';
import { CustomMaterialWindow } from '@/games/CustomMaterialWindow';
import { AnswerPanel } from '@/puzzles/AnswerPanel';
import { outcomeTone } from '@/puzzles/outcome';
import {
  CUSTOM_CLASS,
  DRILL_PRESETS,
  classLabel,
  positionOf,
  readCustomDraft,
  specFor,
  writeCustomDraft,
  type DrillPosition,
} from './drill';

/**
 * The endgame drill: a won ending drawn at random, played out against
 * the tablebase's best defence.
 *
 * Two pages. The picker is a list of the material presets the games
 * hunt already knows; the drill itself is the trainer's page in every
 * part that is not the puzzle: the same board column, the same Moves
 * panel with its typed move box, the same pane strip and swipe on a
 * phone, the same in-place analysis board and engine once the attempt
 * is over, the same bottom bar. Two trainers that differ only where the
 * task differs is what keeps them one page to learn. What differs: there
 * is no answer to find, only a win to keep, and the verdict on every
 * move is the server's (server/endgameDrill.ts), which asks the
 * tablebase; the page grades nothing itself.
 */

/** Where the picker lives, and where the drill goes back to: a section
    of its own, listed under Tools. */
const PICKER = ['endgames'] as const;

export function EndgamesView({ params }: { params: string[] }) {
  const classId = params[0];
  if (!classId) return <EndgamePicker />;
  return <Drill key={classId} classId={classId} />;
}

/**
 * Which ending to drill.
 *
 * Every row is a preset from endgames.json that fits under seven men,
 * and a row is a name and a chevron. Nothing here is kept: a drill is a
 * thing to play when an ending is what you feel like, not a record to
 * tend, so no bar, no count, no history (lanph3re's call). The rows are
 * static and the page waits on nothing.
 */
function EndgamePicker() {
  const [editing, setEditing] = useState(false);
  const rows = [...DRILL_PRESETS.map((p) => p.id), CUSTOM_CLASS];

  return (
    <PageShell width="medium">
      <PageHeader
        title={t('Endgame drills')}
        back={() => navigate('more')}
        description={t(
          'Play the winning side of a random ending against the tablebase. A move that lets the win slip ends the attempt and shows the move that kept it.',
        )}
      />
      <div className="bg-card overflow-hidden rounded-xl ring-1 ring-card-ring">
        {rows.map((id) => (
          <ListRow
            key={id}
            divided
            onClick={() => {
              // The custom class opens its editor first: a drill of
              // nothing in particular is not a drill.
              if (id === CUSTOM_CLASS) setEditing(true);
              else navigate(...PICKER, id);
            }}
          >
            <span className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-sm">
              {id === CUSTOM_CLASS ? (
                <SlidersHorizontal className="size-3.5" />
              ) : (
                <Crown className="size-3.5" />
              )}
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
              {t(classLabel(id))}
            </span>
            <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
          </ListRow>
        ))}
      </div>
      {editing && (
        <CustomMaterialWindow
          initial={readCustomDraft()}
          onApply={(draft) => {
            writeCustomDraft(draft);
            setEditing(false);
            navigate(...PICKER, CUSTOM_CLASS);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </PageShell>
  );
}

/** What the drill is doing right now. */
type Phase =
  | 'loading'
  | 'playing'
  | 'replying' // the move held; the defender's reply is on its way
  | 'won'
  | 'threw'
  | 'stopped' // ended by hand, to look at the position with the engine
  | 'error';

/**
 * What a failed request means for the reader, by the server's reason,
 * and whether Settings is the place to fix it. The English sentence in
 * the error body is for a direct caller; this is the page's own.
 */
function explain(error: unknown): { message: string; settings: boolean } {
  if (isDemo()) {
    return {
      message: t('The demo reaches no tablebase. In the app, the drill plays against whichever tablebase Settings names.'),
      settings: false,
    };
  }
  const reason = error instanceof ApiError ? error.reason : null;
  switch (reason) {
    case 'no-tablebase':
      return { message: t('No tablebase is answering. Choose a source under Settings, Tablebase.'), settings: true };
    case 'no-table':
      return {
        message: t('The tablebase in use holds no tables for this many pieces. Point Settings, Tablebase at one that does: Lichess’s public server has all seven-piece tables.'),
        settings: true,
      };
    case 'unreachable':
      return {
        message: t('The tablebase cannot be reached. Check the connection, or pick another source under Settings, Tablebase.'),
        settings: true,
      };
    case 'too-many':
      return { message: t('This material needs more than seven pieces, which no table holds.'), settings: false };
    case 'none-found':
      return { message: t('No won position of this material turned up this time.'), settings: false };
    default:
      return { message: apiErrorMessage(error), settings: false };
  }
}

/** The line so far as a move tree, the same shape the trainer's answer
    panel and the analysis store take, so both read it unchanged. */
function lineTree(fen: string, ucis: string[]): { tree: MoveTree; lastId: NodeId } {
  let tree = createTree(fen);
  let lastId = tree.rootId;
  for (const uci of ucis) {
    const result = addMove(tree, lastId, parseUci(uci)!);
    tree = result.tree;
    lastId = result.nodeId;
  }
  return { tree, lastId };
}

function Drill({ classId }: { classId: string }) {
  const [start, setStart] = useState<{ fen: string; side: Color } | null>(null);
  /** The line played, solver and defender alternating. */
  const [ucis, setUcis] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<{ message: string; settings: boolean } | null>(null);
  /** The move that would have kept it, once one has been thrown. */
  const [best, setBest] = useState<{ uci: string; san: string } | null>(null);
  /** Mate distance in plies for the position now faced, where the
      table knows one. A distance, never a score. */
  const [dtm, setDtm] = useState<number | null>(null);
  // Reviewing an earlier ply (null = live), via the panel or the bar.
  const [review, setReview] = useState<number | null>(null);
  const [flipped, setFlipped] = useState(false);
  const promotion = usePromotion((orig, dest, role) => void play(orig + dest + roleToChar(role)));
  const wide = useWideLayout();

  // Whoever holds the latest sequence number owns the state; a draw
  // pressed while a reply is on its way must not have that reply land
  // on the new position (the trainer's own rule, loadNext).
  const seq = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const after = (ms: number, fn: () => void): void => {
    timers.current.push(setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const spec = specFor(classId);

  const draw = useCallback(async () => {
    const mine = ++seq.current;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    promotion.cancel();
    setPhase('loading');
    setStart(null);
    setUcis([]);
    setBest(null);
    setDtm(null);
    setReview(null);
    setFlipped(false);
    setError(null);
    if (!spec) {
      setError({ message: t('Pick at least one count, or every game matches.'), settings: false });
      setPhase('error');
      return;
    }
    try {
      const body = await api<{ fen: string; side: Color; dtm: number | null }>(
        `/api/endgames/draw?spec=${encodeURIComponent(spec)}`,
      );
      if (mine !== seq.current) return;
      setStart({ fen: body.fen, side: body.side });
      setDtm(body.dtm);
      setPhase('playing');
    } catch (e) {
      if (mine !== seq.current) return;
      setError(explain(e));
      setPhase('error');
    }
    // `promotion` is a fresh object each render; only its cancel is used.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  // One boot per real mount: StrictMode replays effects.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void draw();
  }, [draw]);

  /** The same position again, from the top. */
  const retry = (): void => {
    if (!start) return;
    ++seq.current;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    promotion.cancel();
    setUcis([]);
    setBest(null);
    setReview(null);
    setPhase('playing');
  };

  // The line as a tree, for the Moves panel and the analysis store; the
  // ids down its mainline index the plies the bar walks.
  const line = useMemo(() => (start ? lineTree(start.fen, ucis) : null), [start, ucis]);
  const lineIds = useMemo(
    () => (line ? mainlineFrom(line.tree, line.tree.rootId) : []),
    [line],
  );
  const plies = ucis.length;
  const positionAtPly = (ply: number): DrillPosition | null => {
    if (!line) return null;
    const fen = getNode(line.tree, ply === 0 ? line.tree.rootId : lineIds[ply - 1]!).fen;
    const uci = ply === 0 ? null : ucis[ply - 1]!;
    return positionOf(fen, uci ? [uci.slice(0, 2), uci.slice(2, 4)] : undefined);
  };
  const live = positionAtPly(plies);
  const shownPly = review ?? plies;
  const displayed = positionAtPly(shownPly);
  const reviewing = review !== null;
  const solverSide: Color = start?.side ?? 'white';
  const orientation: Color = flipped ? (solverSide === 'white' ? 'black' : 'white') : solverSide;

  const play = async (uci: string): Promise<void> => {
    if (!live || phase !== 'playing' || reviewing) return;
    const mine = seq.current;
    setPhase('replying');
    let verdict: {
      verdict: 'won' | 'threw' | 'held';
      san: string;
      fen: string;
      best?: { uci: string; san: string };
      reply?: { uci: string; san: string };
      dtm?: number | null;
    };
    try {
      verdict = await api('/api/endgames/move', { method: 'POST', json: { fen: live.fen, uci } });
    } catch (e) {
      if (mine !== seq.current) return;
      setError(explain(e));
      setPhase('error');
      return;
    }
    if (mine !== seq.current) return;
    setUcis((u) => [...u, uci]);
    if (verdict.verdict === 'won') {
      setPhase('won');
      return;
    }
    if (verdict.verdict === 'threw') {
      setBest(verdict.best ?? null);
      setPhase('threw');
      return;
    }
    const reply = verdict.reply!;
    setDtm(verdict.dtm ?? null);
    // One animation's grace before the reply lands, so the two moves
    // are seen as two.
    after(Math.max(450, boardAnimMs()), () => {
      if (mine !== seq.current) return;
      setUcis((u) => [...u, reply.uci]);
      setPhase('playing');
    });
  };

  const onMove = (orig: string, dest: string): void => {
    if (!live || phase !== 'playing' || reviewing) return;
    if (promotion.maybeStart(live.fen, live.turn, orig, dest)) return;
    void play(orig + dest);
  };

  // Announced for a screen reader at the two moments that matter; the
  // badge on the board and the panel's line are both visual.
  useEffect(() => {
    if (phase === 'threw') announce(t('The win slipped'));
    else if (phase === 'won') announce(t('Checkmate'));
  }, [phase]);

  // Any progress snaps the board back to live.
  useEffect(() => setReview(null), [plies, phase]);

  // Sound per shown position: a capture is the piece count dropping.
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

  const goToPly = (target: number): void => {
    const clamped = Math.max(0, Math.min(target, plies));
    setReview(clamped >= plies ? null : clamped);
  };

  // In-place analysis once the attempt is over, the trainer's own: the
  // line loads into the shared analysis store, the board becomes the
  // analysis board and the panel column takes the moves and the engine.
  // Entering is what turns the engine on; leaving turns it off.
  const [analysing, setAnalysing] = useState(false);
  const [engineOpen, setEngineOpen] = useState(false);
  const [pane, setPane] = useState<'info' | 'moves' | 'engine'>('info');
  const shownPane = !analysing && pane === 'engine' ? 'info' : pane;
  const analysingRef = useRef(false);
  analysingRef.current = analysing;
  useEffect(
    () => () => {
      if (analysingRef.current) useEngine.getState().setEnabled(false);
    },
    [],
  );
  const ended = phase === 'won' || phase === 'threw' || phase === 'stopped';
  useEffect(() => {
    if (ended && line && !analysing) {
      useAnalysis.setState({
        tree: line.tree,
        cursorId: line.lastId,
        orientation,
        pendingPromotion: null,
        loadError: null,
        gameHeaders: null,
      });
      setAnalysing(true);
    }
    if (!ended && analysing) {
      setAnalysing(false);
      setPane('info');
      setEngineOpen(false);
      useEngine.getState().setEnabled(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended, line, analysing]);
  useEffect(() => {
    if (analysing) useEngine.getState().setEnabled(!wide || engineOpen);
  }, [analysing, wide, engineOpen]);

  const label = t(classLabel(classId));
  const title = t('Endgame drill');
  // The move that kept the win, drawn on the board once it was missed.
  const bestShapes: DrawShape[] =
    phase === 'threw' && best && !reviewing
      ? [
          {
            orig: best.uci.slice(0, 2) as DrawShape['orig'],
            dest: best.uci.slice(2, 4) as DrawShape['orig'],
            brush: 'green',
          },
        ]
      : [];

  const panes = [
    { id: 'info' as const, label: t('Drill'), icon: Info },
    { id: 'moves' as const, label: t('Moves'), icon: ListOrdered },
    ...(analysing ? [{ id: 'engine' as const, label: 'Engine', icon: Cpu }] : []),
  ];
  const paneSwipe = usePaneSwipe({
    panes,
    value: shownPane,
    onChange: setPane,
    enabled: !wide,
  });

  const lastSan = line && plies > 0 ? (getNode(line.tree, lineIds[plies - 1]!).san ?? '') : '';
  const status = (): { text: string; tone?: string } => {
    switch (phase) {
      case 'loading':
        return { text: t('Finding a won ending…') };
      case 'playing':
        return { text: t('Keep the win. A move the tablebase calls a draw or a loss ends the attempt.') };
      case 'replying':
        return { text: t('Defending…') };
      case 'won':
        return { text: t('Checkmate. The win held from the first move to the last.'), tone: outcomeTone('solved') };
      case 'threw':
        return {
          text: best
            ? t('{san} lets the win slip. {best} keeps it.', { san: lastSan, best: best.san })
            : t('The win slipped'),
          tone: outcomeTone('missed'),
        };
      case 'stopped':
        return { text: t('Stopped. The position is on the analysis board, with the engine.') };
      case 'error':
        // The board's own box carries the sentence, as the trainer's does.
        return { text: '' };
    }
  };
  const statusLine = status();

  const dockEngine = wide && analysing && engineOpen;
  const movesPanel = analysing ? (
    <AnalysisMovesPanel engine={dockEngine} className="min-h-32 flex-auto" />
  ) : line ? (
    <AnswerPanel
      className="min-h-32 flex-1 shrink"
      tree={line.tree}
      cursorId={lineIds[shownPly - 1] ?? line.tree.rootId}
      onSelect={(id) => goToPly(id === line.tree.rootId ? 0 : lineIds.indexOf(id) + 1)}
      onFlip={() => setFlipped((f) => !f)}
      moveBox={
        live && (
          <MoveBox
            fen={live.fen}
            disabled={phase !== 'playing' || reviewing}
            onMove={(uci) => void play(uci)}
          />
        )
      }
    />
  ) : (
    <Panel className="min-h-32 flex-1 shrink">
      <PanelHeader title={t('Moves')} />
      <p className="text-muted-foreground px-3 py-2.5 text-sm">{t('Finding a won ending…')}</p>
    </Panel>
  );

  const drillPanel = (
    <Panel>
      <PanelHeader
        title={title}
        actions={
          <>
            <span className="text-muted-foreground truncate text-xs">{label}</span>
            {wide && analysing && (
              <Button
                variant="ghost"
                size="icon-sm"
                active={engineOpen}
                title={t('Engine')}
                onClick={() => setEngineOpen((v) => !v)}
              >
                <Cpu className="size-3.5" />
              </Button>
            )}
            {/* The way to the list, where the trainer has its dashboard. */}
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('All endings')}
              onClick={() => navigate(...PICKER)}
            >
              <Crown className="size-3.5" />
            </Button>
          </>
        }
      />
      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-(--card-spacing)">
        <div className="flex flex-col gap-0.5">
          {start && phase !== 'loading' ? (
            <p className="text-foreground text-2xl font-bold tracking-tight">
              {solverSide === 'white' ? t('White to move') : t('Black to move')}
            </p>
          ) : phase === 'loading' ? (
            <div className="flex h-8 items-center">
              <Skeleton className="h-4 w-28" />
            </div>
          ) : null}
          <p className={cn('text-sm leading-relaxed', statusLine.tone ?? 'text-muted-foreground')}>
            {statusLine.text}
          </p>
          {/* A distance the small tables know, said as a fact about the
              position rather than a hint about the move. */}
          {dtm !== null && (phase === 'playing' || phase === 'replying') && (
            <p className="text-muted-foreground text-xs">
              {t('Mate in {n}', { n: Math.ceil(dtm / 2) })}
            </p>
          )}
        </div>

        <CardFooter className="-mx-(--card-spacing) mt-auto flex-wrap justify-end gap-2">
          {ended ? (
            <>
              <Button variant="secondary" size="sm" onClick={retry}>
                <RotateCcw className="size-3.5" data-icon="inline-start" />
                {t('Try again')}
              </Button>
              <Button variant="default" size="sm" onClick={() => void draw()}>
                <RotateCw className="size-3.5" data-icon="inline-start" />
                {t('Next ending')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="me-auto pointer-coarse:h-11"
                disabled={phase === 'loading'}
                onClick={() => void draw()}
              >
                <X className="size-3.5" data-icon="inline-start" />
                {t('Skip')}
              </Button>
              {/* Where the trainer offers the solution, this ends the
                  attempt by hand: the line so far goes to the analysis
                  board and the engine comes on, the same swap a finished
                  attempt makes. Nothing is graded; a stop is a stop. */}
              <Button
                variant="ghost"
                size="sm"
                className="pointer-coarse:h-11"
                disabled={phase !== 'playing'}
                onClick={() => {
                  ++seq.current;
                  promotion.cancel();
                  setReview(null);
                  setPhase('stopped');
                }}
                title={t('Ends the attempt and opens the engine')}
              >
                <Cpu className="size-3.5" data-icon="inline-start" />
                {t('Analyse')}
              </Button>
            </>
          )}
        </CardFooter>
      </div>
    </Panel>
  );

  return (
    <div className={BOARD_HELD_SHELL}>
      <div className="flex h-8 shrink-0 items-center gap-2 wide:hidden">
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          title={t('Back to endgame drills')}
          onClick={() => navigate(...PICKER)}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-foreground text-base font-semibold">{title}</h1>
      </div>
      {analysing ? (
        <AnalysisBoard />
      ) : (
        <div className={BOARD_WIDE_COLUMN}>
          <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
            <div className="hidden w-full items-end wide:flex wide:h-10" />
            <div className="flex w-full items-stretch gap-2">
              <EvalBarSlot />
              <div className="relative min-w-0 flex-1">
                {displayed ? (
                  <Board
                    fen={displayed.fen}
                    orientation={orientation}
                    dests={phase === 'playing' && !reviewing ? displayed.dests : new Map()}
                    lastMove={displayed.lastMove}
                    check={displayed.check}
                    autoShapes={bestShapes}
                    onMove={onMove}
                  />
                ) : phase === 'error' ? (
                  // What happened, and a way to go again, in the trainer's
                  // own box; the way to Settings joins it where that is the fix.
                  <div className="bg-card grid aspect-square w-full place-items-center rounded-xl ring-1 ring-card-ring">
                    <div className="flex max-w-[80%] flex-col items-center gap-3 text-center">
                      <p className="text-muted-foreground text-sm" role="alert">
                        {error?.message}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {error?.settings && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate('settings', 'tablebase')}
                          >
                            <Settings className="size-3.5" data-icon="inline-start" />
                            {t('Open Settings')}
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => void draw()}>
                          <RotateCw className="size-3.5" data-icon="inline-start" />
                          {t('Try again')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
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
                {!reviewing && phase === 'threw' && displayed?.lastMove && (
                  <SquareBadge
                    square={displayed.lastMove[1]}
                    orientation={orientation}
                    className="bg-nag-blunder"
                  >
                    ??
                  </SquareBadge>
                )}
                {!reviewing && phase === 'won' && displayed?.lastMove && (
                  <SquareBadge
                    square={displayed.lastMove[1]}
                    orientation={orientation}
                    className="bg-nag-good"
                  >
                    !
                  </SquareBadge>
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
        <div className="hidden h-9 shrink-0 items-center gap-2 pr-[13px] wide:flex">
          <h1 className="text-foreground text-base font-semibold">{title}</h1>
        </div>
        {!wide && <PaneTabs variant="header" value={shownPane} onChange={setPane} tabs={panes} />}
        {(wide || paneSwipe.shows('moves')) && movesPanel}
        {!wide && analysing && paneSwipe.shows('engine') && (
          <Panel className="min-h-0 flex-1">
            <EngineBlock standalone />
          </Panel>
        )}
        {(wide || paneSwipe.shows('info')) && drillPanel}
        {analysing && <ColumnControls className="wide:hidden" />}
      </div>

      <MobileActionBar>
        {analysing ? (
          <BoardControls className="py-1.5" />
        ) : (
          <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
            <Button variant="ghost" size="icon" disabled={plies === 0} onClick={() => goToPly(0)} title={t('First move')}>
              <ChevronFirst className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={plies === 0} onClick={() => goToPly(shownPly - 1)} title={t('Back')}>
              <ChevronLeft className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly(shownPly + 1)} title={t('Forward')}>
              <ChevronRight className="size-[1.1rem]" />
            </Button>
            <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly(plies)} title={t('Go to the end')}>
              <ChevronLast className="size-[1.1rem]" />
            </Button>
          </div>
        )}
      </MobileActionBar>
    </div>
  );
}
