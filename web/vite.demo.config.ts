import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

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
  plugins: [react(), tailwindcss()],
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
    },
  },
  build: {
    outDir: `${repo}dist-demo`,
    emptyOutDir: true,
    // No source maps: this is the one build that is published to strangers.
    sourcemap: false,
  },
});
