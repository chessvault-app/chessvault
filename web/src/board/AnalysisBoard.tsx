import {
  BookOpen,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  FlipVertical2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import { getNode, legalDests, moveSquares, pathTo, positionAt } from '@shared/tree';
import { BOARD_MAX_W } from '@/board/boardSize';
import { BOARD_WIDE_COLUMN } from '@/components/layout';
import { publishBoardHeight } from './boardBlock.ts';
import { playSound, soundForSan } from '@/board/sound';
import { SquareBadge } from '@/board/square-overlay';
import { cn } from '@/lib/utils';
import { ClearButton } from '@/components/clear-button';
import { noAutofill, noAutofillClass } from '@/components/ui/input';
import { Board } from '@/board/Board';
import { HeatMapOverlay } from '@/board/HeatMapOverlay';
import { PromotionPicker } from '@/board/PromotionPicker';
import { fromDrawShapes, toDrawShapes } from '@/board/shapes';
import { BoardLane, EvalBar, EvalBarRow, EvalBarSlot } from '@/engine/EvalBar';
import { toWhitePov } from '@/engine/uci';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useReview } from '@/store/review';
import { useBookTags } from '@/lib/opening';
import { Button } from '@/components/ui/button';
import { SideDot } from '@/components/side-dot';
import { dialogOpen } from '@/hooks/dialog-focus';
import { t } from '@/lib/i18n';

/**
 * The complete board column driven by the analysis store: eval bar, board with
 * user shapes + engine arrow, promotion picker, navigation controls. Analysis
 * and Studies render exactly this; they differ only in their side columns.
 */
