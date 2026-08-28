import { NotebookPen } from 'lucide-react';
import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { ActionContextMenu, type MenuAction } from '@/components/action-menu';
import { t } from '@/lib/i18n';

import { OpeningTag, ResultScore, type GameSummary } from './shared';

/**
 * The dense table the wide Games pane draws — one line per game, in the
 * reference-database tradition: players, ratings, result, length, ECO,
 * tournament, date, and the opening plies as notation. Card rows
 * (GameRow) stay the shape everywhere narrow; this is what a pane with
 * real width can afford instead.
 *
 * Not an HTML table: the rows are `li` in GameListShell's ul, which is
 * what carries the virtualization, the zebra stripe and the scroll
 * sentinel. Header and rows agree on one grid template so they cannot
 * drift — and the template DROPS columns as the pane narrows, by
 * container query: notation first, then tournament, then the ratings.
 *
 * Two container names for one width: the rows answer the ul's own
 * `@container/arc`; the header stands OUTSIDE the ul (GameListShell's
 * listHeader band, so the stripe and sentinel arithmetic stay row-only)
 * and brings its own `@container/arch` wrapper. The two boxes are bands
 * of the same column, so the same breakpoints fire together.
 */

/** The one place a raw Elo is shown deliberately: game metadata about
    the two players, not the trainer's own rating (CLAUDE.md's stated
    games-list exception). */

// Complete literals only — Tailwind's scanner reads class names from
// this file, and a template assembled at runtime would never be emitted.
const COLS_ROW =
  '[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem_minmax(6rem,1.8fr)] ' +
  '@max-[56rem]/arc:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem] ' +
  '@max-[44rem]/arc:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_4.8rem] ' +
  '@max-[38rem]/arc:[grid-template-columns:minmax(6rem,1.3fr)_minmax(6rem,1.3fr)_2.9rem_2.4rem_2.4rem_4.8rem]';
const COLS_HEADER =
  '[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem_minmax(6rem,1.8fr)] ' +
  '@max-[56rem]/arch:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem] ' +
  '@max-[44rem]/arch:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_4.8rem] ' +
  '@max-[38rem]/arch:[grid-template-columns:minmax(6rem,1.3fr)_minmax(6rem,1.3fr)_2.9rem_2.4rem_2.4rem_4.8rem]';

// The archive's variant: a trailing standing column (the select
// checkbox and the Add button — what that list is FOR), after the
// same columns. Trailing, not leading: a column of buttons ahead of
// the player names pushed the row's identity off its left edge. 6rem
// seats the w-16 button with the checkbox beside it in selection mode.
const COLS_ROW_STANDING =
  '[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem_minmax(6rem,1.8fr)_6rem] ' +
  '@max-[56rem]/arc:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem_6rem] ' +
  '@max-[44rem]/arc:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_4.8rem_6rem] ' +
  '@max-[38rem]/arc:[grid-template-columns:minmax(6rem,1.3fr)_minmax(6rem,1.3fr)_2.9rem_2.4rem_2.4rem_4.8rem_6rem]';
const COLS_HEADER_STANDING =
  '[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem_minmax(6rem,1.8fr)_6rem] ' +
  '@max-[56rem]/arch:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_minmax(4rem,1fr)_4.8rem_6rem] ' +
  '@max-[44rem]/arch:[grid-template-columns:minmax(6rem,1.3fr)_2.75rem_minmax(6rem,1.3fr)_2.75rem_2.9rem_2.4rem_2.4rem_4.8rem_6rem] ' +
  '@max-[38rem]/arch:[grid-template-columns:minmax(6rem,1.3fr)_minmax(6rem,1.3fr)_2.9rem_2.4rem_2.4rem_4.8rem_6rem]';

const HIDE_NOTATION_ROW = '@max-[56rem]/arc:hidden';
const HIDE_EVENT_ROW = '@max-[44rem]/arc:hidden';
const HIDE_ELO_ROW = '@max-[38rem]/arc:hidden';
const HIDE_NOTATION_HEADER = '@max-[56rem]/arch:hidden';
const HIDE_EVENT_HEADER = '@max-[44rem]/arch:hidden';
const HIDE_ELO_HEADER = '@max-[38rem]/arch:hidden';

const GRID = 'grid items-center gap-x-2 px-3';

/** Bare space-separated SAN, numbered for reading: "1. e4 e5 2. Nf3 …". */
export function numberedSan(sans: string, truncated = false): string {
  const tokens = sans.split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (i % 2 === 0) out.push(`${i / 2 + 1}.`);
    out.push(tokens[i]!);
  }
  if (truncated && tokens.length > 0) out.push('…');
  return out.join(' ');
}

/** Moves, as a player counts them: two plies to a move, part-moves up. */
export const moveCount = (plyCount: number): number => Math.ceil(plyCount / 2);

/** chess.com stamps every live game's Event as this; in a Tournament
    column it is noise repeated down the page (the details panel still
    shows it verbatim). */
const isNoiseEvent = (event: string | null): boolean => event === 'Live Chess';

/** What the keyboard does to a table: step the selection, open it,
    clear it. The pane fills the ref fresh each render, so the handler
    always speaks about the rows currently on screen. */
export interface TableNav {
  move: (delta: 1 | -1) => void;
  open: () => void;
  clear: () => void;
}

