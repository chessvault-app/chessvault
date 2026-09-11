import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Crown,
  FlipVertical2,
  RotateCcw,
  RotateCw,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Color } from 'chessops/types';
import { roleToChar } from 'chessops/util';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { Board, boardAnimMs } from '@/board/Board';
import { playSound } from '@/board/sound';
import { PromotionPicker } from '@/board/PromotionPicker';
import { usePromotion } from '@/board/usePromotion';
import { SquareBadge } from '@/board/square-overlay';
import { EvalBarSlot } from '@/engine/EvalBar';
import { api, ApiError, apiErrorMessage } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { useWideLayout } from '@/lib/media';
import { navigate } from '@/lib/router';
import { announce } from '@/lib/announce';
import { cn } from '@/lib/utils';
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
import { outcomeTone } from './outcome';
import {
  CUSTOM_CLASS,
  DRILL_PRESETS,
  afterMove,
  classLabel,
  positionOf,
  readCustomDraft,
  specFor,
  squaresOf,
  writeCustomDraft,
  type DrillPosition,
} from './drill';

/**
 * The endgame drill: a won ending drawn at random, played out against
 * the tablebase's best defence, under Puzzles beside the trainer.
 *
 * Two pages. `#/puzzles/endgames` is the class picker, a list of the
 * material presets the games hunt already knows with how each has gone;
 * `#/puzzles/endgames/<class>` is the drill itself, the trainer's shape
 * (board column, one panel, the phone's bottom bar stepping through the
 * moves) with one difference in what it says: there is no answer to
 * find, only a win to keep. The verdict on every move is the server's
 * (server/endgameDrill.ts), which asks the tablebase; the page never
 * grades anything itself.
 */

