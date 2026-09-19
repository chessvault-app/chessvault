import { useState } from 'react';
import { FilterChip } from '@/components/filter-chip';
import { DatePicker } from '@/components/date-picker';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Segmented } from '@/components/segmented';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Inert, Skeleton, SkeletonSubtitle } from '@/components/skeletons';
import { FilterRow, SideSelect, type SideFilter } from '@/games/GameFilters';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { INSIGHTS_COPY } from './copy';
const exact = new Intl.NumberFormat('en');
import { DATE_RANGES, DATE_RANGE_LABEL, type DateRange } from '@/insights/dateRange';
import type { MyGamesFilters } from '@/store/explorer';
import type { Speed } from '@/store/explorer';
import { readShape, type Shape } from '@/insights/shape';

/** The six verdicts the review gives a move, in the order the bar stacks
    them (the move tree's own NAG inks). */
export type QualityKey = 'brilliant' | 'good' | 'book' | 'inaccuracy' | 'mistake' | 'blunder';
export const QUALITY: { key: QualityKey; label: string; glyph: string; ink: string }[] = [
  { key: 'brilliant', label: 'Brilliant', glyph: '!!', ink: 'bg-nag-brilliant' },
  { key: 'good', label: 'Good', glyph: '', ink: 'bg-nag-good' },
  { key: 'book', label: 'Theory', glyph: '', ink: 'bg-nag-book' },
  { key: 'inaccuracy', label: 'Inaccuracy', glyph: '?!', ink: 'bg-nag-dubious' },
  { key: 'mistake', label: 'Mistake', glyph: '?', ink: 'bg-nag-mistake' },
  { key: 'blunder', label: 'Blunder', glyph: '??', ink: 'bg-nag-blunder' },
];

/** The explorer's filters plus the quick date range. */
export interface InsightsFilters extends MyGamesFilters {
  /** A quick range, or 'custom' for whatever `from` and `to` hold. */
  range: DateRange;
}

export const EMPTY_FILTERS: InsightsFilters = { range: 'any' };

export const FILTERS_KEY = 'vault:insights-filters';
const SPEEDS: { id: Speed; label: string }[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'classical', label: 'Classical' },
];

export const SPEED_LABEL: Record<Speed | 'unknown', string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
  unknown: 'No time control',
};

export const SIDE_LABEL = { white: 'As White', black: 'As Black' } as const;

export function readFilters(): InsightsFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return EMPTY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<InsightsFilters>;
    return { ...EMPTY_FILTERS, ...parsed };
  } catch {
    return EMPTY_FILTERS;
  }
}

/**
 * The Insights page while its chunk is on the wire.
 *
 * Not a reduced version of the page: the page's own filter rail over the
 * page's own outline of cards, which is the longest column in the app
 * and is built from what this device saw last visit (./shape). The page
 * draws the same two while /api/insights is out, so one picture covers
 * both waits.
 *
 * The rail is held inert, which is what the page does with it too until
 * a report has landed (`gated`). Its controls are the real ones showing
 * the filters this device last chose, because those are stored and known
 * before anything is fetched.
 *
 * The header's Analyse button is the one thing left out: it is live, it
 * reports a running pass, and it sits on the title row where its absence
 * moves nothing.
 *
 * The back chevron is live and is not left out. A phone reaches this
 * page from More and the settled header draws one, so without it the
 * title sat 44px left of where it lands; live because it needs nothing
 * that is still on the wire.
 */
export default function InsightsOutline() {
  const [shape] = useState(readShape);
  const [filters] = useState(readFilters);
  return (
    <PageShell width="medium">
      <PageHeader
        title={t('Insights')}
        back={() => navigate('more')}
        subtitle={<SkeletonSubtitle />}
        description={t(
          'Your results by colour, time control and opening, and where each game left the opening catalogue.',
        )}
      />
      {shape.analysed && (
        <InsightsRail filters={filters} onChange={NOOP} onClear={NOOP} narrowed={false} inert />
      )}
      <InsightsSkeleton shape={shape} />
    </PageShell>
  );
}

const NOOP = (): void => {};

