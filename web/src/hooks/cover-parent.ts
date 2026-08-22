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
} | null>(null);
