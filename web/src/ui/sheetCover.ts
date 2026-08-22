import { useContext, useEffect, useState } from 'react';
import { CoverParent } from './coverParent';

/**
 * The window a sheet was opened over: how tall it is, and whether the
 * sheet has grown to hide it completely.
 *
 * Both are bottom-anchored, so equal heights mean the window is entirely
 * behind the sheet. That matters because it is the premise of a sheet
 * failing: a Sheet is a LAYER — a question asked with the window still
 * visible behind it — and one that reaches the window's own top edge has
 * stopped looking like a layer and started looking like a page. A page
 * owes the reader a way back, so a covering sheet grows the same chevron
 * a Modal's second page has (lanph3re's rule: every bottom sheet that
 * covers its parent has a back button).
 *
 * The ceiling is measured at the FIRST RENDER, when the parent is on
 * screen at its real height; an effect would land a frame after the sheet
 * had painted taller, which is a snap you can see. Whether it COVERS can
 * only be answered once the sheet itself has been laid out, and is
 * watched from then on — a list that filters as you type, or a keyboard
 * that opens, changes the answer.
 */
export function useSheetCover(active: boolean): {
  /** Max height the sheet may take; 0 when there is no window behind it. */
  cap: number;
  covered: boolean;
  /** On the sheet's own card — what gets measured against the cap. */
  ref: (node: HTMLElement | null) => void;
} {
  const parent = useContext(CoverParent);
  const [cap] = useState(() => (active ? (parent?.height() ?? 0) : 0));
  // State, not a ref: attaching the card is what starts the watching.
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    if (!cap || !card) {
      setCovered(false);
      return;
    }
    // A pixel of tolerance: both numbers are rounded off fractional
    // layouts, and being one short of the window is still covering it.
    //
    // Against the parent as it is NOW, not as it was when this sheet
    // opened. The ceiling is measured once on purpose — a sheet must not
    // resize itself as its parent's content changes — but "am I hiding
    // it" is a question about the present: a keyboard shrinks both
    // sheets to the band above it, and comparing this one's new height
    // against the parent's old one said it had stopped covering
    // anything, so the chevron vanished at exactly the moment a way out
    // is hardest to find.
    const check = (): void =>
      setCovered(card.offsetHeight >= Math.min(cap, parent?.height() ?? cap) - 1);
    check();
    const watch = new ResizeObserver(check);
    watch.observe(card);
    return () => watch.disconnect();
  }, [cap, card, parent]);

  return { cap, covered, ref: setCard };
}
