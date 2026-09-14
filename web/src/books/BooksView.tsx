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
import { KeepAlive } from '@/lib/keep-alive';
import { decodeSegment } from '@/lib/router';
import { BookReader } from './BookReader';
import { BooksPage } from './BooksPage';

/** The shelf stays mounted under an open book (lib/keep-alive), so Back
    lands on it as it was left; the reader, with its pdf.js pages, is
    keyed by id and not kept. */
export function BooksView({ params }: { params: string[] }) {
  const id = params[0] ? decodeSegment(params[0]) : null;
  return (
    <KeepAlive
      current={id ? `book:${id}` : 'shelf'}
      data={params}
      keep={(key) => key === 'shelf'}
      budget={1}
      render={(key, p) => {
        const bookId = p[0] ? decodeSegment(p[0]) : null;
        if (key === 'shelf' || bookId === null) return <BooksPage />;
        return <BookReader key={bookId} id={bookId} page={p[1]} />;
      }}
    />
  );
}
