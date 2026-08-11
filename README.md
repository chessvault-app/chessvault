# Chess Vault

*English · [한국어](README.ko.md)*

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
  NAGs and drawn arrows; a reading/annotating toggle keeps the board
  uncluttered when you're just stepping through. Import a PGN file, paste
  one, or pull studies straight from a Lichess account. Autosave with
  atomic writes; saving is a codec round-trip, and `shared/pgn.test.ts`
  asserts it is lossless *and* idempotent — a lossy codec would quietly
  erode a vault.
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
  original page scan. Three books and ~3,150 puzzles imported so far.

  ![Puzzle dashboard](docs/screenshots/dashboard.png)

- **Tools** — the interactive boards, grouped: the analysis **Board**,
  the position **Editor**, a shortcut into the opening **Explorer**, and
  a **Repertoire** trainer that spars an opening against the Lichess
  database (weighted-random replies filtered to a rating band, seamless
  hand-off to the engine when the line leaves book).
- **Settings** — change the app password, turn on authenticator 2FA,
  set your display name and platform usernames, pick a board theme and
  piece set, manage the Lichess token, or wipe the vault — all in the
  app, no shell needed.
- **Everywhere** — responsive down to phones, installable as a PWA
  (home-screen icon, splash screens, offline shell), and a desktop app
  (Windows installer) that runs self-hosted or as a client to your
  server. On a phone the bottom bar turns into the open page's controls
  (move navigation, puzzle actions), chess.com/Lichess-style.

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
server/     Hono server: vault I/O, auth gate + 2FA, settings, proxies
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
want it. For a public deployment, set `appPassword` in
`vault/config.json` (or from the Settings page) to turn on the lock
screen; add authenticator 2FA there too. Then:

- **Phone**: open the URL, Add to Home Screen — full PWA with offline
  shell and splash screens.
- **Desktop**: install the app (`npm run desktop:package` builds the
  Windows installer) and choose *remote* mode with your server URL — or
  *local* mode to self-host against any folder on that machine.

Keep SSH off the public internet: the reference deployment runs the box
on a [Tailscale](https://tailscale.com) tailnet with port 22 closed at
the firewall, and `scripts/deploy.sh` (bundle → push → rebuild →
restart) reaches it over the tailnet. Copy
`scripts/deploy.env.example` to `scripts/deploy.env` (gitignored) and set
`CHESS_VAULT_HOST`; the directory and service name have defaults matching
this layout and can be overridden there too.

### Deploy-time jobs

Two databases are **built on your machine and copied to the server**,
rather than by anything the app does. They are the only such exception,
and they are one-offs — not part of a normal deploy:

```bash
# the puzzle trainer's pool: download the Lichess dump (CC0, ~304 MB) once
curl -o data/lichess_db_puzzle.csv.zst https://database.lichess.org/lichess_db_puzzle.csv.zst
npm run build:puzzles              # -> data/puzzles.sqlite (~2.5 GB)

# the reference-game browser: any PGNs you drop in vault/sources/
npm run build:refgames             # -> data/refgames.sqlite
```

Copy both to the server's data directory. Every later deploy keeps their
indexes current on its own. Rebuild only for a newer puzzle dump or more
reference games — see [docs/databases.md](docs/databases.md) for why these
are not done in the app, and what would have to change for that to stop
being the right answer.

Backups are layered: the server auto-commits every vault change to
`vault/.history.git` (fine-grained undo), your host's snapshots guard
against instance loss, and `scripts/backup-vault.sh` pulls the whole
vault — history included — down to any machine for an off-cloud copy.

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

## Reference data (all optional, all free)

The app runs with an empty `data/` — these datasets just light up
specific features, and everything under `data/` is rebuildable and
gitignored, so it never ships in the repo; build or fetch it per machine.

- **Puzzle trainer** — the [Lichess puzzle database](https://database.lichess.org/#puzzles)
  (CC0). Download and build once:
  ```bash
  curl -L -o data/lichess_db_puzzle.csv.zst \
    https://database.lichess.org/lichess_db_puzzle.csv.zst
  npm run build:puzzles          # -> data/puzzles.sqlite
  ```
- **Elite game browser** — index PGN dumps (the Lumbra / Lichess Elite
  sources above) with `npm run build:refgames` → `data/refgames.sqlite`.
- **Opening explorer (local)** — `npm run build:book` over PGNs you drop
  in `vault/sources/`; `npm run build:openings` compiles ECO names from
  vendored TSVs (fully offline).

## Lichess token (optional)

Powers the *online* explorer augmentation, the Repertoire trainer, and
importing studies from a Lichess account. Create one at
[lichess.org/account/oauth/token/create](https://lichess.org/account/oauth/token/create)
with **no scopes ticked** (add `study:read` for private studies,
`puzzle:read` for Lichess puzzle-history import). Paste it into the
Settings page, or put it in `vault/config.json` (gitignored):

```json
{ "lichessToken": "lip_..." }
```

`config.json` also holds `appPassword` and the 2FA `totpSecret` when the
lock screen is on — the Settings page manages all three, and the vault's
history repo deliberately excludes the file so secrets never enter it.

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
npm run desktop:package        # Windows installer
npm run desktop:package:mac    # macOS dmg (needs a Mac, or GitHub Actions)
npm run desktop:package:linux  # Linux AppImage + deb
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
- [Prepared databases](docs/databases.md) — the puzzle and reference-game
  databases: built once, copied to the server, rarely touched again.
- [ML history](docs/ml-history.md) — how the book reader got good.
- [Update log](docs/update-log.md) — what changed, newest first.

## Licensing

Third-party code, data and assets — what is bundled and under what terms —
are listed in [THIRD-PARTY.md](THIRD-PARTY.md). Every npm package is
covered too, generated at build time into `licenses/dependencies.txt` and
browsable in the app under Settings → Licences.

This project is licensed under **GPL-3.0** (see [LICENSE](LICENSE)) —
the choice is effectively made by its bundled dependencies: Stockfish
and Stockfish.js are GPLv3. `chessops` and
`chessground` are AGPL/GPL — same caveat. The Lichess puzzle database
is CC0; Lumbra's Gigabase is CC BY-NC-SA 4.0.
