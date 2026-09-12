import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';
import { navigateNow } from '@/lib/router';
import { confirmLeave } from '@/lib/leaveGuard';
import { useAnalysis } from '@/store/analysis';
import { useStudy } from '@/store/study';
import { bookLabel } from '@/store/explorer';
import { FilterChip } from '@/components/filter-chip';
import { Segmented } from '@/components/segmented';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/skeletons';
import { fieldDatabases, type FieldDatabase } from '@/repertoire/field';

/**
 * The improver's diff, read out loud: every position in your recent
 * games as one colour where YOUR move is one the database's players
 * rarely choose — at your level, when a band is picked. The server walk
 * (`/api/mygames/compare`, see compareAgainst in server/myGames.ts)
 * answers from the reference file's precomputed sums, so the whole
 * report is hash lookups; a row opens its position on the board, where
 * the explorer can take the question further.
 *
 * It lived on the opening map as a window behind a menu row, because
 * the map was the page that already knew the databases and a colour.
 * But it is a report about your games, not about the map — the flags
 * come from your games, which do not care what the map has charted —
 * and this page already asks the neighbouring question (where each game
 * left the catalogue, and whose move did it). So it is a card here,
 * under the same gate as the rest: Insights shows nothing until the
 * pass has run, and one card that answered early would make the gate
 * look broken. The colour the map supplied is a choice on the card.
 *
 * The rows print the field's share of a move and your share of yours,
 * the explorer's own figure about the field. Nothing sums them into a
 * grade, and nothing here should: that would be the page scoring you.
 */

interface CompareRow {
  key: string;
  sans: string[];
  games: number;
  myMove: { san: string; total: number };
  refTotal: number;
  top: { san: string; w: number; d: number; b: number; total: number };
}

/** The same 400-wide bucket-aligned bands the explorer's Level offers. */
const BANDS: { id: string | undefined; label: string }[] = [
  { id: undefined, label: 'Any' },
  { id: '1200-1599', label: '1200–1599' },
  { id: '1600-1999', label: '1600–1999' },
  { id: '2000-2399', label: '2000–2399' },
  { id: '2400-', label: '2400+' },
];
/** Kept from the map's window, so a band picked there still holds here. */
const BAND_KEY = 'vault:openingmap-compare-band';
const SIDE_KEY = 'vault:insights-compare-side';

const line = (sans: string[]): string =>
  sans.map((san, at) => (at % 2 === 0 ? `${at / 2 + 1}. ${san}` : san)).join(' ');

