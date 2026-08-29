import { useState } from 'react';

import { useMediaQuery } from '@/lib/media';
import { t } from '@/lib/i18n';

import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';

import { GameDetailsPanel, type DetailsSelection } from './GameDetails';
import { GamesBrowser } from './GamesBrowser';

/**
 * The Games page: the tabbed games browser (see GamesBrowser, which owns
 * the tabs, the collection and all its verbs) with a details column
 * standing beside it at lg. A thin host on purpose — this file used to
 * BE the browser as well as the page, which is exactly what kept the
 * workspace's games band from showing the Collection tab without a
 * second implementation.
 */
export function CollectionView() {
  // Width changes the dressing of the ONE layout: at lg the rows are
  // the dense table and the details column stands beside the pane;
  // below, the same tabs hold card rows and details open as a sheet
  // from a row's own menu. A flag rather than classes because a
  // display-none details panel would still resolve selections.
  const wide = useMediaQuery('(min-width: 64rem)');
  /** What the browser last selected — the details column's subject. */
  const [selection, setSelection] = useState<DetailsSelection | null>(null);

  return (
    <PageShell
      // xwide, not wide: at lg this page is a data table beside a
      // details column, and every extra pixel is another table column
      // shown instead of shed. Below lg no viewport reaches either cap.
      width="xwide"
      scroll={false}
      // Pinned at every width: the pane's lists scroll themselves (the
      // panel shape's own behaviour), so the page never scrolls — the
      // tab strip and the toolbar stay put while the rows move, on a
      // phone exactly as on the desktop.
      className="h-full overflow-hidden pb-3 sm:pb-4 md:pb-6"
    >
      <PageHeader title={t('Games')} />

      {/* minmax(0,1fr), not a bare fr: an fr track is min-content wide
          at its narrowest, so the table would silently refuse to shed
          columns. The details column keeps a floor a board is legible
          at and never grows past a reading width. The browser's own
          overlays (preview, FAB, import dialog) are fixed or portaled,
          so the pane is its only in-flow child here. */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]">
        <GamesBrowser table={wide} onSelect={setSelection} />
        {/* The details column exists only where it has a column to
            stand in — mounted by the flag, not hidden by a class, so
            a phone never resolves selections for a panel nobody can
            see. */}
        {wide && <GameDetailsPanel selection={selection} />}
      </div>
    </PageShell>
  );
}
