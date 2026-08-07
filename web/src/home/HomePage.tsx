import {
  BookOpen,
  Grid2x2,
  Library,
  NotebookPen,
  Puzzle,
  Swords,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate, type Section } from '@/lib/router';

/**
 * The landing page — minimal, but not empty-handed: the vault sections
 * carry their live counts (lanph3re's design-audit call: structural elements
 * should encode something true). Tools (analysis, editor) stay bare.
 */

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const SECTIONS: { section: Section; label: string; blurb: string; icon: typeof Swords }[] = [
  { section: 'analysis', label: 'Analysis', blurb: 'Free board with engine and explorer', icon: Swords },
  { section: 'editor', label: 'Editor', blurb: 'Set up any position', icon: Grid2x2 },
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
            {/* The cburnett pawn — the same pawn as on the board. */}
            <svg viewBox="5 4.5 35 37" className="size-9" fill="currentColor" aria-hidden>
              <path d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z" />
            </svg>
          </div>
          <div>
            <h1 className="text-fg text-xl font-semibold tracking-tight">Chess Vault</h1>
            <p className="text-subtle text-sm">Your chess, in your vault.</p>
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
