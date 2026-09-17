import { CircleStop, Repeat, RotateCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { PanelHeader } from '@/components/panel';
import { t } from '@/lib/i18n';
import { Skeleton } from '@/components/ui/skeleton';
import { INERT, Inert, Loading } from './primitives';

/**
 * A book's puzzle page: the progress bar and filter chips it wears above
 * the grid, then the grid itself — same columns, gap and tile shape as the
 * real one, so nothing moves when the puzzles arrive.
 */
export function SkeletonTiles({
  tiles = 48,
  cycles = false,
  cyclesOpen = false,
  cyclesProse,
  className,
}: {
  tiles?: number;
  /**
   * Hold the place of the Cycles panel above the grid.
   *
   * That panel is drawn for any book with puzzles in it — which is the
   * same book this grid is worth drawing for — and it is a whole Panel:
   * a header, the pass's own copy, and the card's floor. Measured on the
   * demo's book at 900px, the grid started at y=153 while this was
   * showing and at y=297 once the book landed, so every tile dropped
   * 144px the moment it did.
   */
  cycles?: boolean;
  /**
   * Whether a pass was OPEN in that panel last time this device saw it.
   * A never-started book's panel opens on three lines of prose; a
   * mid-cycle book — the one a returning reader actually opens — draws
   * a single status line, ~37px shorter. The caller stores which.
   */
  cyclesOpen?: boolean;
  /**
   * The paragraph the cold panel opens with — the caller's own words,
   * because how many lines they take is decided by the column's width
   * and the language, not by anything a placeholder can know. Measured
   * on the demo: the three lines guessed here were two on a 1280px
   * desktop in Korean and four on a 390px phone, so the grid below
   * landed 7px higher on the one and 41px lower on the other. Laid out
   * invisibly at the paragraph's own type, the reservation is exact at
   * any width; the bars are painted over it and clipped to its height.
   */
  cyclesProse?: string;
  className?: string;
}) {
  return (
    <Loading className={className}>
      {cycles && (
        // The Panel's own box: pt-0 and a --card-spacing floor (ui/card),
        // a min-h-11 header with no rule under it, then the paragraph the
        // panel opens with at text-sm/relaxed.
        // `--card-pad`, not `--card-spacing`: the latter exists only on a
        // Card (ui/card sets it from --card-pad on the root), so outside
        // one it is nothing — measured, the header bar sat on the column's
        // edge and the panel had no floor, 16px short of the Panel's.
        // `[--card-spacing:var(--card-pad)]` for the same reason: the
        // PanelHeader below pads itself from --card-spacing, which a Card
        // sets and this bare box does not.
        <div className="bg-card mb-4 flex flex-col overflow-hidden rounded-xl ring-1 ring-card-ring pb-(--card-pad) [--card-spacing:var(--card-pad)]">
          {/* The panel's own header and its own act, inert. The title is
              known, and the act depends only on `cyclesOpen`, which the
              caller stored: an open pass shows Stop and Continue, a cold
              panel the one Start button (CyclesPanel, BookPage). A cold
              book that has finished passes says "Start the next cycle",
              which is wider; the stored flag does not say which, so the
              shorter face stands for both. */}
          <PanelHeader
            title={t('Cycles')}
            actions={
              cyclesOpen ? (
                <>
                  <Button variant="ghost" size="sm" {...INERT}>
                    <CircleStop className="glyph" data-icon="inline-start" />
                    {t('Stop')}
                  </Button>
                  <Button variant="default" size="sm" {...INERT}>
                    <RotateCw className="glyph" data-icon="inline-start" />
                    {t('Continue')}
                  </Button>
                </>
              ) : (
                <Button variant="default" size="sm" {...INERT}>
                  <Repeat className="glyph" data-icon="inline-start" />
                  {t('Start a cycle')}
                </Button>
              )
            }
          />
          {/* No gap between the line boxes: the three bars are the wrapped
              lines of ONE paragraph, and wrapped lines meet — the panel's
              own gap-2 is between its children, of which the cold state
              has one. With gap-1 the body stood 8px taller than the prose
              that replaced it. */}
          {cyclesOpen ? (
            // The open pass's single status line (text-sm, 20px).
            <div className="flex h-5 items-center px-(--card-pad)">
              <Skeleton className="h-2.5 w-40" />
            </div>
          ) : cyclesProse ? (
            // The paragraph itself, invisible, at the panel's own
            // text-sm/relaxed; the bars sit over it in 23px boxes and the
            // wrapper clips them to its height, so exactly as many bars
            // show as there are lines (the box is a quarter-pixel taller
            // than the line, which puts the first bar past the text at
            // any count under thirty).
            <div className="relative overflow-hidden px-(--card-pad)">
              <p className="invisible text-sm leading-relaxed">{cyclesProse}</p>
              <div className="absolute inset-x-(--card-pad) inset-y-0 flex flex-col" aria-hidden>
                {['w-full', 'w-11/12', 'w-full', 'w-2/3', 'w-full', 'w-10/12', 'w-full', 'w-1/2'].map((w, i) => (
                  <div key={i} className="flex h-[1.4375rem] shrink-0 items-center">
                    <Skeleton className={cn('h-2', w)} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col px-(--card-pad)">
              {['w-full', 'w-11/12', 'w-2/3'].map((w) => (
                <div key={w} className="flex h-[1.4375rem] items-center">
                  <Skeleton className={cn('h-2', w)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* The Progress track itself, empty: ProgressBar (components/
          progress-bar) is this primitive with two fills, and the fills
          are the data. Hidden from assistive tech, as its `decorative`
          rows are, so nothing announces "0%" under the Loading label. */}
      <Progress value={0} className="mb-3" aria-hidden />
      {/* The two Selects the list draws (PuzzleList): Status and
          Fidelity, prefixed and `steady`, so each trigger is already the
          width of its widest face. Status has its whole option list;
          Fidelity's is built from the book's tiers, so only its two
          fixed faces (the prefix and "Any") are known, and it stands at
          those. Inert (see `Inert`): the phone face is a button of its
          own that would open the sheet. */}
      <Inert>
        <div className="mb-2 flex items-center gap-2">
          <Select
            value="all"
            ariaLabel={t('Filter by state')}
            size="sm"
            prefix="Status"
            steady
            disabled
            groups={[
              {
                options: (
                  [
                    ['all', 'All'],
                    ['new', 'New'],
                    ['failed', 'Failed'],
                    ['solved', 'Solved'],
                  ] as const
                ).map(([value, label]) => ({ value, label })),
              },
            ]}
          />
          <Select
            value="all"
            ariaLabel={t('Filter by how the puzzle was verified')}
            size="sm"
            prefix="Fidelity"
            steady
            disabled
            groups={[{ options: [{ value: 'all', label: 'Any' }] }]}
          />
        </div>
      </Inert>
      <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {Array.from({ length: tiles }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-lg" />
        ))}
      </div>
    </Loading>
  );
}
