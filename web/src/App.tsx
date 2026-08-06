import {
  BookOpen,
  Grid2x2,
  Library,
  NotebookPen,
  Puzzle,
  Swords,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { navigate, useRoute, type Section } from '@/lib/router';
import { ThemeToggle } from '@/ui/ThemeToggle';
import { AnalysisView } from '@/analysis/AnalysisView';
import { EditorView } from '@/editor/EditorView';
import { StudiesView } from '@/studies/StudiesView';

const NAV: { section: Section; label: string; icon: typeof Swords }[] = [
  { section: 'analysis', label: 'Analysis', icon: Swords },
  { section: 'editor', label: 'Editor', icon: Grid2x2 },
  { section: 'studies', label: 'Studies', icon: Library },
  { section: 'notes', label: 'Notes', icon: NotebookPen },
  { section: 'games', label: 'Games', icon: BookOpen },
  { section: 'puzzles', label: 'Puzzles', icon: Puzzle },
];

export function App() {
  const { section, params } = useRoute();

  return (
    <div className="bg-app text-fg flex h-[100dvh] flex-col overflow-hidden md:flex-row">
      <Sidebar active={section} />

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {section === 'analysis' ? (
          <AnalysisView />
        ) : section === 'editor' ? (
          <EditorView />
        ) : section === 'studies' ? (
          <StudiesView params={params} />
        ) : (
          <Placeholder section={section} />
        )}
      </main>

      <MobileNav active={section} />
    </div>
  );
}

function Sidebar({ active }: { active: Section }) {
  return (
    <nav
      className={cn(
        'bg-surface border-line hidden shrink-0 flex-col border-r md:flex',
        'w-[4.25rem] lg:w-52',
      )}
    >
      <div className="flex h-14 items-center gap-2.5 px-4 lg:px-4">
        <div className="bg-primary text-primary-fg grid size-8 shrink-0 place-items-center rounded-lg text-[0.95rem] font-bold">
          {/* U+FE0E forces text presentation — bare U+265F renders as an emoji
              pawn on many platforms and ignores the CSS colour. */}
          {'♟︎'}
        </div>
        <span className="hidden truncate text-sm font-semibold tracking-tight lg:block">
          Chess Vault
        </span>
      </div>

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
      </div>

      <div className="border-line flex items-center justify-center border-t p-2 lg:justify-between lg:px-3">
        <span className="text-subtle hidden text-xs lg:block">Offline · local</span>
        <ThemeToggle />
      </div>
    </nav>
  );
}

function MobileNav({ active }: { active: Section }) {
  return (
    <nav
      className={cn(
        'bg-surface/85 border-line flex shrink-0 items-stretch border-t backdrop-blur-xl md:hidden',
        // Clear the iOS home indicator.
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      {NAV.map(({ section, label, icon: Icon }) => {
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
