import { useEffect, useState } from 'react';

/**
 * How much of the window the on-screen keyboard is covering, in pixels.
 *
 * The app shell is a fixed-height column (`100svh`), and svh does not know
 * about the keyboard — so when the keyboard opens, the bottom of every
 * scroll container is underneath it. Reading a note that way is fine
 * (nothing moves), but EDITING is not: the caret sits under the keyboard,
 * and the part of the note you would scroll to is in a region the finger
 * cannot reach, which reads as the scroll being dead.
 *
 * The fix is not to fight the browser — three previous attempts did, and
 * the notes in main.tsx record how that went. It is to tell the scroll
 * container how much room it has lost, so it can pad its own bottom by
 * that much: the content it holds becomes reachable above the keyboard,
 * and the browser's own caret-scrolling has somewhere to scroll TO.
 *
 * Returns 0 where there is no visual viewport (every desktop browser, and
 * anything without a virtual keyboard), so callers need no branch.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = (): void => {
      // offsetTop matters: iOS shifts the visual viewport up rather than
      // shrinking it in some states, and the covered height is what is
      // below the visible band either way.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      // Under ~120px it is browser chrome moving, not a keyboard.
      setInset(covered > 120 ? Math.round(covered) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
