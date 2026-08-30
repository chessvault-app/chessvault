/** Under this much, it is browser chrome moving, not a keyboard. */
const KEYBOARD_MIN = 120;

/** A line of breathing room, so the caret never sits on the very edge. */
const CARET_MARGIN = 8;

/**
 * The box a field scrolls inside — the sheet, or the note's own column —
 * rather than the page.
 */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
      return p;
    }
  }
  return null;
}

/** Where the caret is, or null if there is no selection to ask about. */
function caretRect(): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.height > 0 || rect.width > 0) return rect;
  // A collapsed range at the start of a line measures zero in WebKit; its
  // client rects still carry the line box it sits on.
  const rects = range.getClientRects();
  return rects.length > 0 ? (rects[0] ?? null) : null;
}

/**
 * How much of the window the on-screen keyboard is covering, in pixels.
 *
 * One listener for the whole app, published two ways: the `--kb` custom
 * property for anything that can lay itself out in CSS, and a `kb-open`
 * class on the root for the things that simply go away while typing. Both
 * stay 0 where there is no visual viewport (every desktop browser, and
 * anything without a virtual keyboard), so callers need no branch.
 */
let inset = 0;

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
      if (!(el instanceof HTMLElement)) return;

      /**
       * A contenteditable is not a field, it is a DOCUMENT, and
       * document.activeElement is the whole of it. scrollIntoView on a box
       * TALLER than the scrollport does not decline to move: `nearest`
       * aligns the box's end edge with the scrollport's end edge, so
       * focusing the FIRST line of a note scrolled to the bottom of the
       * note and you had to come back up by hand. It never needed a long
       * note either — .note-editor is 60vh before it holds anything, which
       * already exceeds what is left above the keyboard.
       *
       * So scroll to the CARET, which is what "put the field on screen"
       * means for an editor, and by the least that works.
       */
      if (el.isContentEditable) {
        const caret = caretRect();
        const scroller = scrollerOf(el);
        if (!caret || !scroller) return;
        const box = scroller.getBoundingClientRect();
        const above = box.top - caret.top;
        const below = caret.bottom - box.bottom;
        if (above > 0) scroller.scrollTop -= above + CARET_MARGIN;
        else if (below > 0) scroller.scrollTop += below + CARET_MARGIN;
        return;
      }

      if (el.matches('input, textarea')) {
        // `nearest` is the least scrolling that puts it on screen, and it
        // acts on the field's own scroller — the sheet it is in — rather
        // than on the page. Sound here because the element IS the field:
        // it is one line tall and never exceeds the scrollport.
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
