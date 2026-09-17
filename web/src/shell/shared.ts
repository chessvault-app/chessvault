import {
  Grid3x3,
  SquarePen,
  BookOpen,
  ChartColumn,
  Database,
  Folder,
  Layers,
  Network,
  LayoutDashboard,
  Puzzle,
  Settings,
  Table2,
  Crown,
} from 'lucide-react';
import { navigate, type Section } from '@/lib/router';
import { lastRouteOf } from '@/lib/keep-alive';
import { SECTION_ICON } from '@/lib/sectionIcon';

// Top-level destinations, in the reading order lanph3re set. Board and
// Editor are not here — they live under Tools (a group, below), the way
// chess.com/Lichess keep the analysis board out of primary nav.
// The top-level destinations. This list drives the sidebar directly and
// the phone's bottom bar through a filter: an entry that ALSO appears in
// More is a sidebar row and not a tab. The opening map is the case that
// filter exists for — it earns a top-level row beside the collections,
// but the bar holds five tabs: Home, three collections and More. Five is
// where the platform guidance stops (Material 3 says three to five, and
// lichess ships five), and the sixth tab this bar used to carry left each
// label about 60px on a 360px phone and went screen-reader-only under
// 320. So the phone reaches the map, Books and Notes through More.
export const NAV: { section: Section; label: string; icon: typeof Folder }[] = [
  // The three that a wiki link can name take their icon from the shared
  // table, so the dialog that offers to create one draws the same picture
  // this row does. The rest are only ever drawn here.
  { section: 'games', label: 'Games', icon: SECTION_ICON.games },
  { section: 'studies', label: 'Studies', icon: SECTION_ICON.studies },
  // Notes is the collection the bar gave up to stay at five tabs: it is
  // mostly entered from a game or a study by a link, and it is a Home
  // tile, so the phone is never more than one tap from it. Listed in
  // More, which is what takes it off the bar.
  { section: 'notes', label: 'Notes', icon: SECTION_ICON.notes },
  // Books is a collection like the three above it, so it is a sidebar
  // row; like the opening map it also appears in More, which is what
  // keeps it OFF the phone's bottom bar (see the filter note above).
  { section: 'books', label: 'Books', icon: BookOpen },
  { section: 'puzzles', label: 'Puzzles', icon: Puzzle },
  { section: 'openingmap', label: 'Opening map', icon: Network },
  // Insights is the map's sibling: a reading of your own games rather
  // than a collection of documents. A sidebar row on a desktop; listed
  // in More too, which keeps it off the phone's five-tab bar.
  { section: 'insights', label: 'Insights', icon: ChartColumn },
];

// The Tools group: interactive boards that aren't a "collection". Explorer
// is not a page of its own — it is the Board opened straight to its opening
// explorer (navigate('board', 'explorer')), so it reuses everything.
export const TOOLS_SUBNAV: {
  key: string;
  label: string;
  icon: typeof Folder;
  nav: [Section, ...string[]];
  active: (section: Section, params: string[]) => boolean;
}[] = [
  { key: 'board', label: 'Board', icon: Grid3x3, nav: ['board'], active: (s, p) => s === 'board' && p[0] !== 'explorer' },
  { key: 'editor', label: 'Editor', icon: SquarePen, nav: ['editor'], active: (s) => s === 'editor' },
  { key: 'explorer', label: 'Explorer', icon: Table2, nav: ['board', 'explorer'], active: (s, p) => s === 'board' && p[0] === 'explorer' },
  // The workspace is every analysis pane at once, so its row exists only
  // on viewports that can hold them (the Sidebar filters on the same
  // query the page gates on) — a phone or a half-screen window never
  // sees a destination it could only meet as a "too narrow" card. It is
  // also why the entry is absent from MORE_GROUPS below.
  // LayoutDashboard, not PanelsTopLeft: at rail size PanelsTopLeft and
  // the Explorer's Table2 are the same square-with-lines silhouette two
  // rows apart (lanph3re caught it); the dashboard tiles read as "many
  // panes" without twinning anything else in the sidebar.
  { key: 'workspace', label: 'Workspace', icon: LayoutDashboard, nav: ['workspace'], active: (s) => s === 'workspace' },
  { key: 'repertoire', label: 'Repertoire', icon: Layers, nav: ['repertoire'], active: (s) => s === 'repertoire' },
  // A board you play on, like the rest of the group: a won ending against
  // the tablebase's defence.
  { key: 'endgames', label: 'Endgame drills', icon: Crown, nav: ['endgames'], active: (s) => s === 'endgames' },
];
// Databases is deliberately NOT in Tools: the entries there are boards
// you play on, and it is where their data is looked after — so it stands
// on its own row below the group, beside nothing.
export const inTools = (s: Section): boolean =>
  s === 'board' || s === 'workspace' || s === 'editor' || s === 'repertoire' || s === 'endgames';

