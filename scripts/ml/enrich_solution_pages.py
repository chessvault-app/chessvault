"""Stamp evidence.solutionPage on every imported 1001 puzzle: the solutions
chapter page (106-124) whose entry range covers the puzzle's number, read
from the text layer's entry headers. Run after autoimport-import, which
rebuilds puzzles.json without this enrichment.

Usage: python enrich_solution_pages.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(REPO, 'data', 'ml')

# Optional per-book config (scripts/ml/books/*.json); default = the 1001 book.
CFG = {
    'title': '1001 Chess Exercises for Beginners',
    'text': 'data/ml/1001-text.json',
    'anchorStyle': 'dash',
    'solutionPages': None,  # None -> data/ml/solution-pages.json
}
if len(sys.argv) > 1:
    CFG.update(json.load(open(sys.argv[1], encoding='utf-8')))
BOOK = os.path.join(REPO, 'vault', 'puzzlebooks', CFG['title'])


def main():
    text = json.load(open(os.path.join(REPO, CFG['text']), encoding='utf-8'))
    if CFG.get('solutionRanges'):
        # Books that put an answers section after every chapter.
        sol_pages = [p for lo, hi in CFG['solutionRanges'] for p in range(lo, hi + 1)]
    elif CFG.get('solutionPages'):
        lo, hi = CFG['solutionPages']
        sol_pages = list(range(lo, hi + 1))
    else:
        sol_pages = json.load(open(os.path.join(DATA, 'solution-pages.json'), encoding='utf-8'))

    # Entry anchor, same as autoimport-measure's solutionEntries(): a
    # puzzle number, a dash, then move one ("103 - 1.e4"; the OCR may
    # space the digits). Move numbers inside bodies never match it.
    style = CFG.get('anchorStyle', 'dash')
    anchor = (
        re.compile(r'(?:^|\n)\s{0,4}(\d(?:\s?\d){0,3})\s*\)\s')
        if style == 'paren'
        else re.compile(r'(?:^|\n)\s{0,3}(\d{1,4})\.\s+(?=[A-Z])')
        if style == 'dot'
        else re.compile(r'(?:^|\s)(\d(?:\s?\d){0,3})\s*-\s*(?=1\s*\.)')
    )
    on_page = {}
    for p in text['pages']:
        if p['page'] not in sol_pages:
            continue
        for m in anchor.finditer(p['text']):
            value = int(m.group(1).replace(' ', ''))
            if 1 <= value <= CFG.get('maxNumber', 1001):
                on_page.setdefault(value, p['page'])
    starts = sorted((min(v for v in on_page if on_page[v] == page), page)
                    for page in set(on_page.values()))

    def page_for(number):
        if number in on_page:
            return f'page{on_page[number]:03d}.jpg'
        # Not anchored (entry the OCR mangled): the page whose range covers it.
        chosen = starts[0][1]
        for first, page in starts:
            if first <= number:
                chosen = page
            else:
                break
        return f'page{chosen:03d}.jpg'

    # Drafts carry evidence too — they need the solutions page most,
    # since a human enters their solution while looking at it.
    for name in ('puzzles.json', 'drafts.json'):
        path = os.path.join(BOOK, name)
        if not os.path.exists(path):
            continue
        items = json.load(open(path, encoding='utf-8'))
        stamped = 0
        for p in items:
            if p.get('number') and 'evidence' in p:
                p['evidence']['solutionPage'] = page_for(p['number'])
                stamped += 1
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(items, f, indent=1)
            f.write('\n')
        print(f'{name}: stamped {stamped}/{len(items)} ({len(starts)} solution pages)')


if __name__ == '__main__':
    main()
