# Architecture

Chess Vault is a private, offline-first chess workbench: analysis board,
position editor, studies, notes, a curated game collection, and puzzle
training (lichess-style themes plus paper books imported by ML). One
person's tool, built to outlive any one machine.

## The one non-negotiable: the vault is plain files

```
vault/
  config.json         app password + TOTP secret + Lichess token, mode 0600
  studies/            *.pgn        (chapters = games in one file)
  notes/              *.md         (markdown + ```chess fenced boards)
  games/
    collection/       *.pgn        (curated, annotatable)
    chesscom/<user>/  YYYY-MM.pgn  (archive cache)
    lichess/<user>/   YYYY-MM.pgn
  puzzlebooks/<slug>/
    book.json  puzzles.json  drafts.json  progress.json
    diagrams/  *.jpg          (evidence scans, cover)
  puzzles/            history.jsonl  state.json
  sources/            reference PGN dumps (input to refgames index)
  .history.git        auto-commit history repo (fine-grained undo; excludes config.json)
```

Everything a person would grieve losing is a file another tool can read.
Notes are Obsidian-compatible markdown (wiki-links `[[...]]` included);
studies and games are standard PGN; puzzle progress is JSON lines. The
app is the successor to a chess-in-Obsidian workflow, and that heritage
is a design constraint, not nostalgia: no databases as the source of
truth, no proprietary formats. Derived data (the reference-game sqlite,
engine caches, ML artifacts under `data/`) is always rebuildable.

## Processes

- **Server** (`server/`, Hono on Node): HTTP API over the vault files,
  plus static serving of the built web app. Beyond plain vault I/O it
  owns the optional auth gate (password + authenticator 2FA/TOTP,
  `server/auth.ts` + `server/totp.ts`), the settings API
  (`server/settings.ts`), and outbound proxies to the Lichess explorer
  and study-export endpoints (`server/lichess.ts`). Sets COOP/COEP so the
  browser Stockfish can use threads. `CHESS_VAULT_DIR` / `CHESS_VAULT_DATA`
  override the vault/data locations; the server creates the vault
  skeleton on boot, so pointing it at an empty folder works.
- **Web app** (`web/`, React + Vite + Tailwind v4 + zustand): everything
  the user touches. Chess logic via `chessops`, boards via chessground,
  notes via TipTap, engine via stockfish.js (WASM, threads). Talks to the
  server over HTTP **only** — this is a hard rule that keeps every
  frontier (desktop, PWA, phone) a thin client. On phones a contextual
  bottom bar (`web/src/ui/MobileActionBar.tsx`) hands the open page its
  own controls in place of the global tabs.
- **Desktop** (`desktop/`, Electron): two modes chosen at launch —
  *remote client* (point at a server URL) or *self-hosted* (spawns the
  bundled server against a local folder). Because the UI is HTTP-only,
  the shell has no IPC in React code; it is packaging, not architecture.
- **PWA**: the same web app installed from the browser. Manifest +
  service worker (network-first, cache fallback, never `/api`), safe-area
  handling for notches, splash screens, and a code-split landing chunk
  (~400 kB) because iOS relaunches backgrounded PWAs from scratch.

## Deployment model

Target: a small Linux box (cloud) running the server; every device —
desktop app in remote mode, phone PWA — is a client. The current Windows
dev box is temporary; nothing may depend on it. Cross-platform paths and
LF endings are policy.

Ship with `scripts/deploy.sh` (git-bundle push → `npm ci` → build →
`systemctl restart chess-vault`). SSH runs over a Tailscale tailnet with
public port 22 closed at the firewall; only 80/443 face the internet, and
the app sits behind Caddy for HTTPS. Backups are layered:
`vault/.history.git` (per-change undo), host snapshots, and
`scripts/backup-vault.sh` for an off-cloud pull.

## Shared code

`shared/` holds the move-tree and PGN codec used by both server and web:
one lossless representation for trees, comments, NAGs, arrows and clocks,
so a study round-trips byte-faithfully between disk, server and UI.
