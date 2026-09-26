import {
  CheckCircle2,
  Eraser,
  FlipHorizontal2,
  Microscope,
  MousePointer2,
  RotateCcw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ClearableInput } from '@/components/text-fields';
import { Segmented } from '@/components/segmented';
import { Inert, Skeleton, SkeletonBoard } from '@/components/skeletons';
import { EDITOR_BOARD_MAX_W } from '@/board/boardSize';
import { BoardLane } from '@/engine/EvalBar';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The position editor while its chunk is on the wire.
 *
 * It drew nothing at all, along with the repertoire trainer, the
 * workspace and the opening map: those four were the routes the shell's
 * old guessing table had no shape for, and the argument for leaving them
 * blank was that a shape invented out in the shell would be a guess.
 * True of the shell, and this is not the shell — it is the page's own
 * outline in its own chunk, and this page waits on no fetch whatever, so
 * its whole download was a blank screen.
 *
 * Everything on it is fixed: a palette of pieces over the board, the
 * board, the tool strip under it, and a Position card whose every label
 * and option is known. Only the position itself is data, and the page
 * opens on the starting one.
 */
export default function EditorOutline() {
  return (
    <SkeletonBoard
      shell="scroll"
      name={t('Editor')}
      // The stacked editor has no pane under the board, so its board runs
      // essentially full width (boardSize, EDITOR_BOARD_MAX_W).
      boardWidth={EDITOR_BOARD_MAX_W}
      // The page centres its column in a stacked screen's free height
      // (EditorView, `stacked:my-auto`), so the outline does.
      centred
      // In the board's lane, as the page's palettes and tools are: they
      // align to the board's edges, so they are indented by the eval
      // bar's reservation too. Out of it the wide row stood 18px left of
      // where it lands (x 224 and 629 wide against 260 and 593, at 1280).
      strip={
        <BoardLane>
          <PalettePlaceholder />
        </BoardLane>
      }
      below={
        <BoardLane>
          <div className="flex flex-col gap-2">
            {/* A phone puts the opponent's pieces above the board and the
                player's below it, lichess-editor style; a desktop has one
                combined row above and nothing under (EditorView). */}
            <PalettePlaceholder className="wide:hidden" />
            <ToolStrip />
          </div>
        </BoardLane>
      }
      // The Position card is a sheet on a phone, so there is no column
      // under the board there and an outline of one would be a picture
      // of a panel that is not coming.
      sideColumn={false}
      panel={{
        title: t('Position'),
        body: (
          <>
            <div className={POSITION_BODY}>
              <PositionForm />
            </div>
            <FenRow />
          </>
        ),
      }}
    />
  );
}

/**
 * The piece palette's frames, stated once for the page (EditorView's
 * PiecePalette) and this outline.
 *
 * The strip over the board: 40px on a wide screen whatever it holds, so
 * the board's top is the same on every page, with the pieces at its foot.
 */
export const PALETTE_STRIP = 'flex w-full items-end justify-center wide:h-10';
/** The palette's row: one colour's group a line on a phone, both colours
    in one line on a wide screen. */
export const PALETTE_ROW = 'flex w-full flex-wrap items-center justify-center gap-1 wide:flex-nowrap';
/** One colour's six pieces. `flex-1` on a wide screen, so the two colours
    split the row between them. */
export const PALETTE_GROUP = 'flex w-full justify-center gap-1 wide:w-auto wide:min-w-0 wide:flex-1';
/** The rule between the colours on a wide screen. A sibling of the two
    groups, never a child of one: inside a `flex-1` group it comes out of
    that group's share, and its six pieces draw smaller than the other
    colour's. */
export const PALETTE_DIVIDER = 'bg-border mx-1.5 hidden h-6 w-px shrink-0 wide:block';
/** A piece's square. Stacked, a comfortable touch size (44, 56 from sm);
    wide, it shrinks to fit the row, never past 40, so the strip above the
    board never clips. */
