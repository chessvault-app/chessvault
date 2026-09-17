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
      strip={<PalettePlaceholder />}
      below={
        <>
          {/* A phone puts the opponent's pieces above the board and the
              player's below it, lichess-editor style; a desktop has one
              combined row above and nothing under (EditorView). */}
          <PalettePlaceholder className="wide:hidden" />
          <ToolStrip />
        </>
      }
      // The Position card is a sheet on a phone, so there is no column
      // under the board there and an outline of one would be a picture
      // of a panel that is not coming.
      sideColumn={false}
      panel={{ title: t('Position'), body: <PositionForm /> }}
    />
  );
}

/**
 * The piece palette: twelve squares on a desktop (both colours in one
 * row), six on a phone (the opponent's above the board, the player's
 * below). Squares rather than the real pieces, because a piece is drawn
 * from the theme's own sprite sheet and that is the page's chunk.
 */
function PalettePlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn('flex w-full items-end justify-center gap-1 wide:h-10', className)}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="size-9 shrink-0 rounded-md" />
      ))}
      <span aria-hidden className="bg-border mx-1 hidden h-6 w-px wide:block" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={`w${i}`} className="hidden size-9 shrink-0 rounded-md wide:block" />
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
function ToolStrip() {
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
          <Button variant="default" size="sm" className="h-full">
            <Microscope className="glyph" />
            <span className="hidden sm:inline">{t('Analyse')}</span>
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Halfmove clock">
          <Input value="" readOnly aria-label={t('Halfmove clock')} />
        </Field>
        <Field label="Move number">
          <Input value="" readOnly aria-label={t('Move number')} />
        </Field>
      </div>
      {/* The FEN row, which is the card's floor: the tick, the string and
          Copy. Without it the card ended 49px above where it settles
          (measured on the demo at 1280). The string is the one thing here
          that is data, so it is a bar; everything else is the real row. */}
      <div className="border-border -mx-3 -mb-3 flex shrink-0 items-center gap-1.5 border-t py-1.5 pl-3 pr-2">
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