/**
 * ↑/↓ move the table's selection, Enter opens it, Escape clears it —
 * page-level keys, because the rows are not focusable (a thousand tab
 * stops is not navigation). Keys aimed at a field, a control, or an
 * open window pass by untouched; ←/→ stay with the details panel's
 * board (GameDetails).
 */
export function useTableNav(enabled: boolean): MutableRefObject<TableNav | null> {
  const nav = useRef<TableNav | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const n = nav.current;
      if (!n) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, button, a, [contenteditable="true"], [role="menuitem"], [role="tab"], [role="option"]',
        )
      )
        return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        n.move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        n.move(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        n.open();
      } else if (e.key === 'Escape') {
        n.clear();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
  return nav;
}

export function GameTableHeader({ withStanding = false }: { withStanding?: boolean }) {
  const head = (label: string, className?: string) => (
    <span className={cn('truncate', className)}>{t(label)}</span>
  );
  return (
    <div className="@container/arch border-border border-t">
      <div
        className={cn(
          GRID,
          withStanding ? COLS_HEADER_STANDING : COLS_HEADER,
          'text-muted-foreground min-h-7 py-1 text-xs font-medium',
        )}
      >
        {head('White')}
        {head('Elo', cn('text-right', HIDE_ELO_HEADER))}
        {head('Black')}
        {head('Elo', cn('text-right', HIDE_ELO_HEADER))}
        {head('Result', 'text-center')}
        {head('Moves', 'text-right')}
        {head('ECO')}
        {head('Tournament', HIDE_EVENT_HEADER)}
        {head('Date')}
        {head('Notation', HIDE_NOTATION_HEADER)}
        {withStanding && <span aria-hidden />}
      </div>
    </div>
  );
}

export function GameTableRow({
  game,
  selected,
  onSelect,
  onOpen,
  menu,
  bookmarked = false,
  standing,
}: {
  game: GameSummary;
  selected: boolean;
  /** Single click: the row becomes the details panel's subject — or,
      in a list with no details panel (the archive window), the open. */
  onSelect: () => void;
  /** Double click (the panel's Open button and Enter say the same). */
  onOpen: () => void;
  /** The row's verbs, at the pointer — the table has no room for trays. */
  menu?: MenuAction[];
  bookmarked?: boolean;
  /** The archive's leading column: the select checkbox and Add. */
  standing?: ReactNode;
}) {
  const name = (player: string, side: 'white' | 'black') => (
    <span
      className={cn(
        'min-w-0 truncate text-sm font-medium',
        game.userSide === side && 'text-primary',
      )}
    >
      {player}
      {side === 'white' && game.annotated && (
        <NotebookPen className="text-info ml-1 inline size-3" aria-label={t('Annotated')} />
      )}
    </span>
  );
  const quiet = 'text-muted-foreground truncate text-xs';
  const item = (
    <li
      onClick={onSelect}
      onDoubleClick={onOpen}
      aria-selected={selected}
      title={`${game.white} vs ${game.black}`}
      className={cn(
        GRID,
        standing !== undefined ? COLS_ROW_STANDING : COLS_ROW,
        'hover:bg-accent relative min-h-[2.125rem] cursor-pointer py-1 transition-colors duration-100',
        // Selection over zebra: aria-selected because the row IS a
        // selection, and the accent wash because the details panel is
        // describing this exact line.
        selected && 'bg-accent',
        // The kept-game mark the card rows carry, unchanged: a warm edge
        // down the left that costs no width (painted, not bordered — see
        // GameRow on why divide-border outranks a border-l).
        bookmarked && 'before:bg-warn before:absolute before:inset-y-0 before:left-0 before:w-0.5',
      )}
    >
      {name(game.white, 'white')}
      <span className={cn(quiet, 'text-right tabular-nums', HIDE_ELO_ROW)}>
        {game.whiteElo || ''}
      </span>
      {name(game.black, 'black')}
      <span className={cn(quiet, 'text-right tabular-nums', HIDE_ELO_ROW)}>
        {game.blackElo || ''}
      </span>
      <ResultScore result={game.result} userSide={game.userSide} />
      <span className={cn(quiet, 'text-right tabular-nums')}>
        {game.plyCount > 0 ? moveCount(game.plyCount) : ''}
      </span>
      <span className="truncate">
        {game.opening ? <OpeningTag eco={game.opening.eco} /> : game.eco ? <OpeningTag eco={game.eco} /> : null}
      </span>
      <span className={cn(quiet, HIDE_EVENT_ROW)} title={game.event ?? undefined}>
        {isNoiseEvent(game.event) ? '' : (game.event ?? '')}
      </span>
      <span className={cn(quiet, 'tabular-nums')}>{game.date}</span>
      <span className={cn(quiet, 'font-mono', HIDE_NOTATION_ROW)}>
        {game.sanPrefix ? numberedSan(game.sanPrefix, game.plyCount > 24) : ''}
      </span>
      {standing !== undefined && (
        <span className="flex items-center justify-end gap-1">{standing}</span>
      )}
    </li>
  );

  if (!menu || menu.length === 0) return item;
  return (
    <ActionContextMenu title={`${game.white} vs ${game.black}`} actions={menu}>
      {item}
    </ActionContextMenu>
  );
}
