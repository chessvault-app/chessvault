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

1. **Text layer dump** — `extract_pdf_words.py <book.pdf> <out.json>`:
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
2b. **Upside-down pages** — `derotate.ts <pages_dir> --book <cfg>`: finds
   pages that hold diagrams but offer no numbers and no ordinary English,
   rotates their renders back, and recovers their numbering from the gap
   it leaves — only where the gap is exactly as wide as the run has
   diagrams. Emits an `--extra-labels` file for a second measure pass.
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
is printed (`chapter` header, per-puzzle `label` "White to play", or a
bare `letter` W/B under the number), label-matching window, and
`cropTrim` for books that print coordinates in a gutter outside the
frame. The 1001 book's config encodes the original defaults.

Books that put an answers section after **every chapter** instead of one
at the back list their spans in `solutionRanges` (`[[28,33],[45,48],…]`),
which replaces the "everything after `solutionsAfterPage`" rule — that
rule would swallow the puzzle pages sitting between the sections. Add `pdf` (the file's NAME, not its path — point `CHESS_BOOK_PDFS` at
wherever your copies live) and `coverPage` so `render_book_pages.py` can
find the source. Configs are committed; nobody's disk layout should be.

## Runbook (per book)

```
# once: extract text, write the config, render pages
python extract_pdf_words.py book.pdf data/ml/<slug>-text.json
python harvest_pdfs.py book.pdf data/ml/<slug>-pages          # page-NNN.gray
npx tsx autoimport-measure.ts <renders> --book cfg.json --emit <emit> --repair --jobs 6
npx tsx derotate.ts <renders> --book cfg.json                 # if any page is upside down
npx tsx autoimport-measure.ts <renders> --book cfg.json --emit <emit> --repair --jobs 6   --extra-labels data/ml/<slug>-extra-labels.json
npx tsx autoimport-import.ts  <emit>    --book cfg.json --jobs 6
python evidence_jpegs.py
python render_book_pages.py cfg.json                          # cover + answers
python enrich_solution_pages.py cfg.json
```

Caveats: a re-import wipes `diagrams/` — cover and solution-page jpgs
must be restored after `evidence_jpegs.py`, which is what
`render_book_pages.py` is for. Progress survives because puzzle ids are
`n<number>`. To re-read boards (e.g. after a model update) delete
`<slug>-reads.json` first; otherwise reads come from cache and only
validation reruns.

## Results so far (bootstrap phase)

| Book | Imported | Book solutions | Drafts |
| --- | --- | --- | --- |
| 1001 Chess Exercises for Beginners | 970 / 1001 | 739 | 10 |
| The Complete Chess Workout | 1,145 / 1,200 | 530 | 0 |
| The Woodpecker Method | 1,043 / 1,128 | 619 | 81 |
| The Ultimate Chess Puzzle Book | 689 / 1001 | 204 | 166 |
| 5334 Problems, Combinations and Games | 4,878 / 5,334 | 4,878 | — |

The Ultimate Chess Puzzle Book is the weakest of the scans. Ten of its
pages were scanned upside down; `derotate.ts` turns those back over and
recovers their numbering from the gap they leave (855 of its 1001
diagrams now find a number, up from 778). What still holds it back is its
answers, which are prose with the moves embedded in sentences — the
mainline parser handles that badly, and it is where the remaining room
is.

**5334 did not use this pipeline at all** — see below.

## Two importers that skip the scan

Neither of these is a per-book script: like everything else here, the
book's own facts live in `scripts/ml/books/*.json` and the code never
knows which book it is reading.

### `import-diagram-text.ts` — diagrams that are already text

    npx tsx scripts/ml/import-diagram-text.ts --book scripts/ml/books/<slug>.json

For books typeset in LaTeX with a diagram font, where every position is
already in the text as one character per square (two glyphs per piece, one
for light squares and one for dark) and every solution is plain algebraic.
Nothing is recognised; it is read.
Every entry is still replayed with chessops before it is imported, which
is what catches a misread entry and what locates the printed position
inside the 600 miniature games, whose answer is the whole game score.

It writes no drafts: a draft exists so a human can re-read a board the
importer could not, and here the boards are exact — it is the remaining
SOLUTIONS that fail to parse. Those numbers are printed by the run with
the reason, and a better parser picks them up in place, since ids are
`n<number>`.

The lesson generalises: **check the text layer for diagram glyphs before
reaching for CellNet.** It costs one `pdftotext` and can turn a week of
model work into an afternoon.

### `import-annotated-games.ts` — a book of annotated games as a study

    python scripts/ml/extract_pdf_lines.py "<book>.pdf" data/ml/<slug>-lines.json
    npx tsx scripts/ml/import-annotated-games.ts --book scripts/ml/books/<slug>.json

Writes one study chapter per game, each move carrying the book's note on
it. Moves are told from commentary by layout, not by font, and no token is
ever read: every legal move is scored against the scanned wreckage and the
whole game is searched depth-first for the reading under which every
printed move still resolves. A game that will not replay end to end is
reported, not written.

The scan's own confusions — which characters it uses for which rank, which
files it mixes up, which squares it collapses into one glyph — are in the
book's config, because they belong to that scan and to no other.

(Latest round: re-measured with the fine-tuned CellNet and the 3-cell
repair search. Progress survives a re-import because puzzle ids are
`n<number>`, so the vault can be updated in place as the pipeline
improves.)

The plan of record: when bootstrapping ends, every book is re-imported
from scratch with the then-current model and pipeline.
