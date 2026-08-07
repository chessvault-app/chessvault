"""Dump the 1001 book's text layer with word boxes (PDF point coords) for
the auto-import measurement: puzzle-number labels above diagrams, and the
solutions text. Usage: python extract_1001_text.py <book.pdf> <out.json>
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
