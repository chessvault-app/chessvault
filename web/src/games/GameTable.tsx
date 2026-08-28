import { NotebookPen } from 'lucide-react';
import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from 'react';

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
 * sentinel. Header and rows agree on one grid template because both
 * read it from the SAME variable — `--gt-cols`, set by the pane on the
 * shell's table wrapper (listVars) from useGameTableVars, which folds
 * in the per-column widths the header's drag handles write. A pane too
 * narrow for the columns scrolls sideways (the wrapper's job) rather
 * than shedding them.
 */

/** The one place a raw Elo is shown deliberately: game metadata about
    the two players, not the trainer's own rating (CLAUDE.md's stated
    games-list exception). */

interface GameColumn {
  id: string;
  label: string;
  /** Starting width in px; a drag on the header overrides it, per device. */
  width: number;
  min: number;
  /** Share of any slack beyond the columns' own widths — the truncating
      text columns; fixed columns are numbers and badges. */
  fr?: number;
  align?: 'right' | 'center';
}

const COLUMNS: GameColumn[] = [
  { id: 'white', label: 'White', width: 150, min: 90, fr: 1.3 },
  { id: 'whiteElo', label: 'Elo', width: 44, min: 36, align: 'right' },
  { id: 'black', label: 'Black', width: 150, min: 90, fr: 1.3 },
  { id: 'blackElo', label: 'Elo', width: 44, min: 36, align: 'right' },
  { id: 'result', label: 'Result', width: 48, min: 44, align: 'center' },
  { id: 'moves', label: 'Moves', width: 44, min: 36, align: 'right' },
  { id: 'eco', label: 'ECO', width: 40, min: 34 },
  { id: 'event', label: 'Tournament', width: 110, min: 60, fr: 1 },
  { id: 'date', label: 'Date', width: 80, min: 64 },
  { id: 'notation', label: 'Notation', width: 220, min: 80, fr: 1.8 },
];
// The archive's trailing standing column (checkbox + Add — what that
// list is FOR). Trailing, not leading: a column of buttons ahead of
// the player names pushed the row's identity off its left edge.
const STANDING: GameColumn = { id: 'standing', label: '', width: 96, min: 80 };
const colsOf = (withStanding: boolean): GameColumn[] =>
  withStanding ? [...COLUMNS, STANDING] : COLUMNS;

/**
 * The dragged column widths, shared by every table on the device the
 * way Panel heights are (vault:panel-h:*): a column width is a reading
 * preference, not a per-list fact. Absent means the default.
 */
const WIDTHS_KEY = 'vault:game-table-cols';
let colWidths: Record<string, number> = {};
try {
  colWidths = JSON.parse(localStorage.getItem(WIDTHS_KEY) ?? '{}') as Record<string, number>;
} catch {
  /* defaults stand */
}
const widthSubs = new Set<() => void>();
function setColWidth(id: string, px: number | null): void {
  const next = { ...colWidths };
  if (px === null) delete next[id];
  else next[id] = Math.round(px);
  colWidths = next;
  try {
    localStorage.setItem(WIDTHS_KEY, JSON.stringify(colWidths));
  } catch {
    /* the session still resizes; it just will not survive a reload */
  }
  for (const fn of widthSubs) fn();
}
function useColWidths(): Record<string, number> {
  return useSyncExternalStore(
    (fn) => {
      widthSubs.add(fn);
      return () => widthSubs.delete(fn);
    },
    () => colWidths,
  );
}
const widthOf = (c: GameColumn, stored: Record<string, number>): number =>
  Math.max(c.min, stored[c.id] ?? c.width);

/**
 * The pane's half of the contract: put this on GameListShell's
 * `listVars` so the header and every row read one template. Fixed
 * columns are exact px; the text columns keep a share of any slack, so
 * a wide pane spends its width on names and notation.
 */
export function useGameTableVars(withStanding = false): CSSProperties {
  const stored = useColWidths();
  const template = colsOf(withStanding)
    .map((c) => {
      const w = widthOf(c, stored);
      return c.fr ? `minmax(${w}px,${c.fr}fr)` : `${w}px`;
    })
    .join(' ');
  return { '--gt-cols': template } as CSSProperties;
}

const GRID = 'grid items-center gap-x-2 px-3 [grid-template-columns:var(--gt-cols)]';

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
  // No width subscription needed here: the cells' widths arrive through
  // the grid template variable the pane sets; the drag reads the live
  // store when it starts.
  const drag = useRef<{ id: string; x: number; w: number } | null>(null);
  return (
    <div className="border-border border-t">
      <div
        className={cn(GRID, 'text-muted-foreground min-h-7 py-1 text-xs font-medium')}
      >
        {colsOf(withStanding).map((c) => (
          <span
            key={c.id}
            className={cn(
              'relative flex min-w-0 items-center',
              c.align === 'right' && 'justify-end',
              c.align === 'center' && 'justify-center',
            )}
          >
            <span className="truncate">{c.label ? t(c.label) : ''}</span>
            {/* The column's edge, draggable: a slim nub standing in the
                gap between headings. Width is written to the shared
                store, so every table's rows follow the same template
                the moment it moves. */}
            <span
              title={t('Drag to resize · double-click to reset')}
              className="hover:bg-border absolute inset-y-0 -right-2 flex w-2.5 cursor-col-resize touch-none items-center justify-center rounded-sm"
              onPointerDown={(e) => {
                e.preventDefault();
                drag.current = { id: c.id, x: e.clientX, w: widthOf(c, colWidths) };
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* no live pointer to capture — the move still tracks */
                }
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== c.id || (e.buttons & 1) === 0) return;
                setColWidth(c.id, Math.max(c.min, d.w + e.clientX - d.x));
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onDoubleClick={() => setColWidth(c.id, null)}
            >
              <span className="bg-border/60 h-3.5 w-px" />
            </span>
          </span>
        ))}
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
      <span className={cn(quiet, 'text-right tabular-nums')}>
        {game.whiteElo || ''}
      </span>
      {name(game.black, 'black')}
      <span className={cn(quiet, 'text-right tabular-nums')}>
        {game.blackElo || ''}
      </span>
      <ResultScore result={game.result} userSide={game.userSide} />
      <span className={cn(quiet, 'text-right tabular-nums')}>
        {game.plyCount > 0 ? moveCount(game.plyCount) : ''}
      </span>
      <span className="truncate">
        {game.opening ? <OpeningTag eco={game.opening.eco} /> : game.eco ? <OpeningTag eco={game.eco} /> : null}
      </span>
      <span className={quiet} title={game.event ?? undefined}>
        {isNoiseEvent(game.event) ? '' : (game.event ?? '')}
      </span>
      <span className={cn(quiet, 'tabular-nums')}>{game.date}</span>
      <span className={cn(quiet, 'font-mono')}>
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
