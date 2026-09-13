import { createContext } from 'react';

/**
 * The window a dialog was opened INSIDE, for the three things a nested
 * window needs from it: where to draw itself when it is a page, to tell
 * it a page is up, and its height.
 *
 * The distinction this rests on: a default-sized dialog is a PAGE and a
 * small one is a LAYER. A page opened from a window is drawn INSIDE that
 * window's card, over the window's own content (`host`): the card, its
 * scrim, its scroller and its swipe stay the window's, the content under
 * it steps aside, state intact, and the page's title row grows the back
 * chevron, wired to its own close: closing a page is going back. A layer
 * (a Select's option sheet, a confirmation) is a question asked and
 * answered in one tap, whose whole point is that the window stays
 * visibly behind it; layers never cover. A layer reads `height`: it is
 * capped to the window it was asked over. A page needs no floor, since
 * it stands in the same box as the content it covers.
 *
 * The context flows through the REACT tree, not the DOM — portals do not
 * break it — so it reaches exactly the windows written inside the window
 * that showed them.
 */
export const CoverParent = createContext<{
  /**
   * Tell the parent a page is up, and what Escape and the platform's
   * Back mean while it is (the page's own way back). Returns the
   * release, which a page calls as it starts to leave, so the content
   * under it comes back on the same clock; calling it twice is safe.
   */
  cover: (request: () => void) => () => void;
  /** The parent card's current height. */
  height: () => number;
  /**
   * The element a page draws into: a grid cell over the parent's own
   * content, inside the parent's card. null until the card has mounted.
   */
  host: HTMLElement | null;
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
