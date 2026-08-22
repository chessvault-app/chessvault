import type { KeyboardEvent } from 'react';

/**
 * Arrow keys for a strip of tabs, and one Tab stop for the strip.
 *
 * Three of these were written in this app — PaneTabs, Segmented, and the
 * collection view's own panel-title switch — and all three had the roles
 * (`tablist`, `tab`, `aria-selected`) and none of the keyboard. Every tab
 * was its own Tab stop, so a keyboard user walked through a five-segment
 * filter one segment at a time to reach what was after it, and the arrow
 * keys — the ones a screen reader tells them to use, because the role
 * promises them — did nothing at all.
 *
 * The pattern is the standard one: the selected tab is the only one in
 * the tab order, Left/Right move along the strip and wrap, Home and End
 * jump to the ends, and moving the selection moves the focus with it.
 * Selection follows the arrow rather than waiting for Enter, which is
 * what these strips already do on a click and what the pattern calls
 * automatic activation — right where switching is cheap, which it is for
 * all three (a pane, a sort order, a source).
 *
 * Vertical strips would want Up/Down; there are none, so there is no
 * `orientation` to pass. The strip's own element is what listens, so a
 * key pressed on any tab in it arrives here by bubbling.
 */
export function useRovingTabs<T extends string>(
  ids: readonly T[],
  value: T,
  onChange: (id: T) => void,
): {
  /** Spread on the element carrying `role="tablist"`. */
  stripProps: { onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
  /** The tab order: 0 for the live tab, -1 for the rest. */
  tabIndex: (id: T) => 0 | -1;
} {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    let next: T | undefined;
    if (step !== 0) {
      const from = ids.indexOf(value);
      next = ids[(from + step + ids.length) % ids.length];
    } else if (e.key === 'Home') next = ids[0];
    else if (e.key === 'End') next = ids[ids.length - 1];
    else return;

    e.preventDefault();
    // And stop it here. preventDefault does not stop a bubble, and the
    // board's shortcuts listen on the WINDOW: they skip a focused input
    // but know nothing about a focused tab, so on a phone — where the
    // pane switcher sits under the board — an arrow would have moved
    // along this strip and stepped the game at the same time. Home would
    // have jumped to the first tab and the first move together. An open
    // strip owns its keys, which is the rule Select's listbox already
    // follows for the same reason.
    e.stopPropagation();
    if (next === undefined) return;
    if (next !== value) onChange(next);
    // The nodes are keyed by id and survive the re-render, so the one to
    // focus can be found now rather than after it. Queried off the strip
    // itself: these components hold no refs to their own buttons, and a
    // ref array for three keys of arithmetic would be the more fragile
    // half of this.
    const tabs = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs[ids.indexOf(next)]?.focus();
  };

  return { stripProps: { onKeyDown }, tabIndex: (id) => (id === value ? 0 : -1) };
}
