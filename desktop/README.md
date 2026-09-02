# Desktop shell

*English · [한국어](README.ko.md)*

Two modes, chosen on first launch (change later from the Desktop app
card in Settings, whose Vault row has a Switch… button — or the Vault
menu, which hides behind Alt):

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

## Installing on macOS

The app is not signed with an Apple Developer ID and is not notarised, so
macOS will not simply open it. What you see depends on what the build
carries:

- **"Chess Vault is damaged and can't be opened."** No signature at all,
  which is what `mac.identity: null` produced before 0.4.1. It is not
  damaged; arm64 macOS refuses to load unsigned code, and Gatekeeper
  reports that as damage. Fix it once, after dragging the app to
  Applications:

  ```
  xattr -dr com.apple.quarantine "/Applications/Chess Vault.app"
  ```

  Right-click → Open does *not* clear this one.

- **"…is from an unidentified developer."** The ad-hoc signature added in
  0.4.1 (now part of `desktop/after-pack.mjs`). Right-click the app → **Open** →
  **Open**, once. The `xattr` line above works here too.

Neither is a warning about the download. Both are macOS saying it cannot
tell who built the app, which is true and stays true until somebody pays
for a Developer ID and notarisation — at which point set `mac.identity`
and delete the ad-hoc hook.

## Packaging

`npm run desktop:package` → `release/installer/Chess Vault Setup <v>.exe`
(NSIS one-click); `desktop:package:mac` builds the dmg and
`desktop:package:linux` the AppImage and deb. Pipeline:

1. `desktop/build-server.mjs`: esbuild-bundles the server to
   `release/server/index.mjs`, the database builders beside it
   (`build-refgames.mjs`, `build-puzzles.mjs`,
   `index-refgames-positions.mjs`, `optimize-refgames.mjs`) and the
   resident scan worker fast search runs in (`scan-worker.mjs`), copies
   better-sqlite3 next to them (v13 ships Node-API prebuilds — ABI-stable
   under Electron, no rebuild), and renders `icon.ico`.

   It also copies the native core
   (`native/target/release/chessvault-core`) beside those children **if it
   has been built** — the server looks there first, so that copy is the
   whole of shipping it. Packaging without a Rust toolchain is supported
   and says so as it goes: the installer then runs the JavaScript jobs, as
   every release before 0.5.0 did. CI builds the crate on each runner
   first, and asserts the binary is there before uploading anything.

2. `npm run build`: the SPA (with engine/model assets) into `dist/`.
3. `electron-builder`: ships `desktop/` in the asar; the server bundle
   and `dist/` ride as extraResources, so the server's `./dist` static
   root and `REPO_ROOT` both resolve to `resources/`.
