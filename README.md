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
  original page scan. No book is bundled: you supply the PDF of a book
  you own, and the puzzles it yields stay in your vault.

  ![Puzzle dashboard](docs/screenshots/dashboard.png)

- **Tools** — the interactive boards, grouped: the analysis **Board**,
  the position **Editor**, a shortcut into the opening **Explorer**, and
  a **Repertoire** trainer that spars an opening against the Lichess
  database (weighted-random replies filtered to a rating band, seamless
  hand-off to the engine when the line leaves book).
- **Your own games, in the explorer.** Alongside opening books and the
  Lichess databases, the explorer has a **My games** source: every game
  in the vault, answering *what have I played here, and how did it go* —
  filtered by which side you had, whether you won, the speed, and the
  date. There is nothing to build and nothing to rebuild; games count
  the moment you collect them, and a listed game opens on the board.
- **Settings** — change the app password, turn on authenticator 2FA,
  set your display name and platform usernames, pick a board theme and
  piece set, manage the Lichess token, or wipe the vault — all in the
  app, no shell needed.
- **Everywhere** — responsive down to phones, installable as a PWA
  (home-screen icon, splash screens, offline shell), and a desktop app
  (Windows, macOS and Linux installers) that keeps the vault on that
  machine by default, or runs as a client to your server. On a phone the
  bottom bar turns into the open page's controls (move navigation, puzzle
  actions), chess.com/Lichess-style.

## Two ways to run it

Both run the same code. The only question is **where the vault lives** —
the folder holding your games, studies, notes and puzzles.

| | **On this machine** | **On a server** |
| --- | --- | --- |
| vault lives | on your computer | on one small Linux box |
| you reach it from | that computer | phone, laptop, desktop — all clients |
| needs | nothing | a machine that stays on, and HTTPS |
| updating it | install a new app | `bash scripts/deploy.sh` |

Pick the second only if you want the same vault from more than one device.
Nothing is lost by starting with the first: the vault is a folder, so
moving to a server later is copying it there.

### A · On this machine

The desktop app in **local** mode is the whole answer — it starts the
server for you and keeps the vault in your user profile:

```bash
npm run desktop:package        # or :mac / :linux — installs, then pick "local"
```

To run it from the source tree instead:

```bash
npm install
npm run build                  # web app -> dist/
npm start                      # http://127.0.0.1:8787
```

The vault is `vault/` in the repo unless `CHESS_VAULT_DIR` says otherwise.
No password is needed — nothing is listening beyond your machine.

### B · On a server

One box owns the vault; every device is a client.

```bash
# on the server, once
npm install
npm run build                          # web app -> dist/
CHESS_VAULT_DIR=/srv/chess-vault npm run start
```

One port serves the built app and the HTTP API together. Then:

1. **Put HTTPS in front.** A reverse proxy is not optional in practice:
   the PWA install and Stockfish's multi-threading both need a secure,
   cross-origin-isolated page.
2. **Turn on the lock screen.** Set an app password in Settings (or
   `appPassword` in `vault/config.json`), and add authenticator 2FA
   while you are there. Anything reachable from the internet needs this.
3. **Connect your devices.** Phone: open the URL and Add to Home Screen —
   it installs as a PWA with an offline shell. Desktop: install the app
   and choose *remote* mode with your server's URL.

Settings shows two version numbers, and they are different things: the
**server** version is the web app and API you are connected to; the
**desktop app** version is the Electron window around it. In local mode
they always match, because one installer contains both. In remote mode
they are independent, and differing is normal.

**Updating the server** is one command from your workstation:

```bash
cp scripts/deploy.env.example scripts/deploy.env   # set CHESS_VAULT_HOST
bash scripts/deploy.sh
```

It builds the web app locally (the heaviest step — a 2 GB box can OOM
under it), ships the commit and the built `dist/`, runs `npm ci`, refreshes
database indexes, restarts the service and asserts it came back. It never
touches the vault.

