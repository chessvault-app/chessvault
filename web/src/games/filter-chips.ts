import { cn } from '@/lib/utils';

/**
 * What a quick filter looks like in the desktop filter bar, stated once
 * because three lists, their placeholder and the page's outline all draw
 * the same row.
 *
 * No React and no components here, so the outline's chunk pays for the
 * class strings and not for the page (the same reason pane-shape.ts holds
 * the page's measurements) — and so a placeholder can import them without
 * importing the page it is standing in for.
 *
 * The face is the phone tab strip's, which is the app's own chip: a pill
 * with the input border kept, quiet while it is at its default, wearing
 * the accent fill while it is narrowing the list (GamesTabStrip, the
 * chips lanph3re settled on 2026-09-19). Only the paint and the width
 * change; every one of these is the same Select it always was, with the
 * same options, the same value and the same accessible name.
 *
 * Every class is `md:`-gated. Below md the quick selects are not in the
 * row at all (QUICK_SELECT hides them and the More filters window holds
 * them instead), so a phone draws exactly what it drew before.
 */

/** The pill: content width rather than a share of the band. Three selects
    stretched across a full-width row is a form, and this is a filter
    bar — the values are short and the room they left over was the row's. */
export const CHIP_SHAPE = 'md:w-fit md:flex-none md:rounded-full';

/** The lit chip: this filter is narrowing the list. */
export const CHIP_ON = 'md:bg-accent md:text-foreground';

/** The class a quick select wears in the row: from `md` up it stands in
    the row as a chip, below it lives in the More filters window alone. */
export const QUICK_SELECT = 'max-md:hidden';

/** One quick filter's chip, `set` being "this is not its default". */
export const quickChip = (set: boolean): string =>
  cn(QUICK_SELECT, CHIP_SHAPE, set && CHIP_ON);

/** The More filters chip: the same pill, sized from an icon button, so
    the label it shows from `md` up does not stretch the button below it. */
export const MORE_FILTERS_CHIP = 'md:w-fit md:gap-1.5 md:rounded-full md:px-3';

/** Said in the button and again in the placeholder that stands in for
    it, so the bar's last chip is one width in both. */
export const MORE_FILTERS_LABEL = 'More filters';
