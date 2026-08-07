"""Synthetic print-style chess diagrams from classic diagram fonts.

Renders full boards (linrock's format: <fen-with-1s, ranks dash-separated>.png)
into data/ml/print-boards/<font>/. The piece-on-square glyph mapping comes from
the CTAN enpassant .enc files (TeX board fonts reuse standard glyph names, so
the ASCII slot of the glyph name is the codepoint FreeType sees); Marroquin
TTFs (Merida) follow the de-facto standard letter layout, sometimes shifted
into the 0xF000 symbol area.

Usage:
  python gen_print.py --verify          one known board + glyph grid per font
  python gen_print.py --count 600       generate boards per font
"""
import argparse
import os
import random
import re
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, '..', '..', 'data', 'ml'))
ENP = os.path.join(DATA, 'enpassant')

# label -> FEN char ('1' = empty), square: w = light, b = dark
LABEL_RE = re.compile(r'^([WB])(Pawn|Knight|Bishop|Rook|Queen|King)On(White|Black)$')
PIECE_CHAR = {'Pawn': 'p', 'Knight': 'n', 'Bishop': 'b', 'Rook': 'r', 'Queen': 'q', 'King': 'k'}

# The Marroquin/Bentzen ASCII convention (Merida etc.): light-square char is
# lowercase, dark-square uppercase; black pieces use the "shifted" letters.
MARROQUIN = {
    ('P', 'w'): 'p', ('P', 'b'): 'P', ('N', 'w'): 'n', ('N', 'b'): 'N',
    ('B', 'w'): 'b', ('B', 'b'): 'B', ('R', 'w'): 'r', ('R', 'b'): 'R',
    ('Q', 'w'): 'q', ('Q', 'b'): 'Q', ('K', 'w'): 'k', ('K', 'b'): 'K',
    ('p', 'w'): 'o', ('p', 'b'): 'O', ('n', 'w'): 'm', ('n', 'b'): 'M',
    ('b', 'w'): 'v', ('b', 'b'): 'V', ('r', 'w'): 't', ('r', 'b'): 'T',
    ('q', 'w'): 'w', ('q', 'b'): 'W', ('k', 'w'): 'l', ('k', 'b'): 'L',
    ('1', 'w'): ' ', ('1', 'b'): '+',
}


def parse_enc(path):
    """CTAN .enc -> {(fen_char, square): glyph_char}. Comments label entries."""
    mapping = {}
    label = None
    for token in re.findall(r'%%?\s*([A-Za-z0-9]+)\s*$|/(\S+)', open(path).read(), re.M):
        comment, name = token
        if comment:
            if LABEL_RE.match(comment) or comment in ('WhiteSquare', 'BlackSquare'):
                label = comment
            continue
        if name == '.notdef' or label is None:
            continue
        if len(name) == 1:
            if label == 'WhiteSquare':
                mapping[('1', 'w')] = name
            elif label == 'BlackSquare':
                mapping[('1', 'b')] = name
            else:
                m = LABEL_RE.match(label)
                colour, piece, square = m.groups()
                fen = PIECE_CHAR[piece]
                mapping[(fen.upper() if colour == 'W' else fen, 'w' if square == 'White' else 'b')] = name
        label = None
    mapping.setdefault(('1', 'w'), ' ')
    mapping.setdefault(('1', 'b'), '+')
    return mapping


# Only mappings that passed the --verify eyeball check. merida-fixed.ttf is
# MERIFONT.TTF with its symbol cmap rewritten to plain ASCII (see README).
FONTS = {
    'merida': (os.path.join(DATA, 'fonts', 'merida-fixed.ttf'), MARROQUIN),
    'alpha': (os.path.join(ENP, 'chess-alpha-board-fig-raw.pfb'), os.path.join(ENP, 'chess-alpha-board.enc')),
    'berlin': (os.path.join(ENP, 'chess-berlin-board-fig-raw.pfb'), os.path.join(ENP, 'chess-berlin-board.enc')),
}


