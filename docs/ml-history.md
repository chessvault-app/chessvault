# ML history

*English · [한국어](ml-history.ko.md)*

How the book reader got good, in order, with the numbers. The recurring
theme: **the books label their own training data** — every stage mines
supervision from what the pipeline already validated, so accuracy
compounds without hand annotation.

## 1. CellNet, the cell classifier

A ~59k-parameter CNN (32×32 gray tile → 13 classes, linrock-compatible
order) shipped as `web/public/models/cellnet-v1.bin` and run in pure JS
in the browser (and in the pipeline). Trained on: the linrock corpus,
synthetic print diagrams in classic fonts (Merida/Alpha/Berlin), and
pseudo-labeled tiles harvested from the books themselves. Baseline to
beat on the 11-board hand-labeled holdout: linrock's 99.43%.

**The 64-cell trap:** 99.4% per-cell sounds solved but compounds to
`0.994^64 ≈ 68%` of boards fully correct — and replay validation is
all-or-nothing. Observed numbers matched the math almost exactly
(980 boards → 702 clean). Every later stage exists because of this gap.

## 2. Text side: measurement first (the 1001 book)

Instrumenting the failures showed text, not boards, dominated the tail:
of 143 never-matched puzzles, 83 numbers were simply absent from the
PDF's text layer; 218/230 replay-failed boards had zero uncertain
cells. Conclusions before building anything — this measurement step is
the reason the later work landed where it mattered.

- **Digit-label reader** (`digit_labels.py`): text-layer word boxes of
  the 858 matched numbers → 2,769 exact digit crops → nearest-centroid
  model (99.86% 5-fold) → reads printed numbers above diagrams
  (855/858 end-to-end). Recovered 125 of the 143 lost numbers, all
  sequence-consistent. Debug lessons: neighbouring caption text poisons
  naive harvesting; detected rects sit slightly above the printed board,
  so a strip cut at `rect.y` beheads digits ('2' minus its base bar
  reads as '7').
- **Figurine-glyph reader** (`figurine_glyphs.py`): validated entries
  align printed tokens with known SAN, labeling ~1,600 glyph crops via
  word boxes (99.7% 5-fold); per-prefix majority votes yield 204
  prefix→piece hints covering the prefixes too rare for the text-only
  dialect (which needs ≥5 sightings). +24 validated.
- **Chapter side guard:** every chapter page prints "White/Black to
  move"; a retry with the stated side rescued zero — proving the
  OCR-dots side detection was already sound and the residue was
  board-side. Negative results steer too.

## 3. Board side: search before training

- **Solution-constrained repair** (measure `--repair`): the validated
  solution text is a checksum strong enough to find misread cells. Try
  runner-up labels (TTA-vote-prioritised) for 1–2 cells; accept only a
  unique position that replays the whole line. 1001: +30. Woodpecker:
  +141. Ambiguous ties (several positions replay) are never guessed —
  they export as candidates and the **import's engine settles them**
  (unique decisive line overlapping the book's mentioned squares →
  book solution): +16, +21 on Woodpecker runs.
- **Sanity gate** (`saneCounts`): Woodpecker exposed that replay can
  succeed with an inert phantom piece (its margin digits warped into
  the cells and read as a rook file — 118 of 140 "validated" boards
  were corrupt). Every replay now requires reachable piece counts.
  The visible symptom that led here: draft thumbnails looked sheared —
  bad crops are diagnostics, which is also why draft thumbnails now
  show the raw page crop, never the warped board.
- **Coordinate gutters** (`cropTrim`): Quality Chess prints coordinates
  outside the frame; trimming the gutter before corner detection took
  Woodpecker from 878 illegal reads to 261.

## 4. Closing the flywheel: fine-tuning CellNet on itself

`build_validated_npz.py` turns every validated board across the books
into 64 labeled tiles — 1,763 boards → 112,832 tiles, *including
repaired fens*, so the model learns from its own corrected mistakes.
Four warm-started CPU epochs (511k tiles total with the older corpora):
holdout **100% (11/11 boards)**, val 99.49%. Re-reading Woodpecker with
the new weights: illegal 261→57, validated 509→619, drafts 301→82,
imported 823→1,042. Recipe: `build_validated_npz.py` → `train.py
--init cellnet-best.pt` → `export_weights.py <ckpt>` (regenerates the
browser bin + golden parity vectors) → delete `<slug>-reads.json` →
re-measure.

## 5. Engineering that made iteration cheap

- Read cache with rects/sides; `--jobs N` process-sharding for reads
  and repair; a persistent engine cache keyed by position+budget. A
  full book cycle fell from ~47 minutes to ~10, re-imports to ~1.
- In the app, CellNet inference runs in a Web Worker and whole-book
  scans are a background job — the 47-minute lesson applied to UX.

## Standing lessons

1. Measure the failure tail before building; attribute each failure to
   its stage.
2. Prefer self-supervision: validated output from stage N is training
   data for stage N+1.
3. Validation gates must close loopholes as they're found (mate check,
   sanity counts, uniqueness-or-nothing repairs).
4. Distrust "high accuracy" on compound tasks — per-unit accuracy is
   not per-artifact accuracy.
5. Keep the human in the loop cheap: drafts carry evidence crops and
   solution-page peeks so hand-fixing a residue puzzle takes seconds.
6. A searched setting whose underlying fact is ABSENT will win on noise.
   The config search picked "the book prints the side to move" for a book
   that prints no side; with the fact missing the flag only changed which
   side was tried second, so it gained a point on chance and cost the
   import fifteen puzzles. Search only over facts you have checked exist.
7. Score the COST beside the gain. Board repair buys 26 puzzles for
   twenty minutes; reading the printed piece symbols buys 23 for a fifth
   of a second. Equal-looking gains, and only one of them belongs in
   front of somebody waiting — which is why one is a checkbox and the
   other is simply on.
8. What a measurement is taken THROUGH can be the thing that is broken.
   A cache holding boards fresh detection no longer finds, an automated
   browser that never fires scroll events, timers clamped in a background
   tab: each looked like a result until it was checked.
