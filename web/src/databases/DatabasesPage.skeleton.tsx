import { Database, FileText, Hammer, MoreHorizontal, Plus, Trash2, Upload, Zap } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Panel } from '@/components/panel';
import { Segmented } from '@/components/segmented';
import { SearchInput } from '@/components/text-fields';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeletons';
import { readDatabasesShape } from '@/databases/reservation';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * The Databases page while its chunk is on the wire.
 *
 * Not a reduced version of the page: its own header, and under it the
 * same two placeholders DatabasesPage draws while /api/refgames is out —
 * the manager's panel, or the mount card with its words invisible. Which
 * of the two, and how many rows, come from what this device saw last
 * visit (databases/reservation), the same record the page reads.
 *
 * The header is drawn in full because none of it waits on anything: the
 * page's name, its way back, and the paragraph that says what a
 * reference database is.
 *
 * The back chevron is LIVE rather than held inert, alone among this
 * outline's parts, and it was missing altogether: a phone reaches this
 * page from More and the settled header draws one, so without it the
 * title sat 44px left of where it lands. Live because it needs nothing
 * that is still on the wire, and because the one thing a reader on a
 * slow link may want is out.
 */
export default function DatabasesOutline() {
  const [reserved] = useState(readDatabasesShape);
  return (
    <PageShell width="medium" scroll={false} className="h-full min-h-0 pb-4 md:pb-6">
      <PageHeader
        className="shrink-0"
        title={t('Databases')}
        back={() => navigate('more')}
        description={t(
          'A reference database is built from uploaded PGN files. It serves whole games to the Databases browser on the Games page, and a filterable position index to the explorer and the repertoire trainer.',
        )}
      />
      {reserved.mount === 'manager' ? (
        <RefDbManagerSkeleton rows={reserved.rows} />
      ) : (
        <MountNote ready={reserved.mount === 'mounted'} games={0} placeholder />
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
export function MountNote({
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
        'bg-card flex shrink-0 flex-col gap-1 rounded-xl ring-1 ring-card-ring p-4 text-sm',
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

/**
 * The panel's own shape, for the moment before /api/refgames answers.
 *
 * The page drew nothing until it did, so the whole panel popped in. Same
 * three bands in the same order and at the same heights — switch, search
 * row, divided list — so nothing moves when the real one lands. Governed
 * by useSlowLoad at the call site: on a local server this never appears,
 * which is the point.
 *
 * Every control here grows under a coarse pointer, because the ones it
 * stands for do: Segmented is h-8/h-9, the search field is an sm input,
 * and both trailing squares are icon-sm buttons. Measured without that,
 * a row stayed 41px on a phone where the real one is 48.
 */
export function RefDbManagerSkeleton({ rows }: {
  /** Rows the list drew last visit (databases/reservation.ts). 0 is the
      empty sentence, laid out invisibly at its own wrapped height. */
  rows: number;
}) {
  return (
    <Panel className="min-h-0">
      {/* Announced once, like every other skeleton here; components/skeletons' own
          wrapper is private to it. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        role="status"
        aria-label={t('Loading')}
        aria-live="polite"
      >
        {/* The switch: one box the size the segmented control settles at.
            42px under a coarse pointer, not the 36 every other control
            here grows to: the tabs track is its 36px triggers plus its
            own 3px of padding above and below (ui/tabs' p-[3px] and
            pointer-coarse:h-auto). Measured on a phone at 42 against a
            36px placeholder, which stood the whole list 6px high. */}
        {/* The line tabs' row, the real control held inert: 40px, the
            rule under it, the two real segments. `inert` on the wrapper,
            because Segmented has no disabled and its triggers must not
            take focus here. */}
        <div inert className="border-border flex shrink-0 items-center border-b px-3">
          <Segmented
            value="databases"
            onChange={() => {}}
            ariaLabel="What to manage"
            kind="tabs"
            look="line"
            segments={[
              {
                value: 'databases',
                label: (
                  <>
                    <Database className="glyph shrink-0" aria-hidden />
                    {t('Databases')}
                  </>
                ),
              },
              {
                value: 'sources',
                label: (
                  <>
                    <FileText className="glyph shrink-0" aria-hidden />
                    {t('PGN files')}
                  </>
                ),
              },
            ]}
          />
        </div>
        {/* The search row, and the upload icon beside it, both real and inert. */}
        <div className="border-border flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <SearchInput
            inputSize="sm"
            value=""
            readOnly
            disabled
            tabIndex={-1}
            placeholder={t('Search')}
            aria-label={t('Search')}
            className="min-w-0 flex-1"
          />
          <Button variant="secondary" size="icon-sm" className="shrink-0" disabled tabIndex={-1} aria-hidden>
            <Upload className="glyph" />
          </Button>
        </div>
        {rows === 0 ? (
          // The real sentence, invisible, so a vault with nothing built
          // reserves the height those words wrap to on this width rather
          // than six rows it will give back.
          <p className="text-muted-foreground invisible px-3 py-6 text-center text-sm leading-relaxed">
            {t('No databases yet. Upload a PGN file and build one.')}
          </p>
        ) : (
        <ul className="divide-border min-h-0 flex-1 divide-y overflow-hidden">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i} className="flex items-center gap-2 py-(--row-py-dense) pl-[17px] pr-3">
              {/* The databases row stacks below md — name over figures,
                  with its ⋯ beside them — and a placeholder one line
                  shorter than what lands is the jump it exists to
                  prevent. `contents` from md up, the same trick the row
                  uses, so the wide placeholder is the flat line it was.

                  Margins on both bars below md, because the row's two
                  stacked lines are text and a bar is not: the row is
                  `type-row`, so each line is a 24px box there, and the
                  12px bar takes 6px above and below to stand in one. It
                  was my-1, which is the same arithmetic against the 20px
                  the rung was before 2026-09-15: 8px a row, and about
                  96px over the twelve this reserves. The bars cannot take
                  `type-row-box` themselves, since `md:contents` above
                  makes them the wide row's own cells. From md the
                  trailing square sets the height and the margins would do
                  nothing, so they are not asked for. */}
              <div className="flex min-w-0 flex-1 flex-col gap-1 md:contents">
                <Skeleton className={cn('my-1.5 h-3 md:my-0', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
                <Skeleton className="my-1.5 h-3 w-24 shrink-0 md:my-0 md:ml-auto md:h-2.5" />
              </div>
              {/* The row's controls, the real buttons held inert: the ⋯
                  below md, and from md the four icons the row carries
                  there (the fast-search slot, add, optimise, delete), so
                  the name column stops where it really stops. */}
              <Button variant="ghost" size="icon-sm" className="shrink-0 md:hidden" disabled tabIndex={-1} aria-hidden>
                <MoreHorizontal className="glyph" />
              </Button>
              {[Zap, Plus, Hammer, Trash2].map((Icon, k) => (
                <Button key={k} variant="ghost" size="icon-sm" className="shrink-0 max-md:hidden" disabled tabIndex={-1} aria-hidden>
                  <Icon className="glyph" />
                </Button>
              ))}
            </li>
          ))}
        </ul>
        )}
      </div>
    </Panel>
  );
}

/** Ragged widths, so the placeholder list does not read as a barcode. */
const NAME_WIDTHS = ['w-40', 'w-32', 'w-44', 'w-36', 'w-28', 'w-40'];
