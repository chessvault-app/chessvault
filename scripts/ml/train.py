"""Train the diagram cell classifier (32x32 gray tile -> 13 classes).

Data sources (all under data/ml/):
  - linrock/images/chessboards/**  board PNGs, FEN-in-filename (screenshots + book scans)
  - print-boards/<font>/           our synthetic print diagrams, same format
  - real-*.npz                     pseudo-labeled 40x40 tiles from lanph3re's books

Boards are tiled to 40x40 (from 512^2 -> 64px cells); training random-crops
32x32 (shift aug) plus photometric augmentation. Split is BY BOARD, and the 11
hand-labeled boards in eval-11/ are a pure holdout reported each epoch.

Usage (torch-env):  python train.py [--epochs 16] [--batch 512]
"""
import argparse
import glob
import os
import struct
import sys
import zlib

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_truth import TRUTH, FEN_CHARS, expand

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, '..', '..', 'data', 'ml'))
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'


# --- data ---------------------------------------------------------------------

def tiles_from_board_png(path):
    img = Image.open(path).convert('L')
    if img.size != (512, 512):
        img = img.resize((512, 512), Image.BILINEAR)
    name = os.path.basename(path)[:-4]
    placement = name.replace('-', '')
    if len(placement) != 64:
        return None
    out = []
    for i, ch in enumerate(placement):
        if ch not in FEN_CHARS:
            return None
        row, col = divmod(i, 8)
        tile = img.crop((col * 64, row * 64, (col + 1) * 64, (row + 1) * 64))
        out.append((np.asarray(tile.resize((40, 40), Image.BILINEAR), dtype=np.uint8), FEN_CHARS.index(ch)))
    return out


def board_split(name):
    """Deterministic 10% validation split keyed on the board, not the tile."""
    return zlib.crc32(name.encode()) % 10 == 0


def load_all(npz_glob):
    train_x, train_y, val_x, val_y = [], [], [], []
    sources = glob.glob(os.path.join(DATA, 'linrock', 'images', 'chessboards', '*', '*.png'))
    sources += glob.glob(os.path.join(DATA, 'print-boards', '*', '*.png'))
    boards = 0
    for path in sources:
        tiles = tiles_from_board_png(path)
        if tiles is None:
            continue
        boards += 1
        dest_x, dest_y = (val_x, val_y) if board_split(os.path.basename(path)) else (train_x, train_y)
        for img, label in tiles:
            dest_x.append(img)
            dest_y.append(label)
    print(f'{boards} labeled boards')
    for npz in glob.glob(os.path.join(DATA, npz_glob)):
        blob = np.load(npz)
        images, labels = blob['images'], blob['labels']
        # Pseudo-labels carry no board identity worth validating against
        # (the teacher labeled them) — all go to train.
        train_x.extend(images)
        train_y.extend(labels)
        print(f'{os.path.basename(npz)}: {len(labels)} pseudo-labeled tiles')
    return (np.stack(train_x), np.array(train_y, dtype=np.int64),
            np.stack(val_x), np.array(val_y, dtype=np.int64))


def load_eval11():
    boards = []
    for n, fen in TRUTH.items():
        path = os.path.join(DATA, 'eval-11', f't{n}.board.gray')
        with open(path, 'rb') as f:
            w, h = struct.unpack('<II', f.read(8))
            img = Image.frombytes('L', (w, h), f.read())
        tiles = []
        for row in range(8):
            for col in range(8):
                tile = img.crop((col * 64, row * 64, (col + 1) * 64, (row + 1) * 64))
                tiles.append(np.asarray(tile.resize((32, 32), Image.BILINEAR), dtype=np.uint8))
        labels = [FEN_CHARS.index(c) for c in expand(fen)]
        boards.append((np.stack(tiles), np.array(labels, dtype=np.int64)))
    return boards


def augment(batch):
    """batch: float tensor [B,1,40,40] in 0..1 -> [B,1,32,32], augmented."""
    b = batch.shape[0]
    # Random 32x32 crop (translation robustness — sloppy handle placement).
    ox = torch.randint(0, 9, (b,))
    oy = torch.randint(0, 9, (b,))
    idx = torch.arange(32)
    rows = (oy[:, None] + idx[None, :])
    cols = (ox[:, None] + idx[None, :])
    out = batch[torch.arange(b)[:, None, None], 0, rows[:, :, None], cols[:, None, :]].unsqueeze(1)
    # Photometric: gamma-ish contrast, brightness, noise, occasional blur/invert-safe ops.
    gain = 1.0 + 0.25 * (torch.rand(b, 1, 1, 1, device=out.device) - 0.5)
    bias = 0.2 * (torch.rand(b, 1, 1, 1, device=out.device) - 0.5)
    out = (out - 0.5) * gain + 0.5 + bias
    blur_mask = torch.rand(b, device=out.device) < 0.3
    if blur_mask.any():
        k = torch.tensor([[1., 2., 1.], [2., 4., 2.], [1., 2., 1.]], device=out.device) / 16
        blurred = F.conv2d(out, k.view(1, 1, 3, 3), padding=1)
        out = torch.where(blur_mask.view(-1, 1, 1, 1), blurred, out)
    out = out + 0.04 * torch.randn_like(out) * torch.rand(b, 1, 1, 1, device=out.device)
    return out.clamp(0, 1)


