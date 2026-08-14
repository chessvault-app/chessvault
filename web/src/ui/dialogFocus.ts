import { useCallback, useEffect, useRef, useState } from 'react';

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
 *  - takes focus into the dialog when it opens: a dialog whose only
 *    input field is a text field puts the caret straight in it —
 *    keyboard and all, on every device (see soleTextField) — and any
 *    other dialog focuses the dialog element itself, which never pops
 *    a phone keyboard; a field that autofocused on its own keeps focus;
 *  - keeps Tab inside it, wrapping at both ends;
 *  - locks the page behind it against scrolling;
 *  - hands focus back to whatever had it when the dialog closes.
 */

/** The platform's close-request primitive; not yet in TS's DOM lib. */
declare global {
  interface Window {
    CloseWatcher?: new () => {
      onclose: (() => void) | null;
      destroy: () => void;
    };
  }
}

/**
 * Close this dialog the way the PLATFORM asks, not only the keyboard.
 *
 * A "close request" is Escape on a desktop and the system Back gesture
 * on Android — and in an installed PWA that gesture is the only chrome
 * an Android phone has. Before this, every window listened for Escape
 * itself and Back was untranslated: it walked the browser history under
 * the open sheet, or backed out of the PWA entirely with the sheet
 * still up.
 *
 * CloseWatcher is the purpose-built API: no history entries to push and
 * silently consume (which would poison the router's history-floor
 * arithmetic in `up()`), the MOST RECENT watcher alone answers each
 * request (so one Escape no longer falls through a stacked option sheet
 * into the window beneath it), and Android's predictive-back animation
 * rides it for free. Where the API is missing — older WebKit — the
 * fallback is exactly the per-dialog Escape listener this replaced, and
 * iOS has no Back gesture to lose.
 */
export function useCloseRequest(onClose: () => void, active = true): void {
  // The latest closer, so a watcher attached once never calls a stale one.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!active) return;
    if (window.CloseWatcher) {
      const watcher = new window.CloseWatcher();
      watcher.onclose = () => close.current();
      return () => watcher.destroy();
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

/** Everything Tab can land on. `[tabindex="-1"]` is focusable but not tabbable. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The input types a caret goes into, as opposed to a checkbox or a slider. */
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/**
 * The field a dialog exists to fill in, if that is the kind of dialog it is.
 *
 * The ground rule: a window whose ONLY input field is a text field was
 * opened to type into it — a rename, a new name, one box to paste into —
 * so it takes the focus, keyboard and all, on every device. A second
 * field of any kind means the window is a form to be read first, and a
 * window with no fields has nothing to type into; both keep the old
 * behaviour (the container takes focus, silently).
 *
 * A SEARCH box is the exception, and not by input type — every plain
 * Input is type="search" for autofill reasons (see ui/Input) — but by
 * SearchInput's own marker. A search field filters the content below
 * it: a window whose only field is one (the online archive's username
 * box, the elite games' player search) was opened to browse that
 * content, and opening it under a keyboard hides the very thing it is
 * for. The box is one tap away for whoever wants it.
 */
function soleTextField(node: HTMLElement): HTMLElement | null {
  const fields = Array.from(
    node.querySelectorAll<HTMLElement>(
      'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])',
    ),
    // Visible only, same as the Tab walk below: a phone-only field that is
    // `hidden sm:block` still counts on a desktop and must not here.
  ).filter((el) => el.offsetParent !== null);
  if (fields.length !== 1) return null;
  const only = fields[0]!;
  if (only.hasAttribute('data-search-field')) return null;
  if (only instanceof HTMLTextAreaElement) return only;
  if (only instanceof HTMLInputElement && TEXT_TYPES.has(only.type)) return only;
  return null;
}

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

  // The sole-text-field focus happens HERE, in the ref callback, not in
  // the effect below: a ref attaches synchronously inside the tap that
  // opened the dialog, and iOS only raises the keyboard for a focus it
  // can trace to a user gesture — from a passive effect it focuses the
  // field and leaves the keyboard down. Guarded per node, because the
  // callers chain refs in fresh arrows and React re-runs those every
  // render; the caret must be placed once per opening, not once per paint.
  const armed = useRef<HTMLElement | null>(null);
  const ref = useCallback((next: HTMLElement | null) => {
    setNode(next);
    if (!next || next === armed.current) return;
    armed.current = next;
    if (!next.contains(document.activeElement)) soleTextField(next)?.focus();
  }, []);

  useEffect(() => {
    if (!active || !node) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    acquireLock();

    // Take focus only if nothing inside already has it — a prompt's field
    // may have autofocused (or the ref callback above put the caret in it)
    // between mount and this effect, and stealing focus from it would
    // throw the caret away. The field is asked for again first, for the
    // one path the ref cannot serve: a window mounted hidden shows no
    // fields until it is shown, and by then its ref has long since run.
    if (!node.contains(document.activeElement)) {
      const field = soleTextField(node);
      if (field) field.focus();
      else {
        if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
        node.focus({ preventScroll: true });
      }
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

  return ref;
}
