/**
 * What this device learned about a book's pages last time it was open —
 * the first page's height over its width, how many there are, and
 * whether the file carried an outline — so the opening treatment can be
 * the page's own shape and the toolbar can say "/ 128" before the file
 * is back. Measured on the demo: a 3:4 guess stood 164px shorter than
 * the page at 1280px and 36px taller at 390px, and the centred toolbar
 * stepped 8px sideways when the count arrived.
 *
 * Here rather than in BookReader because the OUTLINE that stands in for
 * the reader while its chunk is on the wire reads it too, and the
 * reader's chunk is the one with pdf.js in it (books/BooksView.skeleton).
 */

export interface BookPageShape {
  aspect: number;
  pages: number;
  contents: boolean;
}

export const pageShapeKey = (id: string): string => `vault:book-page:${id}`;

/**
 * The reader's two device-wide choices, which decide its WIDE layout:
 * whether the board stands beside the page at all, and how much of the
 * row the page takes when it does. Read by the reader and by its outline.
 */
export const READER_BOARD_KEY = 'vault:reader:board';
export const READER_PANE_KEY = 'vault:panel-w:book-reader';
export const READER_PANE_DEFAULT_W = 560;

export const readReaderBoardShown = (): boolean => {
  try {
    return localStorage.getItem(READER_BOARD_KEY) !== 'off';
  } catch {
    return true;
  }
};

export const readReaderPaneWidth = (): number => {
  try {
    const stored = Number(localStorage.getItem(READER_PANE_KEY));
    return Number.isFinite(stored) && stored >= 320 ? stored : READER_PANE_DEFAULT_W;
  } catch {
    return READER_PANE_DEFAULT_W;
  }
};

export function parsePageShape(raw: string | null): BookPageShape | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as { aspect?: unknown; pages?: unknown; contents?: unknown };
    if (
      typeof v.aspect !== 'number' ||
      !(v.aspect > 0) ||
      typeof v.pages !== 'number' ||
      !(v.pages > 0)
    )
      return null;
    return { aspect: v.aspect, pages: v.pages, contents: v.contents === true };
  } catch {
    return null;
  }
}

export const readPageShape = (id: string): BookPageShape | null => {
  try {
    return parsePageShape(localStorage.getItem(pageShapeKey(id)));
  } catch {
    // Storage a browser has blocked throws on the read, and a reader is
    // not the place to find that out.
    return null;
  }
};
