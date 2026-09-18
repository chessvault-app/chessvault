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
  /**
   * The same two groups again, and the source chips, in the compact bar
   * a scroll up reveals (PageHeader, `pinned`). A portal has one target,
   * so what is drawn into a title-row slot is drawn into its bar twin
   * too: one element, rendered twice, by the one component that owns it.
   */
  barFinders: HTMLElement | null;
  barFilters: HTMLElement | null;
  barChips: HTMLElement | null;
}

/** The slots a caller draws into; each title-row slot brings its bar twin. */
type Slot = 'subtitle' | 'finders' | 'filters' | 'barChips';
const TWIN: Partial<Record<Slot, keyof GamesHeaderSlots>> = { finders: 'barFinders', filters: 'barFilters' };

const Slots = createContext<GamesHeaderSlots | null>(null);

export const GamesHeaderSlotsProvider = Slots.Provider;

/** The lent header, or null where the chrome stays in the list. */
export function useGamesHeader(): GamesHeaderSlots | null {
  return useContext(Slots);
}

/** Draw `children` into one of the lent places; nothing until it exists. */
export function InGamesHeader({ slot, children }: { slot: Slot; children: ReactNode }) {
  const slots = useContext(Slots);
  const target = slots?.[slot];
  const twinKey = TWIN[slot];
  const twin = twinKey ? slots?.[twinKey] : null;
  return (
    <>
      {target ? createPortal(children, target) : null}
      {twin ? createPortal(children, twin) : null}
    </>
  );
}
