import {
  BookMarked,
  BookOpen,
  BookText,
  Compass,
  Database,
  Grid3x3,
  Library,
  Network,
  NotebookPen,
  Puzzle,
  Settings,
  SquarePen,
  SwatchBook,
} from 'lucide-react';
import type { Section } from '@/lib/router';
import { HOME_ENTRY_IDS, type HomeEntryId } from './layout';

/**
 * Everywhere home can send you, written down once.
 *
 * The ids and the arranging live next door in `layout.ts`; this half is
 * the icons and the words, and it is separate so the logic can be tested
 * in a node environment without importing lucide.
 *
 * Every entry carries a blurb even though the launcher row shows only
 * labels: the row is where a demoted entry lands, and any entry can be
 * promoted back to a tile, where the blurb is what it says.
 *
 * `App.tsx` still keeps its own NAV / TOOLS_SUBNAV / MORE_GROUPS lists.
 * Folding those in is a bigger change — they carry grouping and
 * active-state predicates this does not — and MorePage is the obvious
 * next consumer if anyone takes it on.
 */

/** Which personal count a tile shows. Absent means a tool: no number, and
    no skeleton reserving room for one. */
export type HomeCount = 'studies' | 'notes' | 'games' | 'books' | 'puzzles' | 'openingmap';

export interface Destination {
  id: HomeEntryId;
  /** English, as the key t() looks up. */
  label: string;
  blurb: string;
  icon: typeof Grid3x3;
  /** Spread into navigate(), the way TOOLS_SUBNAV's `nav` is. */
  nav: [Section, ...string[]];
  count?: HomeCount;
}

/** A record rather than a list, so TypeScript refuses a catalogue that has
    forgotten an id — the two cannot drift apart. */
const BY_ID: Record<HomeEntryId, Destination> = {
  board: {
    id: 'board',
    label: 'Board',
    blurb: 'Free board with engine and explorer',
    icon: Grid3x3,
    nav: ['board'],
  },
  editor: {
    id: 'editor',
    label: 'Editor',
    blurb: 'Set up any position',
    icon: SquarePen,
    nav: ['editor'],
  },
  studies: {
    id: 'studies',
    label: 'Studies',
    blurb: 'Openings and ideas, in chapters',
    icon: Library,
    nav: ['studies'],
    count: 'studies',
  },
  notes: {
    id: 'notes',
    label: 'Notes',
    blurb: 'Markdown with live boards',
    icon: NotebookPen,
    nav: ['notes'],
    count: 'notes',
  },
  games: {
    id: 'games',
    label: 'Games',
    blurb: 'Your collection, annotated',
    icon: BookOpen,
    nav: ['games'],
    count: 'games',
  },
  puzzles: {
    id: 'puzzles',
    label: 'Puzzles',
    blurb: 'Train tactics offline',
    icon: Puzzle,
    nav: ['puzzles'],
    count: 'puzzles',
  },
  openingmap: {
    id: 'openingmap',
    label: 'Opening map',
    blurb: 'See your opening preparation as a tree',
    icon: Network,
    nav: ['openingmap'],
    // Moves charted, not nodes: the two colour roots are not moves.
    count: 'openingmap',
  },
  repertoire: {
    id: 'repertoire',
    label: 'Repertoire',
    blurb: 'Practise an opening against real games',
    icon: SwatchBook,
    nav: ['repertoire'],
  },
  // Not a page of its own: the board opened straight to its explorer pane.
  explorer: {
    id: 'explorer',
    label: 'Explorer',
    blurb: 'Browse opening statistics move by move',
    icon: Compass,
    nav: ['board', 'explorer'],
  },
  databases: {
    id: 'databases',
    label: 'Databases',
    blurb: 'Reference game databases, built from uploaded PGNs',
    icon: Database,
    nav: ['databases'],
  },
  books: {
    id: 'books',
    label: 'Books',
    blurb: 'Read your chess books beside a board',
    icon: BookText,
    nav: ['books'],
    count: 'books',
  },
  puzzlebooks: {
    id: 'puzzlebooks',
    label: 'Puzzle books',
    blurb: 'Puzzles read from the books you import',
    icon: BookMarked,
    nav: ['puzzles', 'books'],
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    blurb: 'Password, 2FA, themes, tokens',
    icon: Settings,
    nav: ['settings'],
  },
};

/** In catalogue order — which is the order the launcher row is drawn in. */
export const HOME_DESTINATIONS: readonly Destination[] = HOME_ENTRY_IDS.map((id) => BY_ID[id]);
