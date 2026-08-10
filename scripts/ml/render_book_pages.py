"""Render every page a book's puzzles point at, plus its cover, into the
vault book's diagrams/ folder — where the source pane, the "show the
printed answer" button and the shelf cover look for them.

Every book puzzle carries evidence, so every page named by an
evidence.page or evidence.solutionPage has to exist here.

A re-import wipes diagrams/, so this runs after evidence_jpegs.py and before
enrich_solution_pages.py — which is what stamps each puzzle with the page
that holds its answer.

The config names the book's file, not where it lives: point
CHESS_BOOK_PDFS at the folder holding your own copies.

Usage: CHESS_BOOK_PDFS=~/pdfs python render_book_pages.py scripts/ml/books/<book>.json
"""
import json
import os
import sys

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))

WIDTH = 1100  # matches evidence_jpegs.py's page renders


def render(page, path, width=WIDTH):
    zoom = width / page.rect.width
    page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom)).save(path, jpg_quality=72)


def cited_pages(book_dir):
    """Every page image the imported puzzles and drafts refer to."""
    out = {}
    for name in ('puzzles.json', 'drafts.json'):
        path = os.path.join(book_dir, name)
        if not os.path.exists(path):
            continue
        for item in json.load(open(path, encoding='utf-8')):
            for key in ('page', 'solutionPage'):
                f = (item.get('evidence') or {}).get(key)
                if f:
                    out[f] = int(''.join(c for c in f if c.isdigit()))
    return out


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    book_dir = os.path.join(REPO, 'vault', 'puzzlebooks', cfg['title'])
    out = os.path.join(book_dir, 'diagrams')
    os.makedirs(out, exist_ok=True)
    doc = pymupdf.open(os.path.join(os.environ.get('CHESS_BOOK_PDFS', ''), cfg['pdf']))

    # Whatever the imported puzzles cite, by the exact filename they cite.
    wanted = cited_pages(book_dir)
    # Plus the answers chapter, for a book imported before this ran.
    pad = len(next(iter(wanted), 'page000.jpg')) - len('page.jpg')
    if cfg.get('solutionRanges'):
        spans = cfg['solutionRanges']
    elif cfg.get('solutionPages'):
        spans = [cfg['solutionPages']]
    else:
        spans = []
    for lo, hi in spans:
        for n in range(lo, hi + 1):
            wanted.setdefault(f'page{n:0{pad}d}.jpg', n)

    for name, n in sorted(wanted.items(), key=lambda kv: kv[1]):
        if n < 1 or n > len(doc):
            continue
        render(doc[n - 1], os.path.join(out, name))
    # The shelf draws the cover as a small card, so it is rendered small.
    # At 700px and up this file was reaching 700 KB — the single heaviest
    # thing the shelf loads, for a thumbnail. 480 matches what the in-app
    # importer writes, so both paths produce the same kind of cover.
    render(doc[cfg.get('coverPage', 1) - 1], os.path.join(out, 'cover.jpg'), 480)
    print(f'{len(wanted)} pages + cover -> {out}')


if __name__ == '__main__':
    main()
