import {
  ExternalLink,
  Eye,
  MoreHorizontal,
  NotebookPen,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Board } from '@/board/Board';

import { cn } from '@/lib/utils';
import { placeNear } from '@/lib/floating';

import { Button } from '@/components/ui/button';

import { ResultBadge } from '@/components/result-badge';
import { SideDot } from '@/components/side-dot';

import { ActionContextMenu, ActionMenu, type MenuAction } from '@/components/action-menu';
import { useCloseRequest } from '@/hooks/dialog-focus';
import { SwipeTrack, useSwipeRow } from '@/components/swipe-row';

import { PromptDialog } from '@/components/prompt-dialog';

import { t } from '@/lib/i18n';
import { isCoarsePointer } from '@/lib/media';
import { TitleTip } from '@/components/title-tip';

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
  event: string | null;
  round: string | null;
  /** Mainline length in plies. */
  plyCount: number;
  /** First plies of the mainline as bare SAN tokens, space-separated. */
  sanPrefix: string | null;
  opening: { eco: string; name: string } | null;
  finalFen: string | null;
  userSide: 'white' | 'black' | null;
  annotated: boolean;
}

export const gameKey = (g: Pick<GameSummary, 'file' | 'index'>): string => `${g.file}#${g.index}`;

/** Collection file -> document id (the path the studies-style API speaks). */
export const docId = (g: Pick<GameSummary, 'file'>): string =>
  g.file.replace(/^collection\//, '').replace(/\.pgn$/, '');

/**
 * A game's link, only if it is safe to leave the app through.
 *
 * `link` arrives from server-side game summaries — provider URLs and
 * stored PGN metadata — and an anchor or window.open will happily run a
 * `javascript:` value. Anything that is not plain http(s) yields
 * undefined, and the callers render no link at all rather than an inert
 * one.
 */
export const safeLink = (link?: string | null): string | undefined =>
  link && /^https?:\/\//i.test(link) ? link : undefined;

/**
 * The peek card, MEASURED rather than derived: it is `w-44` with `p-1`,
 * so the width is 176 and the board inside it should make the height 176
 * too — but chessground floors a board to a whole number of device pixels
 * per square, so what it actually comes out at is 170 (measured in the
 * running app at 1x). The old numbers here assumed 184 and centred the
 * card 7px above the row it was pointing at. The same card is drawn by
 * the puzzle list's preview, which keeps its own copy of this for the
 * same reason a peek is not yet one component.
 */
const PEEK_CARD = { width: 176, height: 170 };

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
  // The PINNED peek only: it is the modal one, and on Android the Back
  // gesture is how a scrimmed layer is put away. The hover popover
  // follows the pointer out on its own.
  useCloseRequest(onClose, preview?.pinned ?? false);
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
        <div ref={card} className="bg-card relative w-64 max-w-[80vw] rounded-xl ring-1 ring-border p-1.5 shadow-lg">
          <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded-lg" />
        </div>
      </div>
    );
  }
  return (
    <div
      ref={card}
      style={{ top: preview.top, left: preview.left }}
      className="bg-popover ring-border pointer-events-none fixed z-50 w-44 rounded-lg p-1 shadow-lg ring-1"
    >
      <Board fen={preview.fen} orientation={preview.orientation} viewOnly coordinates={false} className="rounded-sm" />
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
  loadPreview,
  actions,
  customName,
  renaming = false,
  onRename,
  showLink = true,
  onSwipeAway,
  onBookmark,
  bookmarked = false,
  contextMenu = false,
  menu,
  standing,
  leading,
}: {
  game: GameSummary;
  onOpen: () => void;
  onPreview: (preview: Preview | null) => void;
  /**
   * Fetch the preview position on demand, for rows whose summary carries
   * no `finalFen` (a reference game is a database row until someone looks
   * at it). The eye renders as if the position were at hand; the fetched
   * board is shown only if the row is still on the page and still the one
   * being asked about by the time it arrives.
   */
  loadPreview?: () => Promise<{ fen: string; orientation: 'white' | 'black' } | null>;
  /**
   * The row's secondary actions, folded into one ⋯.
   *
   * A sheet from the bottom on a phone, a popover under the ⋯ on a
   * desktop — the same ActionSheet the studies and notes shelves use. A
   * phone gets ONLY this: three 36px icon buttons standing permanently at
   * the end of a 390px row left the two player names about half the width
   * they need.
   */
  menu?: MenuAction[];
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
  /** A control at the row's LEADING edge, before the names — the
      archive's selection checkbox, which reads as a mark on the row
      the way a list's checkboxes always sit, not as one more button in
      the trailing furniture. */
  leading?: React.ReactNode;
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
  /**
   * A right-click (or a long press) on the row opens the same verbs as
   * the ⋯, at the pointer — the collection's rows, where those verbs are
   * about the row itself. Off where the ⋯ is the row's only menu.
   */
  contextMenu?: boolean;
}) {
  // The eye pops the final position. Fine pointers hover a popover beside
  // the row; coarse pointers TAP for a centred overlay (dismissed by its
  // scrim) — a beside-row popover on a phone would cover the row itself.
  const swipe = useSwipeRow({ onRemove: () => onSwipeAway?.(), onBookmark });
  const coarse = isCoarsePointer;
  const row = useRef<HTMLLIElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const canPreview = Boolean(game.finalFen || loadPreview);
  // Each show bumps the sequence; a hide bumps it too. A lazily loaded
  // position that resolves after the pointer has already left (or after
  // another row took over) compares stale and is dropped instead of
  // popping a board over nothing.
  const previewSeq = useRef(0);
  const showPreviewAt = async (rect: DOMRect, viaTap: boolean): Promise<void> => {
    const seq = ++previewSeq.current;
    let fen = game.finalFen;
    let orientation: 'white' | 'black' = game.userSide ?? 'white';
    if (!fen && loadPreview) {
      const loaded = await loadPreview().catch(() => null);
      if (!loaded || previewSeq.current !== seq || !row.current?.isConnected) return;
      fen = loaded.fen;
      orientation = loaded.orientation;
    }
    if (!fen) return;
    const { top, left } = placeNear(rect, PEEK_CARD, { side: 'left', align: 'center', gap: 16 });
    onPreview({ fen, orientation, top, left, pinned: viaTap });
  };
  const showPreview = (e: React.MouseEvent<Element>, viaTap = false): void => {
    if (!viaTap && coarse()) return;
    void showPreviewAt(e.currentTarget.getBoundingClientRect(), viaTap);
  };

  const hidePreview = (): void => {
    previewSeq.current++;
    onPreview(null);
  };

  const openingLabel = game.opening
    ? `${game.opening.eco} ${game.opening.name}`
    : (game.eco ?? '');

  // Through the scheme guard: a link that is not http(s) gets no anchor.
  const link = safeLink(game.link);

  // The ⋯ menu and the right-click menu are one list of verbs; the
  // right-click keeps the items the ⋯ hides as duplicates of the tray,
  // since a menu opened at the pointer has no tray beside it.
  const title = customName ?? t('{white} vs {black}', { white: game.white, black: game.black });
  const menuActions: MenuAction[] = [
    // The preview the eye gives a mouse, for a finger — and ONLY for a
    // finger: on a desktop the eye is on the row, two centimetres from
    // the ⋯ that opened this, and a menu that repeats the icons beside it
    // is a menu nobody reads. Anchored to the row rather than to the ⋯,
    // because by the time it opens the sheet is gone and the row is what
    // was being looked at.
    ...(canPreview
      ? [
          {
            label: 'Preview the board',
            icon: Eye,
            className: 'pointer-fine:hidden',
            onSelect: () => {
              const rect = row.current?.getBoundingClientRect();
              if (rect) void showPreviewAt(rect, true);
            },
          },
        ]
      : []),
    ...(menu ?? []),
  ];
  // A ⋯ whose every verb is hidden on a fine pointer (the touch-only
  // preview, alone) hides itself the same way, instead of opening empty.
  const menuTouchOnly =
    menuActions.length > 0 &&
    menuActions.every((a) => a.className?.includes('pointer-fine:hidden'));

  const item = (
    <li
      ref={row}
      onClick={onOpen}
      {...(onSwipeAway ? swipe.handlers : {})}
      // flex-wrap, with a floor under the text: everything to the right of
      // the names — result, eye, Add, ⋯, link — is shrink-0 by necessity,
      // so in a narrow enough box they used to eat the text box down to
      // nothing and then overflow it. Now the text keeps 9rem and the
      // furniture drops to a line of its own instead. It costs a taller
      // row at widths the layout should never reach, which beats a row of
      // numbers printed on top of each other at widths it did.
      className={cn(
        'group hover:bg-accent relative flex cursor-pointer flex-wrap items-center gap-3',
        // py from the density token, not a literal: this row is every
        // game list in the app, which is the list a density knob is for.
        'overflow-hidden px-3 py-(--row-py) transition-colors duration-100',
        // The whole indicator that a game is kept: a warm edge down the
        // left, which costs no width. The lit star that used to stand at
        // the end of the row cost about 36px of two player names on every
        // phone, to say what this says for nothing.
        //
        // Painted, not bordered. `divide-border` on the list sets
        // border-color on every child through `.divide-border > *`, which
        // outranks a plain `border-l-warn` on the row — the edge came out
        // the same grey as the hairlines between rows.
        // In the accent, not amber: amber is caution everywhere else in
        // the app, and a bookmark is not a warning.
        bookmarked && 'before:bg-primary before:absolute before:inset-y-0 before:left-0 before:w-0.5',
      )}
    >
      {onSwipeAway && <SwipeTrack dx={swipe.dx} bookmarked={bookmarked} />}
      {leading && (
        <div style={swipe.style} className="flex shrink-0 items-center">
          {leading}
        </div>
      )}
      <div className="flex min-w-[8rem] flex-1 items-center gap-3" style={swipe.style}>
        {/* The name is asked for in a sheet, like every other rename; the
            row keeps showing what it is called meanwhile. */}
        {renaming && (
          <PromptDialog
            label={t('Rename this game')}
            initial={customName ?? docId(game)}
            onSubmit={(value) => onRename?.(value)}
            onClose={() => onRename?.('')}
          />
        )}
        {/* The row's primary action is a real button on the names, so the
            keyboard reaches what the whole surface answers to a mouse;
            the li keeps its own onClick for the surface, and this stops
            the press from reaching it twice. A button holds phrasing
            content only, so the lines are spans, not p. */}
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {customName ? (
            // A renamed game leads with its given name; the matchup joins
            // the detail line so nothing is lost.
            <span className="text-foreground block truncate text-base font-semibold">
              {customName}
              {game.annotated && (
                <NotebookPen className="text-info ml-1.5 inline size-3" aria-label={t('Annotated')} />
              )}
            </span>
          ) : (
            // One line per player: names never fight each other for width,
            // so narrow screens truncate each side independently.
            <>
              {/* A flex row, not one inline run: with the rating inline
                  after the name, `truncate` on the line clipped whichever
                  came last — so an archive of long handles showed two
                  names and no ratings at all. The name is the only part
                  that gives way. */}
              <span className="text-foreground flex items-baseline gap-1.5 text-base">
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
                  <span className="text-muted-foreground shrink-0 font-mono text-sm">{game.whiteElo}</span>
                ) : null}
                {game.annotated && (
                  <NotebookPen className="text-info size-3 shrink-0" aria-label={t('Annotated')} />
                )}
              </span>
              <span className="text-foreground flex items-baseline gap-1.5 text-base">
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
                  <span className="text-muted-foreground shrink-0 font-mono text-sm">{game.blackElo}</span>
                ) : null}
              </span>
            </>
          )}
          {/* The opening leads the detail line, because the code is what a
              long list is scanned by; the date and the clock follow it in
              the quietest colour on the row. */}
          {/* Opening first, date, then who played — the order every plain
              row leads with (players are its title lines), so a renamed
              game's detail reads the same left to right. */}
          <span className="text-muted-foreground block truncate text-sm" title={openingLabel}>
            {game.opening ? (
              <OpeningTag eco={game.opening.eco} name={game.opening.name} />
            ) : game.eco ? (
              <OpeningTag eco={game.eco} />
            ) : null}
            {(game.opening || game.eco) && ' · '}
            {game.date}
            {customName ? ` · ${t('{white} vs {black}', { white: game.white, black: game.black })}` : ''}
            {game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
          </span>
        </button>
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
          'opacity-0 group-hover:opacity-100 focus-within:opacity-100 group-focus-within:opacity-100',
          'group-hover:bg-accent/70 pointer-coarse:opacity-100',
        )}
      >
        {/* Hidden on touch, where it lives in the ⋯ sheet instead: it is a
            HOVER affordance, and a phone cannot hover. */}
        {canPreview && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('Preview the final position')}
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
        {menuActions.length > 0 && (
          <ActionMenu title={title} actions={menuActions} open={menuOpen} onOpenChange={setMenuOpen}>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('Game actions')}
              active={menuOpen}
              className={cn('shrink-0', menuTouchOnly && 'pointer-fine:hidden')}
              // A press on the ⋯ is the menu's, not the row's.
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </ActionMenu>
        )}
      </div>
      {standing && (
        <div style={swipe.style} className="flex shrink-0 items-center gap-1">
          {standing}
        </div>
      )}

      {/* Same container rule as the eye: in a narrow column this is 22px
          spent on a link out of the app, and the row it is taking them
          from is the reason anyone is looking. */}
      {showLink && !link && (
        <span className="w-[1.375rem] shrink-0 @max-[21.5rem]/arc:hidden" aria-hidden />
      )}
      {showLink && link && (
        <TitleTip title={t('View on Chess.com (needs internet)')}>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            // Under a thumb the padding, not the icon, brings the 22px
            // link up to the 36px floor (DESIGN.md, Buttons).
            className="text-muted-foreground hover:text-foreground shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:p-[11px] pointer-coarse:opacity-100 @max-[21.5rem]/arc:hidden"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </TitleTip>
      )}
    </li>
  );

  if (!contextMenu || !menu || menu.length === 0) return item;
  return (
    <ActionContextMenu
      title={title}
      actions={menu.map(({ className: _hidden, ...action }) => action)}
    >
      {item}
    </ActionContextMenu>
  );
}

