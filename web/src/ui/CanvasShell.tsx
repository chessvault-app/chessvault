import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * The canvas page family — the third of the three named in `ui/layout.ts`.
 *
 * A canvas page is one surface that fills the viewport edge to edge, with
 * every piece of chrome floating ON it rather than framing it. The surface
 * IS the page: a header row and a side column would each be carving space
 * out of the only thing the page exists to show, and on the map that space
 * is the difference between seeing a repertoire and seeing part of one.
 *
 * This is why the width tiers cannot describe it. `PageWidth` answers "how
 * long should a line of this content be", which is a question a scrolling
 * column has and a canvas does not — a canvas wants the whole viewport at
 * every size. So the family is a shell of its own rather than a fourth
 * width, and it is a shell rather than a page's private markup so that the
 * second canvas page inherits the corner title, the floating panel and the
 * overlay instead of re-deriving them.
 *
 * The title sits small and quiet in a corner, not at `PageHeader`'s
 * `text-lg`: a heading that competes with the canvas is a heading in the
 * way. The back chevron is still phone-only and still `md:hidden`, because
 * where a page is reached through More is a fact about the page, not about
 * which family it belongs to.
 */
export function CanvasShell({
  title,
  back,
  meta,
  panel,
  children,
}: {
  title: string;
  /** Where the phone's back chevron goes; omit on top-level pages. */
  back?: () => void;
  /** Quiet trailing text beside the title — state, scope, save status. */
  meta?: ReactNode;
  /**
   * The selection's detail column. It floats over the canvas on a pointer
   * device and becomes a Sheet on a phone, where an inset column would
   * leave neither half usable. One prop rather than three so a panel can
   * never arrive without the label its Sheet needs.
   */
  panel?: { label: string; content: ReactNode; onClose: () => void } | null;
  children: ReactNode;
}) {
  // Below `md`: the width at which the sidebar appears and the panel stops
  // having anywhere to float that is not on top of the canvas.
  const phone = useMediaQuery('(max-width: 47.9375rem)');

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* The surface itself — no box, no border, edge to edge. */}
      {children}

      {/* The corner title, painted after the surface AND after anything
          the page overlays on it. The bar does not take clicks; only the
          chevron inside it does, so a drag that starts under the title
          still pans the canvas rather than dying on invisible chrome.

          The order is the point: an overlay is `absolute inset-0`, so it
          lies over the title's corner too, and a `z-10` sibling painted
          later wins the hit test. Painted first, the title kept its
          pixels — an overlay draws nothing up there — but lost its
          clicks, which left the back chevron dead on a phone for exactly
          as long as the map was failing to load. That is the one moment
          leaving the page is the only thing left to do. */}
      <div className="pointer-events-none absolute left-4 top-3 z-10 flex items-baseline gap-2">
        {back && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('Back')}
            className="pointer-events-auto -my-1 -ml-2 self-center md:hidden"
            onClick={back}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
        )}
        <h1 className="text-fg text-sm font-semibold tracking-tight">{title}</h1>
        {meta}
      </div>

      {panel &&
        (phone ? (
          <Sheet label={panel.label} onClose={panel.onClose}>
            {panel.content}
          </Sheet>
        ) : (
          <aside
            // The Sheet half of this pair announces itself by its label;
            // the floating half is a complementary landmark, and one with
            // no name is a landmark nobody can choose from a list.
            aria-label={panel.label}
            className="border-line bg-surface/90 absolute bottom-24 right-4 top-4 z-10 w-72 overflow-y-auto rounded-xl border p-4 shadow-[var(--shadow-panel)] backdrop-blur-md"
          >
            {panel.content}
          </aside>
        ))}
    </div>
  );
}

/**
 * A centred state laid over the whole canvas: the empty page, a load
 * failure, anything that replaces the surface rather than annotating it.
 *
 * The gutter and the layer are part of the geometry, not the caller's
 * choice. Written out per call site they had drifted apart — the error
 * card had `z-10 p-6` and the empty state had neither, which meant the
 * two states sat on different layers and the empty state's buttons could
 * run to the very edge of a narrow phone.
 */
export function CanvasOverlay({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('absolute inset-0 z-10 grid place-items-center p-6', className)}>
      {children}
    </div>
  );
}