/**
 * The rail of filters over the report: how far back, which side, which
 * speeds, whether only collected games.
 *
 * Its own component so the page and the page's outline draw one rail.
 * Everything in it is a stored choice, so it is known before the report
 * is; `inert` is what the page passes while it has no report and what
 * the outline passes always.
 */
export function InsightsRail({
  filters,
  onChange,
  onClear,
  narrowed,
  inert,
}: {
  filters: InsightsFilters;
  onChange: (patch: Partial<InsightsFilters>) => void;
  onClear: () => void;
  narrowed: boolean;
  inert: boolean;
}) {
  const speeds = filters.speeds ?? [];
  return (
  <FilterRow className="px-0 py-0">
    <MaybeInert inert={inert}>
    <Select
      value={filters.range}
      onValueChange={(v) => onChange({ range: v as DateRange })}
      ariaLabel={t('Played within')}
      size="sm"
      className="w-36 flex-none"
      groups={[{ options: DATE_RANGES.map((r) => ({ value: r, label: t(DATE_RANGE_LABEL[r]) })) }]}
    />
    {filters.range === 'custom' && (
      <span className="flex items-center gap-2">
        <DatePicker
          value={filters.from ?? ''}
          onValueChange={(v) => onChange({ from: v || undefined })}
          aria-label={t('From date')}
          className="w-[9.5rem]"
        />
        <span className="text-muted-foreground" aria-hidden>
          –
        </span>
        <DatePicker
          value={filters.to ?? ''}
          onValueChange={(v) => onChange({ to: v || undefined })}
          aria-label={t('To date')}
          className="w-[9.5rem]"
        />
      </span>
    )}
    <SideSelect
      value={(filters.side ?? 'any') as SideFilter}
      onChange={(v) => onChange({ side: v === 'any' ? undefined : v })}
      className="w-32 flex-none"
    />
    {SPEEDS.map(({ id, label }) => (
      <FilterChip
        key={id}
        label={label}
        active={speeds.includes(id)}
        onClick={() =>
          onChange({ speeds: speeds.includes(id) ? speeds.filter((s) => s !== id) : [...speeds, id] })
        }
      />
    ))}
    <FilterChip
      label="Kept only"
      title="Only the games in your collection, not every archived game"
      active={filters.collectionOnly === true}
      onClick={() => onChange({ collectionOnly: filters.collectionOnly ? undefined : true })}
    />
    {narrowed && (
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('Clear filters')}
      </Button>
    )}
    </MaybeInert>
  </FilterRow>
  );
}

/** A stored figure as the digits it will print, or a three-digit
    stand-in where this device has not seen the page. */
const figureDigits = (n: number): string => (n > 0 ? exact.format(n) : '000');

/** The filter row's controls, live or held still, from one subtree: the
    stand-in has to BE the row or it is a second statement of its width. */
function MaybeInert({ inert, children }: { inert: boolean; children: React.ReactNode }) {
  return inert ? <Inert>{children}</Inert> : <>{children}</>;
}