Keep SSH off the public internet. The reference deployment runs on a
[Tailscale](https://tailscale.com) tailnet with port 22 closed at the
firewall, and `deploy.sh` reaches it over the tailnet.

Backups are layered: the server auto-commits every vault change to
`vault/.history.git` (fine-grained undo), your host's snapshots guard
against instance loss, and `scripts/backup-vault.sh` pulls the whole vault
— history included — to any machine for an off-cloud copy.

## Optional data

The app runs with an empty `data/`. These four datasets light up specific
features; everything under `data/` is derived, gitignored and rebuildable,
so it never ships in the repo. Build what you want, per machine.

| Dataset | Lights up | Built by |
| --- | --- | --- |
| `data/puzzles.sqlite` | the puzzle trainer | in the app, or `npm run build:puzzles` |
| `data/refgames.sqlite` | the elite game browser | `npm run build:refgames` |
| `data/books/*.sqlite` | the local opening explorer | in the app, or `npm run build:book` |
| `data/openings.json` | ECO opening names | the app, on first use |

`data/mygames.sqlite` is not in the table because you never build it: the
explorer's **My games** source indexes the vault's own games itself and
keeps up as you collect more. `data/openings.json` is in it only to say
where the names come from — the server compiles it from the ECO tables it
ships with, the first time something asks for a name.

**Opening books need no shell.** Open the explorer's book manager, upload
your PGN collections, tick the ones to merge and press Build. Good free
sources: [Lumbra's Gigabase](https://lumbrasgigabase.com/en/) "OTB Elite"
and the [Lichess Elite Database](https://database.nikonoel.fr/). Positions
are keyed by a 64-bit Zobrist hash and streamed with bounded memory — one
month of Lichess Elite (280,246 games) indexes 361 k positions in 47 s into
69 MB.

**A book is for a large reference database, not for your own games.** Your
games are answered live instead — see below.

### The two big ones

**The puzzle trainer builds itself, in the app.** Open Puzzles with no
database and it offers to fetch one: the CC0 Lichess dump (~304 MB, 6.1 M
puzzles) downloads with a progress bar and becomes a 2.6 GB database — 115 s
of building here, after the download. Nothing to install, nothing to type,
and it keeps going if you leave the page. `npm run build:puzzles` does the
same thing from a terminal if you prefer one.

**Reference games still need the shell**, because their input is your own
PGN collections rather than one public dump:

```bash
npm run build:refgames         # over vault/sources -> data/refgames.sqlite
```

Running **on a server**: the puzzle build streams a 304 MB compressed dump
into a 2.6 GB database, and it will OOM on a small instance — it did on a
2 GB one here. Press the button on a machine with the memory, or build on
your workstation and `scp` the file into the server's data directory
(`CHESS_VAULT_DATA`, default `data/` beside the app). That is a question
about the machine, not about servers.

Every later deploy keeps their indexes current on its own, so rebuild only
for a newer dump or more games.

[docs/databases.md](docs/databases.md) covers rebuilding them, and why
reference games are the one thing here that still wants a terminal.

## It never calls anyone but your own server

No CDNs, no telemetry, no third-party requests at runtime: fonts, icons,
WASM and CSS are all bundled. The only features that reach outside are
*imports* — one-time by nature — and the optional Lichess explorer
augmentation, which you can leave off.

**With no network at all: yes.** That is the default arrangement — the
app and the vault both on your machine — and nothing about it needs the
internet. Engine, opening books, puzzles, your whole collection.

If you have moved the vault to a server (way B), you need to be able to
reach that server. The PWA keeps its shell offline so the app still opens,
but your games and studies live on the other end of the connection. That
is a trade you make deliberately, in exchange for the same vault on every
device.

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

## Developing

```bash
npm install
npm run dev          # server + web with hot reload, http://localhost:5173
```

First run downloads the Stockfish engine assets (7 MB lite build;
`npm run setup:engine -- --full` swaps in the full-strength one).

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
npm run build:openings # recompile ECO names (the app does this itself)
npm run build:refgames # index reference games for the elite browser
npm run build:puzzles  # build the puzzle trainer's pool from the Lichess dump
npm run desktop:package        # Windows installer (:mac, :linux for the others)
npm run desktop:package:mac    # macOS dmg (needs a Mac, or GitHub Actions)
npm run desktop:package:linux  # Linux AppImage + deb
npm run desktop:release        # check, tag, push — GitHub builds the installers
```

Server-side, from your workstation: `bash scripts/deploy.sh` updates a
server, `bash scripts/backup-vault.sh` pulls its vault down.

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

Copyright © 2026 the Chess Vault authors.

This project is licensed under **GPL-3.0** (see [LICENSE](LICENSE)) —
the choice is effectively made by its bundled dependencies: Stockfish
and Stockfish.js are GPLv3. `chessops` and
`chessground` are AGPL/GPL — same caveat. The Lichess puzzle database
is CC0; Lumbra's Gigabase is CC BY-NC-SA 4.0.