export const PALETTE_SQUARE =
  'aspect-square w-11 rounded-lg sm:w-14 wide:w-full wide:min-w-0 wide:max-w-10 wide:flex-1';

/**
 * The piece palette: twelve squares on a desktop (both colours in one
 * row), six on a phone (the opponent's above the board, the player's
 * below). Squares rather than the real pieces, because a piece is drawn
 * from the theme's own sprite sheet and that is the page's chunk.
 *
 * Every frame is the page's own (the PALETTE_ constants above), in the
 * page's nesting: the strip, the row, two groups and the rule between
 * them, so a square here is a piece's box there at every width. The
 * copy this replaced had drifted twice. Stacked, its squares were size-9
 * until the games hunt's setup window, which is always stacked, measured
 * rows of 36 where 56 landed on a desktop and 44 on a phone. Wide, it
 * stayed one cluster of 36px squares where the page splits the row into
 * two flex-1 groups whose pieces fit the lane, up to 40: measured on the
 * built demo (2026-09-27), a 489px cluster against pieces spanning 554.5
 * in a 568px lane at 1280x800, and a cluster overflowing the lane by 54.5px
 * each side at 1100x575 and by 118 at 844x390, where the pieces are 26.5
 * and 16.
 */
export function PalettePlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn(PALETTE_STRIP, className)}>
      <div className={PALETTE_ROW}>
        <PaletteGroup />
        <span aria-hidden className={PALETTE_DIVIDER} />
        {/* The second colour is the wide row's alone: stacked, a palette
            is one colour, and the other stands on the board's far side. */}
        <PaletteGroup className="hidden wide:flex" />
      </div>
    </div>
  );
}

/** One colour's six squares. */
function PaletteGroup({ className }: { className?: string }) {
  return (
    <div className={cn(PALETTE_GROUP, className)}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className={PALETTE_SQUARE} />
      ))}
    </div>
  );
}

/**
 * The row under the board: the tools in their pill, then the Position
 * sheet's trigger and the press that analyses.
 *
 * ONE row, not one per width. The page draws a single track whose
 * buttons gain their labels from `sm` and whose pill takes the whole row
 * below it, and the row wraps when it does not fit rather than at a
 * breakpoint guessed from one language (EditorView says what that cost).
 * A first attempt here drew two rows folded by class and got the pill's
 * own chrome wrong on a phone: the tools stood bare where the settled
 * page draws them in a bordered, tinted track.
 */
export function ToolStrip({
  use,
}: {
  /** The primary press where a host renames it (EditorView's `useLabel`):
      the games hunt's window says Search, under the list glyph. */
  use?: { label: string; icon: typeof Microscope };
} = {}) {
  const UseIcon = use?.icon ?? Microscope;
  return (
    <Inert>
      <div className="flex w-full flex-wrap items-center justify-center gap-2">
        {/* The pill: the page's own track, its radius nested around the
            armed tool's own (EditorView's nested-radius note), taking
            the whole row below sm. */}
        <div
          data-ground=""
          className="bg-muted/60 border-border flex h-9 items-center gap-0.5 rounded-[calc(var(--radius-md)+3px)] border p-0.5 max-sm:flex-1 max-sm:justify-between"
        >
          {/* Move is armed on a cold open, drawn as the pill-track idiom
              draws a chosen segment. */}
          <Button variant="ghost" size="sm" className="bg-background h-full shadow-sm max-sm:w-10 max-sm:px-0">
            <MousePointer2 className="glyph" />
            <span className="hidden sm:inline">{t('Move')}</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-full max-sm:w-10 max-sm:px-0">
            <Eraser className="glyph" />
            <span className="hidden sm:inline">{t('Erase')}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" className="h-full w-8">
            <FlipHorizontal2 className="glyph" />
          </Button>
          <Button variant="ghost" size="sm" className="h-full max-sm:w-10 max-sm:px-0">
            <RotateCcw className="glyph" />
            <span className="hidden sm:inline">{t('Reset')}</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-full max-sm:w-10 max-sm:px-0">
            <Trash2 className="glyph" />
            <span className="hidden sm:inline">{t('Clear')}</span>
          </Button>
        </div>
        <div className="flex h-9 items-center gap-2">
          {/* Position details are a sheet below the side column's width,
              so the trigger is there and not above it. */}
          <Button variant="secondary" size="sm" className="h-full wide:hidden">
            <Settings2 className="glyph" data-icon="inline-start" />
            <span>{t('Position')}</span>
          </Button>
          <Button variant="default" size="sm" className="h-full max-sm:w-10 max-sm:px-0">
            <UseIcon className="glyph" />
            <span className="hidden sm:inline">{use?.label ?? t('Analyse')}</span>
          </Button>
        </div>
      </div>
      {/* The line that says why Analyse is locked. It stands at its
          one-line height whether or not there is a reason, because the
          column is centred and a row that came and went would move the
          board every time legality flipped (EditorView). */}
      <p className="flex min-h-5 w-full items-start justify-center gap-1.5 text-sm wide:hidden" />
    </Inert>
  );
}


