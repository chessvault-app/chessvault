import type { CSSProperties } from 'react';

/**
 * The phone pane strip's open-tab marker, said once for the strip and
 * for the picture drawn in its place.
 *
 * The strip is drawn twice. PaneTabs draws the real one, and
 * components/skeletons/board draws the one a board page's outline
 * stands behind while the page's chunk is on the wire; it cannot draw
 * the real control, which is a tab stop over a page that is not there
 * yet. Both stated the marker themselves, so when the 2px line on the
 * card's edge became a muted segment under 18px icons (77decca8,
 * 2026-09-18) only one of them changed: every board page went on
 * opening with the retired face, under icons two pixels small, and
 * nothing said so. No measurement could. The box is the same box either
 * way, and the outline's strip is aria-hidden with no role, so
 * check:skeletons reads no landmark there at all. The face is a
 * constant now, and neither side is where it is stated.
 */
export const PANE_MARKER = 'bg-muted absolute inset-y-[3px] rounded-lg';

/**
 * The strip's icon, which is not a row's glyph: at 32px tall the strip
 * read as thin and 14px icons as small, so they are 18 (77decca8).
 */
export const PANE_ICON = 'size-[1.125rem]';

/**
 * Where the marker sits: one tab's width, inset 3px like the registry's
 * pill, over the tab at `at`.
 *
 * Dragging left pulls the next pane in, so the fill goes right: a pane's
 * travel is a tab's width here. `--pane-dx` is the column's, inherited;
 * at rest it is unset and this is 0, which is what the outline inherits
 * too, having no swipe to follow.
 */
export const paneMarkerStyle = (count: number, at: number): CSSProperties => ({
  width: `calc(${100 / count}% - 6px)`,
  left: `calc(${(at * 100) / count}% + 3px)`,
  transform: `translateX(calc(var(--pane-dx, 0px) / -${count}))`,
});
