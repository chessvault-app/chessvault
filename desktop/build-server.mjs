import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

/**
 * Prepares everything the packaged shell ships beside the Electron
 * binary (see package.json "build".extraResources):
 *
 *   release/server/index.mjs                 the whole Hono server, bundled
 *   release/server/build-puzzles.mjs         the puzzle builder the server spawns
 *   release/server/build-refgames.mjs        the reference-games builder, likewise
 *   release/server/index-refgames-positions.mjs   the position indexer, likewise
 *   release/server/optimize-refgames.mjs     the housekeeping pass, likewise
 *   release/server/chessvault-core[.exe]     the native fast path, if built
 *   release/server/node_modules/better-sqlite3   rebuilt for Electron's ABI
 *   desktop/icon.ico                         NSIS/installer icon
 *
 * The bundle lands at resources/server/index.mjs, so paths.ts resolves
 * REPO_ROOT to resources/ — which is where the builder also puts dist/.
 * Vault and data land in the OS profile via CHESS_VAULT_DIR/DATA, set by
 * the shell at spawn time.
 */

// Updates come from this project's GitHub releases, which is a repo value
// and needs no environment. The check that used to stand here existed for
// the `generic` provider, whose URL named somebody's server: unset, it wrote
// an app-update.yml with an empty address and produced an installer that
// could never update and said nothing about why. The github provider takes
// its address from build.publish in package.json, so there is nothing left
// to forget.
//
// CHESS_UPDATE_URL still works for anyone self-hosting a feed — point
// build.publish back at `generic` and it is read again.

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const out = join(repo, 'release', 'server');

rmSync(join(repo, 'release'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(repo, 'server', 'index.ts')],
  outfile: join(out, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Native module: shipped as a real package next to the bundle instead.
  external: ['better-sqlite3'],
  banner: {
    // ESM bundles of CJS-importing code need require() to exist.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('server bundled');

// The bundle reports its version from package.json, and it does not ship
// beside the repo — so it gets the one fact it needs.
const { version } = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf-8'));
writeFileSync(join(out, 'package.json'), `${JSON.stringify({ version }, null, 2)}
`);
console.log(`version ${version} stamped beside the bundle`);

// The puzzle database: the Puzzles page asks the server to
// build it, the server spawns this, and an installed app has no scripts/.
await build({
  entryPoints: [join(repo, 'scripts', 'build-puzzles.ts')],
  outfile: join(out, 'build-puzzles.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('puzzle builder bundled');

// The position-index pass over an existing reference database, spawned
// from the explorer's "Index positions" offer — same contract again.
await build({
  entryPoints: [join(repo, 'scripts', 'index-refgames-positions.ts')],
  outfile: join(out, 'index-refgames-positions.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('position indexer bundled');

// And the reference-games indexer, spawned by the elite browser's build
// offer — same contract as the two above.
await build({
  entryPoints: [join(repo, 'scripts', 'build-refgames.ts')],
  outfile: join(out, 'build-refgames.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('refgames builder bundled');

// The per-database housekeeping pass (dedupe, re-derive, vacuum),
// spawned from the Databases manager — same contract as the three above.
await build({
  entryPoints: [join(repo, 'scripts', 'optimize-refgames.ts')],
  outfile: join(out, 'optimize-refgames.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('optimizer bundled');

// The resident scan worker — a worker_thread, not a child process, but
// the same story: refgamesResident.ts looks for this file beside the
// bundle before falling back to the TS source an installed app lacks.
await build({
  entryPoints: [join(repo, 'server', 'scanWorker.ts')],
  outfile: join(out, 'scan-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('scan worker bundled');

// The query worker — the same story again: refgamesQuery.ts looks for
// this file beside the bundle before falling back to the TS source.
await build({
  entryPoints: [join(repo, 'server', 'queryWorker.ts')],
  outfile: join(out, 'query-worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('query worker bundled');

/**
 * The native fast path, when this machine has built one.
 *
 * `nativeBinary()` in server/refgames.ts looks beside the bundled .mjs
 * children first, which is exactly here — so dropping the binary in is
 * the whole of shipping it. Built for the HOST architecture by cargo,
 * which is why each platform's packaging job builds its own rather than
 * cross-compiling: an installer carries one arch anyway (electron-builder
 * defaults to the host's), and a binary for the wrong one would be dead
 * weight the server would then try to spawn.
 *
 * Absent is normal and silent-ish: a contributor packaging without a Rust
 * toolchain gets an installer that runs the JavaScript children, which is
 * what every release before 0.5.0 shipped. Only the speed is missing.
 */
const exe = process.platform === 'win32' ? 'chessvault-core.exe' : 'chessvault-core';
const nativeBuilt = join(repo, 'native', 'target', 'release', exe);
if (existsSync(nativeBuilt)) {
  copyFileSync(nativeBuilt, join(out, exe));
  const mb = (statSync(nativeBuilt).size / 1e6).toFixed(1);
  console.log(`native core copied (${exe}, ${mb} MB, ${process.arch})`);
} else {
  console.log(`native core NOT bundled — no ${nativeBuilt}`);
  console.log('  (the installer will run the JavaScript jobs; build it with');
  console.log('   `cargo build --release` in native/ to ship the fast path)');
}

// better-sqlite3 v13 ships Node-API prebuilds (prebuilds/<platform>.node),
// ABI-stable across Node and Electron — a plain copy is the whole story.
const sqliteOut = join(out, 'node_modules', 'better-sqlite3');
cpSync(join(repo, 'node_modules', 'better-sqlite3'), sqliteOut, { recursive: true });
console.log('better-sqlite3 copied (Node-API prebuilds, no rebuild needed)');

// The installer icon. Built from icon-256.png, NOT icon.png: NSIS rejects
// any frame above 256x256 with "invalid icon file size" and produces no
// installer at all, while icon.png has to be 512 for macOS. Both are
// rendered from the same favicon by scripts/render-icons.mjs.
writeFileSync(join(here, 'icon.ico'), await pngToIco([join(here, 'icon-256.png')]));
console.log('icon.ico written');
