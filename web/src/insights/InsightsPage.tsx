import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Progress } from '@/components/ui/progress';
import { PASS_DEPTH, useAnalysisJob } from './analysisJob';
import { ChartColumn } from 'lucide-react';
import type { Ending, Speed } from '@shared/gameIndex';
import { api } from '@/lib/api';
import { t, useLang } from '@/lib/i18n';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/date-picker';
import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { ResultBar } from '@/components/result-bar';
import { TitleTip } from '@/components/title-tip';
import { Skeleton, SkeletonSubtitle, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { FilterRow, SideSelect, type SideFilter } from '@/games/GameFilters';
import { hasMyFilters, myFilterQuery, type MyGamesFilters } from '@/store/explorer';
import {
  bandRows,
  earliestExits,
  endingShares,
  exitSplit,
  monthSeries,
  moveOfPly,
  openingRows,
  scorePct,
  tallyBy,
  totals,
  accuracyOf,
  meanOf,
  type AccMean,
  type InsightsCell,
  type MonthTally,
  type OpeningRow,
  type Tally,
} from './aggregate';
import { DATE_RANGES, DATE_RANGE_LABEL, rangeFrom, type DateRange } from './dateRange';

/**
 * Your own games, summed.
 *
 * The explorer answers one position at a time and the games page lists
 * one game at a time; neither could say how the Italian has gone for you
 * as White in blitz, or where your own preparation runs out. This page
 * asks the server for the sums (server/myGames.ts, insights) under the
 * same filters the explorer's My games source takes, plus a quick date
 * range, and regroups the answer four ways (insights/aggregate.ts). Nothing here is a verdict on the player: the
 * tables are counts of what happened, and a rating is nowhere on them.
 */

/** The explorer's filters plus the quick date range. */
interface InsightsFilters extends MyGamesFilters {
  /** A quick range, or 'custom' for whatever `from` and `to` hold. */
  range: DateRange;
}

const EMPTY_FILTERS: InsightsFilters = { range: 'any' };
const FILTERS_KEY = 'vault:insights-filters';
/** What the page drew last visit: how many opening and leaving-book rows,
    and whether the book summary line stood. The skeleton reserves that,
    the way the Databases page reserves its list, so the answer lands on
    the outline instead of moving it. */
const SHAPE_KEY = 'vault:insights-shape';
interface Shape {
  openings: number;
  book: number;
  summary: boolean;
}
const DEFAULT_SHAPE: Shape = { openings: 8, book: 4, summary: false };
function readShape(): Shape {
  try {
    const raw = localStorage.getItem(SHAPE_KEY);
    if (!raw) return DEFAULT_SHAPE;
    const p = JSON.parse(raw) as Partial<Shape>;
    return {
      openings: Math.min(OPENING_FOLD, Math.max(0, Number(p.openings) || 0)),
      book: Math.max(0, Number(p.book) || 0),
      summary: p.summary === true,
    };
  } catch {
    return DEFAULT_SHAPE;
  }
}

const SPEEDS: { id: Speed; label: string }[] = [
  { id: 'bullet', label: 'Bullet' },
  { id: 'blitz', label: 'Blitz' },
  { id: 'rapid', label: 'Rapid' },
  { id: 'classical', label: 'Classical' },
];

const SPEED_LABEL: Record<Speed | 'unknown', string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
  unknown: 'No time control',
};

const SIDE_LABEL = { white: 'As White', black: 'As Black' } as const;

/** English, as the key t() looks up; the words the sites use. */
const ENDING_LABEL: Record<Ending, string> = {
  mate: 'Checkmate',
  resignation: 'Resignation',
  timeout: 'Time',
  abandoned: 'Abandoned',
  stalemate: 'Stalemate',
  agreement: 'Agreement',
  repetition: 'Repetition',
  insufficient: 'Insufficient material',
  fifty: 'Fifty-move rule',
  unknown: 'Not recorded',
};

/** How many opening rows show before "Show all". */
const OPENING_FOLD = 20;

const exact = new Intl.NumberFormat('en');
const pct = (n: number | null): string => (n === null ? '' : `${Math.round(n)}%`);

function readFilters(): InsightsFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return EMPTY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<InsightsFilters>;
    return { ...EMPTY_FILTERS, ...parsed };
  } catch {
    return EMPTY_FILTERS;
  }
}

/** What the server is asked: the explorer's query, with a quick range
    standing in for the pickers' dates (custom keeps them). */
function filterQuery(f: InsightsFilters): string {
  const dates =
    f.range === 'custom'
      ? { from: f.from, to: f.to }
      : { from: rangeFrom(f.range) ?? undefined, to: undefined };
  return myFilterQuery({ ...f, ...dates });
}

interface Report {
  games: number;
  named: boolean;
  /** Summed while the index was still walking the vault; ask again. */
  partial: boolean;
  cells: InsightsCell[];
  /** The other cuts of the same games; see server/myGames.ts InsightsExtras. */
  months: { month: string; w: number; d: number; l: number; accSum: number; accN: number }[];
  weekdays: { day: number; w: number; d: number; l: number; accSum: number; accN: number }[];
  endings: { ending: Ending; w: number; d: number; l: number }[];
  lengths: { band: number; w: number; d: number; l: number; accSum: number; accN: number }[];
  /** The engine pass's cuts; see server/myGames.ts InsightsAnalysis. */
  analysis: {
    games: number;
    depth: number | null;
    accuracy: AccMean;
    acpl: AccMean;
    byOutcome: ({ outcome: 'w' | 'd' | 'l' } & AccMean)[];
    byPhase: ({ phase: number } & AccMean)[];
    byMove: ({ band: number } & AccMean)[];
    quality: {
      book: number;
      good: number;
      brilliant: number;
      inaccuracy: number;
      mistake: number;
      blunder: number;
    };
  };
}