/**
 * The games lists' name for the one result chip the app has — the
 * shared ResultBadge, tinted from the player's own point of view (see
 * components/result-badge for the grammar and why it is one chip).
 */
export function ResultScore({
  result,
  userSide,
}: {
  result: string;
  userSide: 'white' | 'black' | null;
}) {
  return <ResultBadge result={result} userSide={userSide} />;
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
/**
 * One hue for every family, and a lightness step per letter.
 *
 * The families used to take five hues (285, 232, 195, 152, 65), on the
 * argument that you find the Sicilians by colour. Two of those were
 * green and amber, which everywhere else in the app mean solved and
 * caution, and a green D36 chip sat two cells from a green "1-0" in the
 * same row: the colour grammar gives a hue one job, and the eye pairs
 * green with a win before it pairs it with a Queen's Gambit. The letter
 * carries the family now, as it always did, and the family also moves
 * the chip a step along the lightness ladder (index.css sets the
 * direction per theme: down in light, up in dark, so every step keeps
 * at least the contrast the base tag measured).
 */
const ECO_STEP: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const ECO_HUE = 264;

export function OpeningTag({ eco, name }: { eco: string; name?: string | null }) {
  const step = ECO_STEP[eco[0]?.toUpperCase() ?? ''] ?? 0;
  const l = (base: string): string => `calc(var(${base}) + var(--eco-dir) * ${step * 2}%)`;
  return (
    <>
      <span
        className="mr-1.5 inline-block shrink-0 rounded-sm px-1 py-px align-[1px] font-mono text-xs font-semibold leading-4"
        // Lightness and chroma from the theme (index.css), the step from
        // the ECO letter: the same tag was written once for the dark page
        // and was a pale wash on the light one.
        style={{
          color: `oklch(${l('--eco-l')} var(--eco-c) ${ECO_HUE})`,
          backgroundColor: `oklch(${l('--eco-l')} var(--eco-c) ${ECO_HUE} / var(--eco-wash))`,
        }}
      >
        {eco}
      </span>
      {name && (
        <span style={{ color: `oklch(${l('--eco-name-l')} var(--eco-name-c) ${ECO_HUE})` }}>{name}</span>
      )}
    </>
  );
}
