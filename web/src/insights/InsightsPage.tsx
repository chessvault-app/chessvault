import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import type { Speed } from '@shared/gameIndex';
import { isSymmetricMaterial, mirrorMaterialSpec } from '@shared/scanMatch';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/date-picker';
import { EmptyState } from '@/components/empty-state';
import { FilterChip } from '@/components/filter-chip';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { ResultBar } from '@/components/result-bar';
import { SkeletonRows, useSlowLoad } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { FilterRow, SideSelect, type SideFilter } from '@/games/GameFilters';
import ENDGAMES from '@/games/endgames.json';
import STRUCTURES from '@/games/structures.json';
import { hasMyFilters, myFilterQuery, type MyGamesFilters } from '@/store/explorer';
import {
  earliestExits,
  exitSplit,
  moveOfPly,
  openingRows,
  scorePct,
  tallyBy,
  totals,
  type InsightsCell,
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
 * same filters the explorer's My games source takes, plus the
 * Databases browser's endgame and pawn-structure presets, and regroups the answer four ways
 * (insights/aggregate.ts). Nothing here is a verdict on the player: the
 * tables are counts of what happened, and a rating is nowhere on them.
 */

/** The explorer's filters plus the situation, which is the browser's
    preset id with a side where the preset takes one. */
interface InsightsFilters extends MyGamesFilters {
  /** `endgame:<id>`, `structure:<id>`, or 'none'. The browser's motif
      presets are not offered: a motif is a hunt for a game, and this
      page sums seasons. */
  situation: string;
  /** Whose side an asymmetric endgame preset describes. */
  situationSide: 'white' | 'black';
  /** A quick range, or 'custom' for whatever `from` and `to` hold. */
  range: DateRange;
}

const NONE = 'none';
const EMPTY_FILTERS: InsightsFilters = { situation: NONE, situationSide: 'white', range: 'any' };
const FILTERS_KEY = 'vault:insights-filters';

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

/** How many opening rows show before "Show all". */
const OPENING_FOLD = 20;

const exact = new Intl.NumberFormat('en');
const pct = (n: number | null): string => (n === null ? '' : `${Math.round(n)}%`);

function readFilters(): InsightsFilters {
  try {
    const raw = localStorage.getItem(FILTERS_KEY);
    if (!raw) return EMPTY_FILTERS;
    const parsed = JSON.parse(raw) as Partial<InsightsFilters>;
    const merged = { ...EMPTY_FILTERS, ...parsed };
    // A choice this build no longer offers (a motif, from an earlier
    // build) or a side it no longer takes falls back to the default.
    if (merged.situation.startsWith('motif:')) merged.situation = NONE;
    if (merged.situationSide !== 'black') merged.situationSide = 'white';
    return merged;
  } catch {
    return EMPTY_FILTERS;
  }
}

/** Which preset the situation names, and what the server is asked. */
function situationQuery(f: InsightsFilters): URLSearchParams {
  // A quick range replaces the pickers' dates; custom keeps them.
  const dates =
    f.range === 'custom'
      ? { from: f.from, to: f.to }
      : { from: rangeFrom(f.range) ?? undefined, to: undefined };
  const params = new URLSearchParams(myFilterQuery({ ...f, ...dates }));
  const [kind, id] = f.situation.split(':');
  if (kind === 'endgame') {
    const preset = ENDGAMES.find((p) => p.id === id);
    if (preset) {
      const spec = f.situationSide === 'black' ? mirrorMaterialSpec(preset.spec) : preset.spec;
      params.set('material', JSON.stringify({ ...spec, stable: 1 }));
    }
  } else if (kind === 'structure') {
    const structure = STRUCTURES.find((s) => s.id === id);
    if (structure) {
      params.set('fen', structure.fen);
      params.set('match', 'structure');
    }
  }
  return params;
}

/** Whether the picked situation has a side to choose: an endgame preset
    that reads differently from each side. */
function situationTakesSide(situation: string): boolean {
  const [kind, id] = situation.split(':');
  if (kind !== 'endgame') return false;
  const preset = ENDGAMES.find((p) => p.id === id);
  return preset !== undefined && !isSymmetricMaterial(preset.spec);
}

interface Report {
  games: number;
  named: boolean;
  /** Summed while the index was still walking the vault; ask again. */
  partial: boolean;
  cells: InsightsCell[];
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

  const query = useMemo(() => situationQuery(filters).toString(), [filters]);
  const [report, setReport] = useState<Report | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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

  // The previous answer stays on the page while the next is fetched, so
  // a chip press changes the numbers rather than blanking the tables.
  const slow = useSlowLoad(report === null && !failed);
  const narrowed =
    hasMyFilters({ ...filters, from: undefined, to: undefined }) ||
    filters.situation !== NONE ||
    filters.range !== 'any';
  const clear = (): void => setFilters({ ...EMPTY_FILTERS, side: undefined, speeds: [], from: undefined, to: undefined, collectionOnly: undefined });

  const speeds = filters.speeds ?? [];
  const takesSide = situationTakesSide(filters.situation);
  const situationGroups = useMemo(
    () => [
      { options: [{ value: NONE, label: t('Any situation') }] },
      { label: t('Endgames'), options: ENDGAMES.map((p) => ({ value: `endgame:${p.id}`, label: t(p.label) })) },
      {
        label: t('Pawn structures'),
        options: STRUCTURES.map((s) => ({ value: `structure:${s.id}`, label: t(s.label) })),
      },
    ],
    [],
  );

  return (
    <PageShell width="medium">
      {/* Phones reach this from More; a desktop has it in the sidebar. */}
      <PageHeader
        title={t('Insights')}
        back={() => navigate('more')}
        subtitle={
          report !== null && (
            <span className="tabular-nums">{t('{n} games', { n: exact.format(report.games) })}</span>
          )
        }
        description={t(
          'Your results by colour, time control and opening, and where each game left the opening catalogue. The filters narrow every table below.',
        )}
      />

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
          value={filters.situation}
          onValueChange={(v) => setFilters({ situation: v, situationSide: 'white' })}
          ariaLabel={t('Situation')}
          size="sm"
          className="w-44 flex-none"
          groups={situationGroups}
        />
        {takesSide && (
          <Select
            value={filters.situationSide}
            onValueChange={(v) => setFilters({ situationSide: v as 'white' | 'black' })}
            ariaLabel={t('Which side has it')}
            size="sm"
            className="w-28 flex-none"
            groups={[
              {
                options: [
                  { value: 'white', label: t('White') },
                  { value: 'black', label: t('Black') },
                ],
              },
            ]}
          />
        )}
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
      ) : report === null ? (
        slow && <SkeletonRows rows={8} />
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
          <CardDescription>{t('Score counts a draw as half a win.')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="text-foreground text-2xl font-semibold tabular-nums">{pct(scorePct(all))}</span>
            <span className="text-muted-foreground text-sm tabular-nums">
              {t('{w} won, {d} drew, {l} lost', {
                w: exact.format(all.w),
                d: exact.format(all.d),
                l: exact.format(all.l),
              })}
            </span>
          </div>
          <ResultBar w={all.w} d={all.d} b={all.l} pov="mine" />
          <div className="grid gap-4 md:grid-cols-2">
            <TallyTable
              caption={t('By colour')}
              rows={byColour.map((r) => ({ key: r.key, label: t(SIDE_LABEL[r.key]), tally: r.tally }))}
            />
            <TallyTable
              caption={t('By time control')}
              rows={bySpeed.map((r) => ({ key: r.key, label: t(SPEED_LABEL[r.key]), tally: r.tally }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('Openings')}</CardTitle>
          <CardDescription>
            {report.named
              ? t('Named from the deepest catalogued position each game reached. Most played first.')
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
    </div>
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

function TallyTable({ caption, rows }: { caption: string; rows: { key: string; label: string; tally: Tally }[] }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="text-muted-foreground pb-1 text-left text-xs font-medium">{caption}</caption>
      <tbody>
        {rows.map((row, at) => (
          <tr key={row.key} className={cn(at % 2 === 1 && 'bg-muted/50')}>
            <td className="py-(--row-py-tight) pr-2">{row.label}</td>
            <td className="text-muted-foreground w-12 py-(--row-py-tight) pr-2 text-right font-mono tabular-nums">
              {exact.format(row.tally.games)}
            </td>
            {/* The bar's own label threshold was measured against the
                explorer's column; narrower and a 13% segment clips its
                figure, so this is that width. */}
            <td className="w-36 py-(--row-py-tight) pr-2">
              <ResultBar w={row.tally.w} d={row.tally.d} b={row.tally.l} pov="mine" />
            </td>
            <td className="w-12 py-(--row-py-tight) text-right font-mono tabular-nums">{pct(scorePct(row.tally))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
