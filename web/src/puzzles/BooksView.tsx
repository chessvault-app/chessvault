/**
 * Book puzzles (lanph3re's long-wanted feature): positions transcribed from
 * paper books, trained STRICTLY — the solver enters every move of the
 * solution, both sides, no auto-replies — with per-book progress. v1 is
 * manual board entry; diagram OCR is the planned v2.
 *
 * Routes: #/puzzles/books (shelf), /books/<slug> (book), /books/<slug>/<id>
 * (trainer).
 *
 * This file is only the route switch; the pages live in books/ — data.ts
 * (model + caches, the one module every page shares), Shelf, BookPage,
 * PuzzleList, PuzzleEntry (entry + correction), evidence (the scan
 * viewers) and BookTrainer.
 */
import { Shelf } from './books/Shelf';
import { BookPage } from './books/BookPage';
import { pageKeyOf } from './books/data';
import { BookTrainer } from './books/BookTrainer';
import { PuzzleCorrector } from './books/PuzzleEntry';

export function BooksView({ params }: { params: string[] }) {
  // Route segments arrive URL-encoded ("Test%20Book").
  const slug = params[0] ? decodeURIComponent(params[0]) : null;
  const puzzleId = params[1] ? decodeURIComponent(params[1]) : null;
  // /books/<slug>/fix/<id>: correct an existing puzzle through entry flow.
  if (slug && puzzleId === 'fix' && params[2]) {
    return (
      <PuzzleCorrector
        key={`${slug}/fix/${params[2]}`}
        slug={slug}
        puzzleId={decodeURIComponent(params[2])}
      />
    );
  }
  if (slug && puzzleId) {
    return <BookTrainer key={`${slug}/${puzzleId}`} slug={slug} puzzleId={puzzleId} />;
  }
  // pageKeyOf, not the slug: a rename changes the slug and must not
  // remount the page under an open import window. See books/data.ts.
  if (slug) return <BookPage key={pageKeyOf(slug)} slug={slug} />;
  return <Shelf />;
}