# --- model --------------------------------------------------------------------

class CellNet(nn.Module):
    """~59k params (59,077, printed at startup); small enough for hand-rolled TS inference."""

    def __init__(self):
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(1, 24, 3, padding=1), nn.BatchNorm2d(24), nn.ReLU(),
            nn.Conv2d(24, 24, 3, padding=1), nn.BatchNorm2d(24), nn.ReLU(),
            nn.MaxPool2d(2),  # 16
            nn.Conv2d(24, 48, 3, padding=1), nn.BatchNorm2d(48), nn.ReLU(),
            nn.MaxPool2d(2),  # 8
            nn.Conv2d(48, 96, 3, padding=1), nn.BatchNorm2d(96), nn.ReLU(),
            nn.AdaptiveAvgPool2d(1),
        )
        self.head = nn.Linear(96, len(FEN_CHARS))

    def forward(self, x):
        return self.head(self.features(x).flatten(1))


def evaluate_eval11(model, boards):
    model.eval()
    total = correct = perfect = 0
    with torch.no_grad():
        for tiles, labels in boards:
            x = torch.from_numpy(tiles).float().div_(255).unsqueeze(1).to(DEVICE)
            pred = model(x).argmax(1).cpu().numpy()
            hits = int((pred == labels).sum())
            total += 64
            correct += hits
            perfect += hits == 64
    return correct / total, perfect


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--epochs', type=int, default=16)
    ap.add_argument('--batch', type=int, default=512)
    ap.add_argument('--lr', type=float, default=3e-3)
    ap.add_argument('--npz', default='real-*.npz', help='pseudo-label glob under data/ml')
    ap.add_argument('--out', default='cellnet-best.pt')
    ap.add_argument('--init', default=None, help='warm-start weights (fine-tune) under data/ml')
    args = ap.parse_args()

    torch.manual_seed(3)
    train_x, train_y, val_x, val_y = load_all(args.npz)
    eval11 = load_eval11()
    print(f'train {len(train_y)} tiles, val {len(val_y)} tiles, device {DEVICE}')

    tx = torch.from_numpy(train_x).to(DEVICE)
    ty = torch.from_numpy(train_y).to(DEVICE)
    vx = torch.from_numpy(val_x).float().div(255).unsqueeze(1).to(DEVICE)
    vx = vx[:, :, 4:36, 4:36]  # center crop to 32
    vy = torch.from_numpy(val_y).to(DEVICE)

    model = CellNet().to(DEVICE)
    if args.init:
        model.load_state_dict(torch.load(os.path.join(DATA, args.init), map_location=DEVICE, weights_only=True))
        print(f'warm-started from {args.init}')
    print(sum(p.numel() for p in model.parameters()), 'parameters')
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)

    n = len(ty)
    best = (0.0, 0)
    for epoch in range(args.epochs):
        model.train()
        order = torch.randperm(n, device=DEVICE)
        running = 0.0
        for at in range(0, n, args.batch):
            idx = order[at:at + args.batch]
            x = tx[idx].float().div(255).unsqueeze(1)
            x = augment(x)
            loss = loss_fn(model(x), ty[idx])
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            running += loss.item() * len(idx)
        sched.step()

        model.eval()
        with torch.no_grad():
            val_acc = (model(vx).argmax(1) == vy).float().mean().item()
        r11_acc, r11_perfect = evaluate_eval11(model, eval11)
        marker = ''
        if (r11_acc, val_acc) > best:
            best = (r11_acc, val_acc)
            torch.save(model.state_dict(), os.path.join(DATA, args.out))
            marker = '  <- saved'
        print(f'epoch {epoch + 1:2d}: loss {running / n:.4f}  val {val_acc * 100:.2f}%  '
              f'real-11 {r11_acc * 100:.2f}% ({r11_perfect}/11 perfect){marker}')

    print(f'best real-11: {best[0] * 100:.2f}%  (baseline linrock: 99.43%)')


if __name__ == '__main__':
    main()
