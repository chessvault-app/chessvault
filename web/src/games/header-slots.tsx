import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The Games page's title row, lent to the lists under it.
 *
 * On a phone the page stood four rows of chrome before the first game:
 * the title, the source strip, the search row and the count band
 * (lanph3re, 2026-09-18). Three of those rows say things a shelf says on
 * its title row: how many (the subtitle), and the find, bookmark and
 * filter switches (the actions). But each list owns its own count, its
 * own query and its own filters, three lists deep under the page, and
 * lifting that state to the page would mean the page knowing every tab's
 * business. So the page lends the PLACES instead: three elements in its
 * header, handed down here, and whichever list is on show draws into
 * them through a portal. State stays where it is; only the paint moves.
 *
 * Three targets rather than one, because two components fill the
 * actions (the browser owns the query and the bookmark switch, the list
 * owns its filters) and two portals into one element land in commit
 * order, which is not an order anyone wrote down.
 *
 * Null where nothing is lent: a desktop, and the workspace's panel.
 * Every caller reads that as "draw your chrome where it always was".
 */
export interface GamesHeaderSlots {
  /** Under the title: the count. */
  subtitle: HTMLElement | null;
  /** The title row's actions, first group: search and bookmark. */
  finders: HTMLElement | null;
  /** Second group: the list's own filters button. */
  filters: HTMLElement | null;
}

const Slots = createContext<GamesHeaderSlots | null>(null);

export const GamesHeaderSlotsProvider = Slots.Provider;

/** The lent header, or null where the chrome stays in the list. */
export function useGamesHeader(): GamesHeaderSlots | null {
  return useContext(Slots);
}

/** Draw `children` into one of the lent places; nothing until it exists. */
export function InGamesHeader({ slot, children }: { slot: keyof GamesHeaderSlots; children: ReactNode }) {
  const target = useContext(Slots)?.[slot];
  return target ? createPortal(children, target) : null;
}
