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
import { KeepAlive } from '@/lib/keep-alive';
import { decodeSegment } from '@/lib/router';
import { Shelf } from './books/Shelf';
import { BookPage } from './books/BookPage';
import { BookTrainer } from './books/BookTrainer';
import { PuzzleCorrector } from './books/PuzzleEntry';

/**
 * The shelf and the book page are both lists, and both stay mounted
 * under what opens from them (lib/keep-alive): the shelf under a book,
 * the book under its trainer, so Back from a puzzle lands on the list of
 * puzzles where it was and Back again on the shelf. Two kept at once is
 * exactly that pair; the trainer and the corrector are not kept.
 */
export function BooksView({ params }: { params: string[] }) {
  // Route segments arrive URL-encoded ("Test%20Book").
  const slug = params[0] ? decodeSegment(params[0]) : null;
  const puzzleId = params[1] ? decodeSegment(params[1]) : null;
  const key = !slug ? 'shelf' : !puzzleId ? `book:${slug}` : `puzzle:${slug}/${params.slice(1).join('/')}`;
  return (
    <KeepAlive
      current={key}
      data={params}
      keep={(k) => k === 'shelf' || k.startsWith('book:')}
      budget={2}
      render={(k, p) => {
        const s = p[0] ? decodeSegment(p[0]) : null;
        const id = p[1] ? decodeSegment(p[1]) : null;
        if (k === 'shelf' || !s) return <Shelf />;
        // /books/<slug>/fix/<id>: correct an existing puzzle through entry flow.
        if (id === 'fix' && p[2]) {
          return <PuzzleCorrector key={`${s}/fix/${p[2]}`} slug={s} puzzleId={decodeSegment(p[2])} />;
        }
        if (id) return <BookTrainer key={`${s}/${id}`} slug={s} puzzleId={id} />;
        return <BookPage key={s} slug={s} />;
      }}
    />
  );
}
