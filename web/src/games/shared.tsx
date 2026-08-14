import {
  ExternalLink,
  Eye,
  MoreHorizontal,
  NotebookPen,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Board } from '@/board/Board';

import { cn } from '@/lib/cn';

import { Button } from '@/ui/Button';

import { SideDot } from '@/ui/SideDot';

import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { SwipeTrack, useSwipeRow } from '@/ui/SwipeRow';

import { PromptSheet } from '@/ui/PromptSheet';

import { t } from '@/lib/i18n';

export interface GameSummary {
  file: string;
  index: number;
  white: string;
  black: string;
  whiteElo: number;
  blackElo: number;
  result: string;
  date: string;
  timeControl: string | null;
  eco: string | null;
  link: string | null;
  opening: { eco: string; name: string } | null;
  finalFen: string | null;
  userSide: 'white' | 'black' | null;
  annotated: boolean;
}

export const gameKey = (g: Pick<GameSummary, 'file' | 'index'>): string => `${g.file}#${g.index}`;

/** Collection file -> document id (the path the studies-style API speaks). */
export const docId = (g: Pick<GameSummary, 'file'>): string =>
  g.file.replace(/^collection\//, '').replace(/\.pgn$/, '');

export const isCoarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/** PGN results with the proper half glyph: 1/2-1/2 → ½-½. */
export const fmtResult = (result: string): string => result.replaceAll('1/2', '½');

export interface Preview {
  fen: string;
  orientation: 'white' | 'black';
  top: number;
  left: number;
  /** Tapped open on a touch device: show a centred overlay with a scrim
      instead of a popover beside the row (which would cover the row). */
  pinned?: boolean;
}

/** The final-position preview. A hover popover on fine pointers; a centred,
    dismissable overlay when tapped open on touch. Shared by both game lists.
    Any click outside the preview dismisses it (in either mode). */
export function GamePreview({ preview, onClose }: { preview: Preview | null; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!preview) return;
    // Capture-phase click: fires BEFORE the game row's own onClick, so a
    // click outside the preview dismisses it AND is swallowed — otherwise
    // the click behind the preview also opened the game.
    const onClick = (e: MouseEvent): void => {
      if (!card.current?.contains(e.target as Node)) {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [preview, onClose]);

  if (!preview) return null;
  if (preview.pinned) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center p-8">
        <div className="bg-scrim absolute inset-0" />
        <div ref={card} className="border-line bg-surface relative w-64 max-w-[80vw] rounded-xl border p-1.5 shadow-[var(--shadow-pop)]">
          <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded-lg" />
        </div>
      </div>
    );
  }
  return (
    <div
      ref={card}
      style={{ top: preview.top, left: preview.left }}
      className="border-line bg-surface pointer-events-none fixed z-50 w-44 rounded-lg border p-1 shadow-[var(--shadow-pop)]"
    >
      <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded" />
    </div>
  );
}

/**
 * chess.com TimeControl headers are raw seconds: "600" (10 min), "180+2"
 * (3 min + 2 s increment), or "1/86400" (daily, one move per N seconds).
 */
export function formatTimeControl(tc: string | null): string | null {
  if (!tc) return null;
  const daily = tc.match(/^1\/(\d+)$/);
  if (daily) {
    const days = Number(daily[1]) / 86_400;
    return days === 1 ? 'daily' : `daily ${days}d`;
  }
  const live = tc.match(/^(\d+)(?:\+(\d+))?$/);
  if (!live) return tc;
  const minutes = Number(live[1]) / 60;
  const base = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
  return live[2] !== undefined ? `${base}+${live[2]}` : `${base} min`;
}

