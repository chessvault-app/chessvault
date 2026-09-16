import { PageShell } from '@/components/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

/**
 * What a route draws while its own code is still downloading.
 *
 * Every page sketches its own wait (components/skeletons), but those
 * sketches live inside the page's chunk, so until the chunk lands there
 * is nothing that could draw one: on a slow link a first tap on a tab
 * showed a bare ground for seconds (lib/lazyRoute has the numbers). This
 * is the one shape the shell can draw without knowing which page is
 * coming: the scrolling family's column, a title where every page puts
 * its title, and a run of one-line rows, which is what most of the
 * sections open on.
 *
 * Deliberately NOT built from components/skeletons: that file composes
 * the board, the panel and the vault tree and is a chunk of its own, and
 * this must be in the shell's bundle or it arrives with the wait it is
 * standing in for. The row geometry is SkeletonRows' (the dense rung,
 * a mark, a name, a figure at the end, the 44px floor under a thumb)
 * and the title bar is PageHeader's line height, so a list page that
 * replaces it moves as little as a guess allows. A board page replaces
 * it with a board; after half a second of nothing that is still the
 * better trade.
 */
const NAME_WIDTHS = ['w-2/5', 'w-3/5', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];

export function RouteSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <PageShell width="medium">
      <div role="status" aria-label={t('Loading')} aria-live="polite" className="flex flex-col gap-4">
        {/* PageHeader's row: 44px on a phone, one text-2xl line (32px)
            inside it; a desktop's is the text-xl line, 28px. */}
        <div className="flex items-center max-md:min-h-11">
          <div className="flex h-8 items-center md:h-7">
            <Skeleton className="h-4 w-32 md:h-3.5" />
          </div>
        </div>
        <div className="divide-border divide-y">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center pr-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 pr-1.5 py-(--row-py-dense) pointer-coarse:min-h-11">
                <Skeleton className="glyph shrink-0 rounded-sm" />
                <div className="flex h-5 min-w-0 flex-1 items-center">
                  <Skeleton className={cn('h-2.5 max-w-full', NAME_WIDTHS[i % NAME_WIDTHS.length])} />
                </div>
                <div className="ml-auto flex h-5 w-20 shrink-0 items-center justify-end">
                  <Skeleton className="h-2.5 w-12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