class BoardFont:
    def __init__(self, name, path, mapping, size=48):
        self.name = name
        self.font = ImageFont.truetype(path, size)
        self.size = size
        # Symbol-area fonts park the standard layout at 0xF000 + ascii.
        self.offset = 0
        if self._coverage('p') < 5 and self._coverage(chr(0xF000 + ord('p'))) >= 5:
            self.offset = 0xF000
        self.mapping = mapping

    def _coverage(self, ch):
        img = Image.new('L', (self.size * 2, self.size * 2), 255)
        ImageDraw.Draw(img).text((8, 8), ch, font=self.font, fill=0)
        lo, hi = img.getextrema()
        return 0 if lo == hi else sum(1 for p in img.getdata() if p < 128) // 16

    def glyph(self, fen_char, square):
        ch = self.mapping.get((fen_char, square))
        return chr(self.offset + ord(ch)) if ch else None

    def cell_size(self):
        # Board glyphs are square and advance one cell; measure the em box.
        bbox = self.font.getbbox(self.glyph('1', 'b') or '+')
        return max(bbox[2], bbox[3] - bbox[1])


def render_board(bf, placement):
    """placement: 64 fen chars, a8 first. Returns a clean board image."""
    cell = bf.cell_size()
    pad = max(3, cell // 12)
    img = Image.new('L', (cell * 8 + 2 * pad, cell * 8 + 2 * pad), 255)
    d = ImageDraw.Draw(img)
    ascent = bf.font.getbbox(bf.glyph('1', 'b') or '+')[1]
    for i, fen_char in enumerate(placement):
        row, col = divmod(i, 8)
        square = 'w' if (row + col) % 2 == 0 else 'b'
        ch = bf.glyph(fen_char, square)
        if ch is None:  # combo missing in this font: leave the bare square
            ch = bf.glyph('1', square)
        d.text((pad + col * cell, pad + row * cell - ascent), ch, font=bf.font, fill=0)
    d.rectangle([pad - 2, pad - 2, pad + 8 * cell + 1, pad + 8 * cell + 1], outline=0, width=2)
    return img


def random_placement(rng):
    chars = '1' * 14 + 'PNBRQKpnbrqk'  # ~54% empty, pieces uniform
    return [rng.choice(chars) for _ in range(64)]


def to_filename(placement):
    ranks = [''.join(placement[r * 8:(r + 1) * 8]) for r in range(8)]
    return '-'.join(ranks) + '.png'


def load_fonts():
    out = []
    for name, (path, enc) in FONTS.items():
        mapping = enc if isinstance(enc, dict) else parse_enc(enc)
        try:
            out.append(BoardFont(name, path, mapping))
        except Exception as e:
            print(f'{name}: cannot load ({e}), skipping')
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--count', type=int, default=600)
    ap.add_argument('--seed', type=int, default=7)
    args = ap.parse_args()

    fonts = load_fonts()
    if args.verify:
        # One fixed, easy-to-check position per font.
        fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'
        placement = []
        for rank in fen.split('/'):
            for c in rank:
                placement.extend('1' * int(c)) if c.isdigit() else placement.append(c)
        for bf in fonts:
            img = render_board(bf, placement)
            out = os.path.join(DATA, f'verify-{bf.name}.png')
            img.resize((512, 512)).save(out)
            print(f'{bf.name}: offset=0x{bf.offset:x} cell={bf.cell_size()} -> {out}')
        return

    rng = random.Random(args.seed)
    for bf in fonts:
        out_dir = os.path.join(DATA, 'print-boards', bf.name)
        os.makedirs(out_dir, exist_ok=True)
        for i in range(args.count):
            placement = random_placement(rng)
            img = render_board(bf, placement)
            # Mild geometry jitter at board level; heavy per-tile augmentation
            # happens in the training loader.
            if rng.random() < 0.5:
                w, h = img.size
                j = int(w * 0.015)
                quad = (rng.randint(0, j), rng.randint(0, j),
                        rng.randint(0, j), h - rng.randint(0, j),
                        w - rng.randint(0, j), h - rng.randint(0, j),
                        w - rng.randint(0, j), rng.randint(0, j))
                img = img.transform((w, h), Image.QUAD, quad, fillcolor=255)
            img = img.resize((512, 512), Image.BILINEAR)
            img.save(os.path.join(out_dir, to_filename(placement)))
        print(f'{bf.name}: {args.count} boards -> {out_dir}')


if __name__ == '__main__':
    sys.exit(main())
