"""Fine-tune data from the pipeline's own successes: every VALIDATED board
across the imported books (repaired fens included — those are corrected
reads) becomes 64 labeled tiles. The books label themselves; no teacher
model, no hand annotation.

Usage: python build_validated_npz.py <emit_dir:report.json> [...more pairs]
Writes data/ml/real-validated.npz ({images: Nx40x40 u8, labels: N i64}).
"""
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..'))
FEN_CHARS = '1RNBQKPrnbqkp'


def expand_placement(placement):
    out = []
    for rank in placement.split('/'):
        for ch in rank:
            if ch.isdigit():
                out.extend('1' * int(ch))
            else:
                out.append(ch)
    return out


def main():
    images, labels = [], []
    boards = 0
    for pair in sys.argv[1:]:
        emit_dir, report_path = pair.rsplit(':', 1)
        report = json.load(open(os.path.join(REPO, report_path), encoding='utf-8'))
        for e in report:
            if e.get('status') != 'validated' or not e.get('fen'):
                continue
            gray_path = os.path.join(emit_dir, f"n{e['number']}.gray")
            if not os.path.exists(gray_path):
                continue
            with open(gray_path, 'rb') as f:
                w, h = struct.unpack('<II', f.read(8))
                board = np.frombuffer(f.read(), dtype=np.uint8).reshape(h, w)
            if (w, h) != (512, 512):
                continue
            cells = expand_placement(e['fen'].split(' ')[0])
            if len(cells) != 64:
                continue
            boards += 1
            for i, ch in enumerate(cells):
                row, col = divmod(i, 8)
                tile = board[row * 64:(row + 1) * 64, col * 64:(col + 1) * 64]
                tile40 = np.asarray(
                    Image.fromarray(tile).resize((40, 40), Image.BILINEAR), dtype=np.uint8)
                images.append(tile40)
                labels.append(FEN_CHARS.index(ch))
    X = np.stack(images)
    y = np.array(labels, dtype=np.int64)
    np.savez_compressed(os.path.join(REPO, 'data', 'ml', 'real-validated.npz'),
                        images=X, labels=y)
    counts = {FEN_CHARS[i]: int((y == i).sum()) for i in range(13)}
    print(f'{boards} validated boards -> {len(y)} tiles')
    print(counts)


if __name__ == '__main__':
    main()
