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

## Bundled, and NOT yet cleared — see below

| What | Where | Status |
| --- | --- | --- |
| Piece sets: Merida, Chessnut, Pirouetti | `web/src/piece-sets.css` (inline SVG) | **Unverified.** Vendored from lila, whose sets are individually licensed — some CC BY-SA, some free for non-commercial use only |
| cburnett knight (app icon, favicon, landing mark) | `web/public/`, `web/src/ui/KnightIcon.tsx`, `web/landing/` | Colin M.L. Burnett, CC BY-SA 3.0 / GFDL / BSD. Usable with attribution; used here as a brand mark, which is a stronger claim than using it as a board piece |
| Move and capture sounds | `web/public/sound/` | **Unverified.** Provenance not recorded |

### What has to happen before a public release

1. Check each piece set against lila's own `COPYING.md` and either record the
   licence here or remove the set. A set licensed for non-commercial use only
   is a problem for a public demo, not merely an attribution gap.
2. Do the same for the sounds.
3. Decide whether the cburnett knight stays as the brand mark. It may, with
   attribution; an original mark avoids the question entirely.

## Development only — never shipped

Training corpora (linrock's set, MIT), the diagram fonts used to render
synthetic training boards (Chess Merida, Chess Alpha, Chess Berlin — fetched
by URL, not redistributed), and the scanned book PDFs, which are the owner's
own copies. None of these are in the repository or in any build.

## Book puzzles

Puzzles imported from commercial books stay in the vault and are never
published. The static demo does not mount that API at all, and its seed
contains none. See `docs/book-import-pipeline.md`.
