"""Dump a two-column book's text as LINES in reading order, with geometry.

extract_1001_text.py gives words and a flat page string, which is all the
puzzle importer needs. A prose book needs the line structure: in Logical
Chess the moves are told apart from the commentary purely by layout — a
move sits indented and short in its own line, a sentence runs the full
column width — and pymupdf's own block order interleaves the columns when
a full-width heading splits the page.

So: split each page into bands at full-width lines, and read each band
left column then right column.

Usage: python extract_pdf_lines.py <book.pdf> <out.json>
"""
import json
import sys

import pymupdf

# A line counts as full-width when it reaches this far into both halves.
CROSS = 20.0
# ...or when it is centred on the page rather than on a column, which is how
# a short heading ("Game 8") divides the columns without spanning them.
# Measured as symmetry — equal margins left and right — because a short last
# line of the right-hand column also sits near the middle, but lopsidedly.
CENTRED = 18.0


def page_lines(page):
    raw = []
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            text = ''.join(s['text'] for s in line['spans'])
            if not text.strip():
                continue
            x0, y0, x1, y1 = line['bbox']
            raw.append({
                'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1,
                'text': text,
                'fonts': sorted({s['font'] for s in line['spans']}),
            })
    if not raw:
        return []

    # The type block, not the paper: these scans are not centred in their
    # page box and the box size varies page to page, so both the column
    # split and the centred-heading test have to come from the ink.
    ink0 = min(l['x0'] for l in raw)
    ink1 = max(l['x1'] for l in raw)
    mid = (ink0 + ink1) / 2
    for line in raw:
        line['full'] = (line['x0'] < mid - CROSS and line['x1'] > mid + CROSS) or abs(
            (line['x0'] - ink0) - (ink1 - line['x1'])
        ) < CENTRED

    # A move, its ellipsis and the reply print side by side on one baseline,
    # but not on exactly the same y — the ellipsis sits a few points lower.
    # Sweep the page and read anything within a line's height together, left
    # to right, or the pieces of a move arrive out of order.
    def order(lines):
        rows = []
        for line in sorted(lines, key=lambda l: l['y0']):
            if rows and line['y0'] - rows[-1][0]['y0'] < 6:
                rows[-1].append(line)
            else:
                rows.append([line])
        return [l for row in rows for l in sorted(row, key=lambda l: l['x0'])]

    bands = []  # [(lines above this divider, divider or None)]
    current = []
    for line in sorted(raw, key=lambda l: l['y0']):
        if line['full']:
            bands.append((current, line))
            current = []
        else:
            current.append(line)
    bands.append((current, None))

    out = []
    for body, divider in bands:
        left = order([l for l in body if (l['x0'] + l['x1']) / 2 < mid])
        right = order([l for l in body if (l['x0'] + l['x1']) / 2 >= mid])
        out.extend(left)
        out.extend(right)
        if divider:
            out.append(divider)
    return out


def main():
    doc = pymupdf.open(sys.argv[1])
    pages = [
        {'page': n + 1, 'width': page.rect.width, 'height': page.rect.height,
         'lines': page_lines(page)}
        for n, page in enumerate(doc)
    ]
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump({'pages': pages}, f)
    print(f'{len(pages)} pages -> {sys.argv[2]}')


if __name__ == '__main__':
    main()
