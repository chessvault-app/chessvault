/**
 * The popups that are open right now, so a page change can close them
 * first.
 *
 * React skips a view transition it has pending the moment anything calls
 * `flushSync`, and Base UI closes a tooltip with one. On a phone a tap
 * hovers nothing and no tooltip is open when the route changes; a pointer
 * that hovers the back chevron before pressing it opens the chevron's
 * tip, the press starts the page turn, the tip closes inside it, and
 * React cuts where it meant to slide (measured with Playwright's mouse
 * click, which hovers first: every pop a cut; with a tap: every pop a
 * slide). So an open tooltip registers its closer here while it is open,
 * and the router closes them all, synchronously, before it starts the
 * transition, when a flushSync costs nothing.
 */
import { useEffect, useEffectEvent } from 'react';

const closers = new Set<() => void>();

/**
 * A controlled popup's registration, for the registry roots (Popover,
 * DropdownMenu, ContextMenu, Select): while `open`, `close` is on the
 * list the router runs. The exit animation is not the router's problem
 * here: index.css turns a popup's closing animation off while the root
 * carries `data-nav`, so Base UI sees the animation end at once, inside
 * the router's own flush and before the transition exists to be skipped.
 */
export function useOpenPopup(open: boolean, close: () => void): void {
  const shut = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    return registerOpenPopup(() => shut());
  }, [open]);
}

/**
 * The close a root asks its caller for. Base UI's onOpenChange takes the
 * event's details as a second argument; every caller in the app reads the
 * boolean only, and there is no event to describe, so the details are
 * left out.
 */
export function closeByRoute(onOpenChange: unknown): () => void {
  return () => (onOpenChange as ((open: boolean) => void) | undefined)?.(false);
}

/** Register a closer while a popup is open; call the returned function
    when it closes or unmounts. */
export function registerOpenPopup(close: () => void): () => void {
  closers.add(close);
  return () => {
    closers.delete(close);
  };
}

/** Close every registered popup. */
export function closePopups(): void {
  for (const close of [...closers]) close();
  settleClosingPopups();
}

/**
 * A popup that was ALREADY closing when the page turn began: end its
 * exit now. It is not on the list above, since it stopped being open
 * when its verb was pressed, but Base UI still reports the end of its
 * exit with a flushSync, and an end that lands inside the pending turn
 * makes React skip the turn. `[data-nav]` takes the animation away in
 * the stylesheet, which the browser only acts on at its next style
 * pass, inside the turn; finishing it here resolves it in a microtask,
 * before React has rendered the transition at all.
 *
 * Found when an iPhone's menu took a 200ms exit: a book's Read verb
 * navigates about 150ms after the press, and measured on the demo the
 * turn played with a 100ms exit and was skipped with a 200ms one. It
 * was a race at either length, won until then by the shorter exit.
 */
const CLOSING =
  ':is([data-slot=popover-content], [data-slot=dropdown-menu-content], [data-slot=context-menu-content], [data-slot=select-content])[data-closed]';

function settleClosingPopups(): void {
  for (const popup of document.querySelectorAll(CLOSING)) {
    for (const animation of popup.getAnimations()) animation.finish();
  }
}
