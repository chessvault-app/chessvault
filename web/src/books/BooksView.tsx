/**
 * The Books section: the library shelf, and a book open beside a board.
 *
 * Routes: #/books (the library), #/books/<id> (the reader, at the page it
 * was left on), #/books/<id>/<page> (the reader at a page).
 *
 * Only the route switch; the pages live beside it — data.ts (the model
 * and the calls every page shares), BooksPage (the shelf), BookReader
 * (the reader, with pdfViewer and DiagramHotspots under it).
 */
import { decodeSegment } from '@/lib/router';
import { BookReader } from './BookReader';
import { BooksPage } from './BooksPage';

export function BooksView({ params }: { params: string[] }) {
  const id = params[0] ? decodeSegment(params[0]) : null;
  if (id) return <BookReader key={id} id={id} page={params[1]} />;
  return <BooksPage />;
}
