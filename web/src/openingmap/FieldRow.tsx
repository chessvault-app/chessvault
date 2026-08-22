import { AlertTriangle, Library } from 'lucide-react';
import type { ReactNode } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import type { FieldMove } from '@/repertoire/field';
import { ResultBar } from '@/ui/ResultBar';

/**
 * One row of "what the field plays here", in the two places that show it:
 * the panel's statistics table and the add-a-move sheet.
 *
 * They were written separately and drifted, which is what a reader sees
 * as chaos rather than as two views: the same eight moves in the same
 * order, one list in `text-base` with move numbers and a share bar, the
 * other in `text-sm` without numbers and a result bar. The parts are
 * shared now — the label, the marks, the bar and the widths they all
 * stand on — so the two lists differ only where they genuinely do: what
 * a tap on a row DOES, which is jump on one and chart on the other.
 *
 * The widths are the point of this file. Every part that varies from row
 * to row sits in a box of a fixed size, so the bars start and end on the
 * same two lines whatever a row happens to carry.
 */

/**
 * The columns a list of these rows stands on: the move, the bar, and
 * the tail. `ROW` makes a row take all three from the list above it, so
 * every move column in the list is as wide as the widest move in it and
 * not one pixel wider — and the bars still start on one line.
 *
 * A subgrid rather than a width. The width was a fixed 5rem, which left
 * a thumb of empty column between "2… e6" and its bar; measuring the
 * labels in `ch` instead was worse, because `ch` is the width of a ZERO
 * and these labels are mostly dots, spaces and narrow letters — it
 * asked for 71px to hold 40px of text. The browser can measure text; we
 * cannot, and it does it here for free.
 */
export const LIST = 'grid grid-cols-[max-content_1fr_max-content] gap-x-2';
export const ROW = 'col-span-3 grid grid-cols-subgrid items-center';

export function MoveCell({
  ply,
  san,
  gap,
  prepared,
  /** The row goes somewhere when pressed: this move is on the map. */
  linked,
}: {
  ply: number;
  san: string;
  gap?: boolean;
  prepared?: boolean;
  linked?: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        // The tip belongs to the WORDS, not to the button around them.
        // On the button it was an ancestor title, and an ancestor title
        // is what the browser falls back to while our own tooltip shows
        // for the mark inside it: two tips at once, one native and one
        // themed, overlapping.
        title={linked ? t('Show on the map') : undefined}
        className={cn(
          // inline-block/truncate, or the width is a suggestion: in the
          // panel this sits inside the button that jumps to the node,
          // where it is not a flex item and an inline box ignores a
          // width outright.
          'truncate text-sm font-semibold',
          // The app's link colour, because the row IS a link when the
          // move is charted — pressing it goes to that node. It said so
          // in a tooltip and nowhere else, which is a thing you find by
          // accident or never.
          linked ? 'text-primary' : 'text-fg',
          // The fill lights the MOVE, not the cell: on the button it
          // reached across the mark beside it, and the mark is a fact
          // about the move rather than part of the link. `group-hover`
          // so pointing anywhere on the control still lights it, and
          // negative margins so the padding it needs to look like a pill
          // costs the row no width.
          linked &&
            'group-hover:bg-primary-soft -mx-1 rounded-sm px-1 transition-colors duration-100',
        )}
      >
        {moveNumberLabel(ply)} {san}
      </span>
      {gap && (
        <Mark
          label={t('The field plays it and the studies do not answer')}
          icon={<AlertTriangle className="text-warn size-3.5" />}
        />
      )}
      {prepared && (
        <Mark
          label={t('A linked study prepares it')}
          icon={<Library className="text-good size-3.5" />}
        />
      )}
    </span>
  );
}

/**
 * An icon that says what it means when you point at it.
 *
 * The title goes on a SPAN around the glyph, not on the glyph: the
 * app's tooltips are delegated from `[title]` and skip anything that is
 * not an HTMLElement, and an `<svg>` is not one — which is how these
 * marks arrived with no tip at all. It doubles as the accessible name.
 */
function Mark({ label, icon }: { label: string; icon: ReactNode }) {
  return (
    <span role="img" aria-label={label} title={label} className="flex shrink-0">
      {icon}
    </span>
  );
}

/**
 * The result split — the explorer's bar, which is now the app's only
 * one (ui/ResultBar). The map drew its own: thinner, unlabelled, and a
 * different grey for the draws, which made the same numbers two
 * pictures depending on which pane you happened to be reading.
 *
 * A move the field never played (one the studies prepare, or one
 * already charted) has no split to draw and keeps the space, so the
 * rows above and below it do not close up around a gap in the column.
 */
export function MoveResult({ move }: { move: Pick<FieldMove, 'w' | 'd' | 'b'> | null }) {
  const w = move?.w ?? 0;
  const d = move?.d ?? 0;
  const b = move?.b ?? 0;
  return (
    <span className="min-w-0 flex-1">
      <ResultBar w={w} d={d} b={b} />
    </span>
  );
}

/**
 * The share of games, and whatever the caller puts after it.
 *
 * Both in boxes of their own. Laid out as they came, the percentage was
 * pushed left by whatever followed it — so a row with a tick had its
 * number a mark's width in from a row without one, and a column of
 * right-aligned numbers came out zigzagged.
 */
export function RowTail({ share, children }: { share: number | null; children?: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className="text-muted w-8 text-right text-sm">
        {share === null ? '' : share >= 0.005 ? `${Math.round(share * 100)}%` : '<1%'}
      </span>
      <span className="flex w-3.5 justify-center">{children}</span>
    </span>
  );
}
