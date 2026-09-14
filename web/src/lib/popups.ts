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
}
