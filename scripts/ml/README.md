# Diagram-OCR model pipeline

## Text-side models (stage 1: number labels — `digit_labels.py`)

The PDF text layer loses 83 of the 1001 puzzle numbers (and its OCR of the
solutions is figurine garbage), so text is learned from the book itself:
the 858 already-matched puzzles provide exact digit crops via the text
layer's word boxes (`harvest`, ~2,770 samples, 99.86% 5-fold), and a
nearest-centroid model + component segmentation reads the printed number
above any diagram rect (`selftest`: 855/858 end-to-end). Feeding it every
detected-but-unmatched diagram (`dump-rects` over the page renders, then
`read`) recovered 125 of the 143 lost numbers, all sequence-consistent —
see `data/ml/recovered-numbers.json` + `all-diagram-rects.json`
(`pages-extra/` holds renders of the 16 pages the vault lacked). Env:
`python -m uv venv data/ml/venv -p 3.12` + `numpy pillow pymupdf`.
Stage 2 shipped (`figurine_glyphs.py`): validated entries align printed
tokens with known SAN, labeling 1,600+ figurine glyph crops via the word
boxes (99.7% 5-fold); reading every prefix word yields 204 prefix→piece
hints that `autoimport-measure --glyph-hints` applies as pass 3 — +24
validated over the text-only dialect. A full CRNN line reader remains the
next escalation for the ~250 replay-fails that aren't ambiguity-shaped.


Trains the cell classifier used by photo/PDF diagram reading: 32×32 grayscale
tile → 13 classes (`1RNBQKPrnbqkp`, linrock-compatible order). Everything here
is a DEV-TIME tool — only the exported weights ship, inference runs in the
browser. Deployment (AWS cloud) never needs any of this, nor a GPU.

## Environments (uv-managed, throwaway)

- **torch-env** (Python 3.12): `uv venv … && uv pip install torch --index-url
  https://download.pytorch.org/whl/cu126` + `numpy pillow`. Training.
- **tf-env** (Python 3.10): `tensorflow==2.10 pillow "numpy<2" pymupdf
  fonttools`. Only needed to run the linrock teacher model for pseudo-labeling
  and the PDF render helpers.

## Data sources (all land in `data/ml/`, gitignored)

1. **linrock training set** — `training-images.zip` from
   github.com/linrock/chessboard-recognizer v0.4 (MIT). Board PNGs with the
   FEN in the filename (`-` between ranks, `1` per empty square); includes
   both online-board screenshots and book-scan sets.
2. **Print-font synthetics** — `gen_print.py` renders random placements with
   classic diagram fonts: Chess Merida (Marroquin, freeware; `merida-fixed.ttf`
   is MERIFONT.TTF with its symbol cmap rewritten to ASCII via fontTools),
   Chess Alpha (Bentzen, free) and Chess Berlin from CTAN's `enpassant` bundle
   (mirrors.ctan.org/fonts/chess/enpassant.zip); glyph maps parsed from the
   bundle's .enc files. `--verify` renders a start position per font — eyeball
   it after any mapping change.
3. **Pseudo-labeled real books** (the chessvision-style flywheel) —
   `harvest_pdfs.py` renders lanph3re's tactics-book PDFs, `harvest-align.ts` runs
   the app's own `detectDiagrams` + `detectBoardQuad` + warp over the pages,
   and `pseudo_label.py` keeps only tiles the teacher model calls at ≥0.999
   confidence (empties capped per board). Fonts, print artifacts and JBIG2
   noise come for free from the books themselves.

The 11 hand-labeled boards in `data/ml/eval-11/` + `eval_truth.py` are a pure
holdout — never trained on, reported every epoch. Baseline to beat: linrock
pretrained = 99.43%.

## Run order

```sh
# one-time data prep
python scripts/ml/gen_print.py --count 700
python scripts/ml/harvest_pdfs.py <book.pdf> <pages_dir>   # per book
npx tsx scripts/ml/harvest-align.ts <pages_dir> data/ml/harvest-boards <tag>
python scripts/ml/pseudo_label.py <teacher_model> data/ml/real-boards data/ml/real-1001.npz
python scripts/ml/pseudo_label.py <teacher_model> data/ml/harvest-boards data/ml/real-harvest.npz

# training (torch-env, GPU)
python scripts/ml/train.py --epochs 16
```

Outputs: `data/ml/cellnet-best.pt` (state dict). Export/browser format comes
with the integration step.

## Licensing

Training inputs only; none of these assets ship in the app. linrock code +
model: MIT. Merida/Alpha/Berlin fonts: freeware for this kind of use, not
redistributed (fetched by URL above). The books are lanph3re's own copies; the
trained weights carry none of their content.
