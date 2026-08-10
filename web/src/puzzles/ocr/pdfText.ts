import type { TextPage, Word } from '@shared/bookImport';

/**
 * A PDF's text layer, in the shape the book importer reads.
 *
 * The dev pipeline gets this from pymupdf (scripts/ml/extract_pdf_words.py),
 * which hands over word boxes with a top-left origin. pdf.js hands over
 * RUNS of text with a bottom-left origin, so two things have to happen here
 * before the importer sees it, and both are why this is its own file with
 * its own tests rather than a few lines inside the scan loop.
 */

/** The shape of a pdf.js text item, without depending on its types. */
export interface PdfTextItem {
  str: string;
  /** [a, b, c, d, e, f]; e and f are the item's x and y. */
  transform: number[];
  width: number;
  height: number;
  /** pdf.js sets this when the item ends a line. */
  hasEOL?: boolean;
}

/**
 * Split a run into words, giving each the slice of the run's width that its
 * characters take up.
 *
 * pdf.js reports one width for the whole run, not per glyph, so a word's
 * box is proportional rather than measured. That is enough for everything
 * downstream: matching a number to the diagram beneath it, merging digits
 * a scan split apart, and finding a side letter under a number all work on
 * gaps and alignment, not on typographic exactness.
 */
function runWords(item: PdfTextItem, pageHeight: number): Word[] {
  const text = item.str;
  if (text.trim() === '') return [];
  const x = item.transform[4] ?? 0;
  const yBaseline = item.transform[5] ?? 0;
  const height = item.height || Math.abs(item.transform[3] ?? 0) || 1;
  // PDF space counts up from the bottom of the page; the importer counts
  // down from the top, like every render it will be compared against.
  const y0 = pageHeight - (yBaseline + height);
  const y1 = pageHeight - yBaseline;
  const perChar = text.length > 0 ? item.width / text.length : 0;

  const words: Word[] = [];
  const pattern = /\S+/g;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    words.push({
      text: m[0],
      x0: x + m.index * perChar,
      x1: x + (m.index + m[0].length) * perChar,
      y0,
      y1,
    });
  }
  return words;
}

/**
 * One page of text items -> the importer's page. Pure, so it is testable
 * without a PDF; `extractTextPage` below is the thin pdf.js wrapper.
 */
export function textPageFromItems(
  page: number,
  items: PdfTextItem[],
  size: { width: number; height: number },
): TextPage {
  const words: Word[] = [];
  let text = '';
  for (const item of items) {
    words.push(...runWords(item, size.height));
    text += item.str;
    // pymupdf's page text is line-broken, and the answers parser anchors on
    // line starts, so the newlines have to survive the crossing.
    if (item.hasEOL) text += '\n';
    else if (!/\s$/.test(item.str)) text += ' ';
  }
  return { page, width: size.width, words, text };
}

/** Minimal shape of the pdf.js page object this needs. */
interface PdfPageLike {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}

/** Read one page's text layer through pdf.js. */
export async function extractTextPage(page: PdfPageLike, pageNo: number): Promise<TextPage> {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  // Marked-content items carry no `transform`; they are structure, not text.
  const items = content.items.filter(
    (i): i is PdfTextItem => typeof (i as PdfTextItem).str === 'string' && Array.isArray((i as PdfTextItem).transform),
  );
  return textPageFromItems(pageNo, items, viewport);
}
