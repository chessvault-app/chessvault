"""Render a book's cover and its solution pages into the vault book's
diagrams/ folder, where the trainer's "show the printed answer" button and
the shelf cover look for them.

A re-import wipes diagrams/, so this runs after evidence_jpegs.py and before
enrich_solution_pages.py — which is what stamps each puzzle with the page
that holds its answer.

Usage: python render_book_pages.py scripts/ml/books/<book>.json
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


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    out = os.path.join(REPO, 'vault', 'puzzlebooks', cfg['title'], 'diagrams')
    os.makedirs(out, exist_ok=True)
    doc = pymupdf.open(cfg['pdf'])

    if cfg.get('solutionRanges'):
        pages = [p for lo, hi in cfg['solutionRanges'] for p in range(lo, hi + 1)]
    else:
        lo, hi = cfg['solutionPages']
        pages = list(range(lo, hi + 1))

    for n in pages:
        render(doc[n - 1], os.path.join(out, f'page{n:03d}.jpg'))
    render(doc[cfg.get('coverPage', 1) - 1], os.path.join(out, 'cover.jpg'), 700)
    print(f'{len(pages)} solution pages + cover -> {out}')


if __name__ == '__main__':
    main()