/** The sections KeepAlive lets go of when they leave the screen. */
export const UNKEPT = new Set<Section>(['board', 'workspace', 'editor']);

/**
 * Open a section from a tab or a sidebar row.
 *
 * Where it was last, since the page under it is still there (KeepAlive):
 * a tab bar's tab returns to the stack it left, and a shelf that is kept
 * with a note open over it would otherwise be reached only by Back.
 * The section that is ALREADY open goes to its root instead, which is a
 * tab bar's second tap on both platforms: up from the leaf, and from the
 * root itself to the top of the page (the bottom bar does that part).
 * The board, editor and workspace are not kept and open plainly.
 */
export function openSection(section: Section, active: Section, ...root: string[]): void {
  if (section !== active && !UNKEPT.has(section)) {
    const last = lastRouteOf(section);
    if (last) {
      navigate(...last);
      return;
    }
  }
  navigate(section, ...root);
}

/** The More page groups the destinations the bottom bar doesn't carry:
    the Tools boards, Notes, Books, Databases and Settings. Board and
    Editor are not primary nav on a phone (the chess.com/Lichess pattern),
    so they live here; Notes and Books are collections the five-tab bar
    has no room for. */
export const MORE_GROUPS: {
  heading: string;
  items: { section: Section; param?: string; label: string; icon: typeof Folder; blurb: string }[];
}[] = [
  {
    heading: 'Tools',
    items: [
      { section: 'board', label: 'Board', icon: Grid3x3, blurb: 'Analyse any position with the engine' },
      { section: 'editor', label: 'Editor', icon: SquarePen, blurb: 'Set up any position from scratch' },
      { section: 'board', param: 'explorer', label: 'Explorer', icon: Table2, blurb: 'Browse opening statistics move by move' },
      { section: 'repertoire', label: 'Repertoire', icon: Layers, blurb: 'Practise an opening against real games' },
      { section: 'endgames', label: 'Endgame drills', icon: Crown, blurb: 'Play won and drawn endings against the tablebase' },
    ],
  },
  {
    heading: 'App',
    items: [
      // The rows here keep the sidebar's order (NAV above, then Databases
      // and Settings below it), so a phone and a desktop list the same
      // pages the same way. Notes and Books are collections the five-tab
      // bar had no room for; the map and Insights are readings of your
      // own games, not boards, so none of them sits among the Tools.
      // Notes' and Insights' blurbs are Home's, so two places never
      // describe them two ways.
      { section: 'notes', label: 'Notes', icon: SECTION_ICON.notes, blurb: 'Markdown with live boards' },
      { section: 'books', label: 'Books', icon: BookOpen, blurb: 'Read your chess books beside a board' },
      { section: 'openingmap', label: 'Opening map', icon: Network, blurb: 'See your opening preparation as a tree' },
      { section: 'insights', label: 'Insights', icon: ChartColumn, blurb: 'Your results by colour, time control and opening' },
      { section: 'databases', label: 'Databases', icon: Database, blurb: 'Reference game databases, built from uploaded PGNs' },
      { section: 'settings', label: 'Settings', icon: Settings, blurb: 'Password, 2FA, themes, tokens' },
    ],
  },
];
export const MORE_SECTIONS = MORE_GROUPS.flatMap((g) => g.items);
