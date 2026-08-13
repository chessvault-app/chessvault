import {
  BookMarked,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  SquarePen,
  Library,
  NotebookPen,
  Puzzle,
  Grid3x3,
  Settings,
  SwatchBook,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { navigate, type Section } from '@/lib/router';
import { Button } from '@/ui/Button';
import { Skeleton } from '@/ui/Skeleton';
import { KnightIcon } from '@/ui/KnightIcon';
import { BANDS } from '@/puzzles/bands';
import { t } from '@/lib/i18n';

/**
 * The landing page. It used to be six static tiles — four duplicating the
 * sidebar, five destinations unreachable, nothing for a returning user to
 * resume and nothing for a new one to start with. It is still a launcher,
 * but it leads with what you were doing (Continue), tells a fresh vault
 * what to set up first (each step ends in a feature lighting up), reaches
 * everything, and the counts it shows are all yours — the puzzle tile
 * used to show the 6.1M Lichess pool in the slot every other tile used
 * for personal counts, which read as a lie until decoded.
 */

const SECTIONS: { section: Section; label: string; blurb: string; icon: typeof Grid3x3 }[] = [
  { section: 'analysis', label: 'Board', blurb: 'Free board with engine and explorer', icon: Grid3x3 },
  { section: 'editor', label: 'Editor', blurb: 'Set up any position', icon: SquarePen },
  { section: 'studies', label: 'Studies', blurb: 'Openings and ideas, in chapters', icon: Library },
  { section: 'notes', label: 'Notes', blurb: 'Markdown with live boards', icon: NotebookPen },
  { section: 'games', label: 'Games', blurb: 'Your collection, annotated', icon: BookOpen },
  { section: 'puzzles', label: 'Puzzles', blurb: 'Train tactics offline', icon: Puzzle },
];

/** The destinations the tiles never reached — small, but reachable. */
const MORE: { label: string; icon: typeof Grid3x3; go: () => void }[] = [
  { label: 'Repertoire', icon: SwatchBook, go: () => navigate('repertoire') },
  { label: 'Explorer', icon: Compass, go: () => navigate('analysis', 'explorer') },
  { label: 'Opening books', icon: BookOpen, go: () => navigate('books') },
  { label: 'Puzzle books', icon: BookMarked, go: () => navigate('puzzles', 'books') },
  { label: 'Settings', icon: Settings, go: () => navigate('settings') },
];

interface DocMeta {
  id: string;
  updatedAt: string;
}

interface HomeData {
  counts: Partial<Record<Section, number>>;
  lastStudy: DocMeta | null;
  lastGame: DocMeta | null;
  /** Counted training attempts — 0 means the trainer is untouched. */
  attempts: number;
  puzzleDbReady: boolean;
  hasProfile: boolean;
  hasPuzzleBook: boolean;
}

const CHECKLIST_KEY = 'vault:home-checklist-dismissed';

/** The stored difficulty, as the word the trainer will use. */
function bandWord(): string {
  const stored = localStorage.getItem('vault:puzzle-difficulty');
  return stored && stored !== 'any'
    ? (BANDS.find((b) => b.id === stored)?.label ?? 'Any')
    : 'Any';
}

function latest(v: unknown): DocMeta | null {
  const list = (v as { studies?: DocMeta[] })?.studies;
  if (!Array.isArray(list) || list.length === 0) return null;
  return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0] ?? null;
}

/** A study id is a path; the card shows its name. */
const baseName = (id: string): string => id.split('/').at(-1) ?? id;

