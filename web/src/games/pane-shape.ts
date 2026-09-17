/**
 * The measurements that decide the Games page's layout, in one file
 * because three things now read them: the page (CollectionView, which
 * lays the grid out), the browser inside it (GamesBrowser, which folds
 * its toolbar against the room left), and the OUTLINE that stands in for
 * the page while its chunk is on the wire (GamesView.skeleton).
 *
 * They were constants in the two components, which was enough while the
 * two components were the only readers. An outline that copied them
 * would be a third statement of the same arithmetic — the drift these
 * modules exist to remove — and an outline that guessed instead is what
 * left the page's rows unreserved.
 *
 * No React and no components here, so the outline's chunk pays for the
 * numbers and not for the page.
 */

/**
 * Whether the details column keeps its place when nothing is selected —
 * a reading preference, per device, the way the table's dragged column
 * widths (vault:game-table-cols) and the panels' heights (vault:panel-h:*)
 * are. Written on every toggle rather than removed when it agrees with
 * the default below, because that default MOVES with the window: a
 * choice erased for matching it would be undone by a resize, which is
 * the one thing an explicit switch must not do.
 */
export const DETAILS_PIN_KEY = 'vault:games-details-pinned';

/** The stored choice, or null where nobody has chosen on this device and
    the width decides (PIN_FREE_MQ). */
export function readDetailsPin(): boolean | null {
  try {
    const stored = localStorage.getItem(DETAILS_PIN_KEY);
    return stored === null ? null : stored === '1';
  } catch {
    return null;
  }
}

/**
 * The viewport where the details column is FREE — where the table still
 * shows every column beside it, so keeping the panel open costs nothing
 * and the default stays what it has always been.
 *
 * Arithmetic first: the dense table states its own minimum, and
 * `--gt-min` measures 1026px at the default column widths (GameTable's
 * COLUMNS sum to 930, plus nine 8px gaps and the row's px-3). Beside it
 * the panel's track takes its 23rem max — measured at exactly 368 — the
 * grid's gap is 16, and the page loses the sidebar's 13rem and the
 * shell's md gutters: 1026 + 368 + 16 + 208 + 48 = 1666.
 *
 * Then measured, because 1666 is 10px short: the list scrolls itself,
 * and index.css's thin scrollbar takes its 10px out of the scroller's
 * content box, so at 1666 the table still scrolled sideways by exactly
 * that (clientWidth 1016 against scrollWidth 1026). 1680 is the round
 * number above it, and measures clean — 1030 against 1030.
 *
 * The 208 is the sidebar unfolded. Folded to its rail it gives 140 of
 * that back, so the panel is free from about 1540 — but a media query
 * cannot see the fold, and erring towards "not free" only means a wide
 * window with a folded rail starts unpinned when it could have started
 * pinned, which the switch in the panel's header corrects once.
 *
 * Below that width the panel is paid for in table columns — the table
 * never sheds them, it scrolls sideways to reach them (GameTable) — so a
 * window that narrow starts with the column given back and spends it on
 * the panel only while a game is actually selected.
 */
export const PIN_FREE_MQ = '(min-width: 1680px)';

/**
 * Where the details column stops being 23rem and takes 27rem.
 *
 * The track was `minmax(20rem,23rem)` at every width, so a 1920px window
 * gave the table 1104px and left the panel on the same 368px a 1024px
 * window gets — the one width where the panel costs the table nothing
 * was also the width where it refused the room. 368px is tight for what
 * the panel is for: the opening name, the thing a reader actually wants
 * off it, truncates there ("…: Exchange Variation, Reshevs…") and reads
 * in full on a 390px phone's sheet.
 *
 * The threshold is the same arithmetic PIN_FREE_MQ states, with the
 * panel's new maximum in it: the table's own minimum (`--gt-min`, 1026
 * at the default column widths), the grid's 16px gap, 432 for a 27rem
 * panel, the sidebar's 208 unfolded and the shell's 48 of md gutters,
 * which is 1730 — plus the 10px the thin scrollbar takes out of the
 * scroller's content box, the same 10 that put PIN_FREE_MQ at 1680
 * rather than its arithmetic's 1666. So 1740, and below it the panel
 * stays 23rem, because a wider panel there is paid for in the table's
 * columns and that is exactly what the 1680 line exists to stop.
 */
export const PANEL_WIDE_MQ = '(min-width: 1740px)';

/**
 * What the unpinned details column takes from the pane when it arrives:
 * the track's maximum (23rem, measured at exactly 368; 27rem past
 * PANEL_WIDE_MQ) plus the grid's 16px gap. The browser folds its toolbar
 * against the pane LESS this while no column stands, so a selection
 * cannot re-fold it (GamesBrowser's detailsReservePx). The maximum
 * rather than the 20rem floor, because at lg the track is never
 * squeezed below its maximum (the table's own column is minmax(0,1fr)),
 * and erring wide only ever means a toolbar folded one row earlier.
 */
export const DETAILS_RESERVE_PX = 368 + 16;
export const DETAILS_RESERVE_WIDE_PX = 432 + 16;

/** Where the table becomes a table: the same lg the page reads for its
    own grid, so the rows, the details column and the toolbar's fold all
    turn at one width. */
export const TABLE_MQ = '(min-width: 64rem)';

/**
 * How much room the toolbar needs before the filter selects ride the
 * search row instead of standing in a band of their own. Measured
 * against the pane's own width, less whatever a details column is
 * holding (GamesBrowser's decisiveW).
 */
export const MERGED_MIN_PX = 896;
