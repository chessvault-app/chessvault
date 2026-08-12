import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { licenses } from './vite.licenses.ts';

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
  plugins: [react(), tailwindcss(), licenses(false), demoAssets()],
  define: {
    // server/paths.ts reads process.env for its overrides; in the demo there
    // are none, and an undefined `process` would throw at import.
    'process.env': '{}',
    __DEMO__: 'true',
  },
  resolve: {
    alias: {
      '@shared': `${repo}shared`,
      '@': `${root}src`,
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
