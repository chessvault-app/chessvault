import {
  Grid3x3,
  SquarePen,
  BarChart3,
  BookMarked,
  BookOpen,
  Database,
  Ellipsis,
  Folder,
  House,
  LayoutGrid,
  Layers,
  Library,
  Network,
  NotebookPen,
  Puzzle,
  Settings,
  SquareMousePointer,
  Table2,
  Wrench,
} from 'lucide-react';
import { Component, Fragment, Suspense, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { lazyRoute } from '@/lib/lazyRoute';
import { HomePage } from '@/home/HomePage';
import { navigate, useRoute, type Section } from '@/lib/router';
import { PasswordGate } from '@/auth/PasswordGate';
import { MOBILE_BAR_SLOT_ID, useMobileBarClaimed } from '@/components/mobile-action-bar';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/brand-mark';
import { ShortcutsHelp } from '@/components/shortcuts-help';
import { LeaveDialog } from '@/components/leave-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { t, useLang } from '@/lib/i18n';
import { isDemo } from '@/lib/demo';

// Route-level code splitting: iOS relaunches the PWA from scratch after
// backgrounding, so the landing chunk must stay lean — heavy sections
// (pdf/ocr machinery, TipTap, the study editor) load on first visit.
// AnalysisView was the one view loaded eagerly, which put the board, the
// engine, the explorer, the review strip and the move tree into the chunk
// that has to parse before ANYTHING renders — including the landing page,
// which uses none of them.
const AnalysisView = lazyRoute(() => import('@/analysis/AnalysisView').then((m) => ({ default: m.AnalysisView })));
const EditorView = lazyRoute(() => import('@/editor/EditorView').then((m) => ({ default: m.EditorView })));
const GamesView = lazyRoute(() => import('@/games/GamesView').then((m) => ({ default: m.GamesView })));
const NotesView = lazyRoute(() => import('@/notes/NotesView').then((m) => ({ default: m.NotesView })));
const PuzzlesView = lazyRoute(() => import('@/puzzles/PuzzlesView').then((m) => ({ default: m.PuzzlesView })));
const BooksView = lazyRoute(() => import('@/books/BooksView').then((m) => ({ default: m.BooksView })));
// HomePage is EAGER (imported above), alone among the routes. With no
// launch screen, iOS drops its startup image at the app's first paint —
// and when home was a lazy chunk, that first paint was the shell around
// an empty box, with the page popping in a beat later (caught on
// lanph3re's recording). Home is six tiles and some fetches; the engine,
// the board and the parsers stay behind the lazy routes here.
const StudiesView = lazyRoute(() => import('@/studies/StudiesView').then((m) => ({ default: m.StudiesView })));
const SettingsPage = lazyRoute(() => import('@/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LicensesPage = lazyRoute(() => import('@/settings/LicensesPage').then((m) => ({ default: m.LicensesPage })));
const RepertoireView = lazyRoute(() => import('@/repertoire/RepertoireView').then((m) => ({ default: m.RepertoireView })));
const OpeningMapView = lazyRoute(() => import('@/openingmap/OpeningMapView').then((m) => ({ default: m.OpeningMapView })));
const DatabasesPage = lazyRoute(() => import('@/databases/DatabasesPage').then((m) => ({ default: m.DatabasesPage })));

// Top-level destinations, in the reading order lanph3re set. Board and
// Editor are not here — they live under Tools (a group, below), the way
// chess.com/Lichess keep the analysis board out of primary nav.
// The top-level destinations. This list drives the sidebar directly and
// the phone's bottom bar through a filter: an entry that ALSO appears in
// More is a sidebar row and not a tab. The opening map is the case that
// filter exists for — it earns a top-level row beside the collections,
// but the bar already carries Home + four + More, and a seventh tab on a
// 360px phone gives every tab about 50px to hold the longest label in
// the app. So the phone keeps reaching it through More.
const NAV: { section: Section; label: string; icon: typeof Folder }[] = [
  { section: 'games', label: 'Games', icon: Folder },
  { section: 'studies', label: 'Studies', icon: Library },
  { section: 'notes', label: 'Notes', icon: NotebookPen },
  // Books is a collection like the three above it, so it is a sidebar
  // row; like the opening map it also appears in More, which is what
  // keeps it OFF the phone's bottom bar (see the filter note above).
  { section: 'books', label: 'Books', icon: BookOpen },
  { section: 'puzzles', label: 'Puzzles', icon: Puzzle },
  { section: 'openingmap', label: 'Opening map', icon: Network },
];

// The Tools group: interactive boards that aren't a "collection". Explorer
// is not a page of its own — it is the Board opened straight to its opening
// explorer (navigate('board', 'explorer')), so it reuses everything.
const TOOLS_SUBNAV: {
  key: string;
  label: string;
  icon: typeof Folder;
  nav: [Section, ...string[]];
  active: (section: Section, params: string[]) => boolean;
}[] = [
  { key: 'board', label: 'Board', icon: Grid3x3, nav: ['board'], active: (s, p) => s === 'board' && p[0] !== 'explorer' },
  { key: 'editor', label: 'Editor', icon: SquarePen, nav: ['editor'], active: (s) => s === 'editor' },
  { key: 'explorer', label: 'Explorer', icon: Table2, nav: ['board', 'explorer'], active: (s, p) => s === 'board' && p[0] === 'explorer' },
  { key: 'repertoire', label: 'Repertoire', icon: Layers, nav: ['repertoire'], active: (s) => s === 'repertoire' },
];
// Databases is deliberately NOT in Tools: the entries there are boards
// you play on, and it is where their data is looked after — so it stands
// on its own row below the group, beside nothing.
const inTools = (s: Section): boolean =>
  s === 'board' || s === 'editor' || s === 'repertoire';

export function App() {
  return (
    <PasswordGate>
      <Shell />
    </PasswordGate>
  );
}

/**
 * Demo notice.
 *
 * A vault that disappears is only honest if it says so: a visitor who
 * writes a study and comes back to find it gone should have been told
 * before rather than after.
 */
function DemoBanner() {
  if (!isDemo()) return null;
  return (
    <div
      // Named so the screenshot capture can hide it — the demo is where
      // the docs' images come from, and this notice is a property of the
      // demo rather than of the app being pictured. It used to be found
      // by matching its own sentence, which meant the images depended on
      // a string nobody would think to check when editing it.
      data-demo-banner
      className="text-warn border-border flex shrink-0 items-center justify-center gap-2 border-b bg-[color-mix(in_oklch,var(--warn)_14%,var(--background))] px-3 py-1.5 text-center text-sm"
    >
      {t('Demo — this is a sample vault of your own. Edit anything; a reload puts it back.')}
    </div>
  );
}

function Shell() {
  const { section, params } = useRoute();
  // Remount the whole tree when the language changes. Every t() call runs
  // during render, so a re-render is all that is needed — but a keyed
  // remount is what guarantees it reaches a memoised child too, and the
  // route lives in the hash so nothing is lost by it.
  const lang = useLang();

  return (
    <div
      key={lang}
      className={cn(
        // --app-h is set in standalone PWA mode, where 100dvh can be stale
        // on launch. Browsers fall back to 100svh — the SMALL viewport, the
        // height with the toolbars showing. 100dvh is the height with them
        // retracted, which is taller than what you can actually see while
        // they are out, and that difference was cutting the bottom off
        // panels that reached the end of the page.
        // --app-h is set in standalone PWA mode, where 100dvh can be stale
        // on launch. Browsers fall back to 100svh — the SMALL viewport, the
        // height with the toolbars showing. 100dvh is the height with them
        // retracted, which is taller than what you can actually see while
        // they are out, and that difference was cutting the bottom off
        // panels that reached the end of the page.
        //
        // `vv-band` is a hook, not a style: while the keyboard is up, one
        // rule in index.css pins this to the visual viewport. At rest it
        // does nothing at all, which is the point — pinning it full time
        // left a band under the bottom bar on lanph3re's phone, and a
        // shell that is wrong while nobody is typing is worse than a
        // keyboard that misbehaves while somebody is.
        'bg-background text-foreground vv-band flex h-[var(--app-h,100svh)] flex-col overflow-hidden',
        // Standalone PWAs draw edge-to-edge: keep content clear of the
        // dynamic island / notch (top) and the rounded corners (sides).
        // The bottom inset lives on MobileNav, which sits on that edge.
        'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]',
      )}
    >
      <DemoBanner />
      {/* The sidebar/main row. Separated from the shell so a full-width
          strip (the demo notice) can sit above BOTH rather than becoming a
          third column beside the sidebar. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <Sidebar active={section} params={params} />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {/*
          This Suspense is for CODE, not data: it covers the moment a
          section's chunk is being fetched. Data loading is plain fetch in
          effects, so each page draws its own skeleton — React only suspends
          on promises it is given, which ours are not.

          The fallback is deliberately blank. A chunk is a few tens of KB
          over a local network and usually arrives before a paint; a
          skeleton here would flash on every single navigation.
        */}
        <RouteErrorBoundary key={section}>
        <Suspense fallback={<div className="h-full" />}>
        {section === 'home' ? (
          <HomePage />
        ) : section === 'board' ? (
          // Keyed on the sub-mode: AnalysisView makes its param-dependent
          // decisions once per mount (initial pane, explorer on/off, the
          // stateless reset), so Board ↔ Explorer must REMOUNT it — same
          // section, so React would otherwise reconcile the same instance
          // and the sidebar click would change nothing but the title. A
          // handoff set before navigate() survives: the mount effect
          // consumes the flag wherever the mount came from.
          <AnalysisView key={params[0] === 'explorer' ? 'explorer' : 'board'} params={params} />
        ) : section === 'editor' ? (
          <EditorView />
        ) : section === 'studies' ? (
          <StudiesView params={params} />
        ) : section === 'games' ? (
          <GamesView params={params} />
        ) : section === 'notes' ? (
          <NotesView params={params} />
        ) : section === 'puzzles' ? (
          <PuzzlesView params={params} />
        ) : section === 'books' ? (
          <BooksView params={params} />
        ) : section === 'repertoire' ? (
          <RepertoireView />
        ) : section === 'openingmap' ? (
          <OpeningMapView params={params} />
        ) : section === 'databases' ? (
          <DatabasesPage />
        ) : section === 'settings' ? (
          // A sub-route rather than a section of its own: the licences are
          // read from Settings and belong under it, and the sidebar has no
          // business growing an entry for a footnote.
          params[0] === 'licenses' ? (
            <LicensesPage />
          ) : (
            <SettingsPage />
          )
        ) : section === 'more' ? (
          <MorePage />
        ) : (
          <Placeholder section={section} />
        )}
        </Suspense>
        </RouteErrorBoundary>
      </main>

      <MobileBottom active={section} />
      <ShortcutsHelp />
      {/* Global for the same reason: the question is asked by the router,
          which does not know which view is up, and a sheet owned by the
          view being left would have to outlive it. */}
      <LeaveDialog />
      </div>
    </div>
  );
}

/** The phone bottom row: global tabs, or a page's contextual action bar
    when one is claimed (see MobileActionBar). The slot is always mounted so
    a page's portal has a target; it only shows while claimed. */
/**
 * Where this window's data actually lives.
 *
 * It used to read "Offline · local" always — a tagline, not a status, and
 * it said "local" while you were looking at a server on the other side of
 * a tailnet. It now names the host it is talking to, and only says offline
 * when the browser says so.
 */
function ConnectionLabel() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    return () => {
      removeEventListener('online', up);
      removeEventListener('offline', down);
    };
  }, []);
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  return (
    <span className="text-muted-foreground hidden truncate text-sm lg:block" title={location.origin}>
      {!online ? t('Offline') : local ? t('This machine') : host}
    </span>
  );
}

