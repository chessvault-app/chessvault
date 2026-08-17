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

import {
  isValidTemplate,
  type Template,
} from '../ocr/classify';

export interface BookSummary {
  slug: string;
  title: string;
  puzzles: number;
  solved: number;
  failed: number;
  cover?: boolean;
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
}

export interface PuzzleProgress {
  tries: number;
  wins: number;
  last: 'win' | 'loss';
  at: string;
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
  puzzles: BookPuzzle[];
  progress: Record<string, PuzzleProgress>;
  drafts?: BookDraft[];
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

export const diagramUrl = (slug: string, file: string): string =>
  `/api/puzzlebooks/${encodeURIComponent(slug)}/diagrams/${file}`;

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
    "next unsolved" stay correct without a refetch. */
export function patchProgress(slug: string, id: string, progress: PuzzleProgress): BookDetail | null {
  const hit = bookCache.get(slug);
  if (!hit) return null;
  const next = { ...hit, progress: { ...hit.progress, [id]: progress } };
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
  title: "The book's exact solution — parsed and verified, or entered by hand",
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
    title: 'Engine best line only — nothing decisive found; check the source if it feels off',
    icon: CircleHelp,
    iconClass: 'text-warn',
  },
  // Least confident of all: an imported diagram with no solution yet. Opening
  // one goes to the draft editor, not the solver.
  draft: {
    label: 'Draft',
    title: 'Imported diagram awaiting a solution — open it to enter one',
    icon: Pencil,
    iconClass: 'text-subtle',
  },
} as const;
