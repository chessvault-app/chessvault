import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Crown,
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
import { Board, boardAnimMs } from '@/board/Board';
import { MoveBox } from '@/board/MoveBox';
import { useMoveSound } from '@/board/useMoveSound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';
import { SquareBadge } from '@/board/square-overlay';
import { useAnalyseInPlace } from '@/hooks/use-analyse-in-place';
import { addMove, createTree, getNode, mainlineFrom } from '@shared/tree';
import type { MoveTree, NodeId } from '@shared/types';
import { AnalysisMovesPanel } from '@/analysis/AnalysisMovesPanel';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { useWideLayout } from '@/lib/media';
import { navigate } from '@/lib/router';
import { announce } from '@/lib/announce';
import { cn } from '@/lib/utils';
import { BOARD_HELD_SHELL, BOARD_WIDE_SIDE } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { CardFooter } from '@/components/ui/card';
import { ListRow } from '@/components/list-row';
import { PageHeader } from '@/components/page-header';
import { TrainerBoard, TrainerNavBar, TrainerPanes } from '@/components/trainer-shell';
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
 * part that is not the puzzle, built from the same shell the other
 * trainers share (components/trainer-shell, hooks/use-analyse-in-place):
 * the board column, the Moves panel with its typed move box, the pane
 * strip and swipe on a phone, the in-place analysis board and engine
 * once the attempt is over, the bottom bar. What differs: there
 * is no answer to find, only a win to keep, and the verdict on every
 * move is the server's (server/endgameDrill.ts), which asks the
 * tablebase; the page grades nothing itself.
 */

/** Where the picker lives, and where the drill goes back to: a section
    of its own, listed under Tools. */
const PICKER = ['endgames'] as const;
/** The line the drill settles on; the wait reserves its height. */
const PLAYING_NOTE = 'Keep the win. A move the tablebase calls a draw or a loss ends the attempt.';

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
  // By family, in the order the presets first name each one, with the
  // custom class last on its own: twenty-odd rows read top to bottom
  // were one list of names, and a list this long is scanned by section.
  const groups = new Map<string, string[]>();
  for (const p of DRILL_PRESETS) groups.set(p.group, [...(groups.get(p.group) ?? []), p.id]);
  groups.set('Your own', [CUSTOM_CLASS]);

  return (
    <PageShell width="medium">
      <PageHeader
        title={t('Endgame drills')}
        back={() => navigate('more')}
        description={t(
          'Play the winning side of a random ending against the tablebase. A move that lets the win slip ends the attempt and shows the move that kept it.',
        )}
      />
      {[...groups].map(([group, rows]) => (
        <section key={group} className="flex flex-col gap-2">
          {/* The count row's voice: the same one a panel's title and a
              group of settings are named in. */}
          <h2 className="text-muted-foreground text-sm font-medium">{t(group)}</h2>
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
        </section>
      ))}
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
    setReview(null);
    setFlipped(false);
    setError(null);
    if (!spec) {
      setError({ message: t('Pick at least one count, or every game matches.'), settings: false });
      setPhase('error');
      return;
    }
    try {
      const body = await api<{ fen: string; side: Color }>(
        `/api/endgames/draw?spec=${encodeURIComponent(spec)}`,
      );
      if (mine !== seq.current) return;
      setStart({ fen: body.fen, side: body.side });
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

  useMoveSound(displayed?.fen, Boolean(displayed?.lastMove));

  const goToPly = (target: number): void => {
    const clamped = Math.max(0, Math.min(target, plies));
    setReview(clamped >= plies ? null : clamped);
  };

  const ended = phase === 'won' || phase === 'threw' || phase === 'stopped';
  // In-place analysis once the attempt is over, the trainers' shared
  // hook: the line so far loads into the analysis store and the board
  // becomes the analysis board. A desktop docks the engine only once
  // asked (the header's toggle), as the puzzle trainer does.
  const [engineOpen, setEngineOpen] = useState(false);
  const inPlace = useAnalyseInPlace({
    wide,
    infoLabel: t('Drill'),
    done: ended,
    ready: line !== null,
    seed: () => ({ tree: line!.tree, cursorId: line!.lastId, orientation }),
    engineOn: !wide || engineOpen,
    onLeave: () => setEngineOpen(false),
  });
  const { analysing } = inPlace;

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

  const lastSan = line && plies > 0 ? (getNode(line.tree, lineIds[plies - 1]!).san ?? '') : '';
  const status = (): { text: string; tone?: string } => {
    switch (phase) {
      case 'loading':
        return { text: t('Finding a won ending…') };
      case 'playing':
        return { text: t(PLAYING_NOTE) };
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
      {/* AnswerPanel's own empty shape, which is what lands here: the
          sentence centred in the scroller rather than set left at a
          tighter padding, then the two bands that arrive with the ending
          and used to push the panel's floor down as they did. The move
          box is md-and-up, as MoveBox's own caller is. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <p className="text-muted-foreground px-3 py-6 text-center text-sm">
          {t('Finding a won ending…')}
        </p>
      </div>
      <div className="border-border shrink-0 border-t px-3 py-2 max-md:hidden">
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <div className="border-border flex w-full shrink-0 items-center justify-center gap-1 border-t py-1 max-md:hidden">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="size-7" />
        ))}
      </div>
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
          {phase === 'loading' ? (
            // The same reservation the trainer makes, on the shell it
            // shares: "Keep the win…" wraps to two lines on a phone where
            // "Finding a won ending…" takes one, so the box is the answer's
            // and the waiting line sits over it. Without it the footer's
            // buttons stepped down as the ending arrived.
            <div className="relative">
              <p aria-hidden className="invisible text-sm leading-relaxed">
                {t(PLAYING_NOTE)}
              </p>
              <p className="text-muted-foreground absolute inset-0 text-sm leading-relaxed">
                {statusLine.text}
              </p>
            </div>
          ) : (
            <p className={cn('text-sm leading-relaxed', statusLine.tone ?? 'text-muted-foreground')}>
              {statusLine.text}
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
      <TrainerBoard analysing={analysing}>
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
      </TrainerBoard>

      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 ${BOARD_WIDE_SIDE}`}
        {...inPlace.paneSwipe.column}
      >
        <div className="hidden h-9 shrink-0 items-center gap-2 pr-[13px] wide:flex">
          <h1 className="text-foreground text-base font-semibold">{title}</h1>
        </div>
        <TrainerPanes wide={wide} view={inPlace} moves={movesPanel} info={drillPanel} />
      </div>

      <TrainerNavBar
        analysing={analysing}
        startDisabled={plies === 0}
        forwardDisabled={review === null}
        onFirst={() => goToPly(0)}
        onBack={() => goToPly(shownPly - 1)}
        onForward={() => goToPly(shownPly + 1)}
        onLast={() => goToPly(plies)}
        onFlip={() => setFlipped((f) => !f)}
      />
    </div>
  );
}