function MobileBottom({ active }: { active: Section }) {
  const claimed = useMobileBarClaimed();
  return (
    <>
      <div
        id={MOBILE_BAR_SLOT_ID}
        className={cn(
          'bg-card/85 border-border flex items-stretch border-t backdrop-blur-xl md:hidden',
          'pb-[env(safe-area-inset-bottom)] keyboard:hidden',
          !claimed && 'hidden',
        )}
      />
      {!claimed && <MobileNav active={active} />}
    </>
  );
}

/** Sub-entries under Puzzles. Failed-review deliberately has no entry —
    the dashboard and the trainer already link it where it's relevant. */
const PUZZLE_SUBNAV = [
  { param: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  // "Puzzle books", not "Books": the library of PDFs is Books, a section
  // of its own, and this is the shelf of puzzles read out of them.
  { param: 'books', label: 'Puzzle books', icon: BookMarked },
  { param: 'themes', label: 'Themes', icon: LayoutGrid },
] as const;

/** An indented child row under a top-level sidebar entry. */
function SubNavItem({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: typeof Folder;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={t(label)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
        'justify-center lg:justify-start lg:pl-[2.35rem] lg:pr-3',
        active ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="hidden lg:block">{t(label)}</span>
    </button>
  );
}

function Sidebar({ active, params }: { active: Section; params: string[] }) {
  return (
    <nav
      className={cn(
        'bg-card border-border hidden shrink-0 flex-col border-r md:flex',
        'w-[4.25rem] lg:w-52',
      )}
    >
      <button
        type="button"
        onClick={() => navigate('home')}
        title={t('Home')}
        className="hover:bg-accent flex h-14 items-center gap-2.5 px-4 text-left transition-colors duration-100 lg:px-4"
      >
        {/* Bare, in the text's own ink — the same treatment as the home
            header. The filled tile it used to sit on read as a button
            distinct from the wordmark beside it. */}
        <BrandMark className="size-6 shrink-0" />
        <span className="hidden truncate text-base font-semibold tracking-tight lg:block">
          {t('Chess Vault')}
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map(({ section, label, icon: Icon }) => {
          const isActive = section === active;
          return (
            <Fragment key={section}>
            <button
              type="button"
              onClick={() => navigate(section)}
              // aria-label, not title: the label is written beside the icon
              // at lg, so the native tooltip only ever repeated what was
              // already on screen — and it popped over the item below it.
              // Screen readers still get the name in the collapsed rail.
              aria-label={t(label)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-base font-medium',
                'transition-colors duration-150',
                'justify-center lg:justify-start',
                isActive
                  ? // Fill, outline and rail together: on the darker page
                    // the soft fill alone was close enough to the sidebar
                    // that the current section had to be looked for.
                    'bg-muted text-primary ring-primary/30 font-semibold ring-1 ring-inset'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {isActive && (
                <span className="bg-primary absolute left-0 h-6 w-[3px] rounded-r-full" />
              )}
              <Icon className="size-[1.15rem] shrink-0" strokeWidth={isActive ? 2.4 : 2} />
              <span className="hidden lg:block">{t(label)}</span>
            </button>
            {/* A section's children are drawn by the section, not after the
                whole list. They used to be appended below the NAV loop,
                which only looked right for as long as Puzzles happened to
                be the last entry — adding one after it left Dashboard,
                Books and Themes indented under the newcomer, reading as
                its children. Order in NAV is now free. */}
            {section === 'puzzles' &&
              PUZZLE_SUBNAV.map(({ param, label: sub, icon: SubIcon }) => (
                <SubNavItem
                  key={param}
                  label={sub}
                  icon={SubIcon}
                  active={active === 'puzzles' && params[0] === param}
                  onClick={() => navigate('puzzles', param)}
                />
              ))}
            </Fragment>
          );
        })}

        {/* Tools: a top-level group whose row points at its first entry.

            Not a wrench: a wrench means REPAIR, which is what it says
            two screens away on the crash card below — one glyph for
            "this broke" and for the Board. Nothing under this row is
            being fixed, and Settings already holds the gear beside it.

            What these four have in common is not an object — Board,
            Editor, Explorer and Repertoire share none — but a stance:
            they are the pages you ACT on, against the collections you
            keep. A pointer on a surface says that, and says it in a
            silhouette nothing else here has. `Shapes` was tried first
            and withdrawn on sight: three small blobs directly under
            Network's three, which is the clustering this whole sweep is
            against. */}
        <button
          type="button"
          onClick={() => navigate('board')}
          title={t('Tools')}
          aria-current={inTools(active) ? 'page' : undefined}
          className={cn(
            'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-base font-medium',
            'transition-colors duration-150 justify-center lg:justify-start',
            inTools(active) ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {inTools(active) && <span className="bg-primary absolute left-0 h-5 w-[3px] rounded-r-full" />}
          <SquareMousePointer className="size-[1.15rem] shrink-0" strokeWidth={inTools(active) ? 2.4 : 2} />
          <span className="hidden lg:block">{t('Tools')}</span>
        </button>
        {TOOLS_SUBNAV.map(({ key, label, icon: Icon, nav, active: isActive }) => (
          <SubNavItem
            key={key}
            label={label}
            icon={Icon}
            active={isActive(active, params)}
            onClick={() => navigate(...nav)}
          />
        ))}

        {/* Databases: a top-level row of its own — management, not a tool. */}
        <button
          type="button"
          onClick={() => navigate('databases')}
          title={t('Databases')}
          aria-current={active === 'databases' ? 'page' : undefined}
          className={cn(
            'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-base font-medium',
            'transition-colors duration-150 justify-center lg:justify-start',
            active === 'databases' ? 'bg-muted text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {active === 'databases' && <span className="bg-primary absolute left-0 h-5 w-[3px] rounded-r-full" />}
          <Database className="size-[1.15rem] shrink-0" strokeWidth={active === 'databases' ? 2.4 : 2} />
          <span className="hidden lg:block">{t('Databases')}</span>
        </button>
      </div>

      <div className="border-border flex flex-col items-center gap-1 border-t p-2 lg:flex-row lg:justify-between lg:px-3">
        <ConnectionLabel />
        <div className="flex flex-col items-center gap-1 lg:flex-row">
          <button
            type="button"
            onClick={() => navigate('settings')}
            title={t('Settings')}
            aria-current={active === 'settings' ? 'page' : undefined}
            className={cn(
              'grid size-9 place-items-center rounded-lg transition-colors duration-100',
              active === 'settings'
                ? 'bg-muted text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Settings className="size-[1.15rem]" strokeWidth={2} />
          </button>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

/** The More page groups the destinations the bottom bar doesn't carry:
    the Tools boards, and Settings. Board and Editor are not primary nav on
    a phone (the chess.com/Lichess pattern), so they live here. */
const MORE_GROUPS: {
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
      { section: 'openingmap', label: 'Opening map', icon: Network, blurb: 'See your opening preparation as a tree' },
    ],
  },
  {
    heading: 'App',
    items: [
      // Books is a sidebar row on a desktop; here it sits with the app's
      // other pages rather than under a heading of its own.
      { section: 'books', label: 'Books', icon: BookOpen, blurb: 'Read your chess books beside a board' },
      { section: 'databases', label: 'Databases', icon: Database, blurb: 'Reference game databases, built from uploaded PGNs' },
      { section: 'settings', label: 'Settings', icon: Settings, blurb: 'Password, 2FA, themes, tokens' },
    ],
  },
];
const MORE_SECTIONS = MORE_GROUPS.flatMap((g) => g.items);

/** A plain page, not a popover — lanph3re's call after trying the sheet. */
function MorePage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
        <h1 className="px-1 text-xl font-semibold tracking-tight">{t('More')}</h1>
        {MORE_GROUPS.map(({ heading, items }) => (
          <div key={heading} className="flex flex-col gap-2">
            <h2 className="text-muted-foreground px-1 text-sm font-medium">
              {t(heading)}
            </h2>
            {items.map(({ section, param, label, icon: Icon, blurb }) => (
              <button
                key={label}
                type="button"
                onClick={() => (param ? navigate(section, param) : navigate(section))}
                className={cn(
                  'bg-card flex items-center gap-3 rounded-xl ring-1 ring-foreground/10 p-3.5 text-left',
                  'active:bg-accent transition-colors duration-100',
                )}
              >
                <div className="bg-muted text-muted-foreground grid size-10 shrink-0 place-items-center rounded-lg">
                  <Icon className="size-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-medium">{t(label)}</div>
                  <div className="text-muted-foreground text-sm">{t(blurb)}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileNav({ active }: { active: Section }) {
  const inMore = active === 'more' || MORE_SECTIONS.some((m) => m.section === active);
  // Desktop reaches home through the sidebar's logo; the bottom bar needs
  // its own entry or a phone can never get back to the landing page.
  const tabs = [
    { section: 'home' as Section, label: 'Home', icon: House },
    ...NAV.filter(({ section }) => !MORE_SECTIONS.some((m) => m.section === section)),
  ];

  return (
    <nav
      className={cn(
        'bg-card/85 border-border flex shrink-0 items-stretch border-t backdrop-blur-xl md:hidden',
        // Clear the iOS home indicator.
        'pb-[env(safe-area-inset-bottom)]',
        // Gone while the keyboard is up. The shell now ends at the top of
        // the keyboard, so a bar pinned to the shell's bottom edge would
        // sit on the keys — which is exactly how the last attempt at this
        // failed. Nothing on a phone asks for typing except a sheet, and a
        // sheet covers the bar anyway.
        'keyboard:hidden',
      )}
    >
      {tabs.map(({ section, label, icon: Icon }) => {
        const isActive = section === active;
        return (
          <button
            key={section}
            type="button"
            // Phones: the Puzzles tab lands on the hub, a launcher whose
            // buttons sit on the bottom edge where a thumb already is.
            // It landed on the dashboard until that page's own shortcuts
            // had to be read at the top of a screen of statistics to get
            // anywhere — a page consulted now and then, opened every time
            // anyone reached for training.
            onClick={() => (section === 'puzzles' ? navigate('puzzles', 'hub') : navigate(section))}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium',
              'transition-colors duration-150',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-[1.15rem]" strokeWidth={isActive ? 2.4 : 2} />
            {t(label)}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => navigate('more')}
        aria-current={inMore ? 'page' : undefined}
        className={cn(
          'flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium',
          'transition-colors duration-150',
          inMore ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <Ellipsis className="size-[1.15rem]" strokeWidth={inMore ? 2.4 : 2} />
        {t('More')}
      </button>
    </nav>
  );
}

/**
 * The floor under every routed view.
 *
 * Without this, anything thrown during render — including the error
 * lazyRoute deliberately rethrows once its one-reload guard is spent —
 * unmounted the whole root and left a silent blank window, which is the
 * exact symptom lazyRoute exists to remove. Keyed on the section by the
 * caller, so navigating anywhere else discards the crashed instance and
 * gives the next view a clean start.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="optical-center h-full p-8">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-2xl">
            <Wrench className="size-6" strokeWidth={1.75} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t('Something went wrong')}</h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            {t('This page hit an error it could not recover from. Reloading usually clears it — nothing in your vault is affected.')}
          </p>
          <div className="mt-1 flex gap-2">
            <Button variant="secondary" onClick={() => location.reload()}>{t('Reload')}</Button>
            <Button variant="ghost" onClick={() => navigate('home')}>
              {t('Go home')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** Unreachable in practice — every section is routed above, and the router
    resolves anything unknown to the board. Kept as a defensive fallback so a
    future section without a handler degrades gracefully instead of blanking. */
function Placeholder({ section }: { section: Section }) {
  return (
    <div className="optical-center h-full p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-2xl">
          <Folder className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight capitalize">{section}</h1>
        <p className="text-muted-foreground text-base leading-relaxed">{t("This page isn't available.")}</p>
      </div>
    </div>
  );
}
