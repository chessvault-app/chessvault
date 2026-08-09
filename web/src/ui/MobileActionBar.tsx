import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

/**
 * The phone bottom bar is contextual: a leaf page (board, study, puzzle)
 * claims it for its own controls — move navigation, puzzle actions — and
 * the global tab bar steps aside while that page is open. This is the
 * chess.com / Lichess pattern: on a content screen the bottom row drives
 * the content, and you leave via the back chevron. Reclaims the row the
 * controls used to take under the board.
 *
 * Mechanism: the shell always renders a styled slot (`MOBILE_BAR_SLOT_ID`)
 * plus the global nav; a page mounts <MobileActionBar> which portals its
 * children into the slot and bumps a claim count so the shell hides the
 * global nav. Portalled (not stored) so the controls keep live closures
 * over page state.
 */

export const MOBILE_BAR_SLOT_ID = 'mobile-action-bar-slot';

const useClaims = create<{ n: number; inc: () => void; dec: () => void }>((set) => ({
  n: 0,
  inc: () => set((s) => ({ n: s.n + 1 })),
  dec: () => set((s) => ({ n: Math.max(0, s.n - 1) })),
}));

/** True while any page has claimed the bar — the shell hides global tabs. */
export const useMobileBarClaimed = (): boolean => useClaims((s) => s.n > 0);

export function MobileActionBar({ children }: { children: ReactNode }) {
  const inc = useClaims((s) => s.inc);
  const dec = useClaims((s) => s.dec);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById(MOBILE_BAR_SLOT_ID));
    inc();
    return dec;
  }, [inc, dec]);

  return slot ? createPortal(children, slot) : null;
}