/** The Position card's fields, in the page's own order and words. */
/** The Position panel's body, as the page frames its fields and this outline frames the same ones. */
export const POSITION_BODY = 'grid gap-3 px-(--card-spacing) pb-(--card-spacing)';
/** The two clocks, side by side. */
export const CLOCK_GRID = 'grid grid-cols-2 gap-2';
/**
 * The FEN row under the fields. -mb: the row is the card's floor, so it
 * claims the card's own bottom padding; py-1.5 is symmetric, so the line
 * centres itself.
 */
export const FEN_ROW =
  'border-border -mb-[var(--card-floor,var(--card-spacing))] flex shrink-0 items-center gap-1.5 border-t py-1.5 pl-3 pr-2';

function PositionForm() {
  return (
    <Inert>
      <Field label="Opening">
        <ClearableInput
          value=""
          readOnly
          aria-label={t('Opening')}
          placeholder={t('Pick an opening or ECO code')}
        />
      </Field>
      <Field label="Side to move">
        <Segmented
          value="white"
          onChange={NOOP}
          ariaLabel="Side to move"
          even
          segments={[
            { value: 'white', label: t('White') },
            { value: 'black', label: t('Black') },
          ]}
        />
      </Field>
      <Field label="Castling rights">
        <div className="grid grid-cols-4 gap-2">
          {['K', 'Q', 'k', 'q'].map((flag) => (
            <Button key={flag} variant="secondary" size="sm">
              {flag}
            </Button>
          ))}
        </div>
      </Field>
      <Field label="En passant target">
        <Select value="" onValueChange={NOOP} ariaLabel={t('En passant target')} groups={[{ options: [] }]} />
      </Field>
      <div className={CLOCK_GRID}>
        <Field label="Halfmove clock">
          <Input value="" readOnly aria-label={t('Halfmove clock')} />
        </Field>
        <Field label="Move number">
          <Input value="" readOnly aria-label={t('Move number')} />
        </Field>
      </div>
    </Inert>
  );
}

/**
 * The FEN row, which is the card's floor: the tick, the string and Copy.
 * Without it the card ended 49px above where it settles (measured on the
 * demo at 1280). The string is the one thing here that is data, so it is
 * a bar; everything else is the real row, in the page's own frame and,
 * as on the page, a sibling of the fields' body and not the last of them.
 */
function FenRow() {
  return (
    <Inert>
      <div className={FEN_ROW}>
        <CheckCircle2 className="text-good glyph shrink-0" aria-hidden />
        <span className="flex min-w-0 flex-1 items-center font-mono text-xs">
          <Skeleton className="h-2.5 w-full" />
        </span>
        <Button variant="ghost" size="sm">
          {t('Copy')}
        </Button>
      </div>
    </Inert>
  );
}

const NOOP = (): void => {};
