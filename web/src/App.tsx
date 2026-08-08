import {
  Grid3x3,
  BarChart3,
  BookMarked,
  BookOpen,
  Grid2x2,
  House,
  LayoutGrid,
  Library,
  NotebookPen,
  Puzzle,
  Swords,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { navigate, useRoute, type Section } from '@/lib/router';
import { PasswordGate } from '@/auth/PasswordGate';
import { ThemeToggle } from '@/ui/ThemeToggle';
import { AnalysisView } from '@/analysis/AnalysisView';
import { EditorView } from '@/editor/EditorView';
import { GamesView } from '@/games/GamesView';
import { NotesView } from '@/notes/NotesView';
import { PuzzlesView } from '@/puzzles/PuzzlesView';
import { HomePage } from '@/home/HomePage';
import { StudiesView } from '@/studies/StudiesView';

const NAV: { section: Section; label: string; icon: typeof Swords }[] = [
  { section: 'analysis', label: 'Board', icon: Grid3x3 },
  { section: 'editor', label: 'Editor', icon: Grid2x2 },
  { section: 'studies', label: 'Studies', icon: Library },
  { section: 'notes', label: 'Notes', icon: NotebookPen },
  { section: 'games', label: 'Games', icon: BookOpen },
  { section: 'puzzles', label: 'Puzzles', icon: Puzzle },
];

export function App() {
  return (
    <PasswordGate>
      <Shell />
    </PasswordGate>
  );
}

function Shell() {
  const { section, params } = useRoute();

  return (
    <div
      className={cn(
        // --app-h is set (and kept fresh) in standalone PWA mode, where
        // 100dvh can be stale on launch; browsers fall back to 100dvh.
        'bg-app text-fg flex h-[var(--app-h,100dvh)] flex-col overflow-hidden md:flex-row',
        // Standalone PWAs draw edge-to-edge: keep content clear of the
        // dynamic island / notch (top) and the rounded corners (sides).
        // The bottom inset lives on MobileNav, which sits on that edge.
        'pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)]',
      )}
    >
      <Sidebar active={section} params={params} />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {section === 'home' ? (
          <HomePage />
        ) : section === 'analysis' ? (
          <AnalysisView />
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
        ) : (
          <Placeholder section={section} />
        )}
      </main>

      <MobileNav active={section} />
    </div>
  );
}

/** Sub-entries under Puzzles. Failed-review deliberately has no entry —
    the dashboard and the trainer already link it where it's relevant. */
const PUZZLE_SUBNAV = [
  { param: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { param: 'books', label: 'Books', icon: BookMarked },
  { param: 'themes', label: 'Themes', icon: LayoutGrid },
] as const;

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
        title="Home"
        className="hover:bg-surface-2 flex h-14 items-center gap-2.5 px-4 text-left transition-colors duration-100 lg:px-4"
      >
        <div className="bg-primary text-primary-fg grid size-8 shrink-0 place-items-center rounded-lg">
          {/* The cburnett knight — the same knight as on the board. */}
          <svg viewBox="4.5 5 36 36" className="size-5" fill="currentColor" aria-hidden>
            <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 Z M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10 Z" />
          </svg>
        </div>
        <span className="hidden truncate text-sm font-semibold tracking-tight lg:block">
          Chess Vault
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
              title={label}
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
              <span className="hidden lg:block">{label}</span>
            </button>
          );
        })}
        {PUZZLE_SUBNAV.map(({ param, label, icon: Icon }) => {
          const isActive = active === 'puzzles' && params[0] === param;
          return (
            <button
              key={param}
              type="button"
              onClick={() => navigate('puzzles', param)}
              title={label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-lg text-xs font-medium',
                'transition-colors duration-150',
                'justify-center lg:justify-start lg:pl-[2.35rem] lg:pr-3',
                isActive
                  ? 'bg-primary-soft text-primary'
                  : 'text-subtle hover:bg-surface-2 hover:text-fg',
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="border-line flex items-center justify-center border-t p-2 lg:justify-between lg:px-3">
        <span className="text-subtle hidden text-xs lg:block">Offline · local</span>
        <ThemeToggle />
      </div>
    </nav>
  );
}

function MobileNav({ active }: { active: Section }) {
  // Desktop reaches home through the sidebar's logo; the bottom bar needs
  // its own entry or a phone can never get back to the landing page.
  const tabs = [{ section: 'home' as Section, label: 'Home', icon: House }, ...NAV];
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
            onClick={() => navigate(section)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2 text-[0.625rem] font-medium',
              'transition-colors duration-150',
              isActive ? 'text-primary' : 'text-subtle',
            )}
          >
            <Icon className="size-[1.15rem]" strokeWidth={isActive ? 2.4 : 2} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function Placeholder({ section }: { section: Section }) {
  const phase: Record<string, string> = {
    editor: 'Phase 1 — board editor',
    studies: 'Phase 3 — board-as-main studies',
    notes: 'Phase 4 — markdown notes with embedded boards',
    games: 'Phase 5 — games explorer',
    puzzles: 'Phase 6 — puzzle trainer',
  };
  const meta = NAV.find((n) => n.section === section);
  const Icon = meta?.icon ?? Swords;

  return (
    <div className="grid h-full place-items-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-surface-2 text-subtle grid size-14 place-items-center rounded-2xl">
          <Icon className="size-6" strokeWidth={1.75} />
        </div>
        <h1 className="text-lg font-semibold tracking-tight">{meta?.label}</h1>
        <p className="text-muted text-sm leading-relaxed">
          Not built yet — {phase[section] ?? 'coming soon'}.
        </p>
      </div>
    </div>
  );
}