export function GameRow({
  game,
  onOpen,
  onPreview,
  actions,
  customName,
  renaming = false,
  onRename,
  showLink = true,
  onSwipeAway,
  onBookmark,
  bookmarked = false,
  onContext,
  menu,
  standing,
}: {
  game: GameSummary;
  onOpen: () => void;
  onPreview: (preview: Preview | null) => void;
  /**
   * The row's secondary actions, folded into one ⋯.
   *
   * A sheet from the bottom on a phone, a popover under the ⋯ on a
   * desktop — the same ActionSheet the studies and notes shelves use. A
   * phone gets ONLY this: three 36px icon buttons standing permanently at
   * the end of a 390px row left the two player names about half the width
   * they need.
   */
  menu?: SheetAction[];
  /**
   * Controls that belong IN the hover tray — the bookmark star, and the
   * like. They fade in with the eye and the ⋯.
   */
  actions: React.ReactNode;
  /**
   * Controls that must be visible without hovering.
   *
   * The archive's Add button is the point of that list, not a quick
   * action on a row, so it cannot live in a tray that appears under the
   * pointer. It used to be passed as `actions` and therefore shared the
   * tray with the eye — which is why the archive's rows looked like one
   * joined control where the elite list's look like two separate ones.
   */
  standing?: React.ReactNode;
  /** A user-chosen document name (in-game rename), shown instead of the matchup. */
  customName?: string | null;
  renaming?: boolean;
  onRename?: (to: string) => void;
  /** Collection rows fold the external link into their row menu. */
  showLink?: boolean;
  /** Touch: swiping the row's contents left removes it (undoably). */
  onSwipeAway?: () => void;
  /** Touch: swiping right marks it. Omitted where a row cannot be marked. */
  onBookmark?: () => void;
  bookmarked?: boolean;
  /** Desktop: a right-click asks for the row's actions at the pointer. */
  onContext?: (x: number, y: number) => void;
}) {
  // The eye pops the final position. Fine pointers hover a popover beside
  // the row; coarse pointers TAP for a centred overlay (dismissed by its
  // scrim) — a beside-row popover on a phone would cover the row itself.
  const swipe = useSwipeRow({ onRemove: () => onSwipeAway?.(), onBookmark });
  const coarse = isCoarsePointer;
  const row = useRef<HTMLLIElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const showPreviewAt = (rect: DOMRect, viaTap: boolean): void => {
    if (!game.finalFen) return;
    const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
    onPreview({
      fen: game.finalFen,
      orientation: game.userSide ?? 'white',
      top,
      left: Math.max(rect.left - 192, 8),
      pinned: viaTap,
    });
  };
  const showPreview = (e: React.MouseEvent<Element>, viaTap = false): void => {
    if (!game.finalFen) return;
    if (!viaTap && coarse()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const top = Math.min(Math.max(rect.top + rect.height / 2 - 92, 8), innerHeight - 200);
    onPreview({
      fen: game.finalFen,
      orientation: game.userSide ?? 'white',
      top,
      left: Math.max(rect.left - 192, 8),
      pinned: viaTap,
    });
  };

  const hidePreview = (): void => onPreview(null);

  const openingLabel = game.opening
    ? `${game.opening.eco} ${game.opening.name}`
    : (game.eco ?? '');

  return (
    <li
      ref={row}
      onClick={onOpen}
      onContextMenu={
        onContext
          ? (e) => {
              e.preventDefault();
              onContext(e.clientX, e.clientY);
            }
          : undefined
      }
      {...(onSwipeAway ? swipe.handlers : {})}
      // flex-wrap, with a floor under the text: everything to the right of
      // the names — result, eye, Add, ⋯, link — is shrink-0 by necessity,
      // so in a narrow enough box they used to eat the text box down to
      // nothing and then overflow it. Now the text keeps 9rem and the
      // furniture drops to a line of its own instead. It costs a taller
      // row at widths the layout should never reach, which beats a row of
      // numbers printed on top of each other at widths it did.
      className={cn(
        'group hover:bg-surface-2 relative flex cursor-pointer flex-wrap items-center gap-3',
        'overflow-hidden px-3 py-2 transition-colors duration-100',
        // The whole indicator that a game is kept: a warm edge down the
        // left, which costs no width. The lit star that used to stand at
        // the end of the row cost about 36px of two player names on every
        // phone, to say what this says for nothing.
        //
        // Painted, not bordered. `divide-line` on the list sets
        // border-color on every child through `.divide-line > *`, which
        // outranks a plain `border-l-warn` on the row — the edge came out
        // the same grey as the hairlines between rows.
        bookmarked && 'before:bg-warn before:absolute before:inset-y-0 before:left-0 before:w-0.5',
      )}
    >
      {onSwipeAway && <SwipeTrack dx={swipe.dx} bookmarked={bookmarked} />}
      <div className="flex min-w-[8rem] flex-1 items-center gap-3" style={swipe.style}>
        {/* The name is asked for in a sheet, like every other rename; the
            row keeps showing what it is called meanwhile. */}
        {renaming && (
          <PromptSheet
            label={t('Rename this game')}
            initial={customName ?? docId(game)}
            onSubmit={(value) => onRename?.(value)}
            onClose={() => onRename?.('')}
          />
        )}
        <div className="min-w-0 flex-1">
          {customName ? (
            // A renamed game leads with its given name; the matchup joins
            // the detail line so nothing is lost.
            <p className="text-fg truncate text-sm font-semibold">
              {customName}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label={t('Annotated')} />
              )}
            </p>
          ) : (
            // One line per player: names never fight each other for width,
            // so narrow screens truncate each side independently.
            <>
              {/* A flex row, not one inline run: with the rating inline
                  after the name, `truncate` on the line clipped whichever
                  came last — so an archive of long handles showed two
                  names and no ratings at all. The name is the only part
                  that gives way. */}
              <p className="text-fg flex items-baseline gap-1.5 text-sm">
                <SideDot side="white" className="shrink-0 translate-y-[-1px]" />
                <span
                  className={cn(
                    'min-w-0 truncate font-semibold',
                    game.userSide === 'white' && 'text-primary',
                  )}
                >
                  {game.white}
                </span>
                {game.whiteElo ? (
                  <span className="text-subtle shrink-0 text-xs tabular-nums">{game.whiteElo}</span>
                ) : null}
                {game.annotated && (
                  <NotebookPen className="text-info size-3 shrink-0" aria-label={t('Annotated')} />
                )}
              </p>
              <p className="text-fg flex items-baseline gap-1.5 text-sm">
                <SideDot side="black" className="shrink-0 translate-y-[-1px]" />
                <span
                  className={cn(
                    'min-w-0 truncate font-semibold',
                    game.userSide === 'black' && 'text-primary',
                  )}
                >
                  {game.black}
                </span>
                {game.blackElo ? (
                  <span className="text-subtle shrink-0 text-xs tabular-nums">{game.blackElo}</span>
                ) : null}
              </p>
            </>
          )}
          {/* The opening leads the detail line, because the code is what a
              long list is scanned by; the date and the clock follow it in
              the quietest colour on the row. */}
          {/* Opening first, date, then who played — the order every plain
              row leads with (players are its title lines), so a renamed
              game's detail reads the same left to right. */}
          <p className="text-subtle truncate text-xs" title={openingLabel}>
            {game.opening ? (
              <OpeningTag eco={game.opening.eco} name={game.opening.name} />
            ) : game.eco ? (
              <OpeningTag eco={game.eco} />
            ) : null}
            {(game.opening || game.eco) && ' · '}
            {game.date}
            {customName ? ` · ${game.white} vs ${game.black}` : ''}
            {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
          </p>
        </div>
        <ResultScore result={game.result} userSide={game.userSide} />
      </div>

      {/* One strip, not three loose icons: the eye used to sit inside the
          text block and the star and … outside it, so they read as three
          unrelated marks rather than as this row's controls. They share a
          tray now, which appears under the pointer and stays put on touch
          — the space is reserved either way, so nothing shifts. */}
      <div
        style={swipe.style}
        className={cn(
          // ml-auto so it stays against the right edge on the line it
          // wraps to, rather than following the text it left behind.
          'ml-auto flex shrink-0 items-center gap-0.5 rounded-lg p-0.5 transition-opacity duration-100',
          'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          'group-hover:bg-surface-3/70 pointer-coarse:opacity-100',
        )}
      >
        {/* Hidden on touch, where it lives in the ⋯ sheet instead: it is a
            HOVER affordance, and a phone cannot hover. */}
        {game.finalFen && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Preview the final position')}
            // Gone in a narrow list as well as on a phone. In the games
            // column it is 28px of hover convenience taken off the player
            // names, which are the row. 21.5rem is where the row stops
            // fitting with it: 8rem of text + the badge + the tray + the
            // link is 340px. `/arc` is the archive list's own container —
            // a query with no named container never matches, so this
            // reads as "always shown" everywhere else.
            className="shrink-0 pointer-coarse:hidden @max-[21.5rem]/arc:hidden"
            // Guarded like the other preview eyes: an unguarded mouseenter
            // trips iOS's sticky-hover heuristic (first tap hovers only).
            onMouseEnter={(e) => {
              if (!coarse()) showPreview(e);
            }}
            onMouseLeave={() => {
              if (!coarse()) hidePreview();
            }}
            // A hover preview goes when the mouse does; clicking pins it,
            // which is the difference between glancing at a position and
            // looking at one. It used to do nothing at all here — the
            // handler returned early on a fine pointer, and the click went
            // on to open the game.
            onClick={(e) => {
              e.stopPropagation();
              showPreview(e, true);
            }}
          >
            <Eye className="size-3.5" />
          </Button>
        )}
        {actions}
        {menu && menu.length > 0 && (
          <Button
            ref={menuTrigger}
            variant="ghost"
            size="icon-sm"
            title={t('Game actions')}
            active={menuOpen}
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(true);
            }}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        )}
      </div>
      {standing && (
        <div style={swipe.style} className="flex shrink-0 items-center gap-1">
          {standing}
        </div>
      )}

      {menuOpen && menu && (
        <ActionSheet
          title={customName ?? `${game.white} vs ${game.black}`}
          anchor={menuTrigger}
          onClose={() => setMenuOpen(false)}
          actions={[
            // The preview the eye gives a mouse, for a finger — and ONLY
            // for a finger: on a desktop the eye is on the row, two
            // centimetres from the ⋯ that opened this, and a menu that
            // repeats the icons beside it is a menu nobody reads. Anchored
            // to the row rather than to the ⋯, because by the time it
            // opens the sheet is gone and the row is what was being
            // looked at.
            ...(game.finalFen
              ? [
                  {
                    label: 'Preview the board',
                    icon: Eye,
                    className: 'pointer-fine:hidden',
                    onSelect: () => {
                      const rect = row.current?.getBoundingClientRect();
                      if (rect) showPreviewAt(rect, true);
                    },
                  },
                ]
              : []),
            ...menu,
          ]}
        />
      )}
      {/* Same container rule as the eye: in a narrow column this is 22px
          spent on a link out of the app, and the row it is taking them
          from is the reason anyone is looking. */}
      {showLink && !game.link && (
        <span className="w-[1.375rem] shrink-0 @max-[21.5rem]/arc:hidden" aria-hidden />
      )}
      {showLink && game.link && (
        <a
          href={game.link}
          target="_blank"
          rel="noreferrer"
          title={t('View on chess.com (needs internet)')}
          onClick={(e) => e.stopPropagation()}
          className="text-subtle hover:text-fg shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100 @max-[21.5rem]/arc:hidden"
        >
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </li>
  );
}

