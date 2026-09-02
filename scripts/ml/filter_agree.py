"""Agreement-filter pseudo-labels: keep a tile only when the stage-1 student
(trained WITHOUT these labels) confidently agrees with the teacher. Removes
the teacher's systematic errors, which a confidence threshold alone cannot —
the teacher is confidently wrong in a consistent direction.

Usage (torch-env):
  python filter_agree.py <stage1.pt> <in.npz> <out.npz>
"""
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import CellNet

# NOTE: the student trains with label smoothing 0.05, which caps its softmax
# near 0.95 — a high confidence gate here would (did) drop everything. The
# teacher already applied >=0.999; student agreement is the real filter.
CONFIDENCE = 0.8


def main():
    ckpt, in_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    model = CellNet().to(device)
    model.load_state_dict(torch.load(ckpt, map_location=device, weights_only=True))
    model.eval()

    blob = np.load(in_path)
    images, labels = blob['images'], blob['labels']
    keep = np.zeros(len(labels), dtype=bool)
    with torch.no_grad():
        for at in range(0, len(labels), 4096):
            x = torch.from_numpy(images[at:at + 4096]).float().div_(255).unsqueeze(1).to(device)
            probs = torch.softmax(model(x[:, :, 4:36, 4:36]), 1)
            conf, pred = probs.max(1)
            agree = (pred.cpu().numpy() == labels[at:at + 4096]) & (conf.cpu().numpy() >= CONFIDENCE)
            keep[at:at + 4096] = agree
    np.savez_compressed(out_path, images=images[keep], labels=labels[keep])
    dropped = len(labels) - int(keep.sum())
    print(f'{in_path}: kept {int(keep.sum())}/{len(labels)} '
          f'(dropped {dropped}, {100 * dropped / len(labels):.2f}% disagreement)')


if __name__ == '__main__':
    main()
