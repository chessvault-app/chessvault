import { AlertTriangle, Library } from 'lucide-react';
import { moveNumberLabel } from '@shared/tree';
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

/** The move, with its number: `2… Nf6`. Wide enough for `12… Qxf7+`. */
const MOVE_W = 'w-[3.75rem]';
/** The marks after it: a gap warning, a study's tick, or neither. */
const MARKS_W = 'w-8';

export function MoveLabel({ ply, san }: { ply: number; san: string }) {
  return (
    // inline-block, or the width is a suggestion: in the panel this span
    // sits inside the button that jumps to the node, where it is not a
    // flex item and an inline box ignores a width outright. The column
    // then measured whatever SAN it held — invisible down a list of e5,
    // c5, d6 and obvious the moment a Qxf7+ turned up.
    <span className={`text-fg inline-block shrink-0 text-xs font-semibold ${MOVE_W}`}>
      {moveNumberLabel(ply)} {san}
    </span>
  );
}

/**
 * What is true of this move, as marks rather than as words.
 *
 * After the move, not before it: drawn in front, the warning pushed the
 * rows that HAD one further right than the rows that did not, and a
 * column of moves that steps in and out is a column you have to read
 * twice. And as a slot that is always there, empty or not, because the
 * same argument applies to the bar that follows it.
 *
 * Icons, not a coloured dot: a dot says "something is true here" and
 * leaves you to remember which thing. These say which — the warning the
 * canvas badge counts, and the shelf the studies live on.
 */
export function MoveMarks({ gap, prepared }: { gap?: boolean; prepared?: boolean }) {
  return (
    <span className={`flex shrink-0 items-center gap-1 ${MARKS_W}`}>
      {gap && (
        <AlertTriangle
          className="text-warn size-3.5"
          aria-label={t('The field plays it and the studies do not answer')}
        />
      )}
      {prepared && (
        <Library
          className="text-good size-3.5"
          aria-label={t('A linked study prepares it')}
        />
      )}
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
export function RowTail({ share, children }: { share: number | null; children?: React.ReactNode }) {
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
