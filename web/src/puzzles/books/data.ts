import {
  BadgeCheck,
  BookOpenCheck,
  CircleHelp,
  Cpu,
  Pencil,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { parseFen } from 'chessops/fen';

import { api, ApiError } from '@/lib/api';
import { cycleAttempt, reviewDueAt, type CycleWindow } from '@shared/review';

export type { CycleWindow };

import {
  isValidTemplate,
  type Template,
} from '../ocr/classify';
import { localDiagram } from './localDiagrams.ts';

export interface BookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
  /** Puzzles whose review date has come — see shared/review.ts. */
  due?: number;
  /** The pass still running, when one is: its ordinal and first-attempt
      numbers, so the shelf can say where each book's rotation stands. */
  cycle?: { n: number; attempted: number; wins: number } | null;
  cover?: boolean;
  /** The library book holding this book's PDF, while it still does. */
  pdfBook?: string | null;
}

/**
 * A puzzle AS THE GRID KNOWS IT. The position and its solution are not
 * here: a book's list exists to draw numbered tiles, and shipping every
 * position and line to do that is most of what a big book weighs. They
 * come from /solutions the moment something actually solves.
 */
export interface BookPuzzle {
  id: string;
  /** Auto-imported puzzles carry their book number, fidelity tier and the
   *  source page (with the diagram's bounds as page fractions) so the
   *  original context is one click away. */
  number?: number;
  provenance?:
    | 'book-parsed'
    | 'engine-corroborated'
    | 'engine-only'
    | 'engine-unverified'
    | 'corrected'
    | 'draft';
  evidence?: BookEvidence;
}

/** The half of a puzzle only the solver and the corrector need. */
export interface PuzzleSolution {
  fen: string;
  uci: string[];
  san: string[];
  wildcards?: number[];
}

export type SourceRect = { x: number; y: number; w: number; h: number };

export interface BookEvidence {
  page?: string;
  rect?: SourceRect;
  /** The solutions page covering this puzzle's number (page-level match). */
  solutionPage?: string;
  /** The whole answers section, for an entry with no number to match on. */
  solutionPages?: string[];
}

export interface PuzzleProgress {
  tries: number;
  wins: number;
  last: 'win' | 'loss';
  at: string;
  /** Every attempt in order, for the review ladder; entries written
      before histories existed carry only the counters. */
  history?: { win: boolean; at: string }[];
}

/**
 * A progress entry's attempts as the ladder reads them — the server's
 * attemptsOf, mirrored: an entry with no history is its own last attempt,
 * so a legacy loss enters rotation at the ladder's foot and a legacy
 * solve stays retired.
 */
const attemptsOf = (entry: PuzzleProgress | undefined): { win: boolean; at: string }[] =>
  entry === undefined ? [] : (entry.history ?? [{ win: entry.last === 'win', at: entry.at }]);

/**
 * The ids due for review now, in the book's printed order — the client's
 * copy of the server's ?mode=review answer, computed locally because the
 * book detail already carries every progress entry and the trainer wants
 * the whole queue (its Next review button chains through it), not one
 * puzzle at a time.
 */
export function dueBookPuzzles(book: BookDetail): string[] {
  const now = new Date().toISOString();
  return book.puzzles
    .filter((p) => {
      const due = reviewDueAt(attemptsOf(book.progress[p.id]));
      return due !== null && due <= now;
    })
    .map((p) => p.id);
}

export interface BookDraft {
  id: string;
  image: string;
  fen: string | null;
  number?: number;
  evidence?: BookEvidence;
}

export interface BookDetail {
  slug: string;
  title: string;
  /** The library book holding this book's PDF, while it still does. */
  pdfBook?: string | null;
  puzzles: BookPuzzle[];
  progress: Record<string, PuzzleProgress>;
  /** Woodpecker pass windows; every cycle number derives from these and
      the progress histories (see cyclePass). */
  cycles?: CycleWindow[];
  drafts?: BookDraft[];
}

/** One puzzle through one pass's window: its FIRST attempt inside the
    window, or null where the pass has not met it yet. The grid reads
    tile state through this while a cycle is open, so starting a pass
    visibly clears the board. */
export function cycleFirstAttempt(
  entry: PuzzleProgress | undefined,
  cycle: CycleWindow,
): { win: boolean } | null {
  return cycleAttempt(attemptsOf(entry), cycle);
}

/** The pass still running, if one is — the last window not yet closed. */
export function openCycle(book: BookDetail): CycleWindow | null {
  return book.cycles?.find((c) => c.finishedAt === undefined) ?? null;
}

/** One pass's numbers, derived from the histories inside its window.
    First attempts only: a retry after seeing the answer is practice,
    not a better score. */
