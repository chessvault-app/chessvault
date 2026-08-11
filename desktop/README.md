# Desktop shell

*English · [한국어](README.ko.md)*

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

The shell updates itself from a feed it fetches on launch: a `latest.yml`
naming the newest version and the installer to fetch, plus that installer.
Both are built here and uploaded to a server — there is no GitHub in the
loop, so the source repository can stay private.

Two files with confusingly similar names are involved, at opposite ends:

| | `app-update.yml` | `latest.yml` |
| --- | --- | --- |
| lives | inside the installed app | on the server |
| says | "ask this address" | "newest is 0.2.0, here it is" |
| written by | electron-builder, into the bundle | electron-builder, beside the installer |
| changes | never after install | every release |

Both come from `build.publish` in the root `package.json`, which reads its
URL from the environment rather than naming anybody's server in the repo:

```
"publish": { "provider": "generic", "url": "${env.CHESS_UPDATE_URL}" }
```

### Cutting a release

```
# 1. bump "version" in package.json, and commit
# 2. one command: build, publish, deploy, verify
npm run desktop:release
```

It reads the target from `scripts/deploy.env` (`CHESS_VAULT_HOST`,
`CHESS_UPDATE_URL`), refuses to run on a dirty tree, and finishes by
asking the server what it is serving — the feed and `/api/health` must
both name the version just built, or it exits non-zero.

The deploy is part of it on purpose. In remote mode the desktop app runs
the SERVER's web build, so an installer published without a matching
deploy leaves the two disagreeing about what version this is. They are one
act, not two.

electron-builder cannot do the publishing itself: the `generic` provider
is download-only, so `--publish always` has nothing to upload with.

The build refuses to run without `CHESS_UPDATE_URL`, because an installer
built with an empty address can never update and gives no clue why.

### Serving the feed

The server exposes `/updates/:file` from `CHESS_VAULT_UPDATES` (default
`<repo>/updates`, gitignored). It is deliberately outside `/api` and
outside the password gate: the updater is a background process with no
session and no way to get one. On a tailnet-only deployment the network is
the boundary; publicly, these are the same bytes you hand out as an
installer anyway, and every download is verified against the sha512 in
`latest.yml`. Only release-shaped filenames are served and there is no
directory listing.

### Going public later

Change `build.publish` back to the GitHub provider and cut a release the
same way. Nothing else in the app knows where updates come from.
