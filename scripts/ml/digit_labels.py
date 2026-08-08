"""Number-label reader, stage 1 of the text-ML effort: learn the book's own
digit shapes from the 858 already-matched puzzles (their numbers and diagram
rects are ground truth), then read labels the PDF text layer lost.

Harvest: crop the strip above each known diagram, binarize, split connected
components into the leading digit run, and keep the sample only when the run
length matches the known number's digit count — self-labeling with a strict
gate instead of hand annotation.

Model: per-class mean templates (nearest-centroid over 16x24 crops) with a
correlation threshold for rejection. Print digits in one font family don't
need more; the gate below reports if they do.

Usage:
  python digit_labels.py harvest   # -> data/ml/digit-samples.npz + eval
  python digit_labels.py read <rects.json>  # label unmatched diagram rects
"""
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(REPO, 'data', 'ml')

# Optional per-book config (scripts/ml/books/*.json); default = the 1001 book.
CFG = {
    'slug': '1001',
    'title': '1001 Chess Exercises for Beginners',
    'text': 'data/ml/1001-text.json',
    'report': 'data/ml/autoimport-report.json',
}
if '--book' in sys.argv:
    _at = sys.argv.index('--book')
    CFG.update(json.load(open(sys.argv[_at + 1], encoding='utf-8')))
    del sys.argv[_at:_at + 2]
BOOK = os.path.join(REPO, 'vault', 'puzzlebooks', CFG['title'], 'diagrams')

def _artifact(default_name):
    return os.path.join(
        DATA, default_name if CFG['slug'] == '1001' else f"{CFG['slug']}-{default_name}")
CROP_W, CROP_H = 16, 24


def page_image(page):
    return Image.open(os.path.join(BOOK, f'page{page:03d}.jpg')).convert('L')


def label_strip(im, rect):
    """The band above a diagram where its number is printed. Overshoots
    INTO the rect: reported rects sit slightly above the printed board,
    so cutting at rect.y beheads the digits' bottom rows ('2' minus its
    base bar reads as '7'). The board border the overshoot admits is a
    page-wide component the size gate discards."""
    W, H = im.size
    x0 = max(0, int((rect['x'] - 0.01) * W))
    x1 = min(W, int((rect['x'] + rect['w'] + 0.01) * W))
    y0 = max(0, int((rect['y'] - 0.05) * H))
    y1 = min(H, int((rect['y'] + 0.012) * H))
    return np.asarray(im.crop((x0, y0, x1, y1)), dtype=np.uint8)


def components(strip):
    """Connected components of dark ink, as (x0, y0, x1, y1) boxes."""
    dark = strip < 128
    lbl = np.zeros(strip.shape, dtype=np.int32)
    n = 0
    boxes = []
    # Simple two-pass-free flood fill; strips are tiny (~160x25 px).
    stack = []
    for yy in range(strip.shape[0]):
        for xx in range(strip.shape[1]):
            if dark[yy, xx] and lbl[yy, xx] == 0:
                n += 1
                stack.append((yy, xx))
                lbl[yy, xx] = n
                x0 = x1 = xx
                y0 = y1 = yy
                while stack:
                    cy, cx = stack.pop()
                    x0 = min(x0, cx); x1 = max(x1, cx)
                    y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            ny, nx = cy + dy, cx + dx
                            if 0 <= ny < strip.shape[0] and 0 <= nx < strip.shape[1]:
                                if dark[ny, nx] and lbl[ny, nx] == 0:
                                    lbl[ny, nx] = n
                                    stack.append((ny, nx))
                boxes.append((x0, y0, x1 + 1, y1 + 1))
    return boxes


def digit_run(strip, page_h):
    """The label's digits: topmost left-aligned run of digit-sized boxes.

    Size gate is in page fractions — the printed digits are ~1% of the
    page height regardless of how tall the strip is.
    """
    lo, hi = 0.006 * page_h, 0.014 * page_h
    boxes = [b for b in components(strip)
             if lo <= (b[3] - b[1]) <= hi and (b[2] - b[0]) <= (b[3] - b[1]) * 1.2]
    if not boxes:
        return []
    # The number is the first text line: cluster by vertical overlap with the
    # topmost box, then take the leading run with small gaps.
    top = min(boxes, key=lambda b: b[1])
    line = sorted((b for b in boxes if b[1] < top[3] and b[3] > top[1]), key=lambda b: b[0])
    run = [line[0]]
    for b in line[1:]:
        if b[0] - run[-1][2] <= (top[3] - top[1]) * 0.8:
            run.append(b)
        else:
            break
    return run


def crop_norm(strip, box):
    x0, y0, x1, y1 = box
    tile = Image.fromarray(strip[y0:y1, x0:x1]).resize((CROP_W, CROP_H), Image.BILINEAR)
    a = np.asarray(tile, dtype=np.float32) / 255.0
    return 1.0 - a  # ink = high


