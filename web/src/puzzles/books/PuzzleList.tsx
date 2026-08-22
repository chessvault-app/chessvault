import { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { navigate } from '@/lib/router';

import { Select } from '@/components/ui/select';

import { ProgressBar } from '@/components/progress-bar';

import { t } from '@/lib/i18n';
import {
  type BookDraft,
  type BookPuzzle,
  type PuzzleProgress,
  PROVENANCE_META,
} from './data';

/**
 * The book's puzzle grid, revealed from the Puzzle panel's header the way
 * the lichess trainer reveals its difficulty row — a jump pad, not a
 * permanent panel. Cards show number, tier and state; the current puzzle
 * is highlighted and scrolled into view.
 */
export function PuzzleGrid({
  slug,
  puzzles,
  progress,
  currentId,
}: {
  slug: string;
  puzzles: BookPuzzle[];
  progress: Record<string, PuzzleProgress>;
  currentId: string;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);
  // puzzles.length in the deps: the book loads async, so the row to scroll
  // to may not exist on the first run.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, [currentId, puzzles.length]);
  const go = (index: number): void => {
    const target = puzzles[index];
    if (target) navigate('puzzles', 'books', slug, target.id);
  };
  return (
    <div className="max-h-60 overflow-y-auto overscroll-contain p-2">
        {/* Same card language as the book page, at panel scale: state
            colours the tile, the corner icon is the fidelity tier, and the
            current puzzle wears the primary ring. */}
        <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(2.5rem,1fr))]">
          {puzzles.map((p, i) => {
            const last = progress[p.id]?.last;
            const current = p.id === currentId;
            const meta =
              p.provenance && p.provenance in PROVENANCE_META
                ? PROVENANCE_META[p.provenance as keyof typeof PROVENANCE_META]
                : null;
            const prog = progress[p.id];
            return (
              <button
                key={p.id}
                ref={current ? currentRef : undefined}
                type="button"
                onClick={() => go(i)}
                title={[
                  meta ? `${t(meta.label)} — ${t(meta.title)}` : null,
                  prog ? t('{wins}/{tries} tries', { wins: prog.wins, tries: prog.tries }) : t('not attempted'),
                ]
                  .filter(Boolean)
                  .join('\n')}
                className={cn(
                  'relative flex aspect-square items-center justify-center rounded-lg border font-mono text-xs font-semibold transition-colors duration-100 [content-visibility:auto]',
                  current && 'ring-primary/60 ring-2',
                  last === 'win'
                    ? 'bg-nag-good/15 border-nag-good/40 text-nag-good'
                    : last === 'loss'
                      ? 'bg-nag-blunder/15 border-nag-blunder/40 text-nag-blunder'
                      : 'bg-card border-border text-muted-foreground hover:border-border-strong hover:bg-accent',
                )}
              >
                {p.number ?? i + 1}
                {/* State by glyph as well as tint — the colour grammar's
                    own rule; a tile that is only a colour is unreadable
                    to 1 in 12 people. */}
                {(last === 'win' || last === 'loss') && (
                  <span className="absolute bottom-0.5 left-1 text-[0.5rem] leading-none" aria-hidden>
                    {last === 'win' ? '✓' : '✗'}
                  </span>
                )}
                {meta && (
                  <meta.icon
                    className={cn('absolute right-1 top-1 size-2.5', meta.iconClass)}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>
    </div>
  );
}

/** Tailwind's sm breakpoint, where the grid goes from six columns to eight. */
const GRID_SM = '(min-width: 40rem)';
/** gap-2 in pixels. */
const GRID_GAP = 8;
/** Rows kept beyond the viewport, so a fast scroll does not outrun it. */
const OVERSCAN = 6;

/**
 * Which slice of a square-tile grid is worth building.
 *
 * A big book is five thousand tiles, each a button carrying an icon, and
 * React spent most of a second creating them all before the page could be
 * seen — content-visibility skips PAINTING what is offscreen but not
 * building it. So only the rows near the viewport are built, and the rest
 * are two spacers holding the scrollbar honest.
 *
 * Measured from the grid's own box rather than a scroll container, because
 * which ancestor scrolls differs between the phone and desktop layouts.
 */
function useGridWindow(
  grid: React.RefObject<HTMLDivElement | null>,
  total: number,
): { start: number; end: number; top: number; bottom: number } {
  // Starts NARROW. Seeding this with the whole book meant the first render
  // built every tile and only then measured — which is the cost this hook
  // exists to avoid. A screenful is a safe guess before anything is
  // measured, and the effect corrects it on the same frame.
  const [slice, setSlice] = useState(() => ({
    start: 0,
    end: Math.min(total, 200),
    top: 0,
    bottom: 0,
  }));
  useEffect(() => {
    /**
     * Only ever set state when the answer CHANGED.
     *
     * A ResizeObserver watching the grid calls this, and this resizes the
     * grid — so handing React a fresh object every time is a loop that
     * re-renders itself forever: the app goes blank and the window stops
     * responding. Scroll events have the same problem more quietly, one
     * wasted render per event.
     */
    const update = (next: { start: number; end: number; top: number; bottom: number }): void =>
      setSlice((previous) =>
        previous.start === next.start &&
        previous.end === next.end &&
        previous.top === next.top &&
        previous.bottom === next.bottom
          ? previous
          : next,
      );
    const measure = (): void => {
      const el = grid.current;
      if (!el) return;
      const columns = globalThis.matchMedia(GRID_SM).matches ? 8 : 6;
      const cell = (el.clientWidth - GRID_GAP * (columns - 1)) / columns + GRID_GAP;
      // Unmeasurable (hidden, zero-width, mid-layout): show the whole book
      // rather than a slice of it. Slow beats blank.
      if (!(cell > 0)) {
        update({ start: 0, end: total, top: 0, bottom: 0 });
        return;
      }
      const rows = Math.ceil(total / columns);
      const above = Math.max(0, -el.getBoundingClientRect().top);
      const firstRow = Math.max(0, Math.floor(above / cell) - OVERSCAN);
      const visibleRows = Math.ceil(globalThis.innerHeight / cell) + OVERSCAN * 2;
      const lastRow = Math.min(rows, firstRow + visibleRows);
      update({
        start: firstRow * columns,
        end: Math.min(total, lastRow * columns),
        top: firstRow * cell,
        bottom: Math.max(0, (rows - lastRow) * cell),
      });
    };
    measure();
    // Listen on the element that actually scrolls as well as on the window
    // in capture. Either alone is nearly enough — which is the problem: a
    // missed event here does not degrade the grid, it empties it, so it is
    // worth wearing both.
    const scrollers: EventTarget[] = [globalThis];
    for (let el = grid.current?.parentElement; el; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') scrollers.push(el);
    }
    for (const target of scrollers) target.addEventListener('scroll', measure, { passive: true });
    globalThis.addEventListener('scroll', measure, true);
    globalThis.addEventListener('resize', measure);
    // Last line of defence: the grid's own size settling (fonts, images,
    // a filter changing the count) without any scroll at all.
    const observer = new ResizeObserver(measure);
    if (grid.current) observer.observe(grid.current);
    return () => {
      for (const target of scrollers) target.removeEventListener('scroll', measure);
      globalThis.removeEventListener('scroll', measure, true);
      globalThis.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [grid, total]);
  return slice;
}

/**
 * The book's puzzles as an information-dense, filterable list: number,
 * fidelity tier, goal, attempt history — filters double as the tier
 * legend (each chip carries its description as a tooltip).
 */
export function PuzzleList({
  slug,
  puzzles,
  drafts,
  progress,
  solvedCount,
  onDraft,
}: {
  slug: string;
  puzzles: BookPuzzle[];
  drafts: BookDraft[];
  progress: Record<string, PuzzleProgress>;
  solvedCount: number;
  onDraft: (d: BookDraft) => void;
}) {
  const [stateFilter, setStateFilter] = useState<'all' | 'new' | 'failed' | 'solved'>('all');
  // Tier filtering groups by label, so provenances sharing a tier
  // ('book-parsed' + 'corrected') count and filter as one chip.
  const [tierFilter, setTierFilter] = useState<'all' | string>('all');

  // Drafts live in the same list, as their own 'Draft' tier — rendered as
  // pseudo-puzzles so one grid/filter machinery serves both. A click on a
  // draft routes to the editor (see onClick), not the solver.
  const stateOf = (p: BookPuzzle): 'new' | 'failed' | 'solved' => {
    const last = progress[p.id]?.last;
    return last === 'win' ? 'solved' : last === 'loss' ? 'failed' : 'new';
  };
  const metaOf = (p: BookPuzzle) =>
    p.provenance && p.provenance in PROVENANCE_META
      ? PROVENANCE_META[p.provenance as keyof typeof PROVENANCE_META]
      : null;
  type TierMeta = (typeof PROVENANCE_META)[keyof typeof PROVENANCE_META];

  // One pass builds the merged list AND its tier/state tallies — this list
  // can be ~1,000 entries, and the old shape scanned it once per tier plus
  // once per tile for numbering.
  const draftIds = useMemo(() => new Set(drafts.map((d) => d.id)), [drafts]);
  const { items, tiers, stateCounts } = useMemo(() => {
    const merged: BookPuzzle[] = [
      ...puzzles,
      ...drafts.map((d) => ({
        id: d.id,
        number: d.number,
        fen: d.fen ?? '',
        uci: [],
        san: [],
        provenance: 'draft' as const,
        evidence: d.evidence,
      })),
    ].sort((a, b) => (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER));

    const tierTally = new Map<string, { meta: TierMeta; count: number }>();
    const states = { all: merged.length, new: 0, failed: 0, solved: 0 };
    for (const p of merged) {
      states[stateOf(p)]++;
      const meta = metaOf(p);
      if (!meta) continue;
      const entry = tierTally.get(meta.label);
      if (entry) entry.count += 1;
      else tierTally.set(meta.label, { meta, count: 1 });
    }
    // Tier chips render in PROVENANCE_META's key order (confidence order),
    // exactly as the per-key scans produced before.
    const ordered = new Map<string, { meta: TierMeta; count: number }>();
    for (const key of Object.keys(PROVENANCE_META) as (keyof typeof PROVENANCE_META)[]) {
      const label = PROVENANCE_META[key].label;
      const entry = tierTally.get(label);
      if (entry && !ordered.has(label)) ordered.set(label, entry);
    }
    return { items: merged, tiers: ordered, stateCounts: states };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzles, drafts, progress]);
  // Unnumbered entries fall back to their list ordinal; a Map beats an
  // indexOf per rendered tile.
  const ordinalOf = useMemo(() => new Map(items.map((p, i) => [p.id, i + 1])), [items]);

  const visible = items.filter(
    (p) =>
      (stateFilter === 'all' || stateOf(p) === stateFilter) &&
      (tierFilter === 'all' || metaOf(p)?.label === tierFilter),
  );

  const grid = useRef<HTMLDivElement>(null);
  const window_ = useGridWindow(grid, visible.length);

  return (
    <>
      <ProgressBar
        total={puzzles.length}
        solved={solvedCount}
        failed={stateCounts.failed}
        className="mb-3"
      />
      {/*
        Two menus, not two runs of pills in one row — the same shape the
        puzzle dashboard uses. State and fidelity are separate questions,
        and as chips they shared a line with a hairline between them, two
        lit at once and nothing saying which lit chip answered which. A
        menu names its own subject, and carries the count of what it
        would leave.
        The tier icons do not come along: an option row is text. They stay
        where they carry meaning — on the tiles themselves, where the
        shape is how a tier is told apart without relying on colour.
      */}
      <div className="mb-2 flex items-center gap-2">
        <Select
          value={stateFilter}
          onValueChange={(v) => setStateFilter(v as typeof stateFilter)}
          ariaLabel={t('Filter by state')}
          size="sm"
          prefix="Status"
          steady
          groups={[
            {
              options: ([
                ['all', 'All'],
                ['new', 'New'],
                ['failed', 'Failed'],
                ['solved', 'Solved'],
              ] as const).map(([id, label]) => ({
                value: id,
                label: stateCounts[id] === undefined ? label : `${label} (${stateCounts[id]})`,
                short: label,
              })),
            },
          ]}
        />
        {tiers.size > 0 && (
          <Select
            value={tierFilter}
            onValueChange={(v) => setTierFilter(v)}
            ariaLabel={t('Filter by how the puzzle was verified')}
            size="sm"
            prefix="Fidelity"
            steady
            groups={[
              {
                options: [
                  { value: 'all', label: 'Any' },
                  // Map insertion follows meta-key order = confidence order.
                  ...[...tiers.values()].map(({ meta, count }) => ({
                    value: meta.label,
                    label: `${t(meta.label)} (${count})`,
                    short: t(meta.label),
                  })),
                ],
              },
            ]}
          />
        )}
      </div>
      <div ref={grid} className="grid grid-cols-6 gap-2 sm:grid-cols-8">
        {/* The rows above the viewport, as one spacer that spans the grid.
            content-visibility already skipped PAINTING them; this skips
            building them, which is the part that cost most of a second on
            a five-thousand-puzzle book. */}
        {window_.top > 0 && <div style={{ gridColumn: '1/-1', height: window_.top }} />}
        {visible.slice(window_.start, window_.end).map((p) => {
          const state = stateOf(p);
          const meta =
            p.provenance && p.provenance in PROVENANCE_META
              ? PROVENANCE_META[p.provenance as keyof typeof PROVENANCE_META]
              : null;
          const prog = progress[p.id];
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                const d = draftIds.has(p.id) ? drafts.find((x) => x.id === p.id) : null;
                if (d) onDraft(d);
                else navigate('puzzles', 'books', slug, p.id);
              }}
              title={[
                meta ? `${t(meta.label)} — ${t(meta.title)}` : null,
                prog ? `${prog.wins}/${prog.tries} tries` : 'not attempted',
              ]
                .filter(Boolean)
                .join('\n')}
              className={cn(
                // content-visibility: ~1,000 offscreen tiles skip render
                // work entirely — phones feel it.
                'relative flex aspect-square items-center justify-center rounded-lg border font-mono text-base font-semibold transition-colors duration-100 [content-visibility:auto]',
                state === 'solved'
                  ? 'bg-nag-good/15 border-nag-good/40 text-nag-good'
                  : state === 'failed'
                    ? 'bg-nag-blunder/15 border-nag-blunder/40 text-nag-blunder'
                    : 'bg-card border-border text-muted-foreground hover:border-border-strong hover:bg-accent',
              )}
            >
              {p.number ?? ordinalOf.get(p.id)}
              {/* Same glyph redundancy as the panel grid: tint alone is
                  invisible to colour-blind eyes. */}
              {(state === 'solved' || state === 'failed') && (
                <span className="absolute bottom-1 left-1.5 text-[0.625rem] leading-none" aria-hidden>
                  {state === 'solved' ? '✓' : '✗'}
                </span>
              )}
              {meta && (
                <meta.icon
                  className={cn('absolute right-2 top-2 size-3', meta.iconClass)}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
        {window_.bottom > 0 && <div style={{ gridColumn: '1/-1', height: window_.bottom }} />}
      </div>
      {visible.length === 0 && (
        <p className="text-subtle px-3 py-6 text-center text-sm">{t('Nothing matches these filters.')}</p>
      )}
    </>
  );
}
