# Desktop shell

Two modes, chosen on first launch (Vault → Switch vault… to change):

- **remote** — a window onto a Chess Vault server somewhere else. Pure
  client.
- **local** — self-hosted: the shell starts the repo's server as a child
  process (`node --import tsx server/index.ts`, port 8788) and points the
  window at it. Uses the repo's own `vault/` and `data/`; a packaged build
  will point `CHESS_VAULT_DIR` / `CHESS_VAULT_DATA` at per-user app data.

Run it: `npm run build` once (the server serves `dist/`), then
`npm run desktop`.

## The one rule

The web app talks to the same HTTP API in every mode. The shell never
exposes APIs to the app (the chooser's IPC is shell config, not app
surface). This keeps the desktop build droppable and the web deployment
canonical.

## Packaging

`npm run desktop:package` → `release/installer/Chess Vault Setup <v>.exe`
(NSIS one-click; macOS dmg target is pre-configured for later). Pipeline:

1. `desktop/build-server.mjs`: esbuild-bundles the server to
   `release/server/index.mjs` and the book builder to
   `release/server/build-book.mjs`, copies better-sqlite3 beside them
   (v13 ships Node-API prebuilds — ABI-stable under Electron, no
   rebuild), renders `icon.ico`.
2. `npm run build`: the SPA (with engine/model assets) into `dist/`.
3. `electron-builder`: ships `desktop/` in the asar; the server bundle
   and `dist/` ride as extraResources, so the server's `./dist` static
   root and `REPO_ROOT` both resolve to `resources/`.

The packaged local mode runs the bundled server on Electron's own Node
(`ELECTRON_RUN_AS_NODE`), with `CHESS_VAULT_DIR`/`CHESS_VAULT_DATA`
pointed at `%APPDATA%/Chess Vault/{vault,data}` — a fresh vault per
machine profile.

Opening books build in the packaged app: `build-book.mjs` ships beside
the server bundle and the server prefers it over the repo script. The
puzzle and reference-game databases are still prepared artefacts — no
build job exposes them anywhere — so bring built `data/` files along if
wanted.

## Auto-update

The shell auto-updates from GitHub releases via `electron-updater`
(`build.publish` in the root `package.json` points at the repo). On
launch a packaged build checks for a newer release, downloads it in the
background, and offers to restart — otherwise it installs on next quit.
Dev runs and unsigned builds no-op.

Cut a release: bump `version` in `package.json`, then with a GitHub token
in `GH_TOKEN` run `npm run desktop:release` (packages + uploads the
installer and `latest.yml`). Clients pick it up on their next launch.
Requires the repo to be public (or a token baked in) for clients to read
releases.
