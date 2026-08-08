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
 *   release/server/node_modules/better-sqlite3   rebuilt for Electron's ABI
 *   desktop/icon.ico                         NSIS/installer icon
 *
 * The bundle lands at resources/server/index.mjs, so paths.ts resolves
 * REPO_ROOT to resources/ — which is where the builder also puts dist/.
 * Vault and data land in the OS profile via CHESS_VAULT_DIR/DATA, set by
 * the shell at spawn time.
 */

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

// better-sqlite3 v13 ships Node-API prebuilds (prebuilds/<platform>.node),
// ABI-stable across Node and Electron — a plain copy is the whole story.
const sqliteOut = join(out, 'node_modules', 'better-sqlite3');
cpSync(join(repo, 'node_modules', 'better-sqlite3'), sqliteOut, { recursive: true });
console.log('better-sqlite3 copied (Node-API prebuilds, no rebuild needed)');

// The installer icon, from the same knight PNG the window uses.
writeFileSync(join(here, 'icon.ico'), await pngToIco([join(here, 'icon.png')]));
console.log('icon.ico written');
