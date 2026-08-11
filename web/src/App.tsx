import {
  Grid3x3,
  SquarePen,
  BarChart3,
  BookMarked,
  BookOpen,
  Compass,
  Ellipsis,
  House,
  LayoutGrid,
  Library,
  NotebookPen,
  Puzzle,
  Settings,
  Swords,
  SwatchBook,
  Wrench,
} from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { lazyRoute } from '@/lib/lazyRoute';
import { navigate, useRoute, type Section } from '@/lib/router';
import { PasswordGate } from '@/auth/PasswordGate';
import { MOBILE_BAR_SLOT_ID, useMobileBarClaimed } from '@/ui/MobileActionBar';
import { KnightIcon } from '@/ui/KnightIcon';
import { ThemeToggle } from '@/ui/ThemeToggle';
import { t, useLang } from '@/lib/i18n';
import { demoKind, isDemo, noteServerDemo } from '@/lib/demo';

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
const HomePage = lazyRoute(() => import('@/home/HomePage').then((m) => ({ default: m.HomePage })));
const StudiesView = lazyRoute(() => import('@/studies/StudiesView').then((m) => ({ default: m.StudiesView })));
const SettingsPage = lazyRoute(() => import('@/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const RepertoireView = lazyRoute(() => import('@/repertoire/RepertoireView').then((m) => ({ default: m.RepertoireView })));

// Top-level destinations, in the reading order lanph3re set. Board and
// Editor are not here — they live under Tools (a group, below), the way
// chess.com/Lichess keep the analysis board out of primary nav.
const NAV: { section: Section; label: string; icon: typeof Swords }[] = [
  { section: 'games', label: 'Games', icon: BookOpen },
  { section: 'studies', label: 'Studies', icon: Library },
  { section: 'notes', label: 'Notes', icon: NotebookPen },
  { section: 'puzzles', label: 'Puzzles', icon: Puzzle },
];

// The Tools group: interactive boards that aren't a "collection". Explorer
// is not a page of its own — it is the Board opened straight to its opening
// explorer (navigate('analysis', 'explorer')), so it reuses everything.
const TOOLS_SUBNAV: {
  key: string;
  label: string;
  icon: typeof Swords;
  nav: [Section, ...string[]];
  active: (section: Section, params: string[]) => boolean;
}[] = [
  { key: 'board', label: 'Board', icon: Grid3x3, nav: ['analysis'], active: (s, p) => s === 'analysis' && p[0] !== 'explorer' },
  { key: 'editor', label: 'Editor', icon: SquarePen, nav: ['editor'], active: (s) => s === 'editor' },
  { key: 'explorer', label: 'Explorer', icon: Compass, nav: ['analysis', 'explorer'], active: (s, p) => s === 'analysis' && p[0] === 'explorer' },
  { key: 'repertoire', label: 'Repertoire', icon: SwatchBook, nav: ['repertoire'], active: (s) => s === 'repertoire' },
];
const inTools = (s: Section): boolean => s === 'analysis' || s === 'editor' || s === 'repertoire';

export function App() {
  return (
    <PasswordGate>
      <Shell />
    </PasswordGate>
  );
}

/**
 * Public demo notice.
 *
 * A shared vault that anyone can edit is only honest if it says so: a
 * visitor who writes a study and comes back to find it gone should have
 * been told, and a visitor about to type something private should be
 * warned before rather than after.
 */
function DemoBanner() {
  const [demo, setDemo] = useState(isDemo);
  useEffect(() => {
    void fetch('/api/health')
      .then((r) => r.json() as Promise<{ demo?: boolean }>)
      .then((h) => {
        // Recorded so every other surface can name the demo too.
        noteServerDemo(!!h.demo);
        setDemo(!!h.demo || isDemo());
      })
      .catch(() => setDemo(false));
  }, []);
  if (!demo) return null;
  return (
    <div className="text-warn border-line flex shrink-0 items-center justify-center gap-2 border-b bg-[color-mix(in_oklch,var(--warn)_14%,var(--app-bg))] px-3 py-1.5 text-center text-xs">
      {demoKind() === 'server'
        ? t('Demo — everyone shares this vault and it resets regularly. Do not put anything private here.')
        : t('Demo — this is a sample vault of your own. Edit anything; a reload puts it back.')}
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
        'bg-app text-fg flex h-[var(--app-h,100svh)] flex-col overflow-hidden',
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
        <Suspense fallback={<div className="h-full" />}>
        {section === 'home' ? (
          <HomePage />
        ) : section === 'analysis' ? (
          <AnalysisView params={params} />
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
        ) : section === 'repertoire' ? (
          <RepertoireView />
        ) : section === 'settings' ? (
          <SettingsPage />
        ) : section === 'more' ? (
          <MorePage />
        ) : (
          <Placeholder section={section} />
        )}
        </Suspense>
      </main>

      <MobileBottom active={section} />
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
    <span className="text-subtle hidden truncate text-xs lg:block" title={location.origin}>
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
          'bg-surface/85 border-line flex items-stretch border-t backdrop-blur-xl md:hidden',
          'pb-[env(safe-area-inset-bottom)]',
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
  { param: 'books', label: 'Books', icon: BookMarked },
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
  icon: typeof Swords;
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
        'flex h-8 items-center gap-2.5 rounded-lg text-xs font-medium transition-colors duration-150',
        'justify-center lg:justify-start lg:pl-[2.35rem] lg:pr-3',
        active ? 'bg-primary-soft text-primary' : 'text-subtle hover:bg-surface-2 hover:text-fg',
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
        'bg-surface border-line hidden shrink-0 flex-col border-r md:flex',
        'w-[4.25rem] lg:w-52',
      )}
    >
      <button
        type="button"
        onClick={() => navigate('home')}
        title={t('Home')}
        className="hover:bg-surface-2 flex h-14 items-center gap-2.5 px-4 text-left transition-colors duration-100 lg:px-4"
      >
        <div className="bg-primary text-primary-fg grid size-8 shrink-0 place-items-center rounded-lg">
          {/* The cburnett knight — the same knight as on the board. */}
          <KnightIcon className="size-5" />
        </div>
        <span className="hidden truncate text-sm font-semibold tracking-tight lg:block">
          {t('Chess Vault')}
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-0.5 p-2">
        {NAV.map(({ section, label, icon: Icon }) => {
          const isActive = section === active;
          return (
            <button
              key={section}
              type="button"
              onClick={() => navigate(section)}
              title={t(label)}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium',
                'transition-colors duration-150',
                'justify-center lg:justify-start',
                isActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {isActive && (
                <span className="bg-primary absolute left-0 h-5 w-[3px] rounded-r-full" />
              )}
              <Icon className="size-[1.15rem] shrink-0" strokeWidth={isActive ? 2.4 : 2} />
              <span className="hidden lg:block">{t(label)}</span>
            </button>
          );
        })}
        {PUZZLE_SUBNAV.map(({ param, label, icon: Icon }) => (
          <SubNavItem
            key={param}
            label={label}
            icon={Icon}
            active={active === 'puzzles' && params[0] === param}
            onClick={() => navigate('puzzles', param)}
          />
        ))}

        {/* Tools: a top-level group whose row points at its first entry. */}
        <button
          type="button"
          onClick={() => navigate('analysis')}
          title={t('Tools')}
          aria-current={inTools(active) ? 'page' : undefined}
          className={cn(
            'group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium',
            'transition-colors duration-150 justify-center lg:justify-start',
            inTools(active) ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
          )}
        >
          {inTools(active) && <span className="bg-primary absolute left-0 h-5 w-[3px] rounded-r-full" />}
          <Wrench className="size-[1.15rem] shrink-0" strokeWidth={inTools(active) ? 2.4 : 2} />
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
      </div>

      <div className="border-line flex flex-col items-center gap-1 border-t p-2 lg:flex-row lg:justify-between lg:px-3">
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
                ? 'bg-primary-soft text-primary'
                : 'text-muted hover:bg-surface-2 hover:text-fg',
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
  items: { section: Section; param?: string; label: string; icon: typeof Swords; blurb: string }[];
}[] = [
  {
    heading: 'Tools',
    items: [
      { section: 'analysis', label: 'Board', icon: Grid3x3, blurb: 'Analyse any position with the engine' },
      { section: 'editor', label: 'Editor', icon: SquarePen, blurb: 'Set up any position from scratch' },
      { section: 'analysis', param: 'explorer', label: 'Explorer', icon: Compass, blurb: 'Browse opening statistics move by move' },
      { section: 'repertoire', label: 'Repertoire', icon: SwatchBook, blurb: 'Practise an opening against real games' },
    ],
  },
  {
    heading: 'App',
    items: [
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
        <h1 className="px-1 text-lg font-semibold tracking-tight">{t('More')}</h1>
        {MORE_GROUPS.map(({ heading, items }) => (
          <div key={heading} className="flex flex-col gap-2">
            <h2 className="text-subtle px-1 text-xs font-semibold uppercase tracking-[0.08em]">
              {t(heading)}
            </h2>
            {items.map(({ section, param, label, icon: Icon, blurb }) => (
              <button
                key={label}
                type="button"
                onClick={() => (param ? navigate(section, param) : navigate(section))}
                className={cn(
                  'bg-surface border-line flex items-center gap-3 rounded-xl border p-3.5 text-left',
                  'active:bg-surface-2 transition-colors duration-100',
                )}
              >
                <div className="bg-surface-2 text-muted grid size-10 shrink-0 place-items-center rounded-lg">
                  <Icon className="size-5" strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t(label)}</div>
                  <div className="text-subtle text-xs">{t(blurb)}</div>
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
        'bg-surface/85 border-line flex shrink-0 items-stretch border-t backdrop-blur-xl md:hidden',
        // Clear the iOS home indicator.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {tabs.map(({ section, label, icon: Icon }) => {
        const isActive = section === active;
        return (
          <button
            key={section}
            type="button"
            // Phones: the Puzzles tab lands on the dashboard, the hub with
            // big Train/Books/Themes buttons — the trainer is one tap away.
            onClick={() => (section === 'puzzles' ? navigate('puzzles', 'dashboard') : navigate(section))}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-[0.625rem] font-medium',
              'transition-colors duration-150',
              isActive ? 'text-primary' : 'text-subtle',
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
          'flex flex-1 flex-col items-center gap-1 py-2 text-[0.625rem] font-medium',
          'transition-colors duration-150',
          inMore ? 'text-primary' : 'text-subtle',
        )}
      >
        <Ellipsis className="size-[1.15rem]" strokeWidth={inMore ? 2.4 : 2} />
        {t('More')}
      </button>
    </nav>
  );
}

/** Unreachable in practice — every section is routed above, and the router
    resolves anything unknown to the board. Kept as a defensive fallback so a
    future section without a handler degrades gracefully instead of blanking. */
function Placeholder({ section }: { section: Section }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-surface-2 text-subtle grid size-14 place-items-center rounded-2xl">
          <Swords className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold tracking-tight capitalize">{section}</h1>
        <p className="text-muted text-sm leading-relaxed">{t("This page isn't available.")}</p>
      </div>
    </div>
  );
}
