"""Render every page of the tactics-book PDFs to raw grayscale dumps so the
Node side (harvest-align.ts) can run the app's own diagram detection over
them. Driven per-book to bound disk use.

Usage: python harvest_pdfs.py <book.pdf> <out_dir>
"""
import os
import struct
import sys

import pymupdf

RENDER_WIDTH = 1400  # matches the app's PdfImport

def main():
    pdf_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    for n, page in enumerate(doc):
        zoom = RENDER_WIDTH / page.rect.width
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
        with open(os.path.join(out_dir, f'page-{n + 1:03d}.gray'), 'wb') as f:
            f.write(struct.pack('<II', pix.width, pix.height))
            f.write(bytes(pix.samples))
    print(f'{os.path.basename(pdf_path)}: {len(doc)} pages -> {out_dir}')

if __name__ == '__main__':
    main()