export function InsightsPage() {
  const [filters, setFiltersState] = useState<InsightsFilters>(readFilters);
  const setFilters = useCallback((patch: Partial<InsightsFilters>) => {
    setFiltersState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(next));
      } catch {
        // A browser with no storage still gets the page; it just forgets.
      }
      return next;
    });
  }, []);

  const query = useMemo(() => filterQuery(filters), [filters]);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The page is GATED on the engine pass (lanph3re's call): its tables
  // stand only once every game of yours has been through the engine, so
  // no figure on it is ever a mixture of judged and unjudged games. Until
  // the pass has answered how far it is, while games are owed, and while
  // a run is going, the page draws its outline and the strip under the
  // header says how far along the pass is. When the gate opens the
  // report is asked again, since it was fetched before the last games
  // landed.
  const job = useAnalysisJob();
  const owed = Math.max(0, job.total - job.analysed);
  const gated = !job.known || job.status === 'running' || (job.total > 0 && owed > 0);
  const wasGated = useRef(gated);
  useEffect(() => {
    if (wasGated.current && !gated) setAttempt((n) => n + 1);
    wasGated.current = gated;
  }, [gated]);
  useEffect(() => {
    const controller = new AbortController();
    let again: ReturnType<typeof setTimeout> | null = null;
    setFailed(false);
    const ask = (): void => {
      api<Report>(`/api/mygames/insights${query ? `?${query}` : ''}`, { signal: controller.signal })
        .then((body) => {
          setReport(body);
          // A first visit on a vault the index has not finished walking
          // answers from what is indexed so far; the sums settle a
          // second or two later, so ask again until they do.
          if (body.partial) again = setTimeout(ask, 1000);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === 'AbortError') return;
          setReport(null);
          setFailed(true);
        });
    };
    ask();
    return () => {
      controller.abort();
      if (again) clearTimeout(again);
    };
  }, [query, attempt]);

  // The pass's count is asked again with every report: the first answer
  // can come while the index is still walking a big vault, and the
  // report's own re-ask (see `partial`) is when the totals settle.
  useEffect(() => {
    if (report !== null) void useAnalysisJob.getState().refresh();
  }, [report]);

  const [shape] = useState(readShape);
  useEffect(() => {
    if (report === null) return;
    const openings = openingRows(report.cells);
    const next: Shape = {
      openings: Math.min(OPENING_FOLD, openings.length),
      book: earliestExits(openings).length,
      summary: exitSplit(report.cells).exits > 0,
    };
    try {
      localStorage.setItem(SHAPE_KEY, JSON.stringify(next));
    } catch {
      // Nothing to reserve next time; the default outline serves.
    }
  }, [report]);

  // The previous answer stays on the page while the next is fetched, so
  // a chip press changes the numbers rather than blanking the tables.
  const slow = useSlowLoad(report === null && !failed);
  const narrowed =
    hasMyFilters({ ...filters, from: undefined, to: undefined }) || filters.range !== 'any';
  const clear = (): void => setFilters({ ...EMPTY_FILTERS, side: undefined, speeds: [], from: undefined, to: undefined, collectionOnly: undefined });

  const speeds = filters.speeds ?? [];

  return (
    <PageShell width="medium">
      {/* Phones reach this from More; a desktop has it in the sidebar. */}
      <PageHeader
        title={t('Insights')}
        back={() => navigate('more')}
        subtitle={
          report !== null ? (
            <span className="tabular-nums">{t('{n} games', { n: exact.format(report.games) })}</span>
          ) : (
            slow && <SkeletonSubtitle />
          )
        }
        description={t(
          'Your results by colour, time control and opening, and where each game left the opening catalogue. The filters narrow every table below.',
        )}
        actions={<PassButton />}
      />
      <PassStrip />

      <FilterRow className="px-0 py-0">
        <SideSelect
          value={(filters.side ?? 'any') as SideFilter}
          onChange={(v) => setFilters({ side: v === 'any' ? undefined : v })}
          className="w-32 flex-none"
        />
        {SPEEDS.map(({ id, label }) => (
          <FilterChip
            key={id}
            label={label}
            active={speeds.includes(id)}
            onClick={() =>
              setFilters({ speeds: speeds.includes(id) ? speeds.filter((s) => s !== id) : [...speeds, id] })
            }
          />
        ))}
        <FilterChip
          label="Kept only"
          title="Only the games in your collection, not every archived game"
          active={filters.collectionOnly === true}
          onClick={() => setFilters({ collectionOnly: filters.collectionOnly ? undefined : true })}
        />
        <Select
          value={filters.range}
          onValueChange={(v) => setFilters({ range: v as DateRange })}
          ariaLabel={t('Played within')}
          size="sm"
          className="w-36 flex-none"
          groups={[{ options: DATE_RANGES.map((r) => ({ value: r, label: t(DATE_RANGE_LABEL[r]) })) }]}
        />
        {filters.range === 'custom' && (
          <span className="flex items-center gap-2">
            <DatePicker
              value={filters.from ?? ''}
              onValueChange={(v) => setFilters({ from: v || undefined })}
              aria-label={t('From date')}
              className="w-[9.5rem]"
            />
            <span className="text-muted-foreground" aria-hidden>
              –
            </span>
            <DatePicker
              value={filters.to ?? ''}
              onValueChange={(v) => setFilters({ to: v || undefined })}
              aria-label={t('To date')}
              className="w-[9.5rem]"
            />
          </span>
        )}
        {narrowed && (
          <Button variant="ghost" size="sm" onClick={clear}>
            {t('Clear filters')}
          </Button>
        )}
      </FilterRow>

      {failed ? (
        <div className="text-muted-foreground flex items-center gap-3 text-sm">
          <span>{t('The report could not be loaded.')}</span>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
            {t('Retry')}
          </Button>
        </div>
      ) : report === null || (gated && job.total > 0) ? (
        (slow || gated) && <InsightsSkeleton shape={shape} />
      ) : report.games === 0 ? (
        narrowed ? (
          <EmptyState
            icon={ChartColumn}
            title="No games match"
            body="Loosen a filter above, or clear them all."
            action={
              <Button variant="secondary" size="sm" onClick={clear}>
                {t('Clear filters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ChartColumn}
            title="No games of yours yet"
            body="Games count here once your side in them is known. Keep a game with your side marked, or browse one of your Chess.com or Lichess months on the Games page."
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('games')}>
                {t('Open games')}
              </Button>
            }
          />
        )
      ) : (
        <Tables report={report} />
      )}
    </PageShell>
  );
}

