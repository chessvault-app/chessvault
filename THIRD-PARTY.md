# Third-party code, data and assets

What this app ships that somebody else made, and under what terms. Kept
because "we are GPL-3.0" covers our own code and says nothing about a
bundled engine's obligations or an artist's attribution.

Anything **bundled** travels with the app to whoever installs or visits it,
so its licence has to travel too. Anything **development-only** never leaves
this machine.

## Bundled

| What | Where | Licence | Notes |
| --- | --- | --- | --- |
| Stockfish 18 (WASM) | `web/public/engine/` | GPL-3.0 | Licence shipped beside the binaries as `LICENSE.txt`. Source: <https://github.com/official-stockfish/Stockfish> and <https://github.com/lichess-org/stockfish.wasm> |
| chessground | npm, bundled into `dist/` | GPL-3.0 | lichess-org/chessground |
| chessops | npm, bundled into `dist/` | GPL-3.0 | niklasf/chessops |
| pdf.js | `web/public/pdfjs-wasm/`, npm | Apache-2.0 | mozilla/pdf.js |
| sql.js (static demo only) | `web/public/sqljs/` | MIT | sql-js/sql.js |
| lucide icons | npm, bundled | ISC | lucide-icons/lucide |
| ECO opening names | `scripts/vendor/chess-openings/*.tsv` | see its `README.md` | lichess-org/chess-openings |
| Lichess puzzles | `data/puzzles.sqlite`, demo subset | CC0 | <https://database.lichess.org/#puzzles> |
| Reference games | `data/refgames.sqlite`, demo subset | derived from the Lichess database (CC0) | Not Lumbra's Gigabase, which is CC BY-NC-SA and would restrict a public demo |
| CellNet weights | `web/public/models/cellnet-v1.bin` | ours (GPL-3.0) | Trained partly on scans of commercial books; the weights carry none of their content, and no book content is redistributed |

## Piece sets and sounds — checked against lila's COPYING.md

| What | Author | Licence | Verdict |
| --- | --- | --- | --- |
| cburnett (board pieces, app icon, favicon, landing mark) | Colin M.L. Burnett | GPLv2+ | Fine. GPLv2+ combines with our GPL-3.0, and attribution is here |
| merida | Armando Hernandez Marroquin | GPLv2+ | Fine |
| chessnut | Alexis Luengas | Apache 2.0 | Fine |
| pirouetti | pirouetti | **AGPLv3+** | See below |
| move / capture sounds | unknown | **unknown** | See below |

### pirouetti is AGPL, and this app is served over a network

AGPLv3 §13 requires that users interacting with the software *over a
network* be offered its source. A self-hosted vault reachable by its owner
is arguable; a public demo on the open web is not. Shipping the pirouetti
set from a public deployment while this repository is private is the one
combination that does not work.

Three ways out, any of which is fine:

1. publish the source — already the plan, and it settles this completely;
2. drop pirouetti and keep the other three, which are GPLv2+ and Apache;
3. keep it and put a visible source offer in the app.

Until one of those is done, **the static demo should not ship pirouetti**.

### The sounds are not accounted for

lila licenses its sound *collections* individually — futuristic, nes, piano
and sfx are AGPLv3+ by Enigmahack, lisp is CC BY-NC-SA 4.0 — and lists
others under "Exceptions (non-free)". Our `Move.mp3` and `Capture.mp3` match
none of those names, and where they came from was never written down.

An unattributable asset that may be non-free is worse than no sound at all
on a public site. Either identify them against lila's list and record it
here, or replace them: two short clicks are trivial to synthesise or to take
from a CC0 source, and that ends the question permanently.

## Development only — never shipped

Training corpora (linrock's set, MIT), the diagram fonts used to render
synthetic training boards (Chess Merida, Chess Alpha, Chess Berlin — fetched
by URL, not redistributed), and the scanned book PDFs, which are the owner's
own copies. None of these are in the repository or in any build.

## Book puzzles

Puzzles imported from commercial books stay in the vault and are never
published. The static demo does not mount that API at all, and its seed
contains none. See `docs/book-import-pipeline.md`.
