"""Figurine-glyph reader, stage 2 of the text-ML effort: the solutions text
prints pieces as figurine glyphs the PDF's OCR mangles into garbage
("tt:l" = knight). The 678 validated entries align their printed tokens
with known SAN, labeling which garbage prefix means which piece — and,
through the word boxes, which PRINTED GLYPH means which piece. A centroid
model over those glyph crops then reads the prefixes too rare for the
text-only dialect (needs >=5 sightings), emitting extra hints that break
the 'ambiguous' replay failures.

Usage: python figurine_glyphs.py <render1400_dir>
Writes data/ml/glyph-hints.json {prefix: role}.
"""
import json
import os
import re
import struct
import sys
from collections import Counter, defaultdict

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
DATA = os.path.join(REPO, 'data', 'ml')
SQ = re.compile(r'[a-h][1-8]')
CROP_W, CROP_H = 16, 24
ROLES = ['knight', 'bishop', 'rook', 'queen', 'king']
SAN_ROLE = {'N': 'knight', 'B': 'bishop', 'R': 'rook', 'Q': 'queen', 'K': 'king'}


def load_gray(path):
    with open(path, 'rb') as f:
        w, h = struct.unpack('<II', f.read(8))
        return np.frombuffer(f.read(), dtype=np.uint8).reshape(h, w)


def strip_variations(text):
    depth, out = 0, []
    for ch in text:
        if ch in '[(':
            depth += 1
        elif ch in '])':
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return ''.join(out)


def is_moveish(token):
    if SQ.search(token):
        return True
    castle = re.sub(r'[^0Oo-]', '', token)
    return re.fullmatch(r'[0Oo]-[0Oo](-[0Oo])?', castle) is not None


def mainline_tokens(body):
    """Mirror of autoimport-measure's parseMainline, tokens only."""
    clean = strip_variations(body.replace('­\n', '').replace('­', '').replace('\n', ' '))
    tokens = []
    for m in re.finditer(r'(\d{1,3})\s*((?:\.\s*)+)|(\S+)', clean):
        if m.group(3) and is_moveish(m.group(3)):
            tokens.append(m.group(3))
    return tokens


def token_prefix(token):
    squares = SQ.findall(token)
    if not squares:
        return None
    dest = squares[-1]
    prefix = token[: token.rindex(dest)]
    prefix = re.sub(r'[x!?+#\s]', '', prefix)
    if not prefix:
        return None
    if len(prefix) == 1 and re.fullmatch(r'[a-h1-8]', prefix):
        return None
    return prefix


def solution_entries(text):
    """number -> body, same anchor as the measure script."""
    start = next(i for i, p in enumerate(text['pages'])
                 if p['page'] > 100 and re.search(r'\d+\s*-\s*1\s*\.', p['text']))
    joined = '\n'.join(p['text'] for p in text['pages'][start:])
    out = {}
    hits = list(re.finditer(r'(?:^|\s)(\d(?:\s?\d){0,3})\s*-\s*(?=1\s*\.)', joined))
    for i, h in enumerate(hits):
        value = int(h.group(1).replace(' ', ''))
        if 1 <= value <= 1001 or value in out:
            end = hits[i + 1].start() if i + 1 < len(hits) else len(joined)
            out.setdefault(value, joined[h.end():end])
    return out


def components(img):
    dark = img < 128
    lbl = np.zeros(img.shape, dtype=np.int32)
    boxes = []
    n = 0
    stack = []
    for yy in range(img.shape[0]):
        for xx in range(img.shape[1]):
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
                            if 0 <= ny < img.shape[0] and 0 <= nx < img.shape[1]:
                                if dark[ny, nx] and lbl[ny, nx] == 0:
                                    lbl[ny, nx] = n
                                    stack.append((ny, nx))
                boxes.append((x0, y0, x1 + 1, y1 + 1))
    return boxes


def crop_norm(img, box):
    from PIL import Image
    x0, y0, x1, y1 = box
    tile = Image.fromarray(img[y0:y1, x0:x1]).resize((CROP_W, CROP_H), Image.BILINEAR)
    return 1.0 - np.asarray(tile, dtype=np.float32) / 255.0


def leading_glyph(word_img):
    """The figurine: leftmost full-height component (skips quote marks)."""
    h = word_img.shape[0]
    boxes = [b for b in components(word_img) if (b[3] - b[1]) >= h * 0.5]
    if not boxes:
        return None
    return min(boxes, key=lambda b: b[0])


