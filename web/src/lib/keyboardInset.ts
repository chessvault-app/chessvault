import { useSyncExternalStore } from 'react';

/** Under this much, it is browser chrome moving, not a keyboard. */
const KEYBOARD_MIN = 120;

let inset = 0;
const subscribers = new Set<() => void>();

const subscribe = (fn: () => void): (() => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

/**
 * How much of the window the on-screen keyboard is covering, in pixels.
 *
 * One listener for the whole app, published three ways: this number for
 * components that lay themselves out in JS, the `--kb` custom property for
 * anything that can do it in CSS, and a `kb-open` class on the root for
 * the things that simply go away while typing.
 *
 * Returns 0 where there is no visual viewport (every desktop browser, and
 * anything without a virtual keyboard), so callers need no branch.
 */
export function useKeyboardInset(): number {
  return useSyncExternalStore(
    subscribe,
    () => inset,
    () => 0,
  );
}

/**
 * Give the app back the height the keyboard took, instead of letting the
 * browser shove the page.
 *
 * The old stance was to let iOS do its native shove and put the window
 * back once the keyboard closed — three attempts to prevent it had each
 * failed worse than the shove (main.tsx used to carry the list). The one
 * that came closest was resizing the shell, and it failed for a reason
 * that has since gone away: it parked the bottom nav bar on top of the
 * keyboard. Everything that asks for typing on a phone is a bottom sheet
 * now, and the nav is hidden underneath it anyway — so the shell can end
 * where the keyboard begins, and then there is nothing under the keyboard
 * for the browser to want to scroll to.
 *
 * What is left is small and in our hands: put the window back if it moved
 * anyway, and scroll the field itself into view by the least amount that
 * works.
 */
export function startKeyboardTracking(): void {
  const vv = window.visualViewport;
  if (!vv) return;

  const measure = (): void => {
    // offsetTop matters: iOS shifts the visual viewport up rather than
    // shrinking it in some states, and the covered height is what is
    // below the visible band either way.
    const covered = window.innerHeight - vv.height - vv.offsetTop;
    const next = covered > KEYBOARD_MIN ? Math.round(covered) : 0;
    if (next !== inset) {
      inset = next;
      const root = document.documentElement;
      root.style.setProperty('--kb', `${inset}px`);
      root.classList.toggle('kb-open', inset > 0);
      for (const fn of subscribers) fn();
    }

    // After the shell has been re-measured against the new --kb, not
    // before: the point of both of these is that the layout already fits
    // above the keyboard, so neither has anything visible to undo.
    requestAnimationFrame(() => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (inset === 0) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.matches('input, textarea, [contenteditable="true"]')) {
        // `nearest` is the least scrolling that puts it on screen, and it
        // acts on the field's own scroller — the sheet it is in — rather
        // than on the page.
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  measure();
  vv.addEventListener('resize', measure);
  vv.addEventListener('scroll', measure);
}
