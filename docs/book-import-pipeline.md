# Book import pipeline

Turns a scanned tactics-book PDF into a vault puzzle book: positions,
verified solutions, per-puzzle evidence images, and honest fidelity
tiers. Everything runs locally; only the resulting vault files matter.

## The core idea: the book proves itself

A puzzle is only imported as a **book solution** when the whole chain
agrees: the diagram was read into a position, the printed solution was
parsed into moves, and replaying those moves on that position is legal
(with any claimed mate actually mate, and the position passing a
piece-count reachability gate). One success validates all three inputs
at once. Everything that fails the chain degrades gracefully into
engine-backed tiers or drafts — nothing is silently dropped.

## Stages (`scripts/ml/`)

1. **Text layer dump** — `extract_1001_text.py <book.pdf> <out.json>`:
   pymupdf word boxes + page text.
2. **Measure** — `autoimport-measure.ts <pages_dir> --book <cfg>`:
   per page, detect diagrams, match each to its printed number, read the
   64 cells with CellNet, parse the solutions chapter, replay. Passes:
   - pass 1: plain replay;
   - pass 2: the learned **figurine dialect** (garbage OCR prefixes →
     pieces, learned from this book's own validated entries);
   - pass 3: `--glyph-hints` (image-read figurine glyphs, see below);
   - pass 4: `--repair` — solution-constrained board repair: retry the
     line under the classifier's runner-up labels (1-cell anywhere,
     2-cell among the least-confident, test-time-augmentation votes
     prioritised); accept only a UNIQUE working position; ties export
     as `repairCandidates`.
   `--jobs N` shards page reads and the repair search across N child
   processes. Reads cache to `<slug>-reads.json` (with rects and sides);
   `--emit <dir>` dumps board/page grays for evidence images.
3. **Import** — `autoimport-import.ts <emit_dir> --book <cfg> --jobs N`:
   tiers every entry. Validated → book-parsed; else Stockfish solves the
   read position — decisive + overlapping the squares the book's entry
   mentions → engine-corroborated; decisive alone → engine-only; legal +
   known side → engine-unverified; rest → drafts. Repair ties are
   settled here: exactly one candidate whose engine line is decisive and
   square-corroborated imports as a book solution. Engine results cache
   to `<report>-engine-cache.json`, so re-imports are cheap. Writes the
   vault book (puzzles/drafts/book.json + evidence manifest).
4. **Evidence images** — `evidence_jpegs.py` converts emitted grays.
5. **Solution pages** — `enrich_solution_pages.py --book <cfg>` stamps
   every puzzle/draft with the solutions-chapter page covering its
   number (rendered separately into `diagrams/`), so the trainer can
   peek at the printed answer.

Self-supervised text helpers (both take `--book`):
- `digit_labels.py` — learns the book's digit shapes from text-layer
  word boxes of already-matched numbers, then reads the printed number
  above any diagram the text layer lost (`--extra-labels` feeds the
  recoveries back into measure).
- `figurine_glyphs.py` — aligns validated entries' printed tokens with
  known SAN to label figurine glyph crops, then reads every garbage
  prefix and emits prefix→piece hints for pass 3.

## Per-book configs (`scripts/ml/books/*.json`)

Every book-specific fact is data: page ranges, artifact paths, number
style (`bare` digits vs `123)`), solutions anchor (`N - 1.` / `N) Name`
/ `N. Name`), move markers (dotted vs dotless), where the side to move
is printed (chapter header vs per-puzzle label), label-matching window,
and `cropTrim` for books that print coordinates in a gutter outside the
frame. The 1001 book's config encodes the original defaults.

## Runbook (per book)

```
# once: extract text, write the config, render pages
python extract_1001_text.py book.pdf data/ml/<slug>-text.json
<render pages P0..P1 at 1400px as page-NNN.gray>          # pymupdf
npx tsx autoimport-measure.ts <renders> --book cfg.json --emit <emit> --repair --jobs 6
npx tsx autoimport-import.ts  <emit>    --book cfg.json --jobs 6
python evidence_jpegs.py
<render cover + solution pages into vault diagrams/>       # pymupdf
python enrich_solution_pages.py cfg.json
```

Caveats: a re-import wipes `diagrams/` — cover and solution-page jpgs
must be restored after `evidence_jpegs.py`. Progress survives because
puzzle ids are `n<number>`. To re-read boards (e.g. after a model
update) delete `<slug>-reads.json` first; otherwise reads come from
cache and only validation reruns.

## Results so far (bootstrap phase)

| Book | Imported | Book solutions | Drafts |
| --- | --- | --- | --- |
| 1001 Chess Exercises for Beginners | 970 / 1001 | 739 | 10 |
| The Complete Chess Workout | 1,145 / 1,200 | 530 | 0 |
| The Woodpecker Method | 1,043 / 1,128 | 619 | 81 |

(Latest round: re-measured with the fine-tuned CellNet and the 3-cell
repair search. Progress survives a re-import because puzzle ids are
`n<number>`, so the vault can be updated in place as the pipeline
improves.)

The plan of record: when bootstrapping ends, every book is re-imported
from scratch with the then-current model and pipeline.
