"""Export the trained CellNet for in-browser inference.

Produces:
  web/public/models/cellnet-v1.bin   'CNET' magic + JSON manifest + f32 payload
  web/src/puzzles/ocr/__fixtures__/cellnet-golden.json   parity test vectors

BatchNorm is folded into the preceding conv (exact at eval time), so the
browser side only needs conv3x3 + relu + maxpool + GAP + linear.

Usage (torch-env): python export_weights.py
"""
import json
import os
import struct
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import CellNet, DATA
from eval_truth import FEN_CHARS

REPO = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def fold_bn(conv, bn):
    """Return (weight, bias) with the BN baked into the conv."""
    scale = bn.weight / torch.sqrt(bn.running_var + bn.eps)
    weight = conv.weight * scale.view(-1, 1, 1, 1)
    bias = (conv.bias if conv.bias is not None else 0) * scale + bn.bias - bn.running_mean * scale
    return weight.detach(), bias.detach()


def main():
    model = CellNet()
    model.load_state_dict(torch.load(os.path.join(DATA, sys.argv[1] if len(sys.argv) > 1 else 'cellnet-best.pt'), map_location='cpu', weights_only=True))
    model.eval()

    f = model.features
    layers = []
    # features indices: 0 conv,1 bn,2 relu, 3 conv,4 bn,5 relu, 6 pool,
    # 7 conv,8 bn,9 relu, 10 pool, 11 conv,12 bn,13 relu, 14 gap
    for conv_i, bn_i in [(0, 1), (3, 4), (7, 8), (11, 12)]:
        w, b = fold_bn(f[conv_i], f[bn_i])
        layers.append(('conv', w.numpy(), b.numpy()))
    layers.append(('linear', model.head.weight.detach().numpy(), model.head.bias.detach().numpy()))

    manifest = {
        'version': 1,
        'labels': FEN_CHARS,
        'input': [32, 32],
        'layers': [
            {'kind': kind, 'shape': list(w.shape)} for kind, w, _ in layers
        ],
    }
    payload = b''
    for _, w, b in layers:
        payload += w.astype('<f4').tobytes() + b.astype('<f4').tobytes()

    header = json.dumps(manifest).encode()
    out_path = os.path.join(REPO, 'web', 'public', 'models', 'cellnet-v1.bin')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'wb') as out:
        out.write(b'CNET')
        out.write(struct.pack('<I', len(header)))
        out.write(header)
        out.write(payload)
    print(f'{out_path}: {os.path.getsize(out_path)} bytes')

    # Parity vectors: real tiles from the eval-11 boards through the FOLDED
    # graph must match the browser implementation to ~1e-3.
    folded = torch.nn.Sequential()
    at = 0
    rebuilt = []
    for kind, w, b in layers[:-1]:
        conv = torch.nn.Conv2d(w.shape[1], w.shape[0], 3, padding=1)
        conv.weight.data = torch.from_numpy(w)
        conv.bias.data = torch.from_numpy(b)
        rebuilt.append(conv)
        rebuilt.append(torch.nn.ReLU())
        at += 1
        if at in (2, 3):
            rebuilt.append(torch.nn.MaxPool2d(2))
    rebuilt.append(torch.nn.AdaptiveAvgPool2d(1))
    rebuilt.append(torch.nn.Flatten())
    head = torch.nn.Linear(96, 13)
    head.weight.data = torch.from_numpy(layers[-1][1])
    head.bias.data = torch.from_numpy(layers[-1][2])
    rebuilt.append(head)
    folded = torch.nn.Sequential(*rebuilt).eval()

    rng = np.random.default_rng(9)
    tiles = []
    with open(os.path.join(DATA, 'eval-11', 't3.board.gray'), 'rb') as fh:
        w, h = struct.unpack('<II', fh.read(8))
        board = np.frombuffer(fh.read(), dtype=np.uint8).reshape(h, w)
    from PIL import Image
    for _ in range(6):
        row, col = int(rng.integers(0, 8)), int(rng.integers(0, 8))
        cell = Image.fromarray(board[row * 64:(row + 1) * 64, col * 64:(col + 1) * 64])
        tiles.append(np.asarray(cell.resize((32, 32), Image.BILINEAR), dtype=np.uint8))
    x = torch.from_numpy(np.stack(tiles)).float().div(255).unsqueeze(1)
    with torch.no_grad():
        probs = torch.softmax(folded(x), 1).numpy()
        orig = torch.softmax(model(x), 1).numpy()
    assert np.abs(probs - orig).max() < 1e-4, 'BN folding drifted'

    golden = {
        'tiles': [t.flatten().tolist() for t in tiles],
        'probs': [p.tolist() for p in probs],
        'labels': FEN_CHARS,
    }
    fix_path = os.path.join(REPO, 'web', 'src', 'puzzles', 'ocr', '__fixtures__', 'cellnet-golden.json')
    os.makedirs(os.path.dirname(fix_path), exist_ok=True)
    with open(fix_path, 'w') as out:
        json.dump(golden, out)
    print(f'{fix_path}: 6 parity vectors (fold drift {np.abs(probs - orig).max():.2e})')


if __name__ == '__main__':
    main()
