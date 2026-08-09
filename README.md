# Chess Vault

Your chess, in plain files. A private, self-hosted chess workbench:
engine analysis, opening explorer, studies, notes, a curated game
collection, and a puzzle trainer fed by real paper books — everything
stored as PGN, markdown and JSON in one folder you own.

![Analysis board](docs/screenshots/board.png)

## Features

- **Board** — free analysis with Stockfish 18 (WASM, multi-threaded),
  full move trees with variations, comments, NAGs and arrows, an
  opening explorer (local book + Lichess), game review with accuracy
  and honest brilliancy detection, and position loading from FEN, PGN,
  or a *photo/screenshot* of any board.
- **Editor** — set up any position; drag pieces from the palette, or
  import from an image.
- **Studies** — PGN chapter studies with variations, per-move comments,
  NAGs and drawn arrows; autosave with atomic writes. Saving is a codec
  round-trip, and `shared/pgn.test.ts` asserts it is lossless *and*
  idempotent — a lossy codec would quietly erode a vault.
- **Notes** — markdown notes with embedded interactive boards
  (```` ```chess ```` fences) and Obsidian-style `[[wiki-links]]`
  across notes, studies and games. Files stay Obsidian-readable.
- **Games** — a curated collection (annotatable like studies), your
  chess.com / Lichess archives browsed month by month with filters,
  manual PGN import, and a searchable reference database of elite
  games.

  ![Games](docs/screenshots/games.png)

- **Puzzles** — a lichess-themed trainer with difficulty bands and a
  progress dashboard, plus **book puzzles**: point the importer at a
  scanned tactics book PDF and an ML pipeline reads the diagrams,
  parses the printed solutions, verifies them by replay, and imports
  each puzzle with an honest fidelity tier and a one-click peek at the
  original page scan. Three books and ~3,100 puzzles imported so far.

  ![Puzzle dashboard](docs/screenshots/dashboard.png)

- **Everywhere** — responsive down to phones, installable as a PWA
  (home-screen icon, splash screens, offline shell), and a desktop app
  (Windows installer) that runs self-hosted or as a client to your
  server.

## Quick start (development)

```bash
npm install
npm run dev          # server + web, http://localhost:5173
```

First run downloads the Stockfish engine assets (7 MB lite build;
`npm run setup:engine -- --full` swaps in the full-strength one).

## Layout

```
shared/     pure TS: move tree + PGN codec (the core everything reuses)
server/     Hono server: vault I/O, COOP/COEP headers, explorer proxy
web/        Vite + React UI
desktop/    Electron shell (remote-client or self-hosted)
scripts/    builders: engine setup, opening book, refgames index, ML pipeline
data/       DERIVED — rebuildable, gitignored
vault/      YOUR DATA — plain files, git-friendly
```

**`vault/` is the irreplaceable part.** Everything in `data/` can be
deleted and rebuilt. Backing up or migrating is copying a folder.

## Deployment

The intended shape: one small Linux server owns the vault; every device
is a client.

```bash
# on the server
npm install
npm run build                      # web app -> dist/
CHESS_VAULT_DIR=/srv/chess-vault npm run start
```

One port serves both the built app and the HTTP API. Put a reverse
proxy with HTTPS in front — the PWA install and Stockfish's threads
(SharedArrayBuffer needs a cross-origin-isolated, secure page) both
want it. Then:

- **Phone**: open the URL, Add to Home Screen — full PWA with offline
  shell and splash screens.
- **Desktop**: install the app (`npm run desktop:package` builds the
  Windows installer) and choose *remote* mode with your server URL — or
  *local* mode to self-host against any folder on that machine.

## Everything works offline

No runtime CDN calls: fonts, icons, WASM and CSS are all bundled. The
only features needing network are *imports* (one-time by nature) and
the optional Lichess explorer augmentation.

The opening explorer is **local-first**: books are built from PGN you
drop into `vault/sources/` — from the book manager inside the explorer
pane, or:

```bash
npm run build:book                          # every .pgn in vault/sources, one book each
npm run build:book -- a.pgn b.pgn --name elite    # merge several files into one book
npm run build:openings                      # ECO names (vendored TSVs, fully offline)
```

Positions are keyed by a 64-bit Zobrist hash, streamed with bounded
memory. Measured on one month of the Lichess Elite Database (280,246
games): 361 k positions indexed in 47 s, 69 MB SQLite, sub-millisecond
lookups. Recommended sources (both free):
[Lumbra's Gigabase](https://lumbrasgigabase.com/en/) "OTB Elite" and
the [Lichess Elite Database](https://database.nikonoel.fr/).

## Lichess token (optional)

Only needed for the *online* explorer augmentation. Create one at
[lichess.org/account/oauth/token/create](https://lichess.org/account/oauth/token/create)
with **no scopes ticked**; add `puzzle:read` only for Lichess puzzle
history import. Put it in `vault/config.json` (gitignored):

```json
{ "lichessToken": "lip_..." }
```

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
npm run build:refgames # index reference games for the elite browser
npm run desktop:package  # Windows installer
```

Keyboard: `←` `→` step through moves · `↑`/`Home` start · `↓`/`End`
end · `f` flip board.

## Documentation

- [Architecture](docs/architecture.md) — the plain-files vault, the
  process split, the HTTP-only client rule.
- [Design principles](docs/design-principles.md) — the color grammar,
  layout rules, and other standing decisions.
- [Book import pipeline](docs/book-import-pipeline.md) — how PDFs
  become verified puzzle books, with a runbook.
- [ML history](docs/ml-history.md) — how the book reader got good.

## Licensing

This project is licensed under **GPL-3.0** (see [LICENSE](LICENSE)) —
the choice is effectively made by its bundled dependencies: Stockfish
and Stockfish.js are GPLv3. `chessops` and
`chessground` are AGPL/GPL — same caveat. The Lichess puzzle database
is CC0; Lumbra's Gigabase is CC BY-NC-SA 4.0.