export function EndgameDrillPage({ params }: { params: string[] }) {
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
        back={() => navigate('puzzles', 'hub')}
        description={t(
          'Play the winning side of a random ending against the tablebase. A move that lets the win slip ends the attempt and shows the move that kept it.',
        )}
      />
      <div className="bg-card overflow-hidden rounded-xl ring-1 ring-card-ring">
        {rows.map((id) => {
          return (
            <ListRow
              key={id}
              divided
              onClick={() => {
                // The custom class opens its editor first: a drill of
                // nothing in particular is not a drill.
                if (id === CUSTOM_CLASS) setEditing(true);
                else navigate('puzzles', 'endgames', id);
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
          );
        })}
      </div>
      {editing && (
        <CustomMaterialWindow
          initial={readCustomDraft()}
          onApply={(draft) => {
            writeCustomDraft(draft);
            setEditing(false);
            navigate('puzzles', 'endgames', CUSTOM_CLASS);
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
  | 'error';

/** One ply of the line, as the board shows it afterwards. */
interface Step {
  fen: string;
  san: string;
  lastMove: [string, string];
}

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

function Drill({ classId }: { classId: string }) {
  const [start, setStart] = useState<{ fen: string; side: Color } | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<{ message: string; settings: boolean } | null>(null);
  /** The move that would have kept it, once one has been thrown. */
  const [best, setBest] = useState<{ uci: string; san: string } | null>(null);
  /** Mate distance in plies for the position now faced, where the
      table knows one. A distance, never a score. */
  const [dtm, setDtm] = useState<number | null>(null);
  // Reviewing an earlier ply (null = live), via the bottom bar.
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
    setSteps([]);
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
    setSteps([]);
    setBest(null);
    setReview(null);
    setPhase('playing');
  };

  const live: DrillPosition | null = (() => {
    if (!start) return null;
    const last = steps[steps.length - 1];
    return last ? positionOf(last.fen, last.lastMove) : positionOf(start.fen);
  })();
  const displayed: DrillPosition | null =
    review !== null && start
      ? review === 0
        ? positionOf(start.fen)
        : positionOf(steps[review - 1]!.fen, steps[review - 1]!.lastMove)
      : live;
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
    // A won or thrown move is the line's last, and the server's FEN is
    // the position it leaves; a held move is followed by the reply, so
    // the server's FEN is the position after BOTH and the one in between
    // is rebuilt from the move itself, for the bottom bar's walk.
    const ownFen = verdict.verdict === 'held' ? (afterMove(live.fen, uci) ?? verdict.fen) : verdict.fen;
    const own: Step = { fen: ownFen, san: verdict.san, lastMove: squaresOf(uci) };
    setSteps((s) => [...s, own]);
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
      setSteps((s) => [...s, { fen: verdict.fen, san: reply.san, lastMove: squaresOf(reply.uci) }]);
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
  useEffect(() => setReview(null), [steps.length, phase]);

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
    const clamped = Math.max(0, Math.min(target, steps.length));
    setReview(clamped >= steps.length ? null : clamped);
  };

  const label = t(classLabel(classId));
  const title = t('Endgame drill');
  const ended = phase === 'won' || phase === 'threw';
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
            ? t('{san} lets the win slip. {best} keeps it.', {
                san: steps[steps.length - 1]?.san ?? '',
                best: best.san,
              })
            : t('The win slipped'),
          tone: outcomeTone('missed'),
        };
      case 'error':
        // The board's own box carries the sentence; the panel keeps
        // the actions, so it is not said twice on one screen.
        return { text: '' };
    }
  };
  const line = status();

  const panel = (
    <Panel>
      <PanelHeader
        title={title}
        actions={
          <span className="text-muted-foreground truncate text-xs">{label}</span>
        }
      />
      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-(--card-spacing)">
        <div className="flex flex-col gap-0.5">
          {start && phase !== 'loading' ? (
            <p className="text-foreground text-2xl font-bold tracking-tight">
              {solverSide === 'white' ? t('You play White') : t('You play Black')}
            </p>
          ) : phase === 'loading' ? (
            <div className="flex h-8 items-center">
              <Skeleton className="h-4 w-28" />
            </div>
          ) : null}
          <p className={cn('text-sm leading-relaxed', line.tone ?? 'text-muted-foreground')}>
            {line.text}
          </p>
          {/* A distance the small tables know, said as a fact about the
              position rather than a hint about the move: it tells the
              solver the win is getting closer or is not. */}
          {dtm !== null && (phase === 'playing' || phase === 'replying') && (
            <p className="text-muted-foreground text-xs">
              {t('Mate in {n}', { n: Math.ceil(dtm / 2) })}
            </p>
          )}
        </div>

        {/* The line so far, in the moves face. Numbered from the side
            that started, so a drill Black begins reads "1... Kd4"; the
            numbers sit outside the buttons, since a space inside one is
            whitespace a button collapses. */}
        {steps.length > 0 && (
          <p className="font-moves text-foreground flex flex-wrap items-baseline gap-x-1 gap-y-0.5 text-sm leading-relaxed">
            {steps.map((step, i) => {
              const ply = i + (solverSide === 'black' ? 1 : 0);
              const number = Math.floor(ply / 2) + 1;
              const prefix = ply % 2 === 0 ? `${number}.` : i === 0 ? `${number}...` : null;
              return (
                <span key={i} className="flex items-baseline gap-x-1">
                  {prefix && <span className="text-muted-foreground">{prefix}</span>}
                  <button
                    type="button"
                    className={cn(
                      'rounded-sm px-1 py-0.5 transition-colors duration-100 hover:bg-accent',
                      (review ?? steps.length) === i + 1 && 'bg-accent',
                    )}
                    onClick={() => goToPly(i + 1)}
                  >
                    {step.san}
                  </button>
                </span>
              );
            })}
          </p>
        )}

        <CardFooter className="-mx-(--card-spacing) mt-auto flex-wrap justify-end gap-2">
          {phase === 'error' ? (
            <>
              {error?.settings && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="me-auto"
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
            </>
          ) : ended ? (
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
          onClick={() => navigate('puzzles', 'endgames')}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <h1 className="text-foreground text-base font-semibold">{title}</h1>
      </div>
      <div className={BOARD_WIDE_COLUMN}>
        <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
          <div className="hidden w-full items-end wide:flex wide:h-10" />
          {/* The eval bar's lane, held open as the trainer holds it, so
              this board sits where that one does. */}
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
                <div className="bg-card grid aspect-square w-full place-items-center rounded-xl ring-1 ring-card-ring">
                  <div className="flex max-w-[80%] flex-col items-center gap-3 text-center">
                    <p className="text-muted-foreground text-sm" role="alert">
                      {error?.message}
                    </p>
                    {/* The way out is on the panel's footer, where every
                        other action on this page is; the box only says
                        what happened. */}
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

      <div
        className={`flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2 ${BOARD_WIDE_SIDE}`}
      >
        <div className="hidden h-9 shrink-0 items-center gap-2 pr-[13px] wide:flex">
          <h1 className="text-foreground text-base font-semibold">{title}</h1>
          <span className="min-w-0 flex-1" />
          {wide && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('puzzles', 'endgames')}
            >
              <ChevronLeft className="size-3.5" data-icon="inline-start" />
              {t('All endings')}
            </Button>
          )}
        </div>
        {panel}
      </div>

      <MobileActionBar>
        <div className="flex flex-1 items-center justify-center gap-1 py-1.5">
          <Button variant="ghost" size="icon" disabled={steps.length === 0} onClick={() => goToPly(0)} title={t('First move')}>
            <ChevronFirst className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={steps.length === 0} onClick={() => goToPly((review ?? steps.length) - 1)} title={t('Back')}>
            <ChevronLeft className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly((review ?? steps.length) + 1)} title={t('Forward')}>
            <ChevronRight className="size-[1.1rem]" />
          </Button>
          <Button variant="ghost" size="icon" disabled={review === null} onClick={() => goToPly(steps.length)} title={t('Go to the end')}>
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
