import {
  BookOpen,
  SquarePen,
  Library,
  NotebookPen,
  Puzzle,
  Grid3x3,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate, type Section } from '@/lib/router';

/**
 * The landing page — minimal, but not empty-handed: the vault sections
 * carry their live counts (lanph3re's design-audit call: structural elements
 * should encode something true). Tools (analysis, editor) stay bare.
 */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const SECTIONS: { section: Section; label: string; blurb: string; icon: typeof Grid3x3 }[] = [
  { section: 'analysis', label: 'Board', blurb: 'Free board with engine and explorer', icon: Grid3x3 },
  { section: 'editor', label: 'Editor', blurb: 'Set up any position', icon: SquarePen },
  { section: 'studies', label: 'Studies', blurb: 'Openings and ideas, in chapters', icon: Library },
  { section: 'notes', label: 'Notes', blurb: 'Markdown with live boards', icon: NotebookPen },
  { section: 'games', label: 'Games', blurb: 'Your collection, annotated', icon: BookOpen },
  { section: 'puzzles', label: 'Puzzles', blurb: 'Train tactics offline', icon: Puzzle },
];

export function HomePage() {
  const [counts, setCounts] = useState<Partial<Record<Section, number>>>({});
  useEffect(() => {
    const grab = async (url: string): Promise<unknown> => {
      try {
        const res = await fetch(url);
        return res.ok ? res.json() : null;
      } catch {
        return null;
      }
    };
    void (async () => {
      // The notes/games endpoints speak the studies document API, so all
      // three answer with a `studies` list.
      const [studies, notes, games, puzzles] = await Promise.all([
        grab('/api/studies'),
        grab('/api/notes'),
        grab('/api/games/docs'),
        grab('/api/puzzles/meta'),
      ]);
      const docs = (v: unknown): number | undefined =>
        Array.isArray((v as { studies?: unknown[] })?.studies)
          ? (v as { studies: unknown[] }).studies.length
          : undefined;
      const next: Partial<Record<Section, number>> = {
        studies: docs(studies),
        notes: docs(notes),
        games: docs(games),
      };
      // The trainer's own pool (the full lichess db), not the book totals.
      const trainerPool = (puzzles as { puzzles?: number })?.puzzles;
      if (typeof trainerPool === 'number' && trainerPool > 0) next.puzzles = trainerPool;
      setCounts(next);
    })();
  }, []);

  return (
    <div className="grid h-full min-h-0 place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-fg grid size-14 place-items-center rounded-2xl">
            {/* The cburnett knight — the same knight as on the board. */}
            <svg viewBox="4.5 5 36 36" className="size-9" fill="currentColor" aria-hidden>
              <path d="M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18 Z M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10 Z" />
            </svg>
          </div>
          <div>
            <h1 className="text-fg text-xl font-semibold tracking-tight">Chess Vault</h1>
            <p className="text-subtle text-sm">Your chess, in plain files.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SECTIONS.map(({ section, label, blurb, icon: Icon }) => (
            <button
              key={section}
              type="button"
              onClick={() => navigate(section)}
              className="bg-surface border-line hover:border-line-strong hover:bg-surface-2 group flex flex-col items-start gap-2 rounded-xl border p-3.5 text-left transition-colors duration-100"
            >
              <Icon className="text-subtle group-hover:text-primary size-4.5 transition-colors" />
              <span>
                <span className="text-fg block text-sm font-medium">
                  {label}
                  {counts[section] !== undefined && (
                    <span className="text-subtle font-mono text-xs font-normal">
                      {' '}
                      · {compact.format(counts[section]!)}
                    </span>
                  )}
                </span>
                <span className="text-subtle block text-xs leading-snug">{blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