export function AnalysisBoard({
  editablePlayers = false,
  drawShapes = true,
  strip = true,
  verticalKeys = true,
  alignPlayersTo = 'board',
}: {
  /**
   * What the top player bar lines up with. The board pages keep
   * 'board': a fixed h-10 strip, items-end, the name hugging the board
   * it belongs to, while the side column's own title band answers the
   * strip's height. The workspace passes 'panels': its neighbours are
   * panels starting at the row's very top, so the whole column stack —
   * bar, board, bar — top-aligns with them instead: the strip drops
   * its reserve and sits at its natural height on the row's first
   * line, which also makes the gap above the board equal the gap
   * below it (centring the bar in the fixed strip was tried and
   * rejected — it put 14px over the board against 8 under, and the
   * three pieces read as three misaligned things; lanph3re's call).
   * The freed reserve goes to the board through the host's budget.
   */
  alignPlayersTo?: 'board' | 'panels';
  /**
   * ↑/↓ as go-to-start / go-to-end. Off for a host that shares the
   * window's keyboard with a games table (the workspace), where the
   * vertical arrows browse rows through useTableNav and both listeners
   * firing at once stepped the list AND threw the board to an end —
   * Home and End still jump the board there, so nothing is lost, and
   * the split reads as a grammar: horizontal arrows walk the moves,
   * vertical arrows walk the games. Opt-in from the caller; every
   * full-page board keeps the default.
   */
  verticalKeys?: boolean;
  editablePlayers?: boolean;
  /**
   * The fixed-height strip over the board at `wide`, where a game's player
   * bar sits. Held open even when empty so the board top stays put as a
   * game loads — except where the page has a band of its own in that
   * slot and never a game (the book reader), which passes false.
   */
  strip?: boolean;
  /**
   * Whether arrows and circles drawn on the board are kept.
   *
   * This was `locked`, and it did two jobs: no legal moves, and no
   * shapes. The first is gone — a document is only pending until it is
   * saved, so pushing a piece around while reading costs nothing and a
   * board that refuses is a board that lies about what it will accept.
   * Drawing stays a tool, offered while annotating, because an arrow is
   * something you leave for a reader rather than something you try out.
   */
  drawShapes?: boolean;
} = {}) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const orientation = useAnalysis((s) => s.orientation);
  const pendingPromotion = useAnalysis((s) => s.pendingPromotion);

  const playMove = useAnalysis((s) => s.playMove);
  const completePromotion = useAnalysis((s) => s.completePromotion);
  const cancelPromotion = useAnalysis((s) => s.cancelPromotion);
  const setShapes = useAnalysis((s) => s.setShapes);

  const node = getNode(tree, cursorId);
  // Position replay is the expensive part of a render — memoized so engine
  // ticks and hover state don't replay the game. It no longer has a
  // reading mode to skip: every board here accepts moves, so the legal
  // ones are always needed. Same memo keys, so the work per cursor move
  // is unchanged; there is simply no longer a case that skips it.
  const pos = useMemo(() => positionAt(tree, cursorId), [tree, cursorId]);
  const dests = useMemo(() => legalDests(tree, cursorId), [tree, cursorId]);
  const isCheck = pos.isCheck();
  const headers = useAnalysis((s) => s.gameHeaders);
  const hasGame = headers !== null;
  // Whether the bars would actually SAY anything: a loaded game can carry
  // headers with no names ("?" is PGN's own unknown), and the Board tab's
  // editable fields are empty until someone types. On a phone those are
  // two rows of placeholder either side of the board, and the panels
  // below have better uses for them — so stacked shows the bars only for
  // real names, while wide keeps its fixed strip and the editable fields.
  const named = (v: string | undefined): boolean => !!v && v !== '?';
  const hasNames = named(headers?.White) || named(headers?.Black);

  // Board props are memoized on their VALUES: this component re-renders on
  // every engine info line, and a fresh array/Map each time made chessground
  // re-run set()/setShapes()/setAutoShapes() — three full board redraws per
  // tick for a position that never changed.
  // moveSquares, not a plain slice: castling highlights the king's real
  // destination (lichess-style), not the rook square its uci encodes.
  const lastMove = useMemo(
    () => moveSquares(node),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values the helper reads
    [node.uci, node.san],
  );
  const shapes = useMemo(() => toDrawShapes(node.shapes), [node.shapes]);

  // Whether the move on screen is book — from the opening catalogue, on
  // any branch, so the badge follows the cursor into variations; deferred
  // until a review has run, like the move list's tags. The walk inside is
  // memoized on the tree; engine ticks don't re-run it.
  const reviewed = useReview((s) => s.points !== null);
  const bookMove = useBookTags(tree, reviewed).has(cursorId);

  const engineOn = useEngine((s) => s.enabled);
  const engineLines = useEngine((s) => s.lines);
  const engineFen = useEngine((s) => s.resultFen);

  // Only trust engine output that belongs to the position on screen, otherwise
  // a late message paints the previous position's arrow and eval.
  const engineFresh = engineOn && engineFen === node.fen;
  const topLine = engineFresh ? engineLines[0] : undefined;
  const turn: 'white' | 'black' = node.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const evalScore = topLine ? toWhitePov({ cp: topLine.cp, mate: topLine.mate }, turn) : null;

  // Keyed on the best move STRING: topLine.moves is a fresh array per info
  // line, so an identity-keyed memo never hit.
  const best = topLine?.moves[0];
  const engineArrow = useMemo((): DrawShape[] => {
    if (!best || best.length < 4) return [];
    // An auto-shape, so drawing your own arrows never clobbers it.
    return [{ orig: best.slice(0, 2) as Key, dest: best.slice(2, 4) as Key, brush: 'blue' }];
  }, [best]);

  // Every rendered move sounds — played AND replayed — like lichess. The
  // ref skips the mount so opening a study mid-game stays quiet.
  //
  // Arriving at the ROOT is silent, and deliberately: `node.san` is what
  // says so, since the root is the only node without one. It does not
  // read as an oversight — a piece visibly moves on the board and nothing
  // sounds — so it was once "fixed", and lichess is the reference here
  // too: going back to the starting position is silent there as well.
  // A move sounds; the absence of a move does not.
  const lastCursor = useRef<string | null>(null);
  useEffect(() => {
    if (lastCursor.current !== null && lastCursor.current !== cursorId && node.san) {
      playSound(soundForSan(node.san));
    }
    lastCursor.current = cursorId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId]);

  // Mouse wheel over the board steps through the game. Registered manually:
  // React's synthetic wheel listener is passive, so it cannot stop the page
  // from scrolling underneath.
  const boardColumn = useRef<HTMLDivElement>(null);
  const goBack = useAnalysis((s) => s.goBack);
  const goForward = useAnalysis((s) => s.goForward);
  const goToStart = useAnalysis((s) => s.goToStart);
  const goToEnd = useAnalysis((s) => s.goToEnd);
  const flip = useAnalysis((s) => s.flip);

  // Arrow keys drive the board from anywhere except a text field — owned
  // HERE, beside the wheel, and not by BoardControls. The listener used
  // to live on the nav row with a keyboard flag ("exactly one rendered
  // instance may own it"), and the one instance that owned it was the
  // row under the board — which the nav-consolidation pass then stopped
  // rendering wherever the moves panel shows its own row, so every
  // desktop layout was left with five copies and no
  // owner (lanph3re's report: arrows dead across the board pages). A
  // page's board is mounted exactly once, which is what the flag was
  // trying to say.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // An open window owns the keyboard. This listens on the window and
      // cannot see a scrim: arrows were stepping the game behind an open
      // dialog while its own list wanted them.
      if (dialogOpen()) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          goBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goForward();
          break;
        case 'ArrowUp':
          if (!verticalKeys) break;
          e.preventDefault();
          goToStart();
          break;
        case 'Home':
          e.preventDefault();
          goToStart();
          break;
        case 'ArrowDown':
          if (!verticalKeys) break;
          e.preventDefault();
          goToEnd();
          break;
        case 'End':
          e.preventDefault();
          goToEnd();
          break;
        case 'f':
          // Bare `f` only: Ctrl+F is the browser's find, and flipping the
          // board underneath it turned a search into a surprise.
          if (e.ctrlKey || e.metaKey || e.altKey) break;
          flip();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goBack, goForward, goToStart, goToEnd, flip, verticalKeys]);
  useEffect(() => {
    const el = boardColumn.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      // Accumulate so trackpads (many tiny deltas) step at a sane rate.
      acc += e.deltaY;
      if (acc > 24) {
        goForward();
        acc = 0;
      } else if (acc < -24) {
        goBack();
        acc = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [goBack, goForward]);

  return (
    // Top-anchored, not centred: the board must sit at the same y in every
    // view regardless of what each stacks below it. The above-centre
    // placement this produces is also deliberate in itself — see the
    // optical-centre note on BOARD_WIDE_COLUMN in components/layout.ts.
    <div
      ref={boardColumn}
      className={BOARD_WIDE_COLUMN}
    >
      {/* Bounded by the shared budget so the board is the same size in every
          view — see boardSize.ts. */}
      <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', BOARD_MAX_W)}>
        {/* Fixed-height strip, matching the editor's palette strip: the board
            top stays put whether or not a player bar is shown. On phones the
            strip only exists when there is a player bar to show. */}
        {/* Stacked, the bar goes here — in the row the name above the board
            occupies, and instead of it. See EvalBarRow. */}
        <EvalBarRow fen={node.fen} />
        {(strip || hasGame || editablePlayers) && (
          <div
            className={cn(
              // See alignPlayersTo — wide only; stacked keeps the bar on
              // the board it sits directly above.
              alignPlayersTo === 'panels'
                ? 'w-full items-start wide:flex wide:h-auto'
                : 'w-full items-end wide:flex wide:h-10',
              hasNames ? 'flex' : 'hidden wide:flex',
              // The names go when the bar takes their row, and come back
              // where it does not: at `roomy` the bar is beside the board,
              // so the row is the names' again. `roomy` is declared after
              // `stacked` in index.css, which is what makes this win.
              engineOn && 'stacked:hidden',
              engineOn && hasNames && 'roomy:flex',
            )}
          >
            <BoardLane>
              <PlayerBar
                side={orientation === 'white' ? 'black' : 'white'}
                editable={editablePlayers}
              />
            </BoardLane>
          </div>
        )}
        <div className="flex w-full items-stretch gap-2">
          {/* The eval bar sits beside the board in every layout (lanph3re's
              call): on phones it costs a sliver of board width but stays a
              persistent eval readout even when the Engine tab isn't open. */}
          {/* Beside the board at `wide` and `roomy` — see EvalBarSlot. The bar
              is drawn when the engine is on and its width held open when it
              is not: rendered conditionally, it took the row's gap-2 with it
              when it went, so switching the engine on stole 20px from the
              board and stepped the whole thing sideways under the thumb. */}
          {engineOn ? (
            <EvalBar score={evalScore} className="hidden shrink-0 wide:block roomy:block" />
          ) : (
            <EvalBarSlot />
          )}
          <div className="relative min-w-0 flex-1">
            <Board
              fen={node.fen}
              orientation={orientation}
              dests={dests}
              lastMove={lastMove}
              check={isCheck}
              shapes={shapes}
              autoShapes={engineArrow}
              onMove={playMove}
              onShapesChange={drawShapes ? (next) => setShapes(cursorId, fromDrawShapes(next)) : undefined}
            />
            {pendingPromotion && (
              <PromotionPicker
                color={pendingPromotion.color}
                dest={pendingPromotion.dest}
                orientation={orientation}
                onSelect={completePromotion}
                onCancel={cancelPromotion}
              />
            )}
            <HeatMapOverlay fen={node.fen} orientation={orientation} />
            <NagBadge node={node} orientation={orientation} book={bookMove} />
          </div>
        </div>
        {/* The name under the board goes when the one above it does, and the
            panels below get the row back — a phone has better uses for it
            than two placeholders either side of an engine's opinion. */}
        <BoardLane
          className={cn(
            (engineOn || !hasNames) && 'stacked:hidden',
            hasNames && 'roomy:flex',
          )}
        >
          <PlayerBar side={orientation} editable={editablePlayers} />
        </BoardLane>
      </div>
      {/* No navigation row here. It used to be drawn under the board for
          the one layout that had nowhere else to put it — a tablet upright,
          where the phone's bottom bar is gone and the moves panel may be
          behind another tab — and it moved as the tab changed: at the
          panel's floor on Moves, under the board on Engine or Explorer. It
          lives at the foot of every pane now (PaneControls), so it is in
          one place whatever is open (lanph3re's call). */}
    </div>
  );
}

/** Move-quality NAGs drawn on the board, coloured via the --nag-* tokens. */
const BOARD_NAGS: Record<number, { glyph: string; className: string }> = {
  1: { glyph: '!', className: 'bg-nag-good' },
  2: { glyph: '?', className: 'bg-nag-mistake' },
  3: { glyph: '!!', className: 'bg-nag-brilliant' },
  4: { glyph: '??', className: 'bg-nag-blunder' },
  5: { glyph: '!?', className: 'bg-nag-interesting' },
  6: { glyph: '?!', className: 'bg-nag-dubious' },
};

/**
 * Badge pinned to the destination square's top-right corner when the move on
 * screen carries a quality NAG — the annotation is visible on the board
 * itself, not only in the move list. A book move (review state, never a
 * tree NAG) wears the open book instead; an explicit NAG outranks it.
 */
function NagBadge({
  node,
  orientation,
  book = false,
}: {
  node: { uci?: string; san?: string; nags: number[] };
  orientation: 'white' | 'black';
  book?: boolean;
}) {
  const nag = node.nags.find((n) => BOARD_NAGS[n]);
  const dest = moveSquares(node)?.[1];
  if ((!nag && !book) || !dest) return null;
  const badge = nag ? BOARD_NAGS[nag]! : { glyph: null, className: 'bg-nag-book' };

  return (
    <SquareBadge square={dest} orientation={orientation} className={badge.className}>
      {badge.glyph ?? <BookOpen className="size-3.5" />}
    </SquareBadge>
  );
}

/** "0:09:58.1" style seconds → "9:58"; hours only when they exist. */
function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The editable player name, styled bare over the board rather than as an
 * Input, with the app's usual clear affordance: an X while the field is
 * focused and holds text (components/text-fields' ClearableInput carries the same
 * rules, but its bordered chrome has no place on a name plate). Controlled
 * so the X is one state write; the caller's `key` resets it when a loaded
 * game brings its own names.
 */
function NameField({
  initial,
  placeholder,
  onCommit,
}: {
  initial: string;
  placeholder: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [focused, setFocused] = useState(false);
  const showClear = focused && draft !== '';
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      <input
        {...noAutofill}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          setFocused(false);
          onCommit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className={cn(
          // No outline-none: this is a bare input with no border to tint,
          // so the global :focus-visible ring is the only sign the name is
          // being edited. rounded-md gives that ring Input's own corners.
          'text-foreground placeholder:text-muted-foreground w-full min-w-0 truncate rounded-md bg-transparent text-base font-medium',
          showClear && 'pr-6',
          noAutofillClass,
        )}
      />
      {showClear && <ClearButton className="right-0" onClear={() => setDraft('')} />}
    </span>
  );
}

/**
 * Name plate for one side of a loaded game: player, rating, and the clock as
 * it stood at the current move (from the [%clk] comments chess.com and
 * lichess write). Renders nothing for scratch analysis.
 */
function PlayerBar({
  side,
  editable = false,
  className,
}: {
  side: 'white' | 'black';
  editable?: boolean;
  className?: string;
}) {
  const headers = useAnalysis((s) => s.gameHeaders);
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);

  // The side's clock after its most recent move at or before the cursor.
  // Memoized: this bar re-renders with AnalysisBoard on every engine info
  // line, and the scan walks every ancestor of the cursor. Declared BEFORE
  // the early return below — hooks must run in the same order every render.
  const clock = useMemo(() => {
    let found: number | undefined;
    for (const id of pathTo(tree, cursorId)) {
      const n = getNode(tree, id);
      // Odd plies are White's moves.
      if (n.clock !== undefined && (n.ply % 2 === 1) === (side === 'white')) found = n.clock;
    }
    return found;
  }, [tree, cursorId, side]);

  if (!headers && !editable) return null;

  const name = headers?.[side === 'white' ? 'White' : 'Black'] ?? '?';
  // Editable placeholders (the Board tab): typed names live in the same
  // gameHeaders the loaded games use, so PGN export picks them up.
  const setName = (value: string): void => {
    const key = side === 'white' ? 'White' : 'Black';
    const next = { ...(useAnalysis.getState().gameHeaders ?? {}) };
    const v = value.trim();
    if (v) next[key] = v;
    else delete next[key];
    useAnalysis.setState({ gameHeaders: Object.keys(next).length > 0 ? next : null });
  };
  const elo = headers?.[side === 'white' ? 'WhiteElo' : 'BlackElo'];

  const turn = getNode(tree, cursorId).fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const toMove = turn === side;

  return (
    // `board-box`, and no padding of its own: inside a BoardLane this row is
    // the board's own rectangle, so the swatch starts where the a-file does
    // and the clock ends where the h-file does. A w-* utility here would
    // beat the class (utilities layer over components) and hand back the
    // couple of pixels it exists to remove.
    <div className={cn('board-box flex h-6 items-center gap-2', className)}>
      <SideDot side={side} />
      {editable ? (
        <NameField
          key={name}
          initial={name === '?' ? '' : name}
          placeholder={side === 'white' ? t('White') : t('Black')}
          onCommit={setName}
        />
      ) : (
        <span className="text-foreground min-w-0 truncate text-base font-medium">{name}</span>
      )}
      {elo && <span className="text-muted-foreground font-mono text-sm">{elo}</span>}
      {clock !== undefined && (
        <span
          className={cn(
            'ml-auto rounded-sm px-1.5 py-0.5 font-mono text-sm tabular-nums',
            toMove ? 'bg-muted text-primary font-semibold' : 'text-muted-foreground',
          )}
        >
          {formatClock(clock)}
        </span>
      )}
    </div>
  );
}

