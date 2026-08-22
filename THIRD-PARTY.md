# Third-party code, data and assets

What this app ships that somebody else made, and under what terms.

Licence texts are in [`licenses/`](licenses/). Every build copies them into
its output and generates `licenses/index.html`, a list of everything with
each item's own licence text — reachable in the app under Settings →
Licences. The generated `licenses/dependencies.txt` is the same list as one
plain file.

## Bundled

Anything here travels with the app to whoever installs or visits it.

| What | Where | Licence |
| --- | --- | --- |
| Stockfish 18 (WASM) | `web/public/engine/` | GPL-3.0-or-later |
| chessground | npm, bundled into `dist/` | GPL-3.0-or-later |
| chessops | npm, bundled into `dist/` | GPL-3.0-or-later |
| pdf.js | `web/public/pdfjs-wasm/`, npm | Apache-2.0 |
| sql.js (static demo only) | `web/public/sqljs/` | MIT |
| fzstd (reads the zstd puzzle dump) | npm, bundled into the puzzle builder | MIT |
| lucide icons | npm, bundled | ISC |
| shadcn/ui component sources (what `npx shadcn add` writes into `web/src/components/ui/`, owned and reshaped here) | `web/src/components/ui/`, bundled into `dist/` | MIT |
| Radix UI primitives (`radix-ui`), tw-animate-css — what the shadcn/ui component layer is built on; the `shadcn` CLI itself is a dev dependency | npm, bundled into `dist/` | MIT |
| class-variance-authority (the component layer's variant sheet) | npm, bundled into `dist/` | Apache-2.0 |
| Pretendard, JetBrains Mono | npm, bundled as woff2 | OFL-1.1 |
| ECO opening names | `scripts/vendor/chess-openings/*.tsv` | CC0-1.0 |
| Bundled starter reference games (the strongest games of each opening, one Lichess Elite month) | `assets/refgames-*.sqlite`, copied into `data/refgames/` on first run | CC0-1.0, derived from the Lichess database |
| Lichess puzzles | `data/puzzles.sqlite`, demo subset | CC0-1.0 |
| Reference games | `data/refgames/`, demo subset | CC0-1.0, derived from the Lichess database |
| ~220 other npm packages (the build regenerates the exact list) | bundled or shipped beside the server | MIT, ISC, BSD-2-Clause, 0BSD, Apache-2.0, Python-2.0, BlueOak-1.0.0 |
| Electron, and with it Chromium and Node | desktop installer only | MIT, plus 773 components listed in `LICENSES.chromium.html` |

The npm list is generated from `node_modules` at build time, so it cannot go
stale. Electron is a devDependency — nothing imports it — but the desktop
installer is Electron, so it is listed too. electron-builder places
`LICENSE.electron.txt` and `LICENSES.chromium.html` at the root of the
installed app.

## Piece sets and sounds

| What | Author | Licence |
| --- | --- | --- |
| cburnett (pieces; the knight and king glyphs drawn in the UI) | Colin M.L. Burnett | GPL-2.0-or-later |
| merida | Armando Hernandez Marroquin | GPL-2.0-or-later |
| chessnut | Alexis Luengas | Apache-2.0 |
| pirouetti | pirouetti | AGPL-3.0-or-later |
| fantasy, spatial, celtic | Maurizio Monge | MIT |
| kiwen-suwi | neverRare | CC-BY-4.0 |
| mpchess | Maxime Chupin | GPL-3.0-or-later |
| rhosgfx | RhosGFX | CC0-1.0 |
| move / capture sounds | ours | GPL-3.0-only |

The piece sets are vendored from lila as base64, one lazily-loaded file
per set under `web/src/pieces/`. That re-encoding is the only change made
to any of them — no artwork is redrawn — and it is stated because CC BY
4.0 asks a modification to be indicated, which covers kiwen-suwi.
Sets under CC BY-NC-SA (the sadsnake1
family, california, caliente, xkcd…) are deliberately not taken: the
NC clause fails this repository's redistribution bar, and the
"freeware" sets (alpha, leipzig, chess7…) carry no licence at all.

The sounds are synthesised by
[chess-sounds-gen](https://github.com/chessvault-app/chess-sounds-gen) — no
recording is sampled or redistributed. Nineteen takes ship, selectable in
Settings.

**pirouetti is AGPL-3.0, and this app is served over a network.** AGPLv3 §13
requires that users interacting with the software over a network be offered
its source. The repository is public, which satisfies it. If the source were
ever taken private while a public deployment stayed up, the set would have to
be dropped.

## Development only — never shipped

Training corpora (linrock's set, MIT), the diagram fonts used to render
synthetic training boards (Chess Merida, Chess Alpha, Chess Berlin — fetched
by URL, not redistributed), and the scanned book PDFs. None are in the
repository or in any build.

## Book puzzles

Puzzles imported from commercial books stay in the vault and are never
published. The static demo does not mount that API and its seed contains
none. See `docs/book-import-pipeline.md`.
