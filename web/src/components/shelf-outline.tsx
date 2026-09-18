import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { CreateControl } from '@/components/fab';
import { Inert, SkeletonSubtitle } from '@/components/skeletons';
import { ShelfToolbar, type ShelfDir, type ShelfSorts } from '@/components/shelf-toolbar';
import type { ShelfLayout } from '@/components/shelf-card';

/**
 * A shelf's toolbar while its page is on the wire: the REAL toolbar,
 * held inert.
 *
 * It used to be a reduced copy — the title, a count bar and a search
 * field — on the argument that the row of buttons beside the title
 * "changes nothing about where the cards start". True of the cards, and
 * false of the picture: the settled shelf draws a bookmark toggle, the
 * sort select with the order this device chose printed in it, the
 * direction arrow, the layout switch and the Create button, and a
 * placeholder that draws none of them is a different screen, not the
 * same screen waiting. It got the field's own width wrong too, and
 * silently: PageHeader caps its search slot's first child at `max-w-sm`
 * from md, the copy wrapped the field in `Inert` (a `display: contents`
 * span), and a `display: contents` box ignores max-width — so the
 * outline's field ran the full column where the settled one stops at
 * 384px. Measured on the demo at 1280: 1003px against 384.
 *
 * So the outline draws ShelfToolbar itself, with `Inert` OUTSIDE it,
 * wrapping the whole header rather than one slot. Nothing here can
 * disagree with the settled shelf about a control's size, because it is
 * the same control.
 *
 * Everything it is given is known before anything is fetched: the
 * shelf's name, its search placeholder, its sort list, and the order and
 * layout this device last chose (shelf-toolbar's `readShelfView`, or a
 * shelf's own reader where its orders are its own). The two things that
 * are not known are the count line, which is a bar, and the cards, which
 * are the shelf's own reservation.
 *
 * Here rather than in each shelf's outline module because the three
 * shelves hold the same kind of thing and had no business being
 * different sizes (NotesView's own note about the studies shelf). It is
 * reached only from those outline modules, so it rides their chunks and
 * costs the launch nothing.
 */
export function ShelfHeader<S extends string>({
  title,
  back,
  search,
  subtitle,
  sorts,
  sort,
  dir,
  layout,
  create,
}: {
  title: string;
  /** A shelf reached from a hub rather than from the nav has a way back,
      and the chevron sits before the title, so an outline without it
      draws the name 44px left of where it lands. Live, like the two
      page outlines' (databases, insights): it needs nothing that is
      still on the wire. */
  back?: () => void;
  /** The field's own placeholder, which is also its label. */
  search: string;
  /** Whether a count line is coming. The studies shelf drops it entirely
      on a vault with no studies, so the stored shape is what knows. */
  subtitle: boolean;
  /** The orders this shelf offers; the document shelves' three unless
      the shelf says otherwise (the library orders by what a book has). */
  sorts?: ShelfSorts<S>;
  /** The order this device last chose, printed in the select. */
  sort: S;
  dir: ShelfDir;
  /** The layout switch's state, or nothing where the shelf has no switch
      (the library, whose cards are covers). */
  layout?: ShelfLayout;
  /** The shelf's own Create control — see `OutlineCreate`. */
  create: ReactNode;
}) {
  return (
    <Inert>
      <ShelfToolbar<S>
        title={title}
        back={back}
        subtitle={subtitle ? <SkeletonSubtitle /> : undefined}
        query=""
        onQuery={NOOP}
        placeholder={search}
        sorts={sorts}
        sort={sort}
        onSort={NOOP}
        dir={dir}
        onDir={NOOP}
        layout={layout}
        onLayout={layout === undefined ? undefined : NOOP}
        markedOnly={false}
        onMarkedOnly={NOOP}
        create={create}
      />
    </Inert>
  );
}

/**
 * The shelf's Create button as an outline draws it.
 *
 * Only two things decide that button's face: its label, and whether
 * there is more than one action behind it, which is what puts the
 * chevron on it and opens a menu instead of firing (components/fab). The
 * actions themselves are the page's, with handlers an outline could not
 * call, so it passes the count and the real control draws itself.
 *
 * Every stand-in action carries the SAME label, because a control with
 * one action prints that action's name on the button rather than the
 * menu's: numbered placeholders drew the puzzle shelf a button that
 * read "+ 0".
 */
export function OutlineCreate({
  label = 'Create',
  actions,
  compact,
}: {
  label?: string;
  actions: number;
  /** As the shelf's own CreateControl. */
  compact?: boolean;
}) {
  return (
    <CreateControl
      label={label}
      compact={compact}
      actions={Array.from({ length: actions }, () => ({
        label,
        icon: Plus,
        onSelect: NOOP,
      }))}
    />
  );
}

const NOOP = (): void => {};
