import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { licenses } from './vite.licenses.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

// Stockfish's multi-threaded WASM build needs SharedArrayBuffer, which browsers
// only expose to cross-origin-isolated documents. These two headers are what
// buy us `Threads > 1`; without them we silently fall back to the single-thread
// build. The Hono server sets the same pair for production.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  root,
  publicDir: `${root}public`,
  // The stylesheet blocks first paint again, on purpose: with no in-page
  // launch screen, iOS holds its startup image until the first paint, so
  // a blocking stylesheet means the first thing painted is a styled page
  // rather than an unstyled flash. (vite.launchScreen.ts, which deferred
  // it, went with the launch screen it existed for.)
  plugins: [react(), tailwindcss(), licenses()],
  // Stated false so it FOLDS. `isDemo()` guards on
  // `typeof __DEMO__ !== 'undefined'`, which is safe when the identifier is
  // absent but cannot be evaluated at build time — so the demo's dynamic
  // import survived, and every production build emitted the in-page demo
  // server and its seed vault as a 229 KB chunk no real user ever fetches.
  // Defining it lets the branch fold away, which is what web/src/lib/demo.ts
  // has always claimed happens.
  define: { __DEMO__: 'false' },
  resolve: {
    alias: {
      '@shared': `${repo}shared`,
      '@': `${root}src`,
    },
  },
  server: {
    port: 5173,
    // Listen on the LAN so the app can be used from a phone on the same
    // network. Note: over plain http a non-localhost origin is not a secure
    // context, so SharedArrayBuffer is unavailable there and the engine
    // falls back to its single-threaded build — expected on mobile for now.
    host: true,
    headers: crossOriginIsolation,
    // fs events silently die on this machine (seen three times); polling is
    // slightly more CPU but never goes stale.
    watch: { usePolling: true, interval: 400 },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
    fs: {
      // Allow serving the engine binaries straight out of node_modules in dev.
      allow: [repo],
    },
  },
  preview: { port: 4173, headers: crossOriginIsolation },
  build: {
    outDir: `${repo}dist`,
    emptyOutDir: true,
    target: 'es2022',
    // Maps are a debugging aid, and shipping them publishes the source: the
    // server serves whatever is in dist/, and the desktop installer carries
    // it too (25 MB of the package, most of it maps). Set CHESS_SOURCEMAPS=1
    // to get them back for a build you are actually debugging.
    sourcemap: process.env.CHESS_SOURCEMAPS === '1',
    /**
     * 700 kB, not the default 500.
     *
     * The default fired on exactly one chunk, every build: NoteView, at
     * 644 kB minified (229 kB gzipped, which is the number that actually
     * travels — the limit is compared against the pre-gzip size). It is
     * the TipTap/ProseMirror editor stack plus markdown-it, and it is
     * lazy TWICE over — App lazy-loads NotesView, which lazy-loads
     * NoteView — so it is fetched only by someone opening a note, never
     * at boot. The advice the warning gives is "code-split", which is
     * already done; it simply cannot tell a leaf route from the entry.
     *
     * A warning that fires on every build for a known, deliberate chunk
     * trains you to scroll past it, and the next one that means something
     * scrolls past with it. 700 clears NoteView with ~9% headroom and
     * still catches real growth. For scale, the entry chunk that gates
     * first paint is 216 kB (68 kB gzipped) and the runner-up is pdfjs at
     * 427 kB. If this needs raising again, that is the signal to split
     * the editor rather than the number.
     */
    chunkSizeWarningLimit: 700,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // These ship as prebuilt ESM and choke esbuild's dep scan otherwise.
    exclude: ['stockfish'],
  },
});