/**
 * The result stacked one score per line, mirroring the player lines it
 * sits beside. The winner's digit carries the outcome colour from the
 * user's perspective (green won, red lost) and is bold either way, so
 * the signal isn't colour-only; games without a known side just
 * brighten the winner. This replaced the old leading result dot — same
 * information, no extra column.
 */
export function ResultScore({
  result,
  userSide,
}: {
  result: string;
  userSide: 'white' | 'black' | null;
}) {
  const parts = result.split('-');
  const winner = result === '1-0' ? 'white' : result === '0-1' ? 'black' : null;
  // Read at a glance, in one tag, instead of two faint characters stacked
  // in a 24px column: at that size neither the score nor which side got it
  // survived, and the pair read as one smudge down the side of the list.
  // Tinted from the player's own point of view where there is one — a win
  // and a loss are not the same fact, and the list is mostly their games.
  const tone =
    parts.length !== 2 || !winner
      ? 'bg-surface-3 text-muted'
      : !userSide
        ? 'bg-surface-3 text-fg'
        : userSide === winner
          ? 'bg-good/15 text-good'
          : 'bg-bad/15 text-bad';
  return (
    <span
      title={fmtResult(result)}
      className={cn(
        'w-11 shrink-0 rounded px-1 py-0.5 text-center font-mono text-[0.6875rem] font-semibold',
        'tabular-nums leading-4',
        tone,
      )}
    >
      {fmtResult(result)}
    </span>
  );
}