export function InsightsSkeleton({ shape }: { shape: Shape }) {
  /**
   * A table's header band and its rows, at the geometry Tables draws.
   *
   * Two boxes deep, and it has to be: the `<th>`/`<td>` heights are a
   * line box PLUS a padding, and these are border-box, so a padding on
   * the same element that carries the height comes out of the line
   * instead of adding to it. The outer div is the padding the cell
   * carries (`py-1` on a head, the density token on a row) and the inner
   * one is the line the type sets.
   *
   * Both were flat: `h-6` for a header and `h-7` for a row, which is the
   * settled geometry on a fine-pointer desktop at the comfortable rung
   * and nowhere else. A row is 20px + 2×4 there, 24 + 2×4 on a phone
   * (`type-row` steps up under md) and 20 + 2×2 on a compact vault.
   * Computed from those and the default Shape's row counts, not measured:
   * `/api/insights` 404s on the static demo, so this page cannot be
   * photographed there. About 270px short over the outline on a phone,
   * and about 250 long on a compact desktop.
   */
  const headRow = (children: React.ReactNode) => (
    <div className="flex flex-col py-1">
      <div className="type-row-sub-box flex items-center gap-2">{children}</div>
    </div>
  );
  const bodyRow = (key: number, children: React.ReactNode) => (
    <div key={key} className="flex flex-col py-(--row-py-tight)">
      <div className="type-row-box flex items-center gap-2">{children}</div>
    </div>
  );
  /**
   * A results row: name, count, the result bar's own box, a figure.
   *
   * `dense` is TallyTable's own prop, and it decides whether there is a
   * Results column at all: the weekday table passes it, because at 80px
   * the bar printed its figures over each other. Below sm the column
   * steps aside on every table. Neither was asked here, so a 144px bar
   * stood in for a column that lands on no phone and in no weekday
   * table.
   */
  const table = (rows: number, key: string, dense = false) => (
    <div key={key} className="flex flex-col">
      {headRow(
        <>
          <Skeleton className="h-2 w-16" />
          <Skeleton className="ml-auto h-2 w-8" />
          {!dense && <Skeleton className="h-2 w-10 max-sm:hidden" />}
          <Skeleton className="ml-20 h-2 w-8" />
        </>,
      )}
      {Array.from({ length: rows }, (_, i) =>
        bodyRow(
          i,
          <>
            <Skeleton className={cn('h-2.5', ['w-24', 'w-20', 'w-28', 'w-16'][i % 4])} />
            <Skeleton className="ml-auto h-2.5 w-6" />
            {/* The result bar's box: its 16px track and the chip corner. */}
            {!dense && <Skeleton className="h-4 w-36 rounded-[4px] max-sm:hidden" />}
            <Skeleton className="h-2.5 w-8" />
          </>,
        ),
      )}
    </div>
  );
  /** The leaving-book row: a name and four figures, and no result bar,
      which that table has no column for. */
  const bookTable = (rows: number, key: string) => (
    <div key={key} className="flex flex-col">
      {headRow(
        <>
          <Skeleton className="h-2 w-16" />
          <Skeleton className="ml-auto h-2 w-8" />
          <Skeleton className="ml-2 h-2 w-16" />
          <Skeleton className="ml-2 h-2 w-6" />
          <Skeleton className="ml-2 h-2 w-8" />
        </>,
      )}
      {Array.from({ length: rows }, (_, i) =>
        bodyRow(
          i,
          <>
            <Skeleton className={cn('h-2.5', ['w-24', 'w-20', 'w-28', 'w-16'][i % 4])} />
            <Skeleton className="ml-auto h-2.5 w-6" />
            <Skeleton className="ml-2 h-2.5 w-10" />
            <Skeleton className="ml-2 h-2.5 w-6" />
            <Skeleton className="ml-2 h-2.5 w-6" />
          </>,
        ),
      )}
    </div>
  );
  /** A table with no result bar: a word, a count, a share. */
  const plain = (rows: number, key: string, head = false) => (
    <div key={key} className="flex flex-col">
      {head &&
        headRow(
          <>
            <Skeleton className="h-2 w-16" />
            <Skeleton className="ml-auto h-2 w-10" />
            <Skeleton className="ml-2 h-2 w-8" />
          </>,
        )}
      {Array.from({ length: rows }, (_, i) =>
        bodyRow(
          i,
          <>
            <Skeleton className={cn('h-2.5', ['w-20', 'w-24', 'w-16', 'w-28'][i % 4])} />
            <Skeleton className="ml-auto h-2.5 w-8" />
            <Skeleton className="ml-2 h-2.5 w-8" />
          </>,
        ),
      )}
    </div>
  );
  /**
   * A card header drawn from the words that are coming: the real title
   * and description laid out invisible, with bars clipped over them, so
   * the box is whatever those words wrap to. A fixed line count was
   * wrong on a phone, where these descriptions take three and four
   * lines against the desk's one and two.
   */
  const card = (
    key: string,
    title: string,
    desc: string,
    body: React.ReactNode,
    content = 'flex flex-col gap-4',
  ) => (
    <Card key={key}>
      <CardHeader>
        <div className="relative">
          <CardTitle className="invisible">{title}</CardTitle>
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <Skeleton className="h-3.5 w-24" />
          </div>
        </div>
        <div className="relative max-w-prose overflow-hidden">
          <CardDescription className="invisible">{desc}</CardDescription>
          <div className="absolute inset-0 flex flex-col" aria-hidden>
            {['w-full', 'w-11/12', 'w-full', 'w-2/3'].map((w, i) => (
              <div key={i} className="flex h-5 shrink-0 items-center">
                <Skeleton className={cn('h-2.5', w)} />
              </div>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className={content}>{body}</CardContent>
    </Card>
  );
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={t('Loading')} aria-live="polite">
      {card(
        'results',
        INSIGHTS_COPY.results.title(),
        INSIGHTS_COPY.results.desc(),
        <>
          {/* Overall, by colour, by time control. */}
          {[1, 2, shape.speeds].map((rows, i) => table(rows, `results-${i}`))}
          {/* The "Accuracy from n of N games analysed at depth d, m
              centipawns lost per move. Start over" footnote. One line on a
              desk and three on a phone, so the sentence itself sets the box
              and a bar sits over its first line, the way the settings link
              row reserves its words. The figures are tabular, so stand-in
              digits measure what the real ones will. */}
          {shape.quality && (
            <div className="relative">
              <p
                aria-hidden
                className="invisible flex flex-wrap items-baseline gap-x-2 type-row-sub tabular-nums"
              >
                <span>
                  {t('Accuracy from {n} of {total} games analysed at depth {d}', {
                    // This device's own figures where it has them: the
                    // idiom below sets the box from the sentence, and the
                    // sentence's length rides its digits. With `000` for
                    // both, a vault of 31 games reserved a line more than
                    // it settled at.
                    n: figureDigits(shape.accGames),
                    total: figureDigits(shape.games),
                    d: '00',
                  })}
                  {`, ${t('{n} centipawns lost per move', { n: '00' })}`}.{' '}
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 align-baseline type-row-sub"
                    tabIndex={-1}
                  >
                    {t('Start over')}
                  </Button>
                </span>
              </p>
              <div className="absolute inset-x-0 top-0 flex h-4 items-center" aria-hidden>
                <Skeleton className="h-2 w-72 max-w-full" />
              </div>
            </div>
          )}
        </>,
      )}
      {shape.quality &&
        card(
          'quality',
          INSIGHTS_COPY.quality.title(),
          INSIGHTS_COPY.quality.desc(),
          <>
            {/* The stacked verdict bar: 16px, on the chip corner. */}
            <Skeleton className="h-4 w-full rounded-[4px]" />
            {plain(QUALITY.length, 'verdicts', true)}
            {/* By phase and by move number: a label, a count and an
                accuracy, with no bar between them. */}
            {plain(3, 'phase', true)}
            {plain(shape.moveBands, 'moves', true)}
          </>,
        )}
      {card(
        'openings',
        INSIGHTS_COPY.openings.title(),
        INSIGHTS_COPY.openings.desc(),
        table(shape.openings, 'openings'),
        'flex flex-col gap-2',
      )}
      {card(
        'book',
        INSIGHTS_COPY.book.title(),
        INSIGHTS_COPY.book.desc(),
        <>
          {/* The "Your move left book first in n of N games, on average at
              move m" line. It is one line on a desk and two on a phone, so
              the sentence itself sets the box and bars are clipped over it;
              the figures are tabular, so stand-in digits measure the same. */}
          {shape.summary && (
            <div className="relative overflow-hidden">
              <p aria-hidden className="invisible text-sm tabular-nums">
                {t('Your move left book first in {you} of {n} games, on average at move {m}.', {
                  you: '00',
                  n: '000',
                  m: '00',
                })}
              </p>
              <div className="absolute inset-0 flex flex-col" aria-hidden>
                {['w-full', 'w-2/3'].map((w) => (
                  <div key={w} className="flex h-5 shrink-0 items-center">
                    <Skeleton className={cn('h-2.5', w)} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {bookTable(shape.book, 'book')}
        </>,
        'flex flex-col gap-3',
      )}
      {/* Compare, where the report does not decide whether it stands:
          the card rides /api/refgames, so what this device saw last
          visit is the only thing that can say (./shape, `compare`). It
          sits HERE, between Leaving book and Activity, which is why
          leaving it out did not merely lose a card at the foot of the
          page — the three below it were reserved in the wrong places
          and dropped by its whole height when the report landed. The
          comment on the card helper records fixing exactly this for
          Move quality; it went on happening one card along. */}
      {shape.compare &&
        card(
          'compare',
          INSIGHTS_COPY.compare.title(),
          INSIGHTS_COPY.compare.desc('white'),
          <>
            {/* The side toggle and, where there is more than one
                database, the picker beside it. Held inert, as every
                other known control in a placeholder is. */}
            <div className="flex flex-wrap items-center gap-2">
              <Inert>
                <Segmented
                  value="white"
                  onChange={NOOP}
                  ariaLabel="Side"
                  segments={[
                    { value: 'white', label: t('White') },
                    { value: 'black', label: t('Black') },
                  ]}
                />
              </Inert>
            </div>
            {/* "At level" over its chip row. */}
            <div className="flex flex-col gap-1.5">
              <div className="type-row-box flex items-center">
                <Skeleton className="h-2.5 w-16" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {['w-12', 'w-16', 'w-20', 'w-16', 'w-14'].map((w) => (
                  <Skeleton key={w} className={cn('h-7 rounded-full', w)} />
                ))}
              </div>
            </div>
            {/* The card's own three-row wait, at its own geometry. */}
            <div className="flex flex-col gap-px">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-0.5 px-2 py-(--row-py-dense)">
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-2.5 w-2/5" />
                  </div>
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-2 w-4/5" />
                  </div>
                </div>
              ))}
            </div>
          </>,
          'flex flex-col gap-3',
        )}
      {card(
        'activity',
        INSIGHTS_COPY.activity.title(),
        INSIGHTS_COPY.activity.desc(),
        <>
          <div className="min-w-0">
            {/* The figure's four lines around its chart, each on
                `type-row-sub` as ActivityCard sets them, at the figure's
                own margins. They were `h-4`, the desktop half of that
                rung, and the third of them was not drawn at all: the
                pressed month's figures, which stand as an empty
                `min-h-4` line until a bar is pressed and are the one
                place a phone can read a month's split. Measured on the
                demo at 390: the card was 582px against the 614 it
                settled at, 4px for each caption line and 24 for the
                missing one. */}
            <div className="type-row-sub-box mb-1 flex items-center">
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-32 w-full" />
            <div className="type-row-sub-box mt-1 flex items-center justify-between">
              <Skeleton className="h-2 w-16" />
              <Skeleton className="h-2 w-16" />
            </div>
            {/* Empty, as it settles: nothing is pressed yet, and a bar
                here would stand for a figure the page is not going to
                print by itself. `min-h-4` alone, NOT the type box beside
                it: an empty block generates no line, so the real <p> is
                its 16px floor at both widths and the rung never applies.
                Measured: with the box it came out 618 against 614. */}
            <div className="mt-1 min-h-4" aria-hidden />
            <div className="type-row-sub-box mt-2 flex items-center gap-3">
              {['w-10', 'w-10', 'w-8'].map((w) => (
                <Skeleton key={w} className={cn('h-2', w)} />
              ))}
            </div>
          </div>
          {shape.weekdays > 0 && table(shape.weekdays, 'week', true)}
        </>,
        'grid gap-6 md:grid-cols-[1fr_18rem]',
      )}
      {card(
        'endings',
        INSIGHTS_COPY.endings.title(),
        INSIGHTS_COPY.endings.desc(),
        <>
          {['won', 'drew', 'lost'].map((key) => (
            <div key={key} className="flex min-w-0 flex-col gap-3">
              {/* The figcaption: a word and an accuracy, on the column's
                  own `type-row-sub`. Pinned at 16 it was the desktop
                  rung, so each of the three columns stood 4px short on a
                  phone and the card 12. */}
              <div className="type-row-sub-box flex items-center justify-between">
                <Skeleton className="h-2 w-10" />
                <Skeleton className="h-2 w-12" />
              </div>
              {/* The donut is size-28 and centred in its column. */}
              <Skeleton className="mx-auto size-28 rounded-full" />
              {plain(shape.endings, `legend-${key}`)}
            </div>
          ))}
        </>,
        'grid gap-6 sm:grid-cols-3',
      )}
      {shape.lengths > 0 &&
        card(
          'length',
          INSIGHTS_COPY.length.title(),
          INSIGHTS_COPY.length.desc(),
          table(shape.lengths, 'length'),
          '',
        )}
    </div>
  );
}
