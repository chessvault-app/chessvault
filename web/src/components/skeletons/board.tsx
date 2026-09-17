import { ChevronLeft, Cpu, Files, ListOrdered, type LucideIcon, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { BOARD_MAX_W } from '@/board/boardSize';
import { publishBoardHeight } from '@/board/boardBlock';
import { BoardLane } from '@/engine/EvalBar';
import {
  BOARD_HELD_SHELL,
  BOARD_SCROLL_SHELL,
  BOARD_WIDE_COLUMN,
  BOARD_WIDE_SIDE,
} from '@/components/layout';
import { PanelHeader, panelStoredHeight } from '@/components/panel';
import { t } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import { INERT, InertDocumentTools, InertEditButton, Loading } from './primitives';

/**
 * A board beside its panel — the shape every playing surface takes.
 *
 * Built from the board pages' OWN layout constants rather than from
 * something that looks like them. It carried p-4 against their p-3, no
 * wide-screen shell at all, and a board capped at min(70vh,40rem) — which
 * on a 1920 desktop drew a 540px board where the page draws 736, in a
 * column that is not where the page puts one. Every element on it moved
 * when the document arrived.
 *
 * BOARD_HELD_SHELL, BOARD_MAX_W and BOARD_WIDE_SIDE are the three rules
 * the real pages compose, so sharing them is what keeps the two in the
 * same places. A copy would drift the first time one of them moved — and
 * it had: the shell was written out by hand here with
 * `stacked:overflow-hidden` where the constant says
 * `stacked:overflow-y-auto`, so a window short enough to make the page
 * scroll clipped the placeholder instead.
 */
export function SkeletonBoard({
  players = false,
  chapters = false,
  explorer = false,
  name,
  panes,
  foot,
  stackedPanel,
  panel,
  engine = false,
  shell = 'held',
  strip,
  below,
  sideColumn = true,
  centred = false,
  boardWidth = BOARD_MAX_W,
  className,
}: {
  /**
   * Reserve the two player bars a GAME wears, above and below its board.
   *
   * PlayerBar draws nothing until the headers are loaded, so a game's board
   * used to sit where a study's does and then take on 24px above it, 24
   * below and the gaps between. A study has no players and passes nothing.
   */
  players?: boolean;
  /** A study's chapter list, which a game and a trainer do not have. */
  chapters?: boolean;
  /** The explorer, docked at the foot of the column on a wide screen. */
  explorer?: boolean;
  /**
   * A TRAINER's title row instead of a document's.
   *
   * The three trainers (puzzles, the book trainer, the repertoire drill)
   * stand on the same shell as a study, and their title row is not a
   * study's: one word in `text-base font-semibold` with a back chevron
   * before it on a phone, and no document tools, no Edit and no save
   * state. The word is known from the address, so it is the real one.
   *
   * Without this the Board's own outline drew a document's row over a
   * page that has none, and its own note admitted as much: the tools
   * "vanish in place when the page lands".
   */
  name?: string;
  /**
   * The phone switcher's own icons, where they are not a document's.
   * A trainer opens on ITS pane and not on the moves, so the order
   * differs as well as the count, and the tabs divide the width however
   * many there are. An EMPTY list is a page with no switcher at all: the
   * repertoire trainer draws one only once a game is running, and it is
   * not running while the page is still arriving.
   */
  panes?: LucideIcon[];
  /** A panel at the foot of the side column, drawn by whoever knows what
      it holds. The explorer's own fold is `explorer` above. */
  foot?: React.ReactNode;
  /**
   * What the column-filling panel is CALLED, where it is not the moves.
   *
   * A phone shows one pane at a time, and a trainer opens on its own
   * pane, not on the moves — so below lg the panel that fills the column
   * is the trainer's, and above it the moves panel is back with the
   * trainer's at the foot (`foot`). The two words are drawn as a pair
   * and folded by class, because which one is showing is a width and
   * not an answer.
   */
  stackedPanel?: string;
  /**
   * What the column-filling panel is CALLED and what is in it, where it
   * is not the moves and their bars.
   *
   * The editor's column holds Position and the repertoire trainer's
   * holds New game — forms whose labels are known before anything is
   * fetched, so those outlines draw the real words. Given a body, the
   * panel takes its content's height (`shrink-0`) rather than filling
   * the column, which is what both of those panels do.
   */
  panel?: {
    title: React.ReactNode;
    /** Omit to keep the move list's own bars, for a page whose column
        panel IS the moves under another name (the Board prints the
        line's name there, which before a move is the starting
        position). With a body the panel takes that body's height. */
    body?: React.ReactNode;
  };
  /**
   * The Engine block docked on top of that panel, which is what every
   * board page does from lg (a phone gives the engine its own tab). Its
   * header is a title and a switch, and it is drawn because it costs the
   * panel below it 44px that would otherwise arrive with the page.
   */
  engine?: boolean;
  /**
   * The SCROLLING board shell instead of the held one: the editor and
   * the repertoire trainer stack into a page that scrolls, where a study
   * and the puzzle trainers fit the screen exactly (components/layout).
   * One constant either way, never a copy.
   */
  shell?: 'held' | 'scroll';
  /** The row ABOVE the board, where a page has one of its own (the
      editor's piece palette). The 40px reserve is drawn when it has not. */
  strip?: React.ReactNode;
  /** The row UNDER the board (the editor's tool strip). */
  below?: React.ReactNode;
  /**
   * Whether the side column stands below `wide` as well.
   *
   * Every board page but one draws its panes under the board when it
   * stacks; the editor folds its Position card into a sheet instead and
   * leaves the board and its tools the whole screen, so drawing a column
   * there would be a picture of a panel that is not coming.
   */
  sideColumn?: boolean;
  /**
   * Centre the board's column in the height a stacked page leaves it,
   * as the editor does (`stacked:my-auto` on its column): with no pane
   * under the board there is free height, and the page splits it. Left
   * out, the outline's board stood 93.5px above the page's on a 390x844
   * phone (palette row 52 against 145.5, board 104 against 197.5).
   */
  centred?: boolean;
  /**
   * The board block's own width budget, where a page has one of its own.
   * The editor's stacked board runs essentially full width, because it
   * has no pane under it (boardSize, EDITOR_BOARD_MAX_W); everything
   * else takes BOARD_MAX_W, which is the default.
   */
  boardWidth?: string;
  className?: string;
}) {
  // What this device dragged the chapters list to, if it ever has —
  // read per render like everything else here; the wait it stands
  // through cannot change it.
  const chapterH = chapters ? panelStoredHeight('study-chapters') : null;
  /**
   * The board square, the title row and the player bars are drawn on the
   * PAGE rather than in a card, and were the first placeholders found
   * painted in the ground's exact colour once the light theme went
   * tonal (page 245,245,245 and board placeholder 245,245,245, sampled
   * on the demo at 375). They carried their own accent fill for a while;
   * the Skeleton's default is accent now (components/ui/skeleton), which
   * is the same fill, so they draw it like everything else.
   */
  const titleRow = name ? (
    // A trainer's row: the chevron a phone leaves by, and the page's own
    // word — both known from the address, so neither is a bar.
    <>
      <Button variant="ghost" size="icon-sm" className="md:hidden" {...INERT}>
        <ChevronLeft className="glyph" />
      </Button>
      <h1 className="text-foreground text-base font-semibold">{name}</h1>
    </>
  ) : (
    // A way back, the name, the edit toggle and the save state. Drawn at
    // the top of the page on a phone and in the side column on a wide
    // screen, which is why it is written once and placed twice.
    <>
      <Button variant="ghost" size="icon-sm" {...INERT}>
        <ChevronLeft className="glyph" />
      </Button>
      <Skeleton className="h-3.5 min-w-0 flex-1" />
      {/* As SkeletonDocument's row, and StudyView's own: the real tools
          and Edit, inert, then the save state. */}
      <InertDocumentTools />
      <InertEditButton />
      <Skeleton className="h-2.5 w-10 shrink-0" />
    </>
  );
  const playerBar = (
    // In the lane, like the row it stands in for — the board it is drawn
    // beside is indented by the eval bar's reservation, and a placeholder
    // that ignores it moves the whole stack sideways when the real view
    // arrives.
    <BoardLane>
      <div className="board-box flex h-6 items-center gap-2">
        <Skeleton className="size-2 shrink-0 rounded-full" />
        <Skeleton className="h-3 w-32" />
      </div>
    </BoardLane>
  );
  return (
    // BOARD_HELD_SHELL itself, not a copy of it. The copy differed in one
    // class — stacked:overflow-hidden where the constant says
    // stacked:overflow-y-auto — so a window short enough to make the real
    // page scroll clipped the placeholder instead. Sharing the string is
    // what the constant exists for; see components/layout.
    <Loading className={cn(shell === 'scroll' ? BOARD_SCROLL_SHELL : BOARD_HELD_SHELL, className)}>
      {/* data-ground, as StudyView's row: the Edit button's secondary
          fill is the page's own tone there. */}
      <div
        className={cn(
          'flex shrink-0 items-center gap-2 wide:hidden',
          // A trainer's stacked row is a flat h-8 (PuzzlesView,
          // BookTrainer, the repertoire drill); a document's grows to
          // the 36px icon rung under a thumb, because its row holds
          // buttons.
          name ? 'h-8' : 'wide:h-9 pointer-coarse:h-9',
        )}
        data-ground=""
      >
        {titleRow}
      </div>

      {/* The board's column, and inside it the one width budget every view
          that shows a board shares. */}
      <div className={cn(BOARD_WIDE_COLUMN, centred && 'stacked:my-auto')}>
        <div ref={publishBoardHeight} className={cn('flex w-full flex-col gap-2', boardWidth)}>
          {/* 40px on a wide screen whatever it holds, so the board top
              stays put; on a phone only there when there is a game. */}
          <div
            className={cn(
              'w-full items-end wide:flex wide:h-10',
              players || strip ? 'flex' : 'hidden wide:flex',
            )}
          >
            {strip ?? (players && playerBar)}
          </div>
          <BoardLane>
            <Skeleton className="board-box aspect-square rounded-xl" />
          </BoardLane>
          {below ?? (players && playerBar)}
        </div>
      </div>

      {/* The side column, at the share of the row the real one takes. */}
      {/* stacked:gap-2, which every real column carries: at gap-3 the
          placeholder spaced its children 4px wider apart than the page
          does. `overflow-y-auto scrollbar-hidden` likewise — all three
          real columns scroll themselves (StudyView, BookTrainer,
          PuzzlesView), and without it a window short enough to make the
          page scroll clipped the placeholder instead. The stacked
          10rem floor is StudyView's alone — the trainers do not carry
          it, and imposed on them it held their column open 160px. */}
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scrollbar-hidden stacked:gap-2',
          (players || chapters) && 'stacked:min-h-40',
          !sideColumn && 'stacked:hidden',
          BOARD_WIDE_SIDE,
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 wide:h-9 stacked:hidden',
            // The trainers outdent their title to the column edge but
            // keep 13px at the right, so the session line beside it
            // reads down the same edge as every panel's own text.
            name && 'pr-[13px]',
          )}
          data-ground=""
        >
          {titleRow}
        </div>
        {/* What a phone has instead of the panels: the pane switcher, in
            the face every board page gives it (components/pane-tabs,
            `header`) rather than the floating pill it drew. Two things
            were wrong with the pill. It is a muted track, and a Skeleton
            was bg-muted then, so its four tabs were drawn in the track's
            own fill and the strip stood empty for the whole wait; the
            header is the card's surface, where the default fill is the
            one the rest of this column uses. And the header hangs over the card
            below it, swallowing the column's gap and a pixel more, which
            the pill did not: 32px and a 12px gap where the real strip
            costs 19, so everything under it sat 13px low until the board
            arrived.

            Icon tabs, because every caller's are (a label needs a line box
            a glyph does not), and the open one is the first: all three
            pages open on their first pane. Three of them, or four for a
            study, which is the one caller that says. The trainers have two
            or three, and the tabs divide the width however many there are,
            so the count is the icons' spacing and nothing else.

            The icons are the real ones (StudyView's `panes`: Moves,
            Engine, Chapters for a study, Explorer), drawn in the tab's
            own colours rather than as bars: a tab's glyph is not data.
            The trainers' strips carry other glyphs, and this stands for
            them with the game's three; the boxes are what matter and
            those agree. */}
        <div
          className={cn(
            'bg-card relative z-10 -mb-[calc(0.75rem+1px)] flex h-8 shrink-0 rounded-t-xl ring-1 ring-card-ring stacked:-mb-[calc(0.5rem+1px)] lg:hidden',
            panes?.length === 0 && 'hidden',
          )}
          aria-hidden
        >
          {(panes ?? (chapters ? [ListOrdered, Cpu, Files, Table2] : [ListOrdered, Cpu, Table2])).map((Icon, i) => (
            <div
              key={i}
              className={cn(
                'flex flex-1 items-center justify-center',
                i === 0 ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <Icon className="glyph" />
            </div>
          ))}
          {/* The line that marks the open pane, which the strip draws
              itself and a swipe moves. */}
          <span
            aria-hidden
            className="bg-foreground absolute bottom-0 left-0 h-0.5 rounded-full"
            style={{ width: `${100 / (panes?.length ?? (chapters ? 4 : 3))}%` }}
          />
        </div>
        {/* The panels below are the wide layout's: a phone shows one pane
            at a time behind the tabs above, and that one is the panel that
            fills the column.

            Both headers are min-h-11 — a PanelHeader's own floor, measured
            at 44px on every panel in the app — and not the h-10 they were
            drawn at. And the chapters block carries the real panel's own
            floor and ceiling rather than standing at one row: measured on
            a three-chapter study, 90px of placeholder against a 150px
            panel, so the explorer and the moves below it started 60px too
            high. */}
        {chapters && (
          <div
            className={cn(
              'bg-card flex shrink-0 flex-col overflow-hidden rounded-xl ring-1 ring-card-ring max-lg:hidden',
              // The panel's floor and ceiling, for a device that has
              // never dragged it. One that has stores the height it chose
              // (vault:panel-h, applied by Panel on every mount at lg and
              // up), and the placeholder reads the same number — a
              // dragged 320px list stood at the 192px ceiling here and
              // the whole side column re-laid when the study opened. The
              // stored case shrinks like the panel does (`0 1 auto`, not
              // shrink-0): an exact height that refuses to shrink is
              // clipped by a short column, which is the bug Panel's own
              // comment walks through. Below lg both are moot — the
              // block is hidden.
              chapterH === null && 'max-h-48 min-h-[min(6rem,15%)]',
              // PanelHeader pads from --card-spacing, which only a Card
              // sets; these bare boxes set it themselves.
              '[--card-spacing:var(--card-pad)]',
            )}
            style={chapterH === null ? undefined : { height: chapterH, flex: '0 1 auto' }}
          >
            {/* The real header with the real word. The count after it
                ("Chapters · 3") and the add button are the study's. */}
            <PanelHeader title={t('Chapters')} />
            {/* px-1 and no gap, like the real list: its rows are --row-h
                tall and meet. With a gap and a padding of its own the
                block came out 166px against the panel's 150. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-(--row-h) shrink-0 items-center px-2">
                  <Skeleton className={cn('h-3', i === 0 ? 'w-2/3' : 'w-1/2')} />
                </div>
              ))}
            </div>
            {/* The grip that resizes it, which is part of the panel. */}
            <div className="bg-muted h-2.5 shrink-0" />
          </div>
        )}
        {/* A panel's own box, filling the column the way the real one
            does — it was a bordered strip that stopped wherever its rows
            ran out, in a column the page fills to the bottom.

            A named panel with a body of its own takes that body's height
            instead: the editor's Position card and the repertoire
            trainer's New game card are forms, and a form stretched to the
            column's foot is not what either page draws. */}
        <div
          className={cn(
            'bg-card flex flex-col overflow-hidden rounded-xl ring-1 ring-card-ring [--card-spacing:var(--card-pad)]',
            panel?.body ? 'shrink-0' : 'min-h-0 flex-1',
          )}
        >
          {/* The panel opens on its header, as the chapters panel above
              does: the moves title and the row of controls beside it. The
              bars used to start 12px down a panel whose first 44px is that
              band, so every move line sat a header too high. The title is
              the real PanelHeader's; a study's says its chapter's name
              instead, which is data, so the panel's own word stands. The
              controls stay as boxes: which ones the row holds depends on
              the document. */}
          {/* The engine, docked: its own header with the switch that
              turns it on, and nothing under it, which is what a board
              page opens with (the block is off until asked). */}
          {engine && (
            <div className="max-lg:hidden">
              <PanelHeader
                title={t('Engine')}
                actions={<span aria-hidden className="bg-muted h-5 w-9 shrink-0 rounded-full" />}
              />
            </div>
          )}
          <PanelHeader
            title={
              panel ? (
                panel.title
              ) : stackedPanel === undefined ? (
                t('Moves')
              ) : (
                <>
                  <span className="max-lg:hidden">{t('Moves')}</span>
                  <span className="lg:hidden">{stackedPanel}</span>
                </>
              )
            }
            actions={
              panel ? undefined : [0, 1, 2].map((i) => <span key={i} className="size-7" />)
            }
          />
          {panel?.body ? (
            <div className="flex flex-col gap-3 px-3 pb-3">{panel.body}</div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className={cn('h-2.5 shrink-0', i % 2 ? 'w-3/5' : 'w-4/5')} />
              ))}
            </div>
          )}
        </div>
        {/* Folded to its header, which is where a board page opens it:
            `enabled` is session state and starts off (store/explorer), so a
            load never finds the 300px open panel. Same min-h-11 header. */}
        {explorer && (
          <div className="bg-card shrink-0 overflow-hidden rounded-xl ring-1 ring-card-ring max-lg:hidden [--card-spacing:var(--card-pad)]">
            <PanelHeader title={t('Explorer')} />
          </div>
        )}
        {foot}
      </div>
    </Loading>
  );
}
