import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { licenses } from './vite.licenses.ts';
import { precache } from './vite.precache.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

/**
 * The demo's own assets — its curated databases and the ECO tables it
 * fetches into the in-page filesystem — copied in at the end of the build.
 *
 * They used to live in `web/public/`, which meant every production build
 * carried them too: 5.2 MB of demo data in each desktop installer and each
 * deploy, fetched by nobody. `public/` is what the APP serves, so the demo's
 * assets are not in it, and the copy below is the only thing that puts them
 * anywhere. A demo run through `vite dev` would not have them, and degrades
 * the way it does for any missing asset — the demo is a build target.
 */
function demoAssets(): Plugin {
  return {
    name: 'demo-assets',
    closeBundle() {
      cpSync(`${root}demo-assets`, `${repo}dist-demo/demo`, { recursive: true });
    },
  };
}

/**
 * What the demo's /api/health says it is.
 *
 * The real server reads the version out of package.json and stamps the
 * build from `dist/index.html`'s mtime; neither file is reachable from a
 * page, so both are settled here, at the moment that mtime would be
 * written anyway. The format matches the server's to the second, because
 * the Settings card prints whichever it is given without knowing which
 * deployment answered.
 */
const APP_VERSION = (JSON.parse(readFileSync(`${repo}package.json`, 'utf-8')) as { version: string })
  .version;
const BUILD_STAMP = new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * The static demo build: the whole app as files, with no server behind it.
 *
 * The trick is the aliases below. `server/studies.ts` and friends import
 * `node:fs`; pointing those imports at the in-memory shims lets the REAL
 * route modules run in the page. The demo therefore cannot drift from the
 * app — it is not a reimplementation, it is the same code with its disk
 * swapped out.
 *
 * `base` is relative so the output works from a project page
 * (user.github.io/repo/) without being told the repository's name, and the
 * app routes on the hash, so there is no 404-rewrite rule to configure.
 */
export default defineConfig({
  root,
  base: './',
  publicDir: `${root}public`,
  plugins: [react(), tailwindcss(), licenses(/* desktop */ false), precache(), demoAssets()],
  define: {
    // server/paths.ts reads process.env for its overrides; in the demo there
    // are none, and an undefined `process` would throw at import.
    'process.env': '{}',
    __DEMO__: 'true',
    __DEMO_VERSION__: JSON.stringify(APP_VERSION),
    __DEMO_BUILD__: JSON.stringify(BUILD_STAMP),
  },
  resolve: {
    alias: {
      '@shared': `${repo}shared`,
      '@': `${root}src`,
      // BEFORE 'node:fs': these are prefix matches, so the shorter key
      // would otherwise swallow this one and resolve the import to
      // `.../fs.ts/promises`, which is not a path.
      'node:fs/promises': `${root}src/demo/nodeShim/fsPromises.ts`,
      'node:fs': `${root}src/demo/nodeShim/fs.ts`,
      'node:path': `${root}src/demo/nodeShim/path.ts`,
      'node:url': `${root}src/demo/nodeShim/url.ts`,
      'better-sqlite3': `${root}src/demo/nodeShim/sqlite.ts`,
    },
  },
  build: {
    outDir: `${repo}dist-demo`,
    emptyOutDir: true,
    // No source maps: this is the one build that is published to strangers.
    sourcemap: false,
  },
});
