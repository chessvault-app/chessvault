import { useCallback, useEffect, useState } from 'react';
import { navigate } from '@/lib/router';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { RefDbManager, type RefDb } from './RefDbManager';
import { t } from '@/lib/i18n';

/**
 * One page for everything built from uploaded PGN collections.
 *
 * Opening books had a page; reference game databases could only be
 * managed from a sheet inside the Elite games browser — a management job
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
    void fetch('/api/refgames')
      .then((r) => r.json())
      .then((d: { ready: boolean; games?: number; databases?: RefDb[] }) => setMeta(d))
      .catch(() => setMeta(null));
  }, []);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  return (
    <PageShell width="medium" scroll={false} className="h-full min-h-0 pb-4 md:pb-6">
      {/* Phones reach this from More; a desktop has it in the sidebar,
          and top-level pages carry no back arrow there. */}
      <PageHeader
        className="shrink-0"
        title={t('Databases')}
        back={() => navigate('more')}
        description={t(
          'A reference database is built from uploaded PGN collections and answers everything at once: whole games for the Elite games browser, and a position index the explorer and the repertoire trainer draw from — with filters.',
        )}
      />

      {meta === null ? null : meta.databases ? (
        <RefDbManager databases={meta.databases} onChanged={loadMeta} />
      ) : (
        // What is mounted, and why there is nothing to press. Only the
        // count: this mount has no name to show, and its size cannot be
        // measured through the demo's in-memory filesystem.
        <div className="border-line bg-surface flex shrink-0 flex-col gap-1 rounded-xl border p-4 text-xs">
          {meta.ready ? (
            <>
              <p className="text-fg font-medium">
                {t('{n} games', { n: (meta.games ?? 0).toLocaleString() })}
              </p>
              <p className="text-muted leading-relaxed">
                {t(
                  'This database is read-only. Uploading collections and building databases need the installed app.',
                )}
              </p>
            </>
          ) : (
            <p className="text-muted leading-relaxed">
              {t('This server has no reference games database.')}
            </p>
          )}
        </div>
      )}
    </PageShell>
  );
}