def main():
    render_dir = sys.argv[1]
    text = json.load(open(os.path.join(DATA, '1001-text.json'), encoding='utf-8'))
    report = json.load(open(os.path.join(DATA, 'autoimport-report.json'), encoding='utf-8'))
    entries = solution_entries(text)

    # 1. prefix -> role stats from validated entries (token/SAN alignment).
    stats = defaultdict(Counter)
    for e in report:
        if e.get('status') != 'validated' or not e.get('sans'):
            continue
        tokens = mainline_tokens(entries.get(e['number'], ''))
        if len(tokens) != len(e['sans']):
            continue
        for tok, san in zip(tokens, e['sans']):
            pre = token_prefix(tok)
            if pre and san[0] in SAN_ROLE:
                stats[pre][SAN_ROLE[san[0]]] += 1
    pure = {p: c.most_common(1)[0][0] for p, c in stats.items()
            if c.most_common(1)[0][1] / sum(c.values()) >= 0.9 and sum(c.values()) >= 3}
    print(f'{len(stats)} prefixes seen, {len(pure)} pure enough to label glyph crops')

    # 2. harvest labeled glyph crops from word boxes on solution pages.
    sol_pages = set(json.load(open(os.path.join(DATA, 'solution-pages.json'), encoding='utf-8')))
    pages = {}
    samples, labels = [], []
    word_crops = []  # (prefix, crop) for every prefix word, labeled or not
    for p in text['pages']:
        if p['page'] not in sol_pages:
            continue
        try:
            img = pages.setdefault(
                p['page'], load_gray(os.path.join(render_dir, f"page-{p['page']:03d}.gray")))
        except FileNotFoundError:
            continue
        sx = img.shape[1] / p['width']
        sy = img.shape[0] / p['height']
        for w in p['words']:
            pre = token_prefix(w['text']) if is_moveish(w['text']) else None
            if not pre:
                continue
            x0, y0 = int(w['x0'] * sx) - 1, int(w['y0'] * sy) - 1
            x1, y1 = int(w['x1'] * sx) + 1, int(w['y1'] * sy) + 1
            box = img[max(0, y0):y1, max(0, x0):x1]
            if box.size == 0:
                continue
            g = leading_glyph(box)
            if g is None:
                continue
            crop = crop_norm(box, g)
            word_crops.append((pre, crop))
            if pre in pure:
                samples.append(crop)
                labels.append(ROLES.index(pure[pre]))
    X = np.stack(samples)
    y = np.array(labels)
    print(f'{len(y)} labeled glyph crops; per class:',
          {ROLES[i]: int((y == i).sum()) for i in range(5)})

    # 3. centroid model + 5-fold eval.
    def fit(Xs, ys):
        return np.stack([Xs[ys == i].mean(axis=0) for i in range(5)])

    def classify(cent, crop):
        c = crop - crop.mean()
        sims = [float(((c) * (cent[i] - cent[i].mean())).sum()
                      / (np.linalg.norm(c) * np.linalg.norm(cent[i] - cent[i].mean()) + 1e-6))
                for i in range(5)]
        best = int(np.argmax(sims))
        return best, sims[best]

    rng = np.random.default_rng(7)
    idx = rng.permutation(len(y))
    wrong = 0
    for f in range(5):
        test = idx[f::5]
        cent = fit(X[np.setdiff1d(idx, test)], y[np.setdiff1d(idx, test)])
        for i in test:
            wrong += classify(cent, X[i])[0] != y[i]
    print(f'5-fold accuracy: {1 - wrong / len(y):.4%} ({wrong} wrong of {len(y)})')
    cent = fit(X, y)

    # 4. read every prefix word's glyph; per-prefix majority becomes a hint.
    votes = defaultdict(Counter)
    for pre, crop in word_crops:
        role, conf = classify(cent, crop)
        if conf >= 0.6:
            votes[pre][ROLES[role]] += 1
    hints = {}
    for pre, c in votes.items():
        role, n = c.most_common(1)[0]
        if n / sum(c.values()) >= 0.8:
            hints[pre] = role
    # The text-only dialect already covers the common prefixes; keep every
    # image-read one anyway — the measure merge gives the dialect priority.
    agree = sum(1 for p, r in pure.items() if hints.get(p) == r)
    print(f'{len(hints)} glyph hints; agreement with text-derived labels '
          f'{agree}/{len(pure & hints.keys() if isinstance(pure, set) else set(pure) & set(hints))}')
    json.dump(hints, open(os.path.join(DATA, 'glyph-hints.json'), 'w'), indent=1)
    print('-> data/ml/glyph-hints.json')


if __name__ == '__main__':
    main()