4. `desktop/after-pack.mjs`: copies `release/server/node_modules` into the
   packaged `resources/server/`, then ad-hoc signs the app on macOS.

   The copy is there because extraResources will not carry it.
   app-builder-lib's copy filter opens with `if (relative ===
   "node_modules") return false`, so a directory named exactly that, at
   the root of an extraResources source, is dropped whatever `filter`
   says — silently. Until 0.4.2 the app shipped without its database
   driver and every local vault died on launch with "Cannot find package
   'better-sqlite3'". The hook throws if the copy does not land, so the
   next time it breaks it breaks the build rather than the app.

The packaged local mode runs the bundled server on Electron's own Node
(`ELECTRON_RUN_AS_NODE`), with `CHESS_VAULT_DIR`/`CHESS_VAULT_DATA`
pointed at `%APPDATA%/Chess Vault/{vault,data}` — a fresh vault per
device profile.

The puzzle pool and the reference databases all build in the
packaged app: `build-puzzles.mjs`, `build-refgames.mjs`,
`index-refgames-positions.mjs` and `optimize-refgames.mjs` ship beside
the server bundle and the server prefers them over the repo scripts.
`scan-worker.mjs` ships there too, which is what lets a database with
fast search turned on hold its packed index in the packaged app —
and prefers the native binary over both, where one shipped. The
installer seeds a starter reference database (position index included)
on first run besides.

## Auto-update

The shell updates itself from a feed it fetches on launch: a `latest.yml`
naming the newest version and the installer to fetch, plus that installer.
Both come from this repository's GitHub releases.

Two files with confusingly similar names are involved, at opposite ends:

| | `app-update.yml` | `latest.yml` |
| --- | --- | --- |
| lives | inside the installed app | on the release |
| says | "ask this address" | "newest is `<v>`, here it is" |
| written by | electron-builder, into the bundle | electron-builder, beside the installer |
| changes | never after install | every release |

Both come from `build.publish` in the root `package.json`:

```
"publish": {
  "provider": "github", "owner": "chessvault-app", "repo": "chessvault",
  "releaseType": "draft"
}
```

There are three `latest.yml`s, not one — `latest.yml` for Windows,
`latest-mac.yml`, `latest-linux.yml` — and each platform's updater fetches
only its own. All three must land on the SAME release, which is what
`releaseType: draft` buys: three matrix jobs finishing minutes apart would
otherwise race to create the release, and electron-builder instead finds the
existing draft and adds to it.

Self-hosting the feed instead still works: point `build.publish` back at
`{ "provider": "generic", "url": "${env.CHESS_UPDATE_URL}" }` and the
server's `/updates` route (below) serves it. Nothing else in the app knows
where updates come from.

What an update is checked against, and what it is not: the installer's
sha512 has to match the one in `latest.yml`, and both arrive over HTTPS
from GitHub. There is no code signature. The Windows build is unsigned and
the macOS build is ad-hoc signed (`"identity": null`), so nothing on the
machine vouches for who built the file; whoever can publish a release on
the repository ships code to every installed app, which downloads it in
the background and installs it on quit. That is the ordinary state of an
unsigned open-source app, and it is why publishing is a button a person
presses rather than a step the workflow takes.

### Cutting a release

```
# 1. bump "version" in package.json, and commit
# 2. check, tag, push — GitHub builds from the tag
npm run desktop:release
# 3. when the workflow finishes, check the draft and press Publish
gh release view v<version> --web
```

Three parties, in order:

| | does what |
| --- | --- |
| `release.sh` | typechecks, tests, refuses a dirty tree or an existing tag, pushes the tag |
| the `desktop` workflow | builds Windows, macOS and Linux onto one **draft** release |
| you | check the three installers are there, publish the draft |

**A release needs no server and no personal configuration.** It is a
property of the project — a version, a tag, and three installers built from
that commit — so anyone with push access can cut one. It used to deploy one
particular server and refuse to tag until that machine answered, which made
releasing depend on private infrastructure being reachable and meant nobody
else could do it.

Deploying a server is a separate act, run by whoever operates that server:
`bash scripts/deploy.sh`, or `npm run desktop:release -- --deploy` to do both
at once.

They are still related. In remote mode the desktop app loads the SERVER's
web build, so a server left on an older commit disagrees with a freshly
installed app about what version it is — which is why Settings shows the
server's version and the shell's version separately. If you run a server,
deploy it around the same time.

Nothing is offered to any installed app until the draft is published.

### Serving the feed

Only for a self-hosted feed — releases go to GitHub now, and this route is
what makes the `generic` provider an option for anyone who would rather not
use it.

The server exposes `/updates/:file` from `CHESS_VAULT_UPDATES` (default
`<repo>/updates`, gitignored). It is deliberately outside `/api` and
outside the password gate: the updater is a background process with no
session and no way to get one. On a tailnet-only deployment the network is
the boundary; publicly, these are the same bytes you hand out as an
installer anyway, and every download is verified against the sha512 in
`latest.yml`. Only release-shaped filenames are served and there is no
directory listing.

### Building without releasing

Run the `desktop` workflow by hand (`workflow_dispatch`) to get all three
platforms as workflow artifacts without publishing anything: it passes
`--publish never` unless the ref is a `v*` tag. That is how to get a macOS
build — electron-builder cannot produce a dmg anywhere but a Mac — or to
prove all three still compile.
