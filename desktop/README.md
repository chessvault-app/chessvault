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

## Packaging (later)

Dev mode leans on the repo + system Node. A distributable Windows build
(then macOS) needs, roughly:

1. esbuild-bundle `server/index.ts` to plain JS (tsx not shipped).
2. Ship better-sqlite3 prebuilt for the runtime that executes the server
   (system-node child today; if switched to `ELECTRON_RUN_AS_NODE`, use
   electron-rebuild).
3. `electron-builder` with an NSIS target (`dmg` when macOS lands);
   bundle `dist/`, the server bundle, and the engine/model assets from
   `web/public`.
4. Default `CHESS_VAULT_DIR`/`CHESS_VAULT_DATA` into `app.getPath('userData')`,
   with a first-run vault-location picker.