export function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [checklistHidden, setChecklistHidden] = useState(
    () => localStorage.getItem(CHECKLIST_KEY) === '1',
  );

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
      // The notes/games endpoints speak the studies document API, so they
      // answer with a `studies` list.
      const [studies, notes, games, puzzles, settings, books] = await Promise.all([
        grab('/api/studies'),
        grab('/api/notes'),
        grab('/api/games/docs'),
        grab('/api/puzzles/meta'),
        grab('/api/settings'),
        grab('/api/puzzlebooks'),
      ]);
      const docs = (v: unknown): number | undefined =>
        Array.isArray((v as { studies?: unknown[] })?.studies)
          ? (v as { studies: unknown[] }).studies.length
          : undefined;
      const meta = puzzles as { ready?: boolean; user?: { attempts?: number; wins?: number } } | null;
      const profile = (settings as { profile?: { chesscom?: string; lichess?: string } })?.profile;
      const counts: Partial<Record<Section, number>> = {
        studies: docs(studies),
        notes: docs(notes),
        games: docs(games),
      };
      // YOUR solves — a personal number like every other tile's, not the
      // size of the Lichess pool.
      const wins = meta?.user?.wins;
      if (typeof wins === 'number' && wins > 0) counts.puzzles = wins;
      setData({
        counts,
        lastStudy: latest(studies),
        lastGame: latest(games),
        attempts: meta?.user?.attempts ?? 0,
        puzzleDbReady: meta?.ready === true,
        hasProfile: Boolean(profile?.chesscom || profile?.lichess),
        hasPuzzleBook: Array.isArray((books as { books?: unknown[] })?.books)
          ? ((books as { books: unknown[] }).books.length > 0)
          : false,
      });
    })();
  }, []);

  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

  const continueRows: { icon: typeof Grid3x3; label: string; detail: string; go: () => void }[] =
    data === null
      ? []
      : [
          ...(data.lastStudy
            ? [
                {
                  icon: Library,
                  label: baseName(data.lastStudy.id),
                  detail: t('Continue study'),
                  go: () => navigate('studies', encodeURIComponent(data.lastStudy!.id)),
                },
              ]
            : []),
          ...(data.lastGame
            ? [
                {
                  icon: BookOpen,
                  label: baseName(data.lastGame.id),
                  detail: t('Last game'),
                  go: () => navigate('games', encodeURIComponent(data.lastGame!.id)),
                },
              ]
            : []),
          ...(data.puzzleDbReady && data.attempts > 0
            ? [
                {
                  icon: Puzzle,
                  label: t('Resume training'),
                  detail: t(bandWord()),
                  go: () => navigate('puzzles'),
                },
              ]
            : []),
        ];

  // First-run steps, each ending in a feature lighting up. The list only
  // exists while something is unlit, and can be dismissed for good.
  const checklist: { label: string; done: boolean; go: () => void }[] =
    data === null
      ? []
      : [
          {
            label: t('Add your Lichess or Chess.com username — the Games page fills itself from it'),
            done: data.hasProfile,
            go: () => navigate('settings'),
          },
          {
            label: t('Fetch the puzzle database — the trainer runs offline from it'),
            done: data.puzzleDbReady,
            go: () => navigate('puzzles'),
          },
          {
            label: t('Import a scanned tactics book — its diagrams become solvable puzzles'),
            done: data.hasPuzzleBook,
            go: () => navigate('puzzles', 'books'),
          },
        ];
  const showChecklist =
    !checklistHidden && data !== null && checklist.some((step) => !step.done);

  return (
    <div className="grid h-full min-h-0 place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-fg grid size-14 place-items-center rounded-2xl">
            <KnightIcon className="size-9" />
          </div>
          <div>
            <h1 className="text-fg text-xl font-semibold tracking-tight">{t('Chess Vault')}</h1>
            <p className="text-subtle text-sm">{t('Your chess, in plain files.')}</p>
          </div>
        </div>

        {/* Continue — the best retention surface on the page. A returning
            user lands one tap from where they left off. */}
        {continueRows.length > 0 && (
          <div className="bg-surface border-line mb-4 overflow-hidden rounded-xl border">
            <p className="text-subtle border-line border-b px-3 pb-1.5 pt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
              {t('Continue')}
            </p>
            {continueRows.map(({ icon: Icon, label, detail, go }) => (
              <button
                key={label + detail}
                type="button"
                onClick={go}
                className="hover:bg-surface-2 border-line flex w-full items-center gap-2.5 border-b px-3 py-2 text-left text-xs transition-colors duration-100 last:border-b-0"
              >
                <Icon className="text-subtle size-3.5 shrink-0" />
                <span className="text-fg min-w-0 flex-1 truncate font-medium">{label}</span>
                <span className="text-subtle shrink-0">{detail}</span>
                <ChevronRight className="text-subtle size-3.5 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {showChecklist && (
          <div className="bg-surface border-line mb-4 overflow-hidden rounded-xl border">
            <div className="border-line flex items-center border-b px-3 pb-1.5 pt-2">
              <p className="text-subtle flex-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
                {t('Set up your vault')}
              </p>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-my-1 -mr-1.5"
                title={t('Hide this checklist')}
                onClick={() => {
                  localStorage.setItem(CHECKLIST_KEY, '1');
                  setChecklistHidden(true);
                }}
              >
                <X className="size-3" />
              </Button>
            </div>
            {checklist.map((step) => (
              <button
                key={step.label}
                type="button"
                onClick={step.go}
                disabled={step.done}
                className="border-line flex w-full items-center gap-2.5 border-b px-3 py-2 text-left text-xs transition-colors duration-100 last:border-b-0 enabled:hover:bg-surface-2 disabled:opacity-60"
              >
                {step.done ? (
                  <Check className="text-good size-3.5 shrink-0" />
                ) : (
                  <span className="border-line-strong size-3.5 shrink-0 rounded-full border" />
                )}
                <span
                  className={
                    step.done ? 'text-subtle min-w-0 flex-1 line-through' : 'text-fg min-w-0 flex-1'
                  }
                >
                  {step.label}
                </span>
                {!step.done && <ChevronRight className="text-subtle size-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        )}

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
                  {t(label)}
                  {data?.counts[section] !== undefined ? (
                    <span className="text-subtle font-mono text-xs font-normal">
                      {' '}
                      · {compact.format(data.counts[section]!)}
                    </span>
                  ) : (
                    // Only the tiles that will get a number keep space for
                    // one: Board and Editor are tools and never carry one.
                    data === null &&
                    section !== 'analysis' &&
                    section !== 'editor' && (
                      <Skeleton className="ml-1.5 inline-block h-2 w-5 align-middle" />
                    )
                  )}
                </span>
                <span className="text-subtle block text-xs leading-snug">{t(blurb)}</span>
              </span>
            </button>
          ))}
        </div>

        {/* Everything else, reachable: these five destinations had no way
            in from this page at all. */}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {MORE.map(({ label, icon: Icon, go }) => (
            <Button key={label} variant="ghost" size="sm" onClick={go}>
              <Icon className="size-3.5" />
              {t(label)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
