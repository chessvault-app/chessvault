import { Database } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { navigate } from '@/lib/router';
import { PageHeader } from '@/ui/PageHeader';
import { PageShell } from '@/ui/PageShell';
import { RefDbManager, type RefDb } from '@/games/EliteGames';
import { t } from '@/lib/i18n';

/**
 * One page for everything built from uploaded PGN collections.
 *
 * Opening books had a page; reference game databases could only be
 * managed from a sheet inside the Elite games browser — a management
 * job hidden behind the thing it manages (lanph3re's report). The two
 * are the same shape over the same uploads (an opening book indexes
 * positions, a reference database indexes whole games), so they share
 * one page. It also moves out of Tools: the entries there are boards
 * you play on, and this is where their data is looked after.
 */
export function DatabasesPage() {
  // `databases` present = the server's directory mount; absent = a
  // single-database mount (the static demo), which has no manager.
  const [meta, setMeta] = useState<{ ready: boolean; databases?: RefDb[] } | null>(null);
  const loadMeta = useCallback(() => {
    void fetch('/api/refgames')
      .then((r) => r.json())
      .then((d: { ready: boolean; databases?: RefDb[] }) => setMeta(d))
      .catch(() => setMeta(null));
  }, []);
  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  return (
    <PageShell width="medium">
        {/* Phones reach this from More; a desktop has it in the sidebar,
            and top-level pages carry no back arrow there. */}
        <PageHeader
          title={t('Databases')}
          back={() => navigate('more')}
          description={t(
            'A reference database is built from uploaded PGN collections and answers everything at once: whole games for the Elite games browser, and a position index the explorer and the repertoire trainer draw from — with filters.',
          )}
        />

        <Section icon={<Database className="size-3.5" />} title={t('Reference games')}>
          {meta === null ? null : meta.databases ? (
            <RefDbManager databases={meta.databases} onChanged={loadMeta} layout="grid" />
          ) : (
            <p className="text-muted text-xs leading-relaxed">
              {t('This server has no reference games database.')}
            </p>
          )}
        </Section>
    </PageShell>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="bg-surface border-line flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-subtle flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}