/**
 * Which opening, as a code you can scan a list by.
 *
 * The ECO letter is the family — A flank, B semi-open, C open and French,
 * D closed, E Indian — so the badge takes its hue from the letter and the
 * same family is the same colour everywhere. That is the whole point of a
 * code in a list of two hundred games: you find the Sicilians by colour
 * before you have read a word.
 */
const ECO_HUE: Record<string, number> = { A: 285, B: 232, C: 195, D: 152, E: 65 };

export function OpeningTag({ eco, name }: { eco: string; name?: string | null }) {
  const hue = ECO_HUE[eco[0]?.toUpperCase() ?? ''] ?? 264;
  return (
    <>
      <span
        className="mr-1.5 inline-block shrink-0 rounded px-1 py-px align-[1px] font-mono text-[0.6875rem] font-semibold leading-4"
        // Lightness and chroma from the theme (index.css), hue from the
        // ECO letter: the same tag was written once for the dark page and
        // was a pale wash on the light one.
        style={{
          color: `oklch(var(--eco-l) var(--eco-c) ${hue})`,
          backgroundColor: `oklch(var(--eco-l) var(--eco-c) ${hue} / var(--eco-wash))`,
        }}
      >
        {eco}
      </span>
      {name && (
        <span style={{ color: `oklch(var(--eco-name-l) var(--eco-name-c) ${hue})` }}>{name}</span>
      )}
    </>
  );
}
