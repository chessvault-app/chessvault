import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page-header';
import { Dialog, DialogContent } from '@/components/ui/dialog';

/**
 * How much of the canvas's right edge the floating panel is standing on,
 * in the surface's own pixels, and 0 whenever no panel is up.
 *
 * A canvas under a panel is still a whole canvas: it pans, it draws, and
 * nothing in it knows which part of it a reader can actually see. So the
 * one thing that does — this shell, which owns the panel's box — says so,
 * and a surface that can put something WHERE the reader asked for it (the
 * map moving its selection out from under the details) has a number to
 * aim at. Measured off the panel rather than repeated from its classes,
 * which change at `xl` and would otherwise have to be kept in step by
 * hand in a file that cannot see them.
 */
const CanvasInset = createContext(0);
export function useCanvasInset(): number {
  return useContext(CanvasInset);
}

/**
 * Focus for the floating panel, which is emphatically NOT a dialog: it
 * has no scrim, the canvas behind it stays live, and Tab must be able to
 * walk out of it. So it gets neither `useDialogFocus`'s trap nor its
 * scroll lock, only the two halves a non-modal panel does owe the
 * keyboard.
 *
 * Taking focus is by request, not on sight. A panel that opened because
 * somebody clicked a dot leaves the pointer alone; one that opened
 * because somebody pressed Enter on a dot has to bring the keyboard with
 * it, or it is a thing that appeared elsewhere on the screen while Tab
 * went on walking the page behind it.
 *
 * Handing focus back is the other half, because the alternative is
 * dropping it on the body: the panel goes away when the selection does,
 * and what raised it is still there on the canvas. Only the element last
 * focused OUTSIDE the panel counts, tracked as focus moves rather than
 * remembered when it opened, so a second dot chosen while it is up is
 * where focus returns to.
 */
function usePanelFocus(node: HTMLElement | null, takeFocus: number, onClose: () => void): void {
  const outside = useRef<HTMLElement | SVGElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!node) return;
    // SVG as well as HTML: on the map the thing that opened this panel is
    // a dot, and a dot is an SVG group.
    const focusable = (el: EventTarget | null): HTMLElement | SVGElement | null =>
      el instanceof HTMLElement || el instanceof SVGElement ? el : null;
    const here = focusable(document.activeElement);
    if (here && !node.contains(here)) outside.current = here;
    const onFocusIn = (e: FocusEvent): void => {
      const el = focusable(e.target);
      if (el && !node.contains(el)) outside.current = el;
    };
    document.addEventListener('focusin', onFocusIn);

    // A native listener rather than React's onKeyDown: the windows a panel
    // action opens are rendered inside the panel's own children and portal
    // out of it, so a React handler here would answer their Escape as well
    // as its own and close the panel underneath them.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.stopPropagation();
      close.current();
    };
    node.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('keydown', onKey);
      const current = document.activeElement;
      const back = outside.current;
      // Only what this panel was holding, and only somewhere still real:
      // focus moved deliberately elsewhere stays where it was put.
      if (
        back?.isConnected &&
        (current === null || current === document.body || node.contains(current))
      ) {
        back.focus({ preventScroll: true });
      }
    };
  }, [node]);

  // The Align idiom: a counter and the last one answered, so the same
  // request can be made twice and a panel that mounts without one is left
  // alone.
  const answered = useRef(takeFocus);
  useEffect(() => {
    if (takeFocus === answered.current || !node) return;
    answered.current = takeFocus;
    node.focus({ preventScroll: true });
  }, [takeFocus, node]);
}

