import { Suspense, useEffect, useEffectEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { prefetchWhenIdle } from '@/lib/prefetch';
import { HomePage } from '@/home/HomePage';
import { decodeSegment, sectionHref, useRoute, type Section } from '@/lib/router';
import { KeepAlive, rememberRoute } from '@/lib/keep-alive';
import { PasswordGate } from '@/auth/PasswordGate';
import { ShortcutsHelp } from '@/components/shortcuts-help';
import { QuickSwitcher } from '@/components/quick-switcher';
import { LeaveDialog } from '@/components/leave-dialog';
import { WikiUnresolved } from '@/notes/WikiUnresolved';
import { type IconSection } from '@/lib/sectionIcon';
import { t, useLang } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/media';
import { TitleBar } from '@/components/title-bar';
import { foldedFrom, useSidebar } from '@/store/sidebar';
import { useRecentOpens } from '@/store/recent';
import { dialogOpen } from '@/hooks/dialog-focus';
import { DemoBanner } from '@/shell/demo-banner';
import { MobileBottom } from '@/shell/mobile-nav';
import { MorePage } from '@/shell/more-page';
import { Placeholder, RouteErrorBoundary } from '@/shell/route-boundary';
import {
  AnalysisView,
  BooksView,
  DatabasesPage,
  EditorView,
  EndgamesView,
  GamesView,
  InsightsPage,
  LicensesPage,
  NotesView,
  OpeningMapView,
  PuzzlesView,
  RepertoireView,
  SettingsPage,
  StudiesView,
  WARM_ORDER,
  WorkspaceView,
  warmSection,
} from '@/shell/routes';
import { UNKEPT } from '@/shell/shared';
import { Sidebar } from '@/shell/sidebar';
import { VaultTitle } from '@/shell/vault-label';

export function App() {
  return (
    <PasswordGate>
      <Shell />
    </PasswordGate>
  );
}

/**
 * A document route, as the quick switcher's Recent group records it: the
 * five sections the search index names documents in, and the id in the
 * form the index uses (decoded; a book's is its hash and needs none).
 */
function recentOpenOf(section: Section, params: string[]): { section: IconSection; id: string } | null {
  switch (section) {
    case 'studies':
    case 'notes':
    case 'games':
      return params[0] ? { section, id: decodeSegment(params[0]) } : null;
    case 'books':
      return params[0] ? { section, id: params[0] } : null;
    case 'puzzles':
      return params[0] === 'books' && params[1] ? { section: 'puzzlebooks', id: params[1] } : null;
    default:
      return null;
  }
}

/** The page a section draws for its params. */
function renderSection(section: Section, params: string[]): ReactNode {
  switch (section) {
    case 'home':
      return <HomePage />;
    case 'board':
      // Keyed on the sub-mode: AnalysisView makes its param-dependent
      // decisions once per mount (initial pane, explorer on/off, the
      // stateless reset), so Board ↔ Explorer must REMOUNT it — same
      // section, so React would otherwise reconcile the same instance
      // and the sidebar click would change nothing but the title. A
      // handoff set before navigate() survives: the mount effect
      // consumes the flag wherever the mount came from.
      return <AnalysisView key={params[0] === 'explorer' ? 'explorer' : 'board'} params={params} />;
    case 'workspace':
      return <WorkspaceView />;
    case 'editor':
      return <EditorView />;
    case 'studies':
      return <StudiesView params={params} />;
    case 'games':
      return <GamesView params={params} />;
    case 'notes':
      return <NotesView params={params} />;
    case 'puzzles':
      return <PuzzlesView params={params} />;
    case 'books':
      return <BooksView params={params} />;
    case 'repertoire':
      return <RepertoireView />;
    case 'endgames':
      return <EndgamesView params={params} />;
    case 'openingmap':
      return <OpeningMapView params={params} />;
    case 'databases':
      return <DatabasesPage />;
    case 'insights':
      return <InsightsPage />;
    case 'settings':
      // A sub-route rather than a section of its own: the licences are
      // read from Settings and belong under it, and the sidebar has no
      // business growing an entry for a footnote.
      return <SettingsView params={params} />;
    case 'more':
      return <MorePage />;
    default:
      return <Placeholder section={section} />;
  }
}

/** Settings stays mounted under the licences (lib/keep-alive), as a shelf
    does under its leaf: the one link to them is at the foot of a long
    page, and Back used to land at the top of it. */
function SettingsView({ params }: { params: string[] }) {
  const licences = params[0] === 'licenses';
  return (
    <KeepAlive
      current={licences ? 'licences' : 'settings'}
      data={params}
      keep={(key) => key === 'settings'}
      budget={1}
      render={(key, p) => (key === 'licences' ? <LicensesPage /> : <SettingsPage anchor={p[0]} />)}
    />
  );
}

function Shell() {
  const { section, params } = useRoute();
  // Where each section is, for openSection. Every route change, since the
  // kept section under a tab is at its last route, not its root.
  useEffect(() => {
    rememberRoute(section, sectionHref(section, ...params));
  }, [section, params]);
  // Once the app is up and the browser idle, the other sections' chunks
  // are fetched one at a time (lib/prefetch), so the first tap on a tab
  // finds its page in hand instead of behind a placeholder.
  useEffect(() => prefetchWhenIdle(WARM_ORDER.map((s) => () => warmSection(s))), []);
  // What was opened, for the quick switcher's Recent group (store/recent).
  const recordOpen = useRecentOpens((s) => s.record);
  const opened = recentOpenOf(section, params);
  const openedKey = opened ? `${opened.section}/${opened.id}` : null;
  // The key, not the object: a new object per render would re-record.
  // An Effect Event reads the object without it being a dependency.
  const recordOpened = useEffectEvent(() => {
    if (opened) recordOpen(opened);
  });
  useEffect(() => {
    recordOpened();
  }, [openedKey]);
  // Ctrl/Cmd B folds and unfolds the sidebar, the registry's own key for
  // it and VS Code's. Only where there is a sidebar (md), and not while
  // a window owns the keyboard or a field has it. The switch is the
  // band's or the sidebar's; the key is the third way to the same store.
  const lgForFold = useMediaQuery('(min-width: 64rem)');
  const mdForFold = useMediaQuery('(min-width: 48rem)');
  useEffect(() => {
    if (!mdForFold) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== 'b' || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (dialogOpen()) return;
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      e.preventDefault();
      const { choice, setFolded } = useSidebar.getState();
      setFolded(!foldedFrom(choice, lgForFold));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mdForFold, lgForFold]);
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
        //
        // `vv-band` is a hook, not a style: while the keyboard is up, one
        // rule in index.css pins this to the visual viewport. At rest it
        // does nothing at all, which is the point — pinning it full time
        // left a band under the bottom bar on lanph3re's phone, and a
        // shell that is wrong while nobody is typing is worse than a
        // keyboard that misbehaves while somebody is.
        'bg-background text-foreground vv-band app-shell flex h-[var(--app-h,100svh)] flex-col overflow-hidden',
        // From md the window has a FRAME: one quiet tint the sidebar and
        // the title band share, with the page inset in it as a single
        // rounded panel (`main` below). The shell was the reverse — a
        // white sidebar column flush against a toned page — and a
        // borderless frame around an inset panel is what every desktop
        // shell this app is measured against now draws (macOS Tahoe's
        // sidebars, Linear, Notion, and shadcn's own sidebar
        // variant="inset"). Under md nothing of this applies: the page
        // fills the width, there is no frame to be, and the phone keeps
        // --background exactly as before.
        'md:bg-app-ground',
        // The containing block for everything absolutely positioned under
        // it. Without this an `sr-only` span (position: absolute) placed
        // past the shell's bottom edge, which the puzzle dashboard's log
        // hint is on a vault with a long log, sits outside the shell and
        // gives the DOCUMENT scrollable height (measured: 1730px in a
        // 1010px window). A wheel over the sidebar then scrolled the whole
        // window, title bar and all, by 720px. The shell fills the
        // viewport from (0,0), so nothing positioned moves; it is only
        // clipped here instead of stretching the page.
        'relative',
        // Standalone PWAs draw edge-to-edge: keep content clear of the
        // dynamic island / notch (top) and the rounded corners (sides).
        // The bottom inset lives on MobileNav, which sits on that edge.
        // The top one is the shell's only from md: under it the page pads
        // for the notch itself, so its content can scroll through the
        // inset (styles/shell.css, --shell-t and --page-t).
        'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-(--shell-t)',
      )}
    >
      {/* The first thing Tab reaches: a jump past the section list into
          the page, unseen until it has KEYBOARD focus. It used to show on
          any focus, and a popup that closes after its trigger has gone
          (a redrawn map node, the search dialog) hands focus back to the
          document's first tabbable, which is this link: on a phone it
          surfaced in the status bar after a tap, where nobody could use
          it. focus-visible keeps it for Tab. Its top is the shell's own
          safe-area inset plus 8px, so it clears the notch the shell
          already pads for. The ring is the app's one focus ring; the box
          is a card so it reads over any page. The press moves focus
          itself: routes live in the hash, so a plain `#main` jump would
          be read as a section and land on Home. */}
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className={cn(
          'sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:z-50',
          'focus-visible:top-[calc(var(--safe-t)+0.5rem)] focus-visible:left-[calc(env(safe-area-inset-left)+0.5rem)]',
          'bg-card text-foreground border-window-ring rounded-lg border px-3 py-1.5 text-sm font-medium',
          'outline-none focus-visible:ring-3 focus-visible:ring-ring',
        )}
      >
        {t('Skip to content')}
      </a>
      {/* The desktop shell's own top band, nothing in a browser. */}
      <TitleBar />
      <DemoBanner section={section} params={params} />
      {/* The sidebar/main row. Separated from the shell so a full-width
          strip (the demo notice) can sit above BOTH rather than becoming a
          third column beside the sidebar. */}
      {/* `relative`: the phone's bottom bar is positioned on this row
          (shell/mobile-nav), and `main` pads by its measured height
          (styles/shell.css, --bottom-bar-h) so a page still ends where
          the bar begins.

          `md:overflow-visible`: the panel's ring is a box-shadow with no
          `inset`, so it paints the band immediately OUTSIDE main's border
          box. main is flush to this row's top (`md:mt-0`, the zero gutter
          Linear's own panel has), which put that band one pixel ABOVE the
          row, where this clip threw it away: three sides of the panel drew
          and the top did not, on every desktop route, in both themes.
          Nothing here needs to clip, because both children already clip
          themselves — main for the panel's radius, the nav for the fold's
          label wipe — and this was the outer belt over both.

          Measured 2026-09-23 at a simulated 40px title band: the row above
          the panel read 9,9,9 (the window ground) clipped and 32,32,32
          (the ring) unclipped, main's rect was identical either way, and
          the whole frame moved 941 px of which 928 are that one row and
          the rest the corner arcs. The document gained no scroll in either
          axis. The alternative, giving main `mt-px` so the band falls
          inside the row, was built and measured first and rejected: it
          translates every desktop page's interior down one pixel (63,399
          px differ on home--desktop--dark, and 2 once you shift it back),
          which is the one thing the panel was built not to do.

          Only where there is chrome above the panel is there a band to
          draw in: the shell's title bar, or the demo's notice. In a plain
          browser at md the panel's top IS the window's top, the band is
          off-viewport, and no clip setting can put a line there. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row md:overflow-visible">
      <Sidebar active={section} params={params} />

      <main
        id="main"
        tabIndex={-1}
        className={cn(
          'min-h-0 min-w-0 flex-1 overflow-hidden pb-(--bottom-bar-h) outline-none',
          // The panel. From md only: `main` already clips (it always
          // has), so the radius clips what scrolls inside it without
          // moving the scroller — every page keeps its own
          // `data-page-scroll` element, and the sticky headers, the
          // scroll restoration and the view transitions that hang off it
          // are untouched. Its fill is --background, which is what the
          // page was standing on yesterday, so a page's interior is
          // pixel-identical and only the frame around it has moved.
          // `ml-0`: the seam between the sidebar and the panel is the
          // 8px the frame shows on the other three sides, once, not
          // twice. The ring is a window's, not a card's: this is the
          // frame's opening, and in light it is transparent until the
          // contrast knob brings it back, which is the moment the ground
          // and the panel have met at white.
          // The gutter is ONE EDGE, and that is Linear's arrangement
          // rather than a compromise between readings of it. Measured off
          // lanph3re's screenshot of their light desktop app (1281x808,
          // 2026-09-22): the panel's hairline sits at x=249 with the
          // sidebar running to x=248, so the left gutter is zero; its top
          // hairline at y=79 sits directly under the tab strip, so the
          // top is zero; the right edge ends at 1259 with ground from
          // 1261 to the client edge at 1268, which is 8px; and the 36px
          // below it is the bottom bar's strip, not a margin. The dark
          // screenshot says the same shape (0, 2, 7, 34). This shipped as
          // a uniform 2px and then a uniform 8px, and a uniform anything
          // is wrong on three sides of four: the panel is flush to the
          // sidebar and to the chrome above it, and inset only where the
          // window's own edge is.
          //
          // The radius is 14px. Fitting the top-left arc of that same
          // screenshot (the fill starts 10.5px in one row down, 2.5px at
          // five rows, 0.5px at ten) gives R = 14.2. It shipped at 8
          // from a fit of the dark screenshot, whose smaller window fits
          // nearer 8; the light one is the larger sample and the cleaner
          // arc, and 14 is also what the app drew before that fit
          // (lanph3re's call, 2026-09-22). rounded-xl is --radius * 1.4,
          // which is 14 at the default --radius.
          // And the edge it casts. In light this is the panel's actual
          // separator and the ring above is transparent; in dark
          // --panel-shadow is none and the ring is the edge. Both
          // decisions live in the token files, so this class says "the
          // panel's shadow" and never which theme is which.
          'md:bg-background md:mt-0 md:ml-0 md:mr-2 md:mb-2 md:rounded-xl md:ring-1 md:ring-panel-ring md:shadow-(--panel-shadow)',
        )}
      >
        {/*
          A safety net, no longer the route loader. Sections are fetched by
          lib/lazyRoute, which draws its own blank box while the chunk is on
          its way rather than suspending — a boundary that has committed a
          fallback cannot reveal what replaces it for 300 ms, and on a
          launch that was the launch. This still catches anything INSIDE a
          page that suspends, and its fallback stays blank for the reason
          the routes' does: a chunk usually beats the next paint, so a
          skeleton here would flash on every navigation.

          Data loading is plain fetch in effects, so each page draws its own
          skeleton — React only suspends on promises it is given, which ours
          are not.
        */}
        {/* The last few sections stay mounted while another is open
            (lib/keep-alive), so a tab brings a section back as it was:
            its rows, its filters, its scroller where it was left. Three
            hidden at once, the least recently shown going first. The
            board, the workspace and the editor are not kept: the first
            two hold their state in stores already, the editor keeps its
            own snapshot for Back, and all three are the heavy pages (the
            engine, chessground) that a hidden tree should not hold. */}
        <KeepAlive
          current={section}
          data={params}
          keep={(key) => !UNKEPT.has(key as Section)}
          budget={3}
          render={(key, p) => (
            <RouteErrorBoundary at={[key, ...p].join('/')}>
              <Suspense fallback={<div className="h-full" />}>{renderSection(key as Section, p)}</Suspense>
            </RouteErrorBoundary>
          )}
        />
      </main>

      <MobileBottom active={section} />
      <ShortcutsHelp />
      <QuickSwitcher />
      {/* Global for the same reason: the question is asked by the router,
          which does not know which view is up, and a sheet owned by the
          view being left would have to outlive it. */}
      <LeaveDialog />
      {/* And this one for a third version of it: a link that named nothing
          can be pressed in a note, in a move comment, or anywhere a comment
          is read, so the dialog cannot belong to the editor it used to hang
          off. It is a modal, so there is only ever one to mount. */}
      <WikiUnresolved />
      <VaultTitle />
      </div>
    </div>
  );
}
