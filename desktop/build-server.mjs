import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

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
