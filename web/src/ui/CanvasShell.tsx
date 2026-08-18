import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { Button } from './Button';
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
 * `text-xl`: a heading that competes with the canvas is a heading in the
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
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* The page's heading, in the flow above the surface rather than
          floating over it.

          It is `PageHeader` on `PageShell`'s own gutters, not a smaller
          thing of its own. A canvas page briefly had a `text-base` title in
          the corner, on the theory that a heading competing with the
          canvas is a heading in the way; what it actually did was make
          this page's name a different size and a different distance from
          the edge than every other page in the app, which reads as a
          mistake rather than as restraint.

          It floated for a while too, and that was the same error one
          level up: a surface drawn underneath its own title puts dots and
          labels behind the words, and pans them through the heading as
          you drag. The canvas gets the room below instead, which also
          means it can no longer swallow a press meant for the header —
          the pointer-events dance that used to arrange that is gone. */}
      <div className="shrink-0 px-4 pb-3 pt-4 md:px-6 md:pt-6">
        <PageHeader title={title} back={back} meta={meta} />
        {search && <div className="mt-2 flex">{search}</div>}
      </div>

      {/* The surface, and everything that belongs ON it. Positioned, so
          the overlays and the panel measure themselves against the canvas
          rather than against the page. */}
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        {children}

        {/* The surface's own controls, floating on it — kept out of the
            header block so the search row has the left edge to itself,
            and drawn bare, because a canvas is not a toolbar. */}
        {actions && (
          <div className="absolute right-4 top-3 z-10 flex items-center gap-1 md:right-6">
            {actions}
          </div>
        )}

        {panel &&
          (phone ? (
            // `fill`: one height whatever the selection holds. Sized to
            // its content, this sheet stood two thirds of the screen for
            // a move with games under it and a third for a bare one, and
            // its footer — the row of things you can do — landed
            // somewhere different each time you opened it.
            <Sheet label={panel.label} onClose={panel.onClose} fill>
              {panel.content}
            </Sheet>
          ) : (
            <aside
              // The Sheet half of this pair announces itself by its label;
              // the floating half is a complementary landmark, and one
              // with no name is a landmark nobody can choose from a list.
              aria-label={panel.label}
              // The canvas's height, less a hairline of it: a card that
              // floats ON the surface, edge to edge but not welded to it.
              //
              // It was inset a whole 1.5rem with 3.5 at the top, to clear
              // the action icons in that corner. What that bought was two
              // rows of canvas above and below a panel whose content — a
              // board, four fields, a statistics table and a button row —
              // is taller than the screen and scrolls: room the panel
              // needed, spent keeping reachable two icons that a closed
              // panel shows anyway. So the icons go under it while it is
              // open, and the X in its header is how you get back to
              // them. What is left is the page's own gutter, and it is
              // not spacing — it is what makes the corners, the border
              // and the shadow visible all the way round, so the panel
              // reads as one object over the map rather than as a slab
              // bolted to the window. `overflow-hidden` because a sticky
              // footer inside it bleeds to these edges and would
              // otherwise paint square corners over the round ones.
              //
              // The GUTTER, not a number picked to look tight: this card
              // shares a right edge with the search field above it (and
              // with every page in the app), and at 0.75rem it overhung
              // that edge by half a gutter — near enough to read as a
              // mistake rather than as a choice. The top is 0.75rem
              // because the header block already spends its own 0.75
              // underneath itself, so the gap you actually see between
              // the search field and this card is the same 1.5rem.
              //
              // Wide enough that its fields, its statistics rows and its
              // button row stop wrapping: at 18rem nearly every line in
              // it broke, which is a panel technically showing you
              // something and practically hiding it.
              className="border-line bg-surface/90 absolute bottom-6 right-6 top-3 z-10 flex w-[22rem] flex-col overflow-hidden rounded-xl border shadow-[var(--shadow-panel)] backdrop-blur-md xl:w-[26rem]"
            >
              {/* The same strip the Sheet wears, for the same reason: the
                  scrim and Escape close a sheet and neither LOOKS like a
                  control, and this panel has not even got a scrim — it
                  stands over the canvas with no visible way out at all.
                  Named as well as marked, because a panel filling the
                  height no longer sits obviously beside its selection. */}
              <div className="border-line flex shrink-0 items-center gap-2 border-b px-4 py-2">
                <p className="text-subtle min-w-0 flex-1 truncate text-sm">{t(panel.label)}</p>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={t('Close')}
                  aria-label={t('Close')}
                  className="-my-1 -mr-1 shrink-0"
                  onClick={panel.onClose}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">{panel.content}</div>
            </aside>
          ))}
      </div>
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
