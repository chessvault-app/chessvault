import { AlertTriangle, Library } from 'lucide-react';
import type { ReactNode } from 'react';
import { moveNumberLabel } from '@shared/tree';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import type { FieldMove } from '@/repertoire/field';

/**
 * One row of "what the field plays here", in the two places that show it:
 * the panel's statistics table and the add-a-move sheet.
 *
 * They were written separately and drifted, which is what a reader sees
 * as chaos rather than as two views: the same eight moves in the same
 * order, one list in `text-sm` with move numbers and a share bar, the
 * other in `text-xs` without numbers and a result bar. The parts are
 * shared now — the label, the marks, the bar and the widths they all
 * stand on — so the two lists differ only where they genuinely do: what
 * a tap on a row DOES, which is jump on one and chart on the other.
 *
 * The widths are the point of this file. Every part that varies from row
 * to row sits in a box of a fixed size, so the bars start and end on the
 * same two lines whatever a row happens to carry.
 */

/**
 * The move, its number and whatever is true of it, in one box.
 *
 * One box rather than two, because the mark belongs to the move: given
 * a column of its own it sat a third of an inch clear of the SAN it was
 * about, and the space came out of the bar. The box is a fixed width so
 * the bar still starts on one line; inside it the mark simply follows
 * the words.
 */
const CELL_W = 'w-20';

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
    <span className={cn('flex shrink-0 items-center gap-1', CELL_W)}>
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
          'truncate text-xs font-semibold',
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
            'group-hover:bg-primary-soft -mx-1 rounded px-1 transition-colors duration-100',
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
 * The result split, White's wins leftmost — the explorer's own reading
 * order. A move the field never played (one the studies prepare, or one
 * already charted) has no split to draw and keeps the space, so the rows
 * above and below it do not close up around a gap in the column.
 */
export function ResultBar({ move }: { move: Pick<FieldMove, 'w' | 'd' | 'b'> | null }) {
  const w = move?.w ?? 0;
  const d = move?.d ?? 0;
  const b = move?.b ?? 0;
  const games = w + d + b;
  if (games === 0) return <span className="min-w-0 flex-1" />;
  const pct = (n: number): string => `${(n / games) * 100}%`;
  return (
    <span
      className="border-line flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full border"
      title={`+${Math.round((w / games) * 100)}% =${Math.round((d / games) * 100)}% -${Math.round(
        (b / games) * 100,
      )}%`}
    >
      <span style={{ width: pct(w), background: 'var(--color-eval-white)' }} />
      <span style={{ width: pct(d), background: 'var(--color-line-strong)' }} />
      <span style={{ width: pct(b), background: 'var(--color-eval-black)' }} />
    </span>
  );
}

/** The share of games, and whatever the caller puts after it. */
export function RowTail({ share, children }: { share: number | null; children?: ReactNode }) {
  return (
    <span className="flex w-14 shrink-0 items-center justify-end gap-1.5">
      {share !== null && (
        <span className="text-muted text-xs">
          {share >= 0.005 ? `${Math.round(share * 100)}%` : '<1%'}
        </span>
      )}
      {children}
    </span>
  );
}
