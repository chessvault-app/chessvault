import { useEffect, useState } from 'react';

/**
 * Focus management for the shared dialog primitives.
 *
 * Every window in the app had the right role and the right Escape and
 * none of the focus behaviour a dialog owes the keyboard: Tab walked
 * straight out of an open window into the page behind it, nothing was
 * focused when a window opened, and closing one dropped focus on the
 * body instead of the control that opened it. Fixed once here rather
 * than per window, which is the whole point of having shared primitives.
 *
 * One hook does four things while its dialog is active:
 *  - takes focus into the dialog when it opens (the dialog element
 *    itself unless something inside — a PromptSheet field — already
 *    took it; focusing the container never pops a phone keyboard);
 *  - keeps Tab inside it, wrapping at both ends;
 *  - locks the page behind it against scrolling;
 *  - hands focus back to whatever had it when the dialog closes.
 */

/** Everything Tab can land on. `[tabindex="-1"]` is focusable but not tabbable. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * How many dialogs are up right now.
 *
 * Counted rather than flagged because windows stack: the editor's photo
 * page opens over the window that asked for it, and the scroll lock must
 * survive until the LAST one goes.
 */
let openCount = 0;
let lockedOverflow = '';

/**
 * Is any dialog open?
 *
 * For the app's global shortcuts — the board's arrow keys listen on the
 * window and used to keep stepping the game behind an open window's
 * scrim. A document-level listener cannot see a scrim; this is how it
 * asks.
 */
export function dialogOpen(): boolean {
  return openCount > 0;
}

function acquireLock(): void {
  if (++openCount === 1) {
    lockedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function releaseLock(): void {
  if (--openCount === 0) document.body.style.overflow = lockedOverflow;
}

/**
 * Returns a ref callback for the dialog element (the node carrying
 * `role="dialog"`). Callers that also give that node another ref — the
 * sheet-drag ref — chain both in one arrow.
 *
 * `active` is for windows that stay mounted while hidden (Modal's
 * `hidden` prop): a window that is out of sight holds no focus and no
 * lock, and re-arms when it comes back.
 */
export function useDialogFocus(active = true): (node: HTMLElement | null) => void {
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !node) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acquireLock();

    // Take focus only if nothing inside already has it — a prompt's field
    // may have autofocused between mount and this effect, and stealing
    // focus from it would throw the caret away.
    if (!node.contains(document.activeElement)) {
      if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
      node.focus({ preventScroll: true });
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      // Only what is actually on screen: `hidden sm:inline-flex` controls
      // (the desktop-only X) render on phones with no box at all, and
      // focusing one puts focus nowhere.
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const current = document.activeElement;
      const inside = current instanceof HTMLElement && node.contains(current);
      if (e.shiftKey) {
        if (!inside || current === items[0]) {
          e.preventDefault();
          items[items.length - 1]!.focus();
        }
      } else if (!inside || current === items[items.length - 1]) {
        e.preventDefault();
        items[0]!.focus();
      }
    };
    node.addEventListener('keydown', onKey);

    return () => {
      node.removeEventListener('keydown', onKey);
      releaseLock();
      // Hand focus back — but only if this dialog still holds it (or its
      // removal already dumped it on the body). If something moved focus
      // deliberately — a verb in this window focused a field behind it —
      // that choice stands.
      const current = document.activeElement;
      if (
        opener &&
        opener.isConnected &&
        (current === null || current === document.body || node.contains(current))
      ) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [active, node]);

  return setNode;
}
