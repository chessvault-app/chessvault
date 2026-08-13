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
    const root = document.documentElement;

    /**
     * WHERE the band you can see is, not just how tall it is.
     *
     * Subtracting the keyboard from the shell was not enough on its own:
     * iOS also SHIFTS the page up to reveal the field, and a shell that is
     * merely shorter is still shifted — its head goes off the top of the
     * screen and its foot stops short of the keyboard, which is the black
     * band lanph3re photographed. So while the keyboard is up the shell is
     * pinned to the visual viewport instead: top at its offset, height at
     * its height. Then the app IS the band you can see, wherever iOS has
     * decided to put it.
     *
     * Only while the keyboard is up. Left set, these would also track
     * Safari's toolbar sliding in and out, and the shell would twitch
     * every time the page was scrolled.
     */
    if (next > 0) {
      root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`);
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    } else {
      root.style.removeProperty('--vvt');
      root.style.removeProperty('--vvh');
    }

    if (next !== inset) {
      inset = next;
      root.style.setProperty('--kb', `${inset}px`);
      root.classList.toggle('kb-open', inset > 0);
      for (const fn of subscribers) fn();
    }

    // After the shell has been re-pinned to the band, not before: the
    // field is already on screen by then, so this scrolls by nothing in
    // the common case. The window itself is only put back once the
    // keyboard has gone — while it is up, iOS owns that scroll, and
    // fighting it for it is what the first three attempts did.
    requestAnimationFrame(() => {
      if (inset === 0) {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.matches('input, textarea, [contenteditable="true"]')) {
        // `nearest` is the least scrolling that puts it on screen, and it
        // acts on the field's own scroller — the sheet it is in — rather
        // than on the page.
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  /**
   * Measure again, and again, until the keyboard has stopped moving.
   *
   * iOS fires its viewport events DURING the animation, and the numbers
   * they carry are wherever the keyboard had got to at that moment — often
   * a shift of zero, because the shift has not happened yet. One reading
   * was all this took, so the sheet stayed where it was and only came
   * right when a finger nudged the viewport and produced another event.
   * That is what lanph3re kept seeing: "it only comes up when I scroll a
   * little."
   *
   * So: read it now, and read it again over the next half second. measure()
   * is idempotent — it writes nothing when nothing has changed — so the
   * extra passes cost a subtraction each and settle the answer.
   */
  const settle = (): void => {
    measure();
    for (const ms of [60, 150, 300, 500]) setTimeout(measure, ms);
  };

  measure();
  vv.addEventListener('resize', settle);
  vv.addEventListener('scroll', settle);
  // The keyboard follows a focus, and the focus is the earliest notice
  // there is — earlier than any viewport event.
  document.addEventListener('focusin', settle);
  document.addEventListener('focusout', settle);
}