const pct = (part: number, total: number): string => {
  if (total <= 0) return '0%';
  const share = (part / total) * 100;
  return share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`;
};

export function CompareCard() {
  // The reference databases, the way the map asked for them. None (or
  // the demo, which has no indexed games behind it) is no card, not an
  // empty one: a report with nothing to read against is not a report.
  const [databases, setDatabases] = useState<FieldDatabase[] | null>(null);
  useEffect(() => {
    if (isDemo()) {
      setDatabases([]);
      return;
    }
    void api<Parameters<typeof fieldDatabases>[0]>('/api/refgames')
      .then((body) => setDatabases(fieldDatabases(body)))
      .catch(() => setDatabases([]));
  }, []);
  if (databases === null || databases.length === 0) return null;
  return <CompareBody databases={databases} />;
}

function CompareBody({ databases }: { databases: FieldDatabase[] }) {
  const [db, setDb] = useState(databases[0]!.name);
  const [color, setColor] = useState<'white' | 'black'>(() =>
    localStorage.getItem(SIDE_KEY) === 'black' ? 'black' : 'white',
  );
  const pickColor = (c: 'white' | 'black'): void => {
    setColor(c);
    localStorage.setItem(SIDE_KEY, c);
  };
  const [band, setBand] = useState<string | undefined>(() => {
    const stored = localStorage.getItem(BAND_KEY);
    return BANDS.some((b) => b.id === stored) ? (stored ?? undefined) : undefined;
  });
  const pickBand = (id: string | undefined): void => {
    setBand(id);
    if (id) localStorage.setItem(BAND_KEY, id);
    else localStorage.removeItem(BAND_KEY);
  };

  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // False when a band was asked for but the database's sums predate the
  // level buckets: the server answers corpus-wide, and calling that
  // "at your level" would be a lie the chip tells.
  const [banded, setBanded] = useState(true);
  // Only asked when the report comes back empty, to tell "your moves
  // pass" apart from "there is nothing to read" — see the empty copy.
  const [indexedGames, setIndexedGames] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    const query = `side=${color}&db=${encodeURIComponent(db)}${band ? `&band=${band}` : ''}`;
    void api<{ rows: CompareRow[]; banded?: boolean }>(`/api/mygames/compare?${query}`)
      .then((body) => {
        if (!live) return;
        setRows(body.rows);
        setBanded(body.banded !== false);
        if (body.rows.length === 0) {
          void api<{ games: number }>('/api/mygames/status')
            .then((s) => {
              if (live) setIndexedGames(s.games);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (live) {
          setRows([]);
          setFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [color, db, band]);

  /** The same leave-guard dance as opening a deep-search hit: the board
      takes the flagged line, ending at the decision point. */
  const open = async (row: CompareRow): Promise<void> => {
    if (useStudy.getState().openId) {
      if (!(await confirmLeave())) return;
      await useStudy.getState().close();
    }
    if (!useAnalysis.getState().loadPgn(`${line(row.sans)} *`)) return;
    useAnalysis.setState({ handoff: true });
    navigateNow('board');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Compare with a database')}</CardTitle>
        <CardDescription className="max-w-prose">
          {color === 'white'
            ? t('Your recent games as White, checked against this database’s players. Positions where your move is one they rarely choose, strongest habit first.')
            : t('Your recent games as Black, checked against this database’s players. Positions where your move is one they rarely choose, strongest habit first.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={color}
            onChange={pickColor}
            ariaLabel="Side"
            segments={[
              { value: 'white', label: t('White') },
              { value: 'black', label: t('Black') },
            ]}
          />
          {databases.length > 1 && (
            <Select
              value={db}
              onValueChange={setDb}
              ariaLabel={t('Reference database')}
              className="min-w-0 flex-1 basis-56"
              groups={[
                {
                  options: databases.map((b) => ({
                    value: b.name,
                    label: b.label ?? bookLabel(b.name),
                  })),
                },
              ]}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-sm font-medium">{t('At level')}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {BANDS.map(({ id, label }) => (
              <FilterChip
                key={label}
                label={id === undefined ? t('Any') : label}
                active={band === id}
                onClick={() => pickBand(id)}
              />
            ))}
          </div>
          {band !== undefined && rows !== null && !banded && (
            <p className="text-warn text-sm">
              {t('This database’s sums are not split by level, so all of its games are shown.')}
            </p>
          )}
        </div>
        {rows === null ? (
          // The rows are two lines — a move line over a sentence, at
          // px-2 py-1.5 in a gap-px column — so three of them are 164px.
          <div className="flex flex-col gap-px" role="status" aria-label={t('Loading')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-0.5 px-2 py-1.5">
                <div className="flex h-5 items-center">
                  <Skeleton className="h-2.5 w-2/5" />
                </div>
                <div className="flex h-5 items-center">
                  <Skeleton className="h-2 w-4/5" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {failed
              ? t('The comparison could not be read. Is the server reachable?')
              : indexedGames === 0
                ? t(
                    'None of your games are indexed yet. Collect some on the Games page, from an online archive or a PGN, and this will have something to read.',
                  )
                : t('Nothing to flag: where this database has a real sample, your recent moves are among its usual answers.')}
          </p>
        ) : (
          <div className="-mx-1 flex max-h-96 flex-col gap-px overflow-y-auto px-1">
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                onClick={() => void open(row)}
                className="hover:bg-accent flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                <span className="flex w-full items-baseline gap-2">
                  <span className="text-foreground font-moves min-w-0 flex-1 truncate text-sm font-medium">
                    {row.sans.length === 0 ? t('Starting position') : line(row.sans)}
                  </span>
                  {row.games > 1 && (
                    <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                      ×{row.games}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground w-full truncate text-sm">
                  {t('You play {mine} ({mineShare}), they answer {top} ({topShare} of {total})', {
                    mine: row.myMove.san,
                    mineShare: pct(row.myMove.total, row.refTotal),
                    top: row.top.san,
                    topShare: pct(row.top.total, row.refTotal),
                    total: row.refTotal.toLocaleString(),
                  })}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
