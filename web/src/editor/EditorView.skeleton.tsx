import {
  CheckCircle2,
  Eraser,
  MousePointer2,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Wand2,
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
 * The row under the board, in the two shapes the page draws it: labelled
 * verbs in a track on a desktop, and on a phone the same verbs as icons
 * with the Position sheet's own trigger beside them and the press that
 * analyses at the end.
 */
function ToolStrip() {
  return (
    <Inert>
      <div className="bg-muted mx-auto hidden w-fit items-center gap-1 rounded-lg p-1 wide:flex">
        <Button variant="secondary" size="sm">
          <MousePointer2 className="glyph" data-icon="inline-start" />
          {t('Move')}
        </Button>
        <Button variant="ghost" size="sm">
          <Eraser className="glyph" data-icon="inline-start" />
          {t('Erase')}
        </Button>
        <Button variant="ghost" size="sm">
          <RotateCcw className="glyph" data-icon="inline-start" />
          {t('Reset')}
        </Button>
        <Button variant="ghost" size="sm">
          <Trash2 className="glyph" data-icon="inline-start" />
          {t('Clear')}
        </Button>
        <Button variant="default" size="sm">
          {t('Analyse')}
        </Button>
      </div>
      <div className="flex w-full items-center gap-2 wide:hidden">
        <div className="bg-muted flex items-center gap-1 rounded-lg p-1">
          {[MousePointer2, Eraser, Repeat, RotateCcw, Trash2].map((Icon, i) => (
            <Button key={i} variant={i === 0 ? 'secondary' : 'ghost'} size="icon-sm">
              <Icon className="glyph" />
            </Button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto">
          <SlidersHorizontal className="glyph" data-icon="inline-start" />
          {t('Position')}
        </Button>
        <Button variant="default" size="icon-sm">
          <Wand2 className="glyph" />
        </Button>
      </div>
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