export function cyclePass(
  book: BookDetail,
  cycle: CycleWindow,
): { attempted: number; wins: number } {
  let attempted = 0;
  let wins = 0;
  for (const p of book.puzzles) {
    const first = cycleAttempt(attemptsOf(book.progress[p.id]), cycle);
    if (first === null) continue;
    attempted++;
    if (first.win) wins++;
  }
  return { attempted, wins };
}

/** The first puzzle the open pass has not reached, in printed order. */
export function nextInCycle(book: BookDetail, cycle: CycleWindow): string | null {
  return (
    book.puzzles.find((p) => cycleAttempt(attemptsOf(book.progress[p.id]), cycle) === null)?.id ??
    null
  );
}

export async function bookTemplates(slug: string): Promise<Template[]> {
  try {
    const body = await api<{ templates: unknown[] }>(
      `/api/puzzlebooks/${encodeURIComponent(slug)}/ocr`,
    );
    return body.templates.filter(isValidTemplate);
  } catch {
    return [];
  }
}

/** One position's place in the book, for the reader's hotspots. */
export interface Placement {
  id: string;
  page: number;
  rect?: SourceRect;
  fen: string;
}

export async function loadPlacements(slug: string): Promise<Placement[]> {
  try {
    const body = await api<{ placements: Placement[] }>(
      `/api/puzzlebooks/${encodeURIComponent(slug)}/placements`,
    );
    return body.placements;
  } catch {
    return [];
  }
}

/**
 * Where a book's diagram image lives.
 *
 * An `<img src>` is a resource load, not a fetch, so a backend that lives
 * inside the page cannot answer one — see localDiagrams.ts for the one
 * caller that puts images there instead.
 */
export const diagramUrl = (slug: string, file: string): string =>
  localDiagram(slug, file) ?? `/api/puzzlebooks/${encodeURIComponent(slug)}/diagrams/${file}`;

/**
 * One book detail per slug, shared by the shelf page, the solver and the
 * corrector. Stepping between puzzles remounts the trainer (it is keyed on
 * the puzzle id), which used to re-download the WHOLE book — every puzzle's
 * position, solution and evidence — just to show the next one.
 *
 * Integrity: the only field that changes while a book is open is progress,
 * and the attempt route returns the updated entry, so it is patched in
 * exactly rather than guessed. Anything that rewrites puzzles or drafts
 * (import, re-read, a correction, a delete) calls forgetBook, so the next
 * read is fresh. A reload starts empty.
 */
const bookCache = new Map<string, BookDetail>();

/**
 * One puzzle's evidence, fetched when something wants to show it.
 *
 * Evidence is no longer part of the book download — it was the heaviest
 * thing a book carried and the grid never reads it — so anything that
 * DOES read it asks for its own. Both the solver (which offers a peek at
 * the scan) and the corrector (which shows it beside the board) go
 * through here, and a puzzle already looked at costs nothing.
 */
const evidenceCache = new Map<string, BookEvidence | undefined>();

export function usePuzzleEvidence(slug: string, id: string | undefined): BookEvidence | undefined {
  const key = id ? `${slug}/${id}` : '';
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id || evidenceCache.has(key)) return;
    let live = true;
    void (async () => {
      try {
        const body =
          (await api<{ evidence?: BookEvidence } | undefined>(
            `/api/puzzlebooks/${encodeURIComponent(slug)}/puzzles/${encodeURIComponent(id)}/evidence`,
          )) ?? {};
        evidenceCache.set(key, body.evidence);
      } catch (e) {
        // A missing scan is a missing button, not a broken puzzle: the
        // server SAYING no is remembered as no evidence. But a transient
        // network failure must not be — the next look simply asks again.
        if (e instanceof ApiError && e.status !== 0) evidenceCache.set(key, undefined);
      }
      if (live) bump((n) => n + 1);
    })();
    return () => {
      live = false;
    };
  }, [slug, id, key]);
  return key ? evidenceCache.get(key) : undefined;
}

/** Positions and lines, fetched once per book when something solves. */
const solutionCache = new Map<string, Record<string, PuzzleSolution>>();

/**
 * The shelf as it was last drawn, so returning to it is not a redraw —
 * and whether covers were decoded once already. A mutable holder rather
 * than two module lets, because the Shelf page (which reads and writes
 * it) and forgetBook (which clears it) live in different modules now.
 */
export const shelfMemory = {
  books: null as BookSummary[] | null,
  coversDecoded: false,
};

export function forgetBook(slug?: string): void {
  // The shelf shows each book's puzzle and progress counts, so whatever
  // invalidates a book invalidates the shelf's summary of it too.
  shelfMemory.books = null;
  if (slug === undefined) {
    bookCache.clear();
    solutionCache.clear();
  } else {
    bookCache.delete(slug);
    solutionCache.delete(slug);
  }
}

