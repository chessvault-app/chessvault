# Importing a book from the shell

*English · [한국어](book-import-offline.ko.md)*

The app imports a PDF on its own and asks you nothing: open a puzzle
book, hand it the file, wait. **That is the supported route, and this
page is not a replacement for it.** What follows is the same import
driven from a terminal, which is worth the trouble in exactly three
cases:

- **you are re-importing.** Board reads and engine answers are cached to
  disk, so the second run over a book you have already read is seconds
  rather than minutes. The app re-reads every board every time.
- **you have a lot of cores.** `--jobs N` shards the page reads across N
  processes; the app's worker pool tops out at six.
- **you are changing the importer** and want to see what a change does to
  a whole book without sitting through a browser scan.

It is not dramatically faster for a first import. On a 12-core machine,
reading all 1,033 diagrams of *1001 Chess Exercises* takes 204 s with
`--jobs 6` against 314 s in the app — the same CellNet either way, and
about 948 ms of every board is that model. Where the shell wins is the
second run: 2 s, because it reads no pixels at all.

The price is that **you have to write the book's config yourself**. The
app works a book's notation out from the book; the offline stages refuse
to start without a file stating it, and getting that file right is most
of the work below.

## What you need

- **Node** — already there if you can run the app.
- **Python 3.12** with `pymupdf`, `pillow` and `numpy`. The ML README
  suggests a throwaway venv: `python -m uv venv data/ml/venv -p 3.12`.
- **No engine setup.** The tiering stage drives the Stockfish that came
  with `npm install`.
- **Your own PDF.** Nothing here fetches a book, and none is bundled.

## Where it writes

Straight into `vault/puzzlebooks/<id>/` **inside the repository** —
`puzzles.json`, `drafts.json`, `book.json` and the `diagrams/` images.
The folder is an id (`b` and sixteen hex characters), not the title: the
book is found by the title in its `book.json`, or made with a fresh id if
there is no book by that name yet, so running this twice lands in the
same book rather than beside it.
Note that this is the repo's own `vault/`: unlike the server, these
scripts do not read `CHESS_VAULT_DIR`, so if your vault lives elsewhere
you will need to move the folder afterwards. Refresh the app and the
book is there; puzzle ids are `n<number>`, so a re-import keeps whatever
progress you had.

## Starting a book nobody has read yet

The bootstrap is circular and the order matters: the stages need a
config, and the tool that works the config out needs boards, which only
exist once a stage has run. So you write a rough one, read the book with
it, and let the book correct you.

**1. Dump the text layer and render the pages.**

```bash
python scripts/ml/extract_pdf_words.py <book.pdf> data/ml/<slug>-text.json
```

```bash
python scripts/ml/harvest_pdfs.py <book.pdf> data/ml/<slug>-pages
```

**2. Write a rough config** at `scripts/ml/books/<slug>.json`. Only the
identity fields have to be right at this point; the notation is guessed
and fixed in step 4.

```json
{
  "slug": "<slug>",
  "title": "<the book's title, which is also its folder name>",
  "pages": [5, 105],
  "solutionsAfterPage": 100,
  "maxNumber": 1001,
  "text": "data/ml/<slug>-text.json",
  "cache": "data/ml/<slug>-reads.json",
  "report": "data/ml/<slug>-report.json",
  "anchorStyle": "dash",
  "moveMarkers": "dotless",
  "sideMode": "chapter"
}
```

`pages` is the first and last page holding puzzles, `solutionsAfterPage`
the page the answers start after, `maxNumber` the highest puzzle number
printed. Read those four off the book itself — they are the only facts
you supply that the book cannot tell you.

**3. Read the boards once.** This is the slow pass; everything after it
comes off the cache.

```bash
npx tsx scripts/ml/autoimport-measure.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json --jobs 6
```

**4. Let the book settle its own notation**, now that there are boards to
score candidates against. It prints a ranking and how the winner compares
with what your config currently claims.

```bash
npx tsx scripts/ml/search-config.ts --book scripts/ml/books/<slug>.json
```

Copy the winner into the config — `anchorStyle`, `moveMarkers`,
`sideMode` — and measure again. The second run reads no pixels, so it is
quick, and the number to watch is how many solutions validated.

```bash
npx tsx scripts/ml/autoimport-measure.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json --repair --emit data/ml/<slug>-emit --jobs 6
```

A book whose validated count stays near zero across every candidate has
not been read — its answers are shaped in a way the parser does not know,
and importing on those numbers would mint plausible-looking wrong
solutions. Import it as drafts and fix the parser, rather than believing
the run.

## The runbook, once the config is right

```bash
npx tsx scripts/ml/autoimport-measure.ts data/ml/<slug>-pages --book scripts/ml/books/<slug>.json --repair --emit data/ml/<slug>-emit --jobs 6
```

```bash
npx tsx scripts/ml/autoimport-import.ts data/ml/<slug>-emit --book scripts/ml/books/<slug>.json --jobs 6
```

```bash
python scripts/ml/evidence_jpegs.py
```

```bash
CHESS_BOOK_PDFS=<the folder holding your PDFs> python scripts/ml/render_book_pages.py scripts/ml/books/<slug>.json
```

```bash
python scripts/ml/enrich_solution_pages.py scripts/ml/books/<slug>.json
```

The measure stage validates what it can; the import stage tiers the rest
against the engine and writes the vault book. The last three restore the
evidence images — a re-import empties `diagrams/`, which is why the cover
and the answers pages have to be rendered back afterwards, and why
`render_book_pages.py` needs `pdf` and `coverPage` in the config plus
`CHESS_BOOK_PDFS` pointing at wherever your copies live.

If a page or ten was scanned upside down, `derotate.ts` turns them back
over and recovers their numbering; see the
[pipeline doc](book-import-pipeline.md) for that and for what each stage
does internally.

## Things that will bite you

- **Deleting the config's `cache` file is how you re-read boards.**
  Otherwise a measure run takes the cached reads and only re-validates,
  which is exactly what you want after a parser change and exactly what
  you do not want after a model change.
- **The folder is named by `title`, not `slug`.** Two configs with the
  same title write to the same book.
- **The engine cache lives beside the report** as
  `<report>-engine-cache.json`. Delete it to re-search positions.
- **Nothing here is a user-facing route.** If you find yourself wanting a
  shell for something a reader of the app would need to do, that is a
  missing feature in the app, not a reason to write a script.