def harvest():
    """Digit crops located by the PDF text layer's own word boxes — exact
    positions, labels from the word text. No segmentation guessing; the
    text layer is unreliable about EXISTENCE (83 numbers missing) but
    where a digit word exists its box is trustworthy."""
    text = json.load(open(os.path.join(REPO, CFG['text']), encoding='utf-8'))
    rep = json.load(open(os.path.join(REPO, CFG['report']), encoding='utf-8'))
    puzzle_pages = {e['page'] for e in rep}
    samples, labels, skipped = [], [], 0
    for p in text['pages']:
        if p['page'] not in puzzle_pages:
            continue
        im = page_image(p['page'])
        W, H = im.size
        sx, sy = W / p['width'], H / p['height']
        page = np.asarray(im, dtype=np.uint8)
        for w in p['words']:
            if not w['text'].isdigit() or len(w['text']) > 4:
                continue
            x0, y0 = int(w['x0'] * sx) - 1, int(w['y0'] * sy) - 1
            x1, y1 = int(w['x1'] * sx) + 1, int(w['y1'] * sy) + 1
            if y1 - y0 < 6 or y1 - y0 > 0.02 * H:
                continue
            box = page[max(0, y0):y1, max(0, x0):x1]
            runs = components(box)
            runs = [b for b in runs if (b[3] - b[1]) >= (y1 - y0) * 0.45]
            runs.sort(key=lambda b: b[0])
            if len(runs) != len(w['text']):
                skipped += 1
                continue
            for b, ch in zip(runs, w['text']):
                samples.append(crop_norm(box, b))
                labels.append(int(ch))
    X = np.stack(samples)
    y = np.array(labels)
    np.savez_compressed(_artifact('digit-samples.npz'), X=X, y=y)
    print(f'harvested {len(y)} digits ({skipped} digit-words skipped on segmentation)')
    per = {d: int((y == d).sum()) for d in range(10)}
    print('per digit:', per)
    evaluate(X, y)


def fit(X, y):
    return np.stack([X[y == d].mean(axis=0) for d in range(10)])


def score(centroids, crop):
    c = crop - crop.mean()
    best, arg = -2.0, -1
    for d in range(10):
        t = centroids[d] - centroids[d].mean()
        s = float((c * t).sum() / (np.linalg.norm(c) * np.linalg.norm(t) + 1e-6))
        if s > best:
            best, arg = s, d
    return arg, best


def evaluate(X, y):
    """5-fold cross-validated accuracy of the centroid model."""
    rng = np.random.default_rng(7)
    idx = rng.permutation(len(y))
    wrong = 0
    for f in range(5):
        test = idx[f::5]
        train = np.setdiff1d(idx, test)
        cent = fit(X[train], y[train])
        for i in test:
            pred, _ = score(cent, X[i])
            wrong += pred != y[i]
    acc = 1 - wrong / len(y)
    print(f'5-fold accuracy: {acc:.4%} ({wrong} wrong of {len(y)})')
    cent = fit(X, y)
    np.savez_compressed(_artifact('digit-model.npz'), centroids=cent)
    print('model -> data/ml/digit-model.npz')


def lines_of(boxes):
    """Group boxes into text lines by vertical overlap, top to bottom."""
    lines = []
    for b in sorted(boxes, key=lambda b: b[1]):
        for line in lines:
            if b[1] < line[-1][3] and b[3] > line[-1][1]:
                line.append(b)
                break
        else:
            lines.append([b])
    return [sorted(l, key=lambda b: b[0]) for l in lines]


def read_number(model, im, rect, min_conf=0.6):
    """Read the printed number above a diagram rect: candidate digit-sized
    lines in the strip, kept only when EVERY leading-run box classifies
    confidently as a digit (captions and coordinate letters fail that),
    best line = highest worst-box confidence."""
    strip = label_strip(im, rect)
    H = im.size[1]
    lo, hi = 0.006 * H, 0.014 * H
    boxes = [b for b in components(strip)
             if lo <= (b[3] - b[1]) <= hi and (b[2] - b[0]) <= (b[3] - b[1]) * 1.2]
    best = None
    for line in lines_of(boxes):
        run = [line[0]]
        for b in line[1:]:
            if b[0] - run[-1][2] <= (line[0][3] - line[0][1]) * 0.8:
                run.append(b)
            else:
                break
        if len(run) > 4:
            continue
        digits, confs = [], []
        for b in run:
            d, s = score(model, crop_norm(strip, b))
            digits.append(str(d))
            confs.append(s)
        worst = min(confs)
        if worst < min_conf:
            continue
        value = int(''.join(digits))
        if not 1 <= value <= 1001:
            continue
        if best is None or worst > best[1]:
            best = (value, worst)
    return best


def selftest():
    """End-to-end check against the 858 ground-truth labels."""
    model = np.load(_artifact('digit-model.npz'))['centroids']
    rep = json.load(open(os.path.join(REPO, CFG['report']), encoding='utf-8'))
    pages = {}
    right = wrong = none = 0
    misses = []
    for e in rep:
        im = pages.setdefault(e['page'], page_image(e['page']))
        got = read_number(model, im, e['rect'])
        if got is None:
            none += 1
            misses.append((e['number'], None))
        elif got[0] == e['number']:
            right += 1
        else:
            wrong += 1
            misses.append((e['number'], got))
    print(f'end-to-end: {right} right, {wrong} wrong, {none} unread of {len(rep)}')
    for m in misses[:15]:
        print('  miss:', m)


def read(rects_path):
    """Label diagram rects (page + fractional rect) with a read number."""
    model = np.load(_artifact('digit-model.npz'))['centroids']
    entries = json.load(open(rects_path, encoding='utf-8'))
    out = []
    pages = {}
    for e in entries:
        im = pages.setdefault(e['page'], page_image(e['page']))
        got = read_number(model, im, e['rect'])
        out.append({**e,
                    'read': got[0] if got else None,
                    'confidence': round(got[1], 4) if got else 0})
    dest = _artifact('recovered-numbers.json')
    json.dump(out, open(dest, 'w', encoding='utf-8'), indent=1)
    ok = sum(1 for o in out if o['read'] is not None)
    print(f'read {ok}/{len(out)} labels -> {dest}')


if __name__ == '__main__':
    if sys.argv[1:2] == ['harvest']:
        harvest()
    elif sys.argv[1:2] == ['selftest']:
        selftest()
    elif sys.argv[1:2] == ['read'] and len(sys.argv) > 2:
        read(sys.argv[2])
    else:
        print(__doc__)
