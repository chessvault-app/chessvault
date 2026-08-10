"""Dump a PDF's text layer as words with boxes (PDF point coords).

This is what the puzzle importer reads: the numbers printed above the
diagrams, and the solutions text. Nothing here is specific to a book —
a word box is a word box.

Usage: python extract_pdf_words.py <book.pdf> <out.json>
"""
import json
import sys

import pymupdf


def main():
    doc = pymupdf.open(sys.argv[1])
    pages = []
    for n, page in enumerate(doc):
        words = [
            {'x0': w[0], 'y0': w[1], 'x1': w[2], 'y1': w[3], 'text': w[4]}
            for w in page.get_text('words')
        ]
        pages.append({'page': n + 1, 'width': page.rect.width, 'height': page.rect.height,
                      'words': words, 'text': page.get_text()})
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump({'pages': pages}, f)
    print(f'{len(pages)} pages -> {sys.argv[2]}')


if __name__ == '__main__':
    main()