/**
 * Hold a step button to keep stepping.
 *
 * A keyboard repeats ← and → on its own; a finger had to tap once per
 * ply, which is the wrong amount of work for walking through a game on a
 * phone. Starts after a pause long enough that an ordinary tap is never
 * a repeat, then accelerates to a readable pace.
 *
 * The click handler still fires for the tap itself, so this only ever
 * ADDS the repeats: `onClick` moves one, the timer moves the rest.
 *
 * A HOOK, and the timers live in a ref, because the previous version was
 * a plain function called during render — so every re-render built a new
 * pair of handlers over a NEW, empty pair of timer variables. Releasing
 * the button then ran the newest `stop`, which had nothing to stop,
 * while the interval an earlier render had started ran on untouched. The
 * board walked the game by itself until the page was left.
 *
 * It needed a re-render between press and release to happen, and this
 * component gets them constantly: it is redrawn on every evaluation the
 * engine reports. lanph3re found it on an iPad, where a press is
 * naturally long enough to arm the repeat — but nothing about it was
 * ever iPad-specific, and even a plain tap armed the 400ms timer that
 * the same bug then failed to cancel.
 */
function useRepeat(step: () => void): {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
} {
  // Read through a ref so the handlers can stay stable while `step` — a
  // store action, but not guaranteed to be — is free to change.
  const latest = useRef(step);
  latest.current = step;
  const timers = useRef<{
    delay: ReturnType<typeof setTimeout> | null;
    tick: ReturnType<typeof setInterval> | null;
  }>({ delay: null, tick: null });

  const handlers = useMemo(() => {
    const stop = (): void => {
      const t = timers.current;
      if (t.delay) clearTimeout(t.delay);
      if (t.tick) clearInterval(t.tick);
      t.delay = t.tick = null;
    };
    return {
      onPointerDown: () => {
        stop();
        timers.current.delay = setTimeout(() => {
          timers.current.tick = setInterval(() => latest.current(), 90);
        }, 400);
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
    };
  }, []);

  // Navigating away mid-press must not leave a timer stepping a board
  // that is not on screen any more.
  useEffect(() => handlers.onPointerCancel, [handlers]);

  return handlers;
}

/**
 * The same strip at the foot of a PANE, which is where it lives on every
 * board page: sat on the panel's own floor, with the card's bottom padding
 * taken back so the border it draws IS the panel's bottom edge.
 *
 * Every pane wears one — moves, engine, explorer, chapters, a trainer's
 * puzzle panel — because a pane is what a stacked layout shows one of at a
 * time, and a control that is only under one of them moves when the tab
 * does.
 *
 * `max-md:hidden`, always: a phone has the contextual bottom bar
 * (MobileActionBar) and two rows of the same four arrows is one row of
 * wasted screen. Panes that are DOCKED rather than tabbed at `lg` — the
 * explorer, a study's chapters, which stand in the column beside the moves
 * panel and its strip — add `lg:hidden` themselves, or the page grows a
 * second copy on a desktop.
 */
export function PaneControls({ className }: { className?: string }) {
  return (
    <BoardControls
      className={cn('border-border -mb-(--card-spacing) border-t max-md:hidden', className)}
    />
  );
}

/**
 * The move-navigation row: a purely visual control strip. The arrow-key
 * listener lives on AnalysisBoard (see the note there) — it used to be
 * here behind a `keyboard` flag, and the one instance allowed to keep it
 * stopped being rendered on desktop layouts, which is how every board
 * page lost its arrows at once.
 */
export function BoardControls({ className }: { className?: string }) {
  const goToStart = useAnalysis((s) => s.goToStart);
  const goBack = useAnalysis((s) => s.goBack);
  const goForward = useAnalysis((s) => s.goForward);
  const goToEnd = useAnalysis((s) => s.goToEnd);
  const flip = useAnalysis((s) => s.flip);
  // Hooks, so they must be here rather than spread inline in the JSX —
  // which is what let the old version lose its timers on every render.
  const repeatBack = useRepeat(goBack);
  const repeatForward = useRepeat(goForward);

  return (
    <div className={cn('flex w-full shrink-0 items-center justify-center gap-1 py-1', className)}>
      <Button variant="ghost" size="icon" onClick={goToStart} title={t('Start (↑)')}>
        <ChevronFirst className="size-[1.1rem]" />
      </Button>
      <Button variant="ghost" size="icon" onClick={goBack} title={t('Back (←)')} {...repeatBack}>
        <ChevronLeft className="size-[1.1rem]" />
      </Button>
      <Button variant="ghost" size="icon" onClick={goForward} title={t('Forward (→)')} {...repeatForward}>
        <ChevronRight className="size-[1.1rem]" />
      </Button>
      <Button variant="ghost" size="icon" onClick={goToEnd} title={t('End (↓)')}>
        <ChevronLast className="size-[1.1rem]" />
      </Button>
      <div className="bg-border mx-1 h-5 w-px" />
      <Button variant="ghost" size="icon" onClick={flip} title={t('Flip board (f)')}>
        <FlipVertical2 className="size-[1.1rem]" />
      </Button>
    </div>
  );
}
