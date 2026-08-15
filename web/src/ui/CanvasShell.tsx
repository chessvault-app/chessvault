import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { PageHeader } from './PageHeader';
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
  actions,
  search,
  panel,
  children,
}: {
  title: string;
  /** Where the phone's back chevron goes; omit on top-level pages. */
  back?: () => void;
  /** Quiet trailing text beside the title — state, scope, save status. */
  meta?: ReactNode;
  /**
   * The page's own controls, floating bare on the surface in the far
   * corner — no card, no button squares, because chrome drawn ON a
   * canvas should look like it belongs to the canvas rather than like a
   * toolbar parked over it.
   */
  actions?: ReactNode;
  /**
   * A filter or search for the surface, on a row of its own under the
   * title. It shared the title's row while there were two of them; a
   * field is a different kind of thing from a name and from a pair of
   * buttons, and three kinds in one row is a row that has to be read.
   */
  search?: ReactNode;
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

      {/* The page's heading, painted after the surface AND after anything
          the page overlays on it.

          It is `PageHeader` on `PageShell`'s own gutters, not a smaller
          thing of its own. A canvas page briefly had a `text-sm` title in
          the corner, on the theory that a heading competing with the
          canvas is a heading in the way; what it actually did was make
          this page's name a different size and a different distance from
          the edge than every other page in the app, which reads as a
          mistake rather than as restraint. The floating is what makes it
          a canvas page; the typography is what makes it this app.

          The row itself takes no clicks — a drag that starts in the empty
          middle of the header still pans the canvas — while everything
          inside it does. Painting after the overlays is the other half:
          an overlay is `absolute inset-0`, so it covers the header too,
          and a `z-10` sibling painted later wins the hit test. Painted
          first, the header kept its pixels and lost its clicks, which
          left the back chevron dead for exactly as long as the map was
          failing to load — the one moment leaving is all there is to do. */}
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-4 md:px-6 md:pt-6',
          '[&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_input]:pointer-events-auto',
        )}
      >
        <PageHeader title={title} back={back} meta={meta} />
        {search && <div className="mt-2 flex">{search}</div>}
      </div>

      {/* The surface's own controls, floating on it. Kept out of the
          header block so the search row can have the left edge to
          itself, and drawn bare — a canvas is not a toolbar. */}
      {actions && (
        <div className="absolute right-4 top-4 z-10 flex items-center gap-1 md:right-6 md:top-6">
          {actions}
        </div>
      )}

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
            // Clears the header row rather than sitting beside it, and
            // keeps the shell's own gutter on the other three sides — the
            // Fab it used to leave 6rem for is gone at this size. Wide
            // enough that its fields, its statistics rows and its button
            // row stop wrapping: at 18rem nearly every line in it broke,
            // which is a panel that is technically showing you something
            // and practically hiding it.
            className="border-line bg-surface/90 absolute bottom-6 right-6 top-[4.75rem] z-10 w-[22rem] overflow-y-auto rounded-xl border p-4 shadow-[var(--shadow-panel)] backdrop-blur-md xl:w-[26rem]"
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
