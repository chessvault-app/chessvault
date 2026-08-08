# Desktop shell

Two modes, chosen on first launch (Vault → Switch vault… to change):

- **remote** — a window onto a Chess Vault server (the cloud
  deployment). Pure client.
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
   `release/server/index.mjs`, copies better-sqlite3 beside it (v13 ships
   Node-API prebuilds — ABI-stable under Electron, no rebuild), renders
   `icon.ico`.
2. `npm run build`: the SPA (with engine/model assets) into `dist/`.
3. `electron-builder`: ships `desktop/` in the asar; the server bundle
   and `dist/` ride as extraResources, so the server's `./dist` static
   root and `REPO_ROOT` both resolve to `resources/`.

The packaged local mode runs the bundled server on Electron's own Node
(`ELECTRON_RUN_AS_NODE`), with `CHESS_VAULT_DIR`/`CHESS_VAULT_DATA`
pointed at `%APPDATA%/Chess Vault/{vault,data}` — a fresh vault per
machine profile.

Known limits of packaged local mode: opening-book / puzzle-db /
refgames builds are repo activities (the server's build jobs spawn repo
scripts that are not shipped); bring built `data/` artefacts along if
wanted.
