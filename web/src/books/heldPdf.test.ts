import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it } from 'vitest';

import { dropPdf, heldBookKey, holdPdf, pdfKey, takePdf } from './heldPdf';

/**
 * A stand-in for an open document that records being torn down. Only the
 * one call this module makes is real; everything else about a
 * PDFDocumentProxy is beside the point here.
 */
function fakeDoc(): PDFDocumentProxy & { destroyed: number } {
  const doc = {
    destroyed: 0,
    loadingTask: {
      destroy: () => {
        doc.destroyed += 1;
        return Promise.resolve();
      },
    },
  };
  return doc as unknown as PDFDocumentProxy & { destroyed: number };
}

afterEach(() => dropPdf());

describe('the held document', () => {
  it('gives a book back to the same book', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    expect(takePdf(pdfKey('b1', 100))).toBe(doc);
    // Taken means gone: the reader that took it owns it now.
    expect(takePdf(pdfKey('b1', 100))).toBeNull();
    expect(doc.destroyed).toBe(0);
  });

  it('does not answer for a different book, or a different file', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    expect(takePdf(pdfKey('b2', 100))).toBeNull();
    // The same book, a replaced file: a different length is a different key.
    expect(takePdf(pdfKey('b1', 200))).toBeNull();
    expect(takePdf(pdfKey('b1', 100))).toBe(doc);
  });

  it('holds one book, and closes the one it replaces', () => {
    const first = fakeDoc();
    const second = fakeDoc();
    holdPdf(pdfKey('b1', 100), first);
    holdPdf(pdfKey('b2', 100), second);
    expect(first.destroyed).toBe(1);
    expect(second.destroyed).toBe(0);
    expect(takePdf(pdfKey('b1', 100))).toBeNull();
    expect(takePdf(pdfKey('b2', 100))).toBe(second);
  });

  it('holding the same document twice does not close it', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    holdPdf(pdfKey('b1', 100), doc);
    expect(doc.destroyed).toBe(0);
    expect(takePdf(pdfKey('b1', 100))).toBe(doc);
  });

  it('drops a named book, and closes it', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    // A replaced file of exactly the same length: the key would still
    // match, so the length cannot be what decides this.
    dropPdf('b1');
    expect(doc.destroyed).toBe(1);
    expect(takePdf(pdfKey('b1', 100))).toBeNull();
  });

  it('leaves another book alone when one is dropped', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    dropPdf('b2');
    expect(doc.destroyed).toBe(0);
    expect(heldBookKey()).toBe(pdfKey('b1', 100));
  });

  it('drops whatever is held when no book is named', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    dropPdf();
    expect(doc.destroyed).toBe(1);
    expect(heldBookKey()).toBeNull();
    // And dropping nothing is not an error.
    expect(() => dropPdf()).not.toThrow();
  });

  it('does not confuse a book whose id is a prefix of another', () => {
    const doc = fakeDoc();
    holdPdf(pdfKey('b1', 100), doc);
    dropPdf('b');
    expect(doc.destroyed).toBe(0);
    expect(heldBookKey()).toBe(pdfKey('b1', 100));
  });
});
