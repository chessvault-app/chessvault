import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { navigate } from '@/lib/router';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { RefDbManager, RefDbManagerSkeleton, type RefDb, type Source } from './RefDbManager';
import { useSlowLoad } from '@/components/skeletons';
import { t } from '@/lib/i18n';
import { databasesShapeOf, parseDatabasesShape, storedDatabasesShape } from './reservation';

/** See `reserved` below: which block the page drew last visit, and how
    many rows its list held. */
const DATABASES_SHAPE_KEY = 'vault:databases-shape';

/**
 * One page for everything built from uploaded PGN collections.
 *
 * Opening books had a page; reference game databases could only be
 * managed from a sheet inside the games-page Databases browser — a management job
 * hidden behind the thing it manages (lanph3re's report). The two are the
 * same shape over the same uploads (an opening book indexes positions, a
 * reference database indexes whole games), so they share one page. It
 * also moves out of Tools: the entries there are boards you play on, and
 * this is where their data is looked after.
 *
 * It is now the ONLY place either is managed. The browser and the
 * explorer each used to open the manager in a window; both send you here
 * instead, so there is one answer to "where do my databases live".
 *
 * The page does not scroll: its panel takes the height that is left and
 * scrolls its own list. A page that grew with the list put the Build
 * control a thousand pixels down at 24 collections.
 */
export function DatabasesPage() {
  // `databases` present = the server's directory mount; absent = a
  // single-database mount (the static demo), which has no manager. Absent
  // is not the same as empty: the demo mounts a real database it simply
  // cannot rebuild, so `ready` decides what is said about it.
  const [meta, setMeta] = useState<{
    ready: boolean;
    games?: number;
    databases?: RefDb[];
  } | null>(null);
  const loadMeta = useCallback(() => {
    void api<{ ready: boolean; games?: number; databases?: RefDb[] }>('/api/refgames')
      .then(setMeta)
      .catch(() => setMeta(null));
  }, []);

  // What this device reserves while /api/refgames is out, from what it
  // saw last visit (databases/reservation.ts) — a paint hint on home's
  // bargain, corrected by the answer. Read once; the wait cannot change it.
  const [reserved] = useState(() => parseDatabasesShape(localStorage.getItem(DATABASES_SHAPE_KEY)));
  useEffect(() => {
    if (meta !== null) localStorage.setItem(DATABASES_SHAPE_KEY, storedDatabasesShape(databasesShapeOf(meta)));
  }, [meta]);

  /**
   * The uploaded PGN collections, loaded HERE rather than inside the
   * panel that lists them.
   *
   * The panel is only mounted once /api/refgames has answered, so a
   * listing it asked for itself could not start until that round trip
   * was over — two in series for two questions that have nothing to do
   * with each other. Measured against an emulated 200 ms link, the
   * collections landed 242 ms after the databases did; asked side by
   * side they land together.
   *
   * Asked even on a mount with no panel to show them (a single-database
   * server, the static demo): which mount this is only becomes known
   * with the answer this is racing, and it is one small GET — on the
   * demo it never leaves the page.
   */
  const [sources, setSources] = useState<Source[] | null>(null);
  const loadSources = useCallback(async (): Promise<void> => {
    try {
      const body = await api<{ sources: Source[] }>('/api/sources');
      setSources(body.sources);
    } catch {
      setSources([]);
    }
  }, []);
  /** The row leaves when the server says the file is gone — see the
      panel's delSource, which owns that rule and now asks for it. */
  const dropSource = useCallback((name: string) => {
    setSources((prev) => prev && prev.filter((s) => s.name !== name));
  }, []);

  useEffect(() => {
    loadMeta();
    void loadSources();
  }, [loadMeta, loadSources]);

  // The panel used to pop in: nothing was drawn until /api/refgames
  // answered. It has the panel's own shape now, and only once the wait is
  // long enough to be worth admitting to — a skeleton that flashes past
  // reads as a fault, and against a local server this one never appears.
  const slow = useSlowLoad(meta === null);

  return (
    <PageShell width="medium" scroll={false} className="h-full min-h-0 pb-4 md:pb-6">
      {/* Phones reach this from More; a desktop has it in the sidebar,
          and top-level pages carry no back arrow there. */}
      <PageHeader
        className="shrink-0"
        title={t('Databases')}
        back={() => navigate('more')}
        description={t(
          'A reference database is built from uploaded PGN files. It serves whole games to the Databases browser on the Games page, and a filterable position index to the explorer and the repertoire trainer.',
        )}
      />

      {meta === null ? (
        slow &&
        (reserved.mount === 'manager' ? (
          <RefDbManagerSkeleton rows={reserved.rows} />
        ) : (
          <MountNote ready={reserved.mount === 'mounted'} games={0} placeholder />
        ))
      ) : meta.databases ? (
        <RefDbManager
          databases={meta.databases}
          onChanged={loadMeta}
          sources={sources}
          onSourcesChanged={loadSources}
          onSourceRemoved={dropSource}
        />
      ) : (
        <MountNote ready={meta.ready} games={meta.games ?? 0} />
      )}
    </PageShell>
  );
}

/**
 * What is mounted, and why there is nothing to press. Only the count:
 * this mount has no name to show, and its size cannot be measured
 * through the demo's in-memory filesystem.
 *
 * As a placeholder it is the same card with its words invisible, so a
 * device that saw this mount last visit reserves the card's own height
 * rather than a panel's — the panel-sized ghost is what the demo used to
 * draw over a two-line card.
 */
function MountNote({
  ready,
  games,
  placeholder = false,
}: {
  ready: boolean;
  games: number;
  placeholder?: boolean;
}) {
  return (
    <div
      className={cn(
        'bg-card flex shrink-0 flex-col gap-1 rounded-xl ring-1 ring-border p-4 text-sm',
        placeholder && '[&>p]:invisible',
      )}
      {...(placeholder ? { role: 'status', 'aria-label': t('Loading'), 'aria-live': 'polite' as const } : {})}
    >
      {ready ? (
        <>
          <p className="text-foreground font-medium">
            {t('{n} games', { n: games.toLocaleString() })}
          </p>
          <p className="text-muted-foreground leading-relaxed">
            {t(
              'This database is read-only. Uploading files and building databases need the installed app.',
            )}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground leading-relaxed">
          {t('This server has no reference games database.')}
        </p>
      )}
    </div>
  );
}
