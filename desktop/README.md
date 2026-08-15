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
   `release/server/index.mjs` and the database builders beside it
   (`build-refgames.mjs`, `build-puzzles.mjs`,
   `index-refgames-positions.mjs`), copies better-sqlite3 next to them
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

The puzzle pool and the reference databases all build in the
packaged app: `build-puzzles.mjs`, `build-refgames.mjs` and
`index-refgames-positions.mjs` ship beside the server bundle and the
server prefers them over the repo scripts. The installer seeds a
starter reference database (position index included) on first run
besides.

## Auto-update

The shell updates itself from a feed it fetches on launch: a `latest.yml`
naming the newest version and the installer to fetch, plus that installer.
Both come from this repository's GitHub releases.

Two files with confusingly similar names are involved, at opposite ends:

| | `app-update.yml` | `latest.yml` |
| --- | --- | --- |
| lives | inside the installed app | on the release |
| says | "ask this address" | "newest is 0.2.0, here it is" |
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

### Cutting a release

```
# 1. bump "version" in package.json, and commit
# 2. check, tag, push — GitHub builds from the tag
npm run desktop:release
# 3. when the workflow finishes, check the draft and press Publish
gh release view v0.3.0 --web
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
