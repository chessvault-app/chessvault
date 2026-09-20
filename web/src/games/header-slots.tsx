import { createContext, useContext, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';

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
  /**
   * The title row itself, while a list is being searched. A field that
   * opened as a row of its own under the chips was a row all the same
   * (lanph3re, 2026-09-19), so the field takes the title's row over
   * instead, the way a phone's own apps turn their bar into the field:
   * the name and the switches step out, the field and a way back step in,
   * and the page is exactly as tall as it was. Null while nobody is
   * searching. `searching` is the page's, because the page is what swaps
   * the row; a list turns it on from its magnifier and off from its X.
   */
  search: HTMLElement | null;
  searching: boolean;
  setSearching: (on: boolean) => void;
}

/** The slots a caller draws into; each title-row slot brings its bar twin. */
type Slot = 'subtitle' | 'finders' | 'filters' | 'barChips' | 'search';
const TWIN: Partial<Record<Slot, 'barFinders' | 'barFilters'>> = { finders: 'barFinders', filters: 'barFilters' };

const Slots = createContext<GamesHeaderSlots | null>(null);

export const GamesHeaderSlotsProvider = Slots.Provider;

/**
 * Open the title-row search and put the caret in it, inside the press.
 *
 * Inside, because iOS raises the keyboard only for a focus made during
 * the gesture that asked for it: a focus from an effect or a frame later
 * lands the caret and leaves the keyboard down, and a search field with
 * no keyboard is a second tap. So the row swap is committed
 * synchronously (the page's row mounts, its ref hands the portal its
 * target, the list's field mounts into it, all within the flush) and the
 * field that now exists is focused before the handler returns.
 */
export function openTitleSearch(header: GamesHeaderSlots): void {
  flushSync(() => header.setSearching(true));
  document.querySelector<HTMLInputElement>('[data-games-search] input')?.focus();
}

/** The lent header, or null where the chrome stays in the list. */
export function useGamesHeader(): GamesHeaderSlots | null {
  return useContext(Slots);
}

/**
 * Whether this render is the bar's copy of a title-row slot. The twin is
 * a second RENDER of the same children, which is right for a button and
 * wrong for a window: a list that keeps its filter window in the same
 * fragment as the button that opens it mounted two sheets, one over the
 * other. The top one took the drag and played the exit, and the one under
 * it stood still until both unmounted, which read as the sheet leaving
 * an afterimage behind (lanph3re's recording, 2026-09-20). A window
 * written inside a slot asks this and draws only in the original.
 */
const Twin = createContext(false);
export function useInHeaderTwin(): boolean {
  return useContext(Twin);
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
      {twin ? createPortal(<Twin value>{children}</Twin>, twin) : null}
    </>
  );
}