function Tables({ report }: { report: Report }) {
  const { cells } = report;
  const all = totals(cells);
  const byColour = tallyBy(cells, 'side');
  const bySpeed = tallyBy(cells, 'speed');
  const openings = useMemo(() => openingRows(cells), [cells]);
  const exits = earliestExits(openings);
  const split = exitSplit(cells);
  const [allOpenings, setAllOpenings] = useState(false);
  const shown = allOpenings ? openings : openings.slice(0, OPENING_FOLD);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('Results')}</CardTitle>
          <CardDescription>{t('Score is wins plus half the draws, out of the games played.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* The whole corpus is the first row of the same table shape the
              cuts below use, not a headline: two large figures over a bare
              bar read as a banner, and the bar did not read as the total
              (lanph3re's report). One row with the same columns says
              "this is the sum of those" by its shape alone. */}
          <TallyTable
            caption={t('Overall')}
            rows={[{ key: 'all', label: t('All games'), tally: all }]}
          />
          <TallyTable
            caption={t('By colour')}
            rows={byColour.map((r) => ({ key: r.key, label: t(SIDE_LABEL[r.key]), tally: r.tally }))}
          />
          <TallyTable
            caption={t('By time control')}
            rows={bySpeed.map((r) => ({ key: r.key, label: t(SPEED_LABEL[r.key]), tally: r.tally }))}
          />
          {report.analysis.games > 0 && (
            <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-2 text-xs tabular-nums">
              <span>
                {t('Accuracy from {n} of {total} games analysed at depth {d}', {
                  n: exact.format(report.analysis.games),
                  total: exact.format(report.games),
                  d: report.analysis.depth ?? PASS_DEPTH,
                })}
                {meanOf(report.analysis.acpl) !== null &&
                  `, ${t('{n} centipawns lost per move', { n: Math.round(meanOf(report.analysis.acpl)!) })}`}
                .
              </span>
              <StartOver />
            </p>
          )}
        </CardContent>
      </Card>

      <MoveQualityCard analysis={report.analysis} />

      <Card>
        <CardHeader>
          <CardTitle>{t('Openings')}</CardTitle>
          <CardDescription>
            {report.named
              ? t('One row per opening family, named from the deepest catalogued position each game reached. Most played first.')
              : t('The opening catalogue is missing from this install, so games are grouped by their ECO header.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <table className="w-full table-fixed text-sm">
            <thead className="text-muted-foreground text-xs">
              <tr>
                <th scope="col" className="py-1 pr-2 text-left font-medium whitespace-nowrap">
                  {t('Opening')}
                </th>
                <th scope="col" className="w-14 py-1 pr-2 text-right font-medium whitespace-nowrap">
                  {t('Games')}
                </th>
                <th scope="col" className="w-36 py-1 pr-2 text-left font-medium whitespace-nowrap max-sm:hidden">
                  {t('Results')}
                </th>
                <th scope="col" className="w-14 py-1 text-right font-medium whitespace-nowrap">
                  {t('Score')}
                </th>
                {report.analysis.games > 0 && (
                  <th scope="col" className="w-20 py-1 pl-2 text-right font-medium whitespace-nowrap">
                    {t('Accuracy')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, at) => (
                <tr key={`${row.eco}\t${row.name}`} className={cn(at % 2 === 1 && 'bg-muted/50')}>
                  <td className="py-(--row-py-tight) pr-2">
                    <OpeningName row={row} />
                  </td>
                  <td className="text-muted-foreground py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
                    {exact.format(row.games)}
                  </td>
                  <td className="py-(--row-py-tight) pr-2 max-sm:hidden">
                    <ResultBar w={row.w} d={row.d} b={row.l} pov="mine" />
                  </td>
                  <td className="py-(--row-py-tight) text-right font-mono tabular-nums">{pct(scorePct(row))}</td>
                  {report.analysis.games > 0 && (
                    <td className="py-(--row-py-tight) pl-2 text-right font-mono tabular-nums">
                      {row.accuracy === null ? '' : `${row.accuracy.toFixed(1)}%`}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {openings.length > OPENING_FOLD && !allOpenings && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setAllOpenings(true)}>
              {t('Show all {n}', { n: exact.format(openings.length) })}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Leaving book')}</CardTitle>
          <CardDescription>
            {t(
              'The first move after which the position is in no catalogued line, and whose move it was. The openings where your own move leaves earliest come first.',
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {split.exits > 0 && split.meanPly !== null && (
            <p className="text-sm tabular-nums">
              {t('Your move left book first in {you} of {n} games, on average at move {m}.', {
                you: exact.format(split.youLeft),
                n: exact.format(split.exits),
                m: moveOfPly(split.meanPly).toFixed(1),
              })}
            </p>
          )}
          {exits.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('No game of yours has left the catalogue by your own move yet.')}
            </p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="py-1 pr-2 text-left font-medium whitespace-nowrap">
                    {t('Opening')}
                  </th>
                  <th scope="col" className="w-14 py-1 pr-2 text-right font-medium whitespace-nowrap">
                    {t('Games')}
                  </th>
                  <th scope="col" className="w-24 py-1 pr-2 text-right font-medium whitespace-nowrap">
                    {t('Leaves at')}
                  </th>
                  <th scope="col" className="w-28 py-1 text-right font-medium whitespace-nowrap">
                    {t('You / them')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {exits.map((row, at) => (
                  <tr key={`${row.eco}\t${row.name}`} className={cn(at % 2 === 1 && 'bg-muted/50')}>
                    <td className="py-(--row-py-tight) pr-2">
                      <OpeningName row={row} />
                    </td>
                    <td className="text-muted-foreground py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
                      {exact.format(row.exits)}
                    </td>
                    <td className="py-(--row-py-tight) pr-2 text-right tabular-nums">
                      {row.meanExitPly === null ? '' : t('move {n}', { n: moveOfPly(row.meanExitPly).toFixed(1) })}
                    </td>
                    <td className="py-(--row-py-tight) text-right font-mono tabular-nums">
                      {row.youLeft} / {row.theyLeft}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ActivityCard report={report} />
      <EndingsCard endings={report.endings} byOutcome={report.analysis.byOutcome} />
      <LengthCard lengths={report.lengths} />
    </div>
  );
}

/**
 * Games per month as a stacked bar, won over drew over lost, the same
 * three inks as the result bar. Bars are thin with a two-pixel gap and
 * a rounded top; the figure is read off the bar's own tooltip and the
 * table behind it, never printed on every bar. Months with no games
 * stand as gaps, and the chart keeps the last three years at most (the
 * date filter reaches further back). Beside it, the week.
 */
function ActivityCard({ report }: { report: Report }) {
  const lang = useLang();
  const series = useMemo(() => monthSeries(report.months), [report.months]);
  const peak = Math.max(1, ...series.map((m) => m.games));
  const monthName = useMemo(
    () => new Intl.DateTimeFormat(lang === 'ko' ? 'ko' : 'en', { month: 'short', year: 'numeric' }),
    [lang],
  );
  const dayName = useMemo(
    () => new Intl.DateTimeFormat(lang === 'ko' ? 'ko' : 'en', { weekday: 'short' }),
    [lang],
  );
  const label = (m: MonthTally): string => {
    const [y, mo] = m.month.split('-').map(Number) as [number, number];
    return monthName.format(new Date(y, mo - 1, 1));
  };
  // Sunday first, as the server numbers them; only days with games.
  const week = bandRows(
    report.weekdays.map((w) => ({ band: w.day, w: w.w, d: w.d, l: w.l, accSum: w.accSum, accN: w.accN })),
  );
  const dayLabel = (day: number): string => dayName.format(new Date(2026, 1, 1 + day));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Activity')}</CardTitle>
        <CardDescription>{t('Games per month, won over drew over lost, and the week.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[1fr_18rem]">
        {series.length > 0 && (
          <figure className="min-w-0">
            <div className="flex h-32 items-end gap-0.5 overflow-x-auto" role="img" aria-label={t('Games per month')}>
              {series.map((m) => (
                // The app's tooltip, as on the result bar, never the
                // browser's `title` bubble: the two differ in shape and
                // delay, and one page was showing both.
                <TitleTip
                  key={m.month}
                  title={
                    m.games === 0
                      ? label(m)
                      : `${label(m)}: ${t('{w} won, {d} drew, {l} lost', { w: m.w, d: m.d, l: m.l })}`
                  }
                >
                  <div className="flex h-full min-w-2 flex-1 flex-col justify-end">
                    {/* Won on top, lost at the foot; the gap between segments is
                        the page's own ground. The bar's corner is the chip
                        corner, off the radius knob on purpose. */}
                    <div
                      className="bg-good-tint rounded-t-[4px]"
                      style={{ height: `${(100 * m.w) / peak}%` }}
                    />
                    <div className="bg-accent mt-px" style={{ height: `${(100 * m.d) / peak}%` }} />
                    <div className="bg-destructive/10 mt-px" style={{ height: `${(100 * m.l) / peak}%` }} />
                  </div>
                </TitleTip>
              ))}
            </div>
            <figcaption className="text-muted-foreground mt-1 flex justify-between text-xs tabular-nums">
              <span>{label(series[0]!)}</span>
              {series.length > 1 && <span>{label(series[series.length - 1]!)}</span>}
            </figcaption>
            <ul className="text-muted-foreground mt-2 flex gap-3 text-xs" aria-hidden>
              {[
                ['bg-good-tint', 'Won'],
                ['bg-accent', 'Drew'],
                ['bg-destructive/10', 'Lost'],
              ].map(([ink, word]) => (
                <li key={word} className="flex items-center gap-1.5">
                  <span className={cn('inline-block size-2.5 rounded-xs', ink)} />
                  {t(word!)}
                </li>
              ))}
            </ul>
            {/* The same numbers as a table, for a reader the bars cannot reach. */}
            <table className="sr-only">
              <caption>{t('Games per month')}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('Month')}</th>
                  <th scope="col">{t('Won')}</th>
                  <th scope="col">{t('Drew')}</th>
                  <th scope="col">{t('Lost')}</th>
                </tr>
              </thead>
              <tbody>
                {series.map((m) => (
                  <tr key={m.month}>
                    <td>{label(m)}</td>
                    <td>{m.w}</td>
                    <td>{m.d}</td>
                    <td>{m.l}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        )}
        {week.length > 0 && (
          <TallyTable
            caption={t('By weekday')}
            dense
            rows={week.map((r) => ({ key: String(r.band), label: dayLabel(r.band), tally: r.tally }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * How the games ended, per outcome: a donut for each, with its list
 * beside it as the legend.
 *
 * Each donut wears its outcome's ink, the result bar's own (good for
 * won, the muted ink for drew, destructive for lost), with the slices
 * stepped in opacity largest first; a second hue per slice would have
 * meant six categorical colours the app does not have. Identity never
 * rests on the opacity alone: every slice is in the legend with its
 * word, count and share, and carries them as its tooltip. Slices are
 * parted by a gap of the card's own ground, and a slice too thin to
 * part is drawn whole rather than vanishing.
 */
function EndingsCard({
  endings,
  byOutcome,
}: {
  endings: Report['endings'];
  byOutcome: Report['analysis']['byOutcome'];
}) {
  const columns: { key: 'w' | 'd' | 'l'; title: string; ink: string }[] = [
    { key: 'w', title: 'Won by', ink: 'text-good' },
    { key: 'd', title: 'Drew by', ink: 'text-muted-foreground' },
    { key: 'l', title: 'Lost by', ink: 'text-destructive' },
  ];
  if (endings.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('How games ended')}</CardTitle>
        <CardDescription>
          {t('Read from the move text and the file\'s own termination line. A decisive game that names neither is counted as a resignation.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-3">
        {columns.map(({ key, title, ink }) => {
          const shares = endingShares(endings, key);
          const total = shares.reduce((n, s) => n + s.games, 0);
          const acc = byOutcome.find((o) => o.outcome === key);
          const accuracy = acc ? meanOf(acc) : null;
          return (
            <figure key={key} className="flex min-w-0 flex-col gap-3">
              <figcaption className="text-muted-foreground flex items-baseline justify-between gap-2 text-xs font-medium">
                <span>{t(title)}</span>
                {accuracy !== null && (
                  <span className="font-mono tabular-nums">
                    {t('{n}% accuracy', { n: accuracy.toFixed(1) })}
                  </span>
                )}
              </figcaption>
              {shares.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('None')}</p>
              ) : (
                <>
                  <Donut shares={shares} ink={ink} total={total} />
                  <table className="w-full table-fixed text-sm">
                    <tbody>
                      {shares.map((s, at) => (
                        <tr key={s.ending}>
                          <td className="py-(--row-py-tight) pr-2">
                            <span className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className={cn('inline-block size-2.5 shrink-0 rounded-xs bg-current', ink)}
                                style={{ opacity: SLICE_OPACITY[Math.min(at, SLICE_OPACITY.length - 1)] }}
                              />
                              <span className="min-w-0 truncate">{t(ENDING_LABEL[s.ending])}</span>
                            </span>
                          </td>
                          <td className="text-muted-foreground w-10 py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
                            {exact.format(s.games)}
                          </td>
                          <td className="w-12 py-(--row-py-tight) text-right font-mono tabular-nums">{pct(s.share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </figure>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** The slices' steps, largest share first; past the sixth they share
    the last step, which the legend still tells apart. */
const SLICE_OPACITY = [1, 0.72, 0.5, 0.36, 0.26, 0.18];

/**
 * A donut of shares in one ink. A circle of radius 100/2pi has a
 * circumference of exactly 100, so a share in percent is its dash
 * length and the offsets are running sums; the gap is taken off each
 * slice's own length and the ring's stroke is the card's ground, which
 * is what parts them. The centre carries the total.
 */
function Donut({ shares, ink, total }: { shares: { ending: Ending; games: number; share: number }[]; ink: string; total: number }) {
  const R = 100 / (2 * Math.PI);
  const GAP = 2;
  let offset = 0;
  return (
    <div className="relative mx-auto size-28">
      <svg viewBox="0 0 40 40" className={cn('size-full -rotate-90', ink)} role="img" aria-label={t('{n} games', { n: exact.format(total) })}>
        {shares.map((s, at) => {
          const start = offset;
          offset += s.share;
          // A slice thinner than the gap is drawn whole; one that is
          // the whole ring needs no gap at all.
          const drawn = shares.length === 1 ? 100 : Math.max(s.share - GAP, Math.min(s.share, 1));
          return (
            <TitleTip
              key={s.ending}
              title={`${t(ENDING_LABEL[s.ending])}: ${exact.format(s.games)} (${pct(s.share)})`}
            >
              <circle
                cx="20"
                cy="20"
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeDasharray={`${drawn} ${100 - drawn}`}
                strokeDashoffset={-(start + (shares.length === 1 ? 0 : GAP / 2))}
                style={{ opacity: SLICE_OPACITY[Math.min(at, SLICE_OPACITY.length - 1)] }}
              />
            </TitleTip>
          );
        })}
      </svg>
      {/* Over the hole only in looks: the pointer must pass through to the
          slices, or the total's box, which spans the whole ring, takes
          every hover and no slice tip ever opens. */}
      <span className="text-foreground pointer-events-none absolute inset-0 grid place-items-center text-lg font-semibold tabular-nums">
        {exact.format(total)}
      </span>
    </div>
  );
}

/** Results by how long the game ran, in bands of twenty moves. */
function LengthCard({ lengths }: { lengths: Report['lengths'] }) {
  const rows = bandRows(lengths);
  if (rows.length === 0) return null;
  const label = (band: number): string =>
    band === 0
      ? t('Under {n} moves', { n: 20 })
      : t('{a} to {b} moves', { a: band, b: band + 19 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Game length')}</CardTitle>
        <CardDescription>{t('Results by how many moves the game ran.')}</CardDescription>
      </CardHeader>
      <CardContent>
        <TallyTable
          caption={t('By length')}
          rows={rows.map((r) => ({ key: String(r.band), label: label(r.band), tally: r.tally }))}
        />
      </CardContent>
    </Card>
  );
}

/**
 * The engine pass, as a page action rather than a card: a control panel
 * is not a statistic, and a card that stood on the page for ever said
 * so (lanph3re's call). The button lives in the header's actions slot;
 * while a run is going a thin strip under the header carries the bar,
 * the count and the time left; once every game is analysed nothing is
 * drawn here at all, and Start over sits in the Results footnote beside
 * the figures it would change. The pass itself is analysisJob.ts and
 * outlives the page.
 */
function PassButton() {
  const job = useAnalysisJob();
  useEffect(() => {
    void useAnalysisJob.getState().refresh();
  }, []);
  const owed = Math.max(0, job.total - job.analysed);
  if (job.status === 'running') {
    return (
      <Button variant="secondary" size="sm" onClick={() => job.pause()}>
        {t('Pause')}
      </Button>
    );
  }
  if (owed === 0) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      title={t('Judges every game of yours move by move with the engine, at depth {n}. Runs in this window while the app is open, and picks up where it stopped.', { n: PASS_DEPTH })}
      onClick={() => void job.start()}
    >
      {job.analysed > 0 || job.status === 'paused' ? t('Resume analysis') : t('Analyse games')}
    </Button>
  );
}

/** The run's progress, drawn only while there is a run to report on:
    going, paused part way, or stopped by an error. */
function PassStrip() {
  const job = useAnalysisJob();
  const owed = Math.max(0, job.total - job.analysed);
  const running = job.status === 'running';
  const paused = job.status === 'paused' && owed > 0;
  const failed = job.status === 'error';
  // Idle with games owed: the page is gated on them, and says so here.
  const waiting = !running && !paused && !failed && job.known && owed > 0;
  if (!running && !paused && !failed && !waiting) return null;
  const share = job.total === 0 ? 0 : (100 * job.analysed) / job.total;
  const minutesLeft =
    running && job.msPerGame !== null ? Math.ceil((owed * job.msPerGame) / 60_000) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <Progress value={share} aria-label={t('Games analysed')} />
      <p className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs tabular-nums">
        <span>
          {t('{done} of {total} games analysed', {
            done: exact.format(job.analysed),
            total: exact.format(job.total),
          })}
        </span>
        {minutesLeft !== null && (
          <span>{minutesLeft <= 1 ? t('under a minute left') : t('about {m} min left', { m: minutesLeft })}</span>
        )}
        {paused && <span>{t('Paused')}</span>}
        {waiting && (
          <span>
            {t('This page fills once every game has been through the engine pass: {n} to go.', {
              n: exact.format(owed),
            })}
          </span>
        )}
        {failed && job.error && (
          <span className="text-destructive">{t('The pass stopped: {error}', { error: job.error })}</span>
        )}
      </p>
    </div>
  );
}

/** Forget every record and run the pass again: a two-step press, since
    it throws away hours on a big vault. */
function StartOver() {
  const job = useAnalysisJob();
  const [arming, setArming] = useState(false);
  if (job.status === 'running') return null;
  if (!arming) {
    return (
      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setArming(true)}>
        {t('Start over')}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>{t('Forget {n} analysed games and start again?', { n: exact.format(job.analysed) })}</span>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          setArming(false);
          void job.startOver();
        }}
      >
        {t('Start over')}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setArming(false)}>
        {t('Cancel')}
      </Button>
    </span>
  );
}

/**
 * The page's own outline while the first report is out: the Results
 * card with its three tables, the openings card and the leaving-book
 * card, each in the frames and row heights the loaded page draws, so
 * nothing moves when the answer lands. The filter rail is not here: it
 * needs no data and is already on the page above this.
 */
function InsightsSkeleton({ shape }: { shape: Shape }) {
  const table = (rows: number, key: string) => (
    <div key={key} className="flex flex-col">
      <div className="flex h-6 items-center gap-2">
        <Skeleton className="h-2 w-16" />
        <Skeleton className="ml-auto h-2 w-8" />
        <Skeleton className="h-2 w-10" />
        <Skeleton className="ml-20 h-2 w-8" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-7 items-center gap-2">
          <Skeleton className={cn('h-2.5', ['w-24', 'w-20', 'w-28', 'w-16'][i % 4])} />
          <Skeleton className="ml-auto h-2.5 w-6" />
          {/* The result bar's box: its 16px track and the chip corner. */}
          <Skeleton className="h-4 w-36 rounded-[4px]" />
          <Skeleton className="h-2.5 w-8" />
        </div>
      ))}
    </div>
  );
  // The card header's own line boxes, measured on the loaded page: a
  // 22px title line and 20px description lines over the header's 4px gap.
  // One description box however many lines it wraps to: two boxes took
  // the header's gap between them, and the loaded page has none there.
  const card = (key: string, lines: 1 | 2, body: React.ReactNode, gap: 'gap-3' | 'gap-4' = 'gap-4') => (
    <Card key={key}>
      <CardHeader>
        <div className="flex h-5.5 items-center">
          <Skeleton className="h-3.5 w-24" />
        </div>
        <div className={cn('flex flex-col justify-around', lines === 2 ? 'h-10' : 'h-5')}>
          <Skeleton className="h-2.5 w-72 max-w-full" />
          {lines === 2 && <Skeleton className="h-2.5 w-40" />}
        </div>
      </CardHeader>
      <CardContent className={cn('flex flex-col', gap)}>{body}</CardContent>
    </Card>
  );
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={t('Loading')} aria-live="polite">
      {card('results', 1, [1, 2, 4].map((rows, i) => table(rows, `results-${i}`)))}
      {card('openings', 2, table(shape.openings, 'openings'))}
      {card(
        'book',
        2,
        <>
          {/* The "Your move left book first…" line: one text-sm line. */}
          {shape.summary && (
            <div className="flex h-5 items-center">
              <Skeleton className="h-2.5 w-80 max-w-full" />
            </div>
          )}
          {table(shape.book, 'book')}
        </>,
        // That card's content is the tighter rung.
        'gap-3',
      )}
    </div>
  );
}

const PHASE_LABEL: Record<number, string> = { 0: 'Opening', 1: 'Middlegame', 2: 'Endgame' };

/**
 * A label, a count and a mean accuracy drawn as a bar the width of its
 * percentage in one ink, with the figure beside it: magnitude in one
 * hue, the number always printed, since the bars are read against each
 * other and a difference of two points has to be legible.
 */
function MeanTable({
  caption,
  rows,
  unit = 'games',
}: {
  caption: string;
  rows: { key: string; label: string; mean: number | null; n: number }[];
  /** What the count counts: analysed games, or the owner's judged moves. */
  unit?: 'games' | 'moves';
}) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th scope="col" className="py-1 pr-2 text-left font-medium whitespace-nowrap">
            {caption}
          </th>
          <th scope="col" className="w-14 py-1 pr-2 text-right font-medium whitespace-nowrap">
            {unit === 'games' ? t('Games') : t('Moves')}
          </th>
          <th scope="col" className="w-36 py-1 pr-2 text-left font-medium whitespace-nowrap max-sm:hidden">
            {t('Accuracy')}
          </th>
          <th scope="col" className="w-14 py-1 text-right font-medium whitespace-nowrap">
            <span className="sr-only">{t('Accuracy')}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, at) => (
          <tr key={row.key} className={cn(at % 2 === 1 && 'bg-muted/50')}>
            <td className="py-(--row-py-tight) pr-2">{row.label}</td>
            <td className="text-muted-foreground w-14 py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
              {exact.format(row.n)}
            </td>
            <td className="w-36 py-(--row-py-tight) pr-2 max-sm:hidden">
              {/* The chip corner, as the result bar's. */}
              <div className="bg-muted h-2 w-full overflow-hidden rounded-[4px]">
                <div className="bg-primary/70 h-full" style={{ width: `${row.mean ?? 0}%` }} />
              </div>
            </td>
            <td className="w-14 py-(--row-py-tight) text-right font-mono tabular-nums">
              {row.mean === null ? '' : `${row.mean.toFixed(1)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const QUALITY: { key: keyof Report['analysis']['quality']; label: string; ink: string }[] = [
  { key: 'brilliant', label: 'Brilliant', ink: 'bg-nag-brilliant' },
  { key: 'good', label: 'Good', ink: 'bg-nag-good' },
  { key: 'book', label: 'Theory', ink: 'bg-nag-book' },
  { key: 'inaccuracy', label: 'Inaccuracy', ink: 'bg-nag-dubious' },
  { key: 'mistake', label: 'Mistake', ink: 'bg-nag-mistake' },
  { key: 'blunder', label: 'Blunder', ink: 'bg-nag-blunder' },
];

/**
 * Every move the owner played in the analysed games, by the review's
 * verdict, as one stacked bar in the move tree's own NAG inks with the
 * legend beneath. "Good" is a judged move with no mark against it;
 * theory is counted, never judged.
 */
function MoveQualityCard({ analysis }: { analysis: Report['analysis'] }) {
  const { quality } = analysis;
  const total = QUALITY.reduce((n, q) => n + quality[q.key], 0);
  if (total === 0) return null;
  const rows = <R extends AccMean>(
    list: readonly R[],
    key: (r: R) => string | number,
    label: (r: R) => string,
  ) => list.map((r) => ({ key: String(key(r)), label: label(r), mean: meanOf(r), n: r.n }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Move quality')}</CardTitle>
        <CardDescription>
          {t('Every move you played in the analysed games, by the engine\'s verdict, and how accurate they were by phase and by move number.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* The chip corner, as the result bar's. */}
        <div className="flex h-4 w-full gap-px overflow-hidden rounded-[4px]" role="img" aria-label={t('Move quality')}>
          {QUALITY.filter((q) => quality[q.key] > 0).map((q) => (
            <TitleTip
              key={q.key}
              title={`${t(q.label)}: ${exact.format(quality[q.key])} (${pct((100 * quality[q.key]) / total)})`}
            >
              <div className={cn('h-full', q.ink)} style={{ width: `${(100 * quality[q.key]) / total}%` }} />
            </TitleTip>
          ))}
        </div>
        <table className="w-full table-fixed text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="py-1 pr-2 text-left font-medium whitespace-nowrap">
                {t('Verdict')}
              </th>
              <th scope="col" className="w-16 py-1 pr-2 text-right font-medium whitespace-nowrap">
                {t('Moves')}
              </th>
              <th scope="col" className="w-14 py-1 text-right font-medium whitespace-nowrap">
                {t('Share')}
              </th>
            </tr>
          </thead>
          <tbody>
            {QUALITY.map((q, at) => (
              <tr key={q.key} className={cn(at % 2 === 1 && 'bg-muted/50')}>
                <td className="py-(--row-py-tight) pr-2">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-xs', q.ink)} />
                    {t(q.label)}
                  </span>
                </td>
                <td className="text-muted-foreground py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
                  {exact.format(quality[q.key])}
                </td>
                <td className="py-(--row-py-tight) text-right font-mono tabular-nums">
                  {pct((100 * quality[q.key]) / total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <MeanTable
          caption={t('By phase')}
          rows={rows(analysis.byPhase, (r) => r.phase, (r) => t(PHASE_LABEL[r.phase] ?? 'Middlegame'))}
          unit="moves"
        />
        <MeanTable
          caption={t('By move number')}
          rows={rows(analysis.byMove, (r) => r.band, (r) => t('Moves {a} to {b}', { a: r.band, b: r.band + 9 }))}
          unit="moves"
        />
      </CardContent>
    </Card>
  );
}

function OpeningName({ row }: { row: OpeningRow }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      {row.eco && <span className="text-muted-foreground shrink-0 font-mono text-xs">{row.eco}</span>}
      <span className="min-w-0 truncate">{row.name ?? t('Unnamed opening')}</span>
    </span>
  );
}

function TallyTable({
  caption,
  rows,
  mono = false,
  dense = false,
}: {
  caption: string;
  rows: { key: string; label: string; tally: Tally }[];
  /** A label that is a figure (a rating band) takes the mono face. */
  mono?: boolean;
  /** In a narrow column the bar gives up width rather than the words:
      at 18rem the full bar left the label column sixteen pixels. The
      bar then prints fewer of its figures, which its tooltip still has. */
  dense?: boolean;
}) {
  // The engine pass's column appears once it has reached a row's game,
  // on every tally table alike, the way the openings table shows it.
  const withAccuracy = rows.some((r) => r.tally.accN > 0);
  return (
    <table className="w-full table-fixed text-sm">
      {/* A header row, not a bare caption: a number with no word over
          it is a number the reader has to guess at (lanph3re's report),
          and the openings table already names its columns this way. */}
      <thead className="text-muted-foreground text-xs">
        <tr>
          <th scope="col" className="py-1 pr-2 text-left font-medium whitespace-nowrap">
            {caption}
          </th>
          <th scope="col" className="w-12 py-1 pr-2 text-right font-medium whitespace-nowrap">
            {t('Games')}
          </th>
          <th scope="col" className={cn('py-1 pr-2 text-left font-medium whitespace-nowrap', dense ? 'w-20' : 'w-36')}>
            {t('Results')}
          </th>
          <th scope="col" className="w-12 py-1 text-right font-medium whitespace-nowrap">
            {t('Score')}
          </th>
          {withAccuracy && (
            <th scope="col" className="w-16 py-1 pl-2 text-right font-medium whitespace-nowrap">
              {t('Accuracy')}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, at) => (
          <tr key={row.key} className={cn(at % 2 === 1 && 'bg-muted/50')}>
            <td className={cn('py-(--row-py-tight) pr-2', mono && 'font-mono tabular-nums')}>{row.label}</td>
            <td className="text-muted-foreground w-12 py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
              {exact.format(row.tally.games)}
            </td>
            {/* The bar's own label threshold was measured against the
                explorer's column; narrower and a 13% segment clips its
                figure, so this is that width. */}
            <td className={cn('py-(--row-py-tight) pr-2', dense ? 'w-20' : 'w-36')}>
              <ResultBar w={row.tally.w} d={row.tally.d} b={row.tally.l} pov="mine" />
            </td>
            <td className="w-12 py-(--row-py-tight) text-right font-mono tabular-nums">{pct(scorePct(row.tally))}</td>
            {withAccuracy && (
              <td className="w-16 py-(--row-py-tight) pl-2 text-right font-mono tabular-nums">
                {accuracyOf(row.tally) === null ? '' : `${accuracyOf(row.tally)!.toFixed(1)}%`}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
