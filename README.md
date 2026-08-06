# Chess Vault

A private, offline-first chess vault: engine analysis, opening explorer, studies, notes and puzzles. Single user, local files, no server database.

```bash
npm install
npm run dev          # http://localhost:5173
```

## Status

| Phase | Feature | State |
|---|---|---|
| 1 | Analysis board — Stockfish 18, move tree, variations, FEN/PGN loading | ✅ done |
| 1 | Board editor | ✅ done |
| 2 | Local opening book + explorer + book manager + Lichess proxy | ✅ done |
| 3 | Studies (board-as-main) | ⬜ next |
| 4 | Notes (markdown with embedded boards) | ⬜ |
| 5 | Games explorer | ⬜ |
| 6 | Puzzle trainer | ⬜ |

## Layout

```
shared/     pure TS: move tree + PGN codec (the core everything reuses)
server/     Hono local server: COOP/COEP headers, vault I/O, explorer proxy
web/        Vite + React UI
scripts/    one-off builders (engine copy, opening book, puzzle index)
data/       DERIVED — rebuildable, gitignored
vault/      YOUR DATA — plain files, git-friendly
  studies/  *.pgn    one game per chapter, with variations and annotations
  notes/    *.md     markdown with embedded board blocks
  games/    *.pgn    imported games
  sources/  *.pgn    collections to index into opening books
  config.json        Lichess token + settings (gitignored)
```

**`vault/` is the irreplaceable part.** Everything in `data/` can be deleted and rebuilt.

## Why plain files

Studies are stored as ordinary PGN, using Lichess's own annotation syntax — arrows as `[%cal]`, circles as `[%csl]`, evaluations as `[%eval]`. Nothing is lost, and the files stay readable in any editor.

That means **saving a study is a codec round-trip**, so `shared/pgn.test.ts` asserts the round-trip is lossless *and* idempotent. A lossy codec would quietly erode annotations a little on every edit — the worst failure mode for a vault, because you'd only notice months later.

## Engine

Stockfish 18 (`stockfish@18.0.8`) runs as a WASM Web Worker. The multi-threaded build needs `SharedArrayBuffer`, which browsers only expose to cross-origin-isolated pages — hence the COOP/COEP headers in both `web/vite.config.ts` and `server/index.ts`. Measured effect on this machine:

| Threads | Peak nps |
|---|---|
| 1 | 1.38 M |
| 4 | 5.63 M |

If those headers are ever dropped, the engine silently falls back to single-threaded. `npm run setup:engine -- --full` swaps in the 113 MB full-strength build; the default is the 7 MB "lite" one.

## Everything works offline

No runtime CDN calls: fonts, icons, WASM and CSS are all bundled. The only features needing network are *imports* (one-time by nature) and the optional Lichess explorer augmentation.

The opening explorer is **local-first**. Lichess's own explorer requires a token and can never work offline, so books are built from PGN you drop into `vault/sources/` — either from the book manager inside the explorer pane, or:

```bash
npm run build:book                          # every .pgn in vault/sources, one book each
npm run build:book -- a.pgn b.pgn --name elite    # merge several files into one book
npm run build:openings                      # ECO names (vendored TSVs, fully offline)
```

Positions are keyed by a 64-bit Zobrist hash (`shared/zobrist.ts`), streamed with bounded memory, pruned per position (`--min-games`, default 2), with the top 3 reference games kept per position. Measured on one month of the Lichess Elite Database (280,246 games): 361 k positions indexed in 47 s with zero parse errors, 69 MB SQLite, sub-millisecond lookups.

In the explorer pane you can click any move to play it, switch between local books and the (online, token-gated) Lichess masters/players databases, and build or delete books. Online explorer responses are cached on disk, so a position visited once keeps working offline.

Recommended sources (both free, both verified live):
- [Lumbra's Gigabase](https://lumbrasgigabase.com/en/) "OTB Elite" — 2400+ over-the-board games, the Masters-DB equivalent.
- [Lichess Elite Database](https://database.nikonoel.fr/) — ~80 MB/month of 2500+ online games.

## Lichess token (optional)

Only needed for the *online* explorer augmentation. Create one at
[lichess.org/account/oauth/token/create](https://lichess.org/account/oauth/token/create) with **no scopes ticked** — any valid token authenticates the explorer. Add `puzzle:read` only if you want your Lichess puzzle history imported. Put it in `vault/config.json` (gitignored):

```json
{ "lichessToken": "lip_..." }
```

Note that Lichess made this endpoint token-only on 2026-03-03 and moved it from `explorer.lichess.ovh` to `explorer.lichess.org`; older guides and wrapper libraries are wrong.

## Commands

```bash
npm run dev            # server + web with hot reload
npm run build          # production build to dist/
npm start              # serve the built app
npm test               # unit tests
npm run typecheck      # tsc --noEmit
npm run setup:engine   # copy Stockfish into web/public/engine/
npm run build:book     # index vault/sources PGNs into opening books
npm run build:openings # compile ECO opening names
```

## Keyboard shortcuts

`←` `→` step through moves · `↑` / `Home` start · `↓` / `End` end · `f` flip board

## Licensing

Stockfish and Stockfish.js are GPLv3. They are bundled here for personal local use; that matters if this is ever redistributed. `chessops` and `chessground` are AGPL/GPL — same caveat. The Lichess puzzle database is CC0; Lumbra's Gigabase is CC BY-NC-SA 4.0.
