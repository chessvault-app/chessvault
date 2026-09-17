import { lazyRoute } from '@/lib/lazyRoute';
import { parse, registerRoutePending, type Section } from '@/lib/router';

// Route-level code splitting: iOS relaunches the PWA from scratch after
// backgrounding, so the landing chunk must stay lean — heavy sections
// (pdf/ocr machinery, TipTap, the study editor) load on first visit.
//
// What a route draws while its chunk is on the wire is the page's OWN
// outline, named here and living beside the page as `<Name>.skeleton`
// (lib/lazyRoute, `outline`): its own module, fetched in parallel with
// the page and a fraction of its size, so it lands first — and drawn by
// the page too, for the page's own wait. One picture over both waits,
// per route, which is what Next's `loading`, TanStack's
// `pendingComponent` and React Router's `HydrateFallback` each are.
//
// There was a table in the shell that guessed each page's shape instead.
// It is gone; nothing out here knows what a page looks like now.

// AnalysisView was the one view loaded eagerly, which put the board, the
// engine, the explorer, the review strip and the move tree into the chunk
// that has to parse before ANYTHING renders — including the landing page,
// which uses none of them.
export const AnalysisView = lazyRoute(() => import('@/analysis/AnalysisView').then((m) => ({ default: m.AnalysisView })), {
  outline: () => import('@/analysis/AnalysisView.skeleton'),
});
// These four drew NOTHING while their chunks came down, on the argument
// that a shape invented out here would be guessing. True out here, and
// not true of a module beside the page: each of them now owns its
// outline like every other route, and between them they are the app's
// heaviest chunks and its longest blank screens. None of the four waits
// on a fetch at all, so the whole of that wait was the download.
export const WorkspaceView = lazyRoute(() => import('@/workspace/WorkspaceView').then((m) => ({ default: m.WorkspaceView })), {
  outline: () => import('@/workspace/WorkspaceView.skeleton'),
});
export const EditorView = lazyRoute(() => import('@/editor/EditorView').then((m) => ({ default: m.EditorView })), {
  outline: () => import('@/editor/EditorView.skeleton'),
});
export const GamesView = lazyRoute(() => import('@/games/GamesView').then((m) => ({ default: m.GamesView })), {
  outline: () => import('@/games/GamesView.skeleton'),
});
export const NotesView = lazyRoute(() => import('@/notes/NotesView').then((m) => ({ default: m.NotesView })), {
  outline: () => import('@/notes/NotesView.skeleton'),
});
export const PuzzlesView = lazyRoute(() => import('@/puzzles/PuzzlesView').then((m) => ({ default: m.PuzzlesView })), {
  outline: () => import('@/puzzles/PuzzlesView.skeleton'),
});
export const BooksView = lazyRoute(() => import('@/books/BooksView').then((m) => ({ default: m.BooksView })), {
  outline: () => import('@/books/BooksView.skeleton'),
});
// HomePage is EAGER (imported above), alone among the routes. With no
// launch screen, iOS drops its startup image at the app's first paint —
// and when home was a lazy chunk, that first paint was the shell around
// an empty box, with the page popping in a beat later (caught on
// lanph3re's recording). Home is six tiles and some fetches; the engine,
// the board and the parsers stay behind the lazy routes here.
export const StudiesView = lazyRoute(() => import('@/studies/StudiesView').then((m) => ({ default: m.StudiesView })), {
  outline: () => import('@/studies/StudiesView.skeleton'),
});
// The first route converted to the shape every router settles on: its
// outline is its own module beside the page, fetched in parallel with
// it, and the PAGE draws the same module while /api/settings is out
// (lib/lazyRoute, `outline`). RouteSkeleton no longer guesses this one.
export const SettingsPage = lazyRoute(() => import('@/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })), {
  outline: () => import('@/settings/SettingsPage.skeleton'),
});
export const LicensesPage = lazyRoute(() => import('@/settings/LicensesPage').then((m) => ({ default: m.LicensesPage })), {
  outline: () => import('@/settings/LicensesPage.skeleton'),
});

// Which chunk a hash draws, for the phone's page transition to wait on
// (lib/router, swapRoute). The same table as the switch in AppShell's
// render, read the other way; a section not listed draws eagerly.
registerRoutePending((hash) => {
  const { section, params } = parse(hash);
  switch (section) {
    case 'board':
      return AnalysisView.drawable();
    case 'workspace':
      return WorkspaceView.drawable();
    case 'editor':
      return EditorView.drawable();
    case 'studies':
      return StudiesView.drawable();
    case 'games':
      return GamesView.drawable();
    case 'notes':
      return NotesView.drawable();
    case 'puzzles':
      return PuzzlesView.drawable();
    case 'books':
      return BooksView.drawable();
    case 'repertoire':
      return RepertoireView.drawable();
    case 'endgames':
      return EndgamesView.drawable();
    case 'openingmap':
      return OpeningMapView.drawable();
    case 'databases':
      return DatabasesPage.drawable();
    case 'insights':
      return InsightsPage.drawable();
    case 'settings':
      return params[0] === 'licenses' ? LicensesPage.drawable() : SettingsPage.drawable();
    default:
      return null;
  }
});
export const RepertoireView = lazyRoute(() => import('@/repertoire/RepertoireView').then((m) => ({ default: m.RepertoireView })), {
  outline: () => import('@/repertoire/RepertoireView.skeleton'),
});
export const EndgamesView = lazyRoute(() => import('@/endgames/EndgamesView').then((m) => ({ default: m.EndgamesView })), {
  outline: () => import('@/endgames/EndgamesView.skeleton'),
});
export const OpeningMapView = lazyRoute(() => import('@/openingmap/OpeningMapView').then((m) => ({ default: m.OpeningMapView })), {
  outline: () => import('@/openingmap/OpeningMapView.skeleton'),
});
export const DatabasesPage = lazyRoute(() => import('@/databases/DatabasesPage').then((m) => ({ default: m.DatabasesPage })), {
  outline: () => import('@/databases/DatabasesPage.skeleton'),
});
export const InsightsPage = lazyRoute(() => import('@/insights/InsightsPage').then((m) => ({ default: m.InsightsPage })), {
  outline: () => import('@/insights/InsightsPage.skeleton'),
});

// The chunk each section draws, for warming it before it is asked for
// (lib/prefetch, and the sidebar's hover). The same components as the
// switch in renderSection; the phone's tab bar reaches the first three.
const SECTION_CHUNK: Partial<Record<Section, { pending: () => Promise<void> | null }>> = {
  games: GamesView,
  studies: StudiesView,
  puzzles: PuzzlesView,
  board: AnalysisView,
  notes: NotesView,
  books: BooksView,
  openingmap: OpeningMapView,
  insights: InsightsPage,
  databases: DatabasesPage,
  repertoire: RepertoireView,
  endgames: EndgamesView,
  settings: SettingsPage,
  workspace: WorkspaceView,
  editor: EditorView,
};
/** Start a section's chunk on its way, if it is not in hand. */
export function warmSection(section: Section): Promise<void> | null {
  return SECTION_CHUNK[section]?.pending() ?? null;
}
// The order the sweep warms them in: the three tabs a thumb reaches
// first, then the board (where a game or a study opens to, and the
// heaviest chunk), then the rest in the sidebar's order. Licences is
// left out: a page reached from Settings, read once.
export const WARM_ORDER: Section[] = [
  'games', 'studies', 'puzzles', 'board', 'notes', 'books', 'openingmap',
  'insights', 'databases', 'repertoire', 'endgames', 'settings', 'workspace', 'editor',
];
