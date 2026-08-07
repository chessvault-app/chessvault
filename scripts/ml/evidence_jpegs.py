"""Convert the emitted evidence grays into vault jpegs, per the manifest
written by autoimport-import.ts. Boards -> 384px, pages -> 1100px wide.

Usage: python evidence_jpegs.py
"""
import json
import os
import struct

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.normpath(os.path.join(HERE, '..', '..', 'data', 'ml', 'evidence-manifest.json'))


def load_gray(path):
    with open(path, 'rb') as f:
        w, h = struct.unpack('<II', f.read(8))
        return Image.frombytes('L', (w, h), f.read())


def main():
    spec = json.load(open(MANIFEST))
    os.makedirs(spec['target'], exist_ok=True)
    done = missing = 0
    for name in spec['names']:
        src = os.path.join(spec['emitDir'], f'{name}.gray')
        if not os.path.exists(src):
            missing += 1
            continue
        img = load_gray(src)
        if name.startswith('page'):
            scale = 1100 / img.width
        else:
            scale = 384 / img.width
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.BILINEAR)
        img.save(os.path.join(spec['target'], f'{name}.jpg'), quality=72)
        done += 1
    print(f'{done} evidence jpegs -> {spec["target"]} ({missing} missing grays)')


if __name__ == '__main__':
    main()
