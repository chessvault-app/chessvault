import { create } from 'zustand';
import type { IconSection } from '@/lib/sectionIcon';

/**
 * The documents this device opened last, newest first, for the quick
 * switcher's Recent group.
 *
 * Home's Continue card answers a different question, "what changed
 * last", from the files' own dates, and it is the same answer on every
 * device. What was OPENED is this device's business, like the sidebar's
 * fold and the rest of store/prefs: a phone and a monitor read different
 * things. So it is a per-device list in localStorage, written from the
 * route as a document page arrives (App.tsx, Shell), and it keeps only
 * the address. The name comes from the search index when the switcher
 * asks (`/api/search` with no words lists every document by name), so a
 * document renamed or deleted since simply stops appearing rather than
 * showing a stale title, and nothing here has to be told about it.
 */
const KEY = 'vault:recent-opens';
/** How many the list keeps. The group shows at most five; three more
    survive so a deletion does not leave the group short. */
const MAX = 8;

export interface RecentOpen {
  section: IconSection;
  /** The document's id as the search index names it, decoded. */
  id: string;
}

interface RecentState {
  opens: RecentOpen[];
  record: (open: RecentOpen) => void;
}

const read = (): RecentOpen[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (o): o is RecentOpen =>
        typeof o === 'object' && o !== null && typeof (o as RecentOpen).id === 'string' && typeof (o as RecentOpen).section === 'string',
    );
  } catch {
    return [];
  }
};

export const useRecentOpens = create<RecentState>()((set, get) => ({
  opens: read(),
  record: (open) => {
    const rest = get().opens.filter((o) => !(o.section === open.section && o.id === open.id));
    const opens = [open, ...rest].slice(0, MAX);
    set({ opens });
    try {
      localStorage.setItem(KEY, JSON.stringify(opens));
    } catch {
      /* the session still remembers; it just will not survive a reload */
    }
  },
}));
