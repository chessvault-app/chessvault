"""Pseudo-label aligned real-book boards with a trusted model (chessvision-
style flywheel): keep only tiles the model is near-certain about, capped per
class per board so empties don't drown the pieces. Output: one NPZ per input
directory with 40x40 uint8 tiles (stored oversized so training can shift-crop
to 32x32).

Usage (tf-env):
  python pseudo_label.py <model_dir> <boards_dir> <out.npz>
"""
import os
import random
import struct
import sys

os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
import numpy as np
from PIL import Image
from tensorflow.keras import models

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_truth import FEN_CHARS

CONFIDENCE = 0.999
MAX_EMPTY_PER_BOARD = 12


def load_board(path):
    with open(path, 'rb') as f:
        w, h = struct.unpack('<II', f.read(8))
        return Image.frombytes('L', (w, h), f.read())


def main():
    model_dir, boards_dir, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    model = models.load_model(model_dir)
    rng = random.Random(11)

    images, labels = [], []
    files = sorted(f for f in os.listdir(boards_dir) if f.endswith('.gray'))
    kept = {c: 0 for c in FEN_CHARS}
    # Batch MANY boards per predict call: model.predict's per-call overhead
    # dwarfs the math at 64 tiles a time.
    CHUNK = 50
    for at in range(0, len(files), CHUNK):
        chunk_files = files[at:at + CHUNK]
        tiles32, tiles40 = [], []
        for file in chunk_files:
            img = load_board(os.path.join(boards_dir, file))
            cell = img.width // 8
            for row in range(8):
                for col in range(8):
                    tile = img.crop((col * cell, row * cell, (col + 1) * cell, (row + 1) * cell))
                    tiles40.append(np.asarray(tile.resize((40, 40), Image.BILINEAR), dtype=np.uint8))
                    arr = np.asarray(tile.resize((32, 32), Image.BILINEAR), dtype=np.float32)
                    tiles32.append(arr[..., None] / 255.0)
        probs = model.predict(np.stack(tiles32), verbose=0)
        for board_at in range(len(chunk_files)):
            empties = []
            for i in range(board_at * 64, (board_at + 1) * 64):
                p = probs[i]
                k = int(np.argmax(p))
                if p[k] < CONFIDENCE:
                    continue
                if FEN_CHARS[k] == '1':
                    empties.append(i)
                else:
                    images.append(tiles40[i])
                    labels.append(k)
                    kept[FEN_CHARS[k]] += 1
            for i in rng.sample(empties, min(MAX_EMPTY_PER_BOARD, len(empties))):
                images.append(tiles40[i])
                labels.append(FEN_CHARS.index('1'))
                kept['1'] += 1
        print(f'{min(at + CHUNK, len(files))}/{len(files)} boards, {len(images)} tiles kept', flush=True)

    np.savez_compressed(out_path, images=np.stack(images), labels=np.array(labels, dtype=np.int64))
    print(f'{len(files)} boards -> {len(images)} tiles: ' +
          ' '.join(f'{c}:{n}' for c, n in kept.items() if n))


if __name__ == '__main__':
    main()