/**
 * The canvas page family — the third of the three named in `components/layout.ts`.
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
  panel?: {
    label: string;
    content: ReactNode;
    onClose: () => void;
    /**
     * Bumped to ask the panel to take the keyboard with it. See
     * `usePanelFocus`: a selection made with the keyboard leaves focus in
     * the panel it just opened, one made with the pointer does not.
     */
    takeFocus?: number;
  } | null;
  children: ReactNode;
}) {
  // Below `md`: the width at which the sidebar appears and the panel stops
  // having anywhere to float that is not on top of the canvas.
  const phone = useMediaQuery('(max-width: 47.9375rem)');
  // The floating half of the pair, which is the half that stands on the
  // canvas; the phone's Sheet covers it whole and reserves nothing.
  const docked = Boolean(panel) && !phone;

  const surface = useRef<HTMLDivElement | null>(null);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  // Stable, or React detaches and re-attaches the ref every render, and
  // each of those is a setState: two renders per render, forever.
  const panelRef = useCallback((el: HTMLElement | null) => setPanelEl(el), []);
  usePanelFocus(panelEl, panel?.takeFocus ?? 0, panel?.onClose ?? (() => {}));

  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const box = surface.current;
    if (!panelEl || !box) return;
    const measure = (): void =>
      setInset(
        Math.max(0, box.getBoundingClientRect().right - panelEl.getBoundingClientRect().left),
      );
    measure();
    // The panel's own width is the only thing that moves this edge: the
    // gutter is a constant, so a resize that leaves the width alone leaves
    // the covered strip alone.
    const watch = new ResizeObserver(measure);
    watch.observe(panelEl);
    return () => {
      watch.disconnect();
      setInset(0);
    };
  }, [panelEl]);

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
      <div className="flex shrink-0 flex-col gap-4 px-4 pb-3 pt-4 md:px-6 md:pt-6">
        {/* The search row is PageHeader's: the field is what follows this
            page's title, one shell gap down (the column's gap-4, as in
            PageShell), where every other page's first row sits. */}
        <PageHeader title={title} back={back} meta={meta} search={search} />
      </div>

      {/* The surface, and everything that belongs ON it. Positioned, so
          the overlays and the panel measure themselves against the canvas
          rather than against the page. */}
      <div ref={surface} className="relative min-h-0 w-full flex-1 overflow-hidden">
        <CanvasInset.Provider value={inset}>{children}</CanvasInset.Provider>

        {/* The surface's own controls, floating on it — kept out of the
            header block so the search row has the left edge to itself,
            and drawn bare, because a canvas is not a toolbar. */}
        {actions && (
          <div
            // Out of reach while the panel stands on this corner, which it
            // does at every width it appears at: the icons are behind it
            // (see the panel's own note below), so they leave the tab
            // order with it rather than staying as stops that focus
            // something nobody can see — four of them on the map, in the
            // middle of the page's own Tab walk. The X in the panel's
            // header is how you get them back.
            inert={docked}
            className="absolute right-4 top-3 z-10 flex items-center gap-1 md:right-6"
          >
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
            <Dialog
              open
              // Two heights: its full one, where it opens, and half the
              // screen, where a drag down leaves it resting with the
              // canvas in view above it. The canvas is the subject and
              // the sheet covered every pixel of it; a drag past half
              // still closes.
              snapPoints={[0.5, 1]}
              defaultSnapPoint={1}
              onOpenChange={(open) => {
                if (!open) panel.onClose();
              }}
            >
              <DialogContent size="sm" title={panel.label} fill>
                {panel.content}
              </DialogContent>
            </Dialog>
          ) : (
            <aside
              ref={panelRef}
              // The Sheet half of this pair announces itself by its label;
              // the floating half is a complementary landmark, and one
              // with no name is a landmark nobody can choose from a list.
              aria-label={panel.label}
              // Focusable, so a keyboard selection can be handed the panel
              // it just opened and the landmark's own name is what gets
              // announced — see usePanelFocus. A container rather than a
              // control, so it wears the ring only while it is itself the
              // focus, and hands it on to its contents at the next Tab.
              tabIndex={-1}
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
              // open, and out of the tab order with it, and the X in its
              // header is how you get back to them. What is left is the
              // page's own gutter, and it is not spacing — it is what
              // makes the corners, the border
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
              //
              // What it covers, it also takes out of reach: the corner
              // icons are `inert` above while this is up, and the canvas
              // is told how wide this strip is (CanvasInset) so a surface
              // can keep what the reader just asked about out from under
              // it. Both beat fighting the stack with z-index, which would
              // only move the problem to whatever came second.
              className="bg-card/90 absolute bottom-6 right-6 top-3 z-10 flex w-[22rem] flex-col overflow-hidden rounded-xl outline-none ring-1 ring-window-ring backdrop-blur-md focus-visible:ring-3 focus-visible:ring-ring xl:w-[26rem]"
            >
              {/* The same strip the Sheet wears, for the same reason: the
                  scrim and Escape close a sheet and neither LOOKS like a
                  control, and this panel has not even got a scrim — it
                  stands over the canvas with no visible way out at all.
                  Named as well as marked, because a panel filling the
                  height no longer sits obviously beside its selection. */}
              <div className="border-border flex shrink-0 items-center gap-2 border-b px-4 py-2">
                <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{t(panel.label)}</p>
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