/**
 * The book's positions and solutions — one request, cached like the book.
 *
 * One request rather than one per puzzle on purpose: stepping between
 * puzzles has to stay instant, and the goal is to keep this weight off the
 * path that merely OPENS a book, not to trade one wait for a hundred.
 */
export async function loadSolutions(slug: string): Promise<Record<string, PuzzleSolution>> {
  const hit = solutionCache.get(slug);
  if (hit) return hit;
  try {
    const body = await api<{ solutions?: Record<string, PuzzleSolution> } | undefined>(
      `/api/puzzlebooks/${encodeURIComponent(slug)}/solutions`,
    );
    const solutions = body?.solutions ?? {};
    // One corrupt fen in vault data must cost ONE puzzle, not the book:
    // the trainer and the judge unwrap() these, and a single bad row
    // white-paged the whole trainer. A dropped entry degrades to the
    // same "no solution recorded" path a draft takes.
    for (const [id, solution] of Object.entries(solutions)) {
      if (!parseFen(solution.fen).isOk) {
        console.warn(`[books] puzzle ${id} in ${slug} has an unreadable position; skipping it`);
        delete solutions[id];
      }
    }
    solutionCache.set(slug, solutions);
    return solutions;
  } catch {
    return {};
  }
}

export async function loadBook(slug: string, force = false): Promise<BookDetail | null> {
  if (!force) {
    const hit = bookCache.get(slug);
    if (hit) return hit;
  }
  let detail: BookDetail | undefined;
  try {
    detail = await api<BookDetail | undefined>(`/api/puzzlebooks/${encodeURIComponent(slug)}`);
  } catch (e) {
    // A thrown fetch used to escape every caller and pin the view on its
    // skeleton with nothing to say. Offline (status 0), the cached copy
    // (even a force-refresh wanted fresher) beats both that and an error;
    // the server actually refusing stays "no such book".
    if (e instanceof ApiError && e.status === 0) return bookCache.get(slug) ?? null;
    return null;
  }
  // A success with no body is not a book; only a real one may be cached.
  if (!detail) return null;
  bookCache.set(slug, detail);
  return detail;
}

/** Fold a recorded attempt into the cached book, so the grid and
    "next unsolved" stay correct without a refetch. The attempt route
    sends the pass windows back when the book has any — a pass can close
    ITSELF on the attempt that completes it, and the cache must agree. */
export function patchProgress(
  slug: string,
  id: string,
  progress: PuzzleProgress,
  cycles?: CycleWindow[],
): BookDetail | null {
  const hit = bookCache.get(slug);
  if (!hit) return null;
  const next = {
    ...hit,
    progress: { ...hit.progress, [id]: progress },
    ...(cycles ? { cycles } : {}),
  };
  bookCache.set(slug, next);
  return next;
}

/** Fold a started or stopped pass into the cached book, patchProgress-style. */
export function patchCycles(slug: string, cycles: CycleWindow[]): BookDetail | null {
  const hit = bookCache.get(slug);
  if (!hit) return null;
  const next = { ...hit, cycles };
  bookCache.set(slug, next);
  return next;
}

/**
 * Where a puzzle's solution came from, in words a stranger can read.
 * Key order IS the confidence order — filter chips render in it. Tile
 * markers are shape-coded icons on a hue ladder that stays clear of the
 * solved/failed green and red: blue (trusted) → teal (corroborated) →
 * purple (plain engine) → amber (caution).
 *
 * 'book-parsed' and 'corrected' share one tier: both are the book's
 * exact solution, one read by the importer and one entered by a human
 * (lanph3re's call — same guarantee, same tag).
 */
const BOOK_TIER = {
  label: 'Book solution',
  title: "The book's exact solution, parsed and verified or entered by hand",
  icon: BookOpenCheck,
  iconClass: 'text-info',
} as const;

export const PROVENANCE_META = {
  'book-parsed': BOOK_TIER,
  corrected: BOOK_TIER,
  'engine-corroborated': {
    label: 'Engine + book',
    title: 'Engine solution, corroborated by the book text',
    icon: BadgeCheck,
    iconClass: 'text-nag-brilliant',
  },
  'engine-only': {
    label: 'Engine solution',
    title: 'Engine solution (decisive line, no text corroboration)',
    icon: Cpu,
    iconClass: 'text-nag-interesting',
  },
  'engine-unverified': {
    label: 'Engine guess',
    title: 'Engine best line only, nothing decisive found. Check the source if it feels off.',
    icon: CircleHelp,
    iconClass: 'text-warn',
  },
  // Least confident of all: an imported diagram with no solution yet. Opening
  // one goes to the draft editor, not the solver.
  draft: {
    label: 'Draft',
    title: 'Imported diagram awaiting a solution. Open it to enter one.',
    icon: Pencil,
    iconClass: 'text-muted-foreground',
  },
} as const;
