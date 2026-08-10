import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

/**
 * Prepares everything the packaged shell ships beside the Electron
 * binary (see package.json "build".extraResources):
 *
 *   release/server/index.mjs                 the whole Hono server, bundled
 *   release/server/build-book.mjs            the book builder the server spawns
 *   release/server/node_modules/better-sqlite3   rebuilt for Electron's ABI
 *   desktop/icon.ico                         NSIS/installer icon
 *
 * The bundle lands at resources/server/index.mjs, so paths.ts resolves
 * REPO_ROOT to resources/ — which is where the builder also puts dist/.
 * Vault and data land in the OS profile via CHESS_VAULT_DIR/DATA, set by
 * the shell at spawn time.
 */

// The publish URL is an environment value, not a repo value: it names
// somebody's server. Without it electron-builder would happily write an
// app-update.yml with an empty address, producing an installer that can
// never update and gives no clue why.
if (!process.env.CHESS_UPDATE_URL) {
  console.error(
    [
      'CHESS_UPDATE_URL is not set.',
      '  It is where the built app will look for updates, e.g.',
      '    CHESS_UPDATE_URL=https://<your-server>/updates npm run desktop:package',
      '  The same files go to that path on the server; see desktop/README.md.',
    ].join('\n'),
  );
  process.exit(1);
}

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

// The opening-book builder is a repo script the server SPAWNS, so bundling
// the server alone left packaged builds unable to build a book at all —
// there is no scripts/ and no tsx beside the installer. It ships as its own
// bundle next to the server, which looks for it there before falling back
// to the repo script.
await build({
  entryPoints: [join(repo, 'scripts', 'build-book.ts')],
  outfile: join(out, 'build-book.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log('book builder bundled');

// better-sqlite3 v13 ships Node-API prebuilds (prebuilds/<platform>.node),
// ABI-stable across Node and Electron — a plain copy is the whole story.
const sqliteOut = join(out, 'node_modules', 'better-sqlite3');
cpSync(join(repo, 'node_modules', 'better-sqlite3'), sqliteOut, { recursive: true });
console.log('better-sqlite3 copied (Node-API prebuilds, no rebuild needed)');

// The installer icon, from the same knight PNG the window uses.
writeFileSync(join(here, 'icon.ico'), await pngToIco([join(here, 'icon.png')]));
console.log('icon.ico written');
