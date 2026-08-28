import { createContext } from 'react';

/**
 * The window a dialog was opened INSIDE, for the two things a nested window
 * needs from it: to park it while a page covers it, and its height.
 *
 * The distinction this rests on: a default-sized dialog is a PAGE and a
 * small one is a LAYER. A page opened from a window parks that window —
 * hides it, state intact — and the page's title row grows the back
 * chevron, wired to its own close: closing a page is going back. A layer
 * (a Select's option sheet, a confirmation) is a question asked and
 * answered in one tap, whose whole point is that the window stays
 * visibly behind it; layers never cover, and the parent is never parked
 * for them. Both read `height`: a page opens AS TALL as the window it
 * replaces, and a layer is capped to the window it was asked over.
 *
 * The context flows through the REACT tree, not the DOM — portals do not
 * break it — so it reaches exactly the windows written inside the window
 * that showed them.
 */
export const CoverParent = createContext<{
  /** Park the parent; returns the release. */
  cover: () => () => void;
  /** The parent card's current height, read BEFORE it is parked. */
  height: () => number;
  /**
   * Shut this window AND every window it was itself opened inside.
   *
   * The chevron and the X are not two spellings of one verb. Back is a
   * step: it closes this page and hands you the window underneath, which
   * is the whole point of a page. Close is an exit: it means "I am done
   * with this", and a window that answers it by revealing a window you
   * had already walked past is a Back button wearing an X. Three pages
   * deep in the editor's position chain, the X shut one page and left
   * two more to dismiss.
   *
   * So the X walks the chain instead. A LAYER never calls this — a
   * confirmation is answered and returns you to what asked it, and
   * AlertDialog's own buttons stay window-scoped for that reason.
   */
  dismissAll: () => void;
} | null>(null);
