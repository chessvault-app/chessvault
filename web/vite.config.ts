import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { licenses } from './vite.licenses.ts';
import { precache } from './vite.precache.ts';

/**
 * Fail the build on a cycle between chunks. Rolldown will happily emit
 * two chunks that import each other; whichever evaluates second sees
 * the other's exports, and the first sees `undefined` for anything it
 * reads at module load. That is silent at build time and a crash at
 * run time — the editor chunk did exactly this when a manual group
 * split a package from its dependency (see codeSplitting below). Only
 * static imports count: a dynamic import is a request made later, not
 * an evaluation order.
 */
function noChunkCycles(): Plugin {
  return {
    name: 'no-chunk-cycles',
    generateBundle(_options, bundle) {
      const edges = new Map<string, string[]>();
      for (const [file, out] of Object.entries(bundle)) {
        if (out.type === 'chunk') edges.set(file, out.imports);
      }
      const state = new Map<string, 'open' | 'done'>();
      const walk = (file: string, path: string[]): void => {
        const seen = state.get(file);
        if (seen === 'done') return;
        if (seen === 'open') {
          const cycle = [...path.slice(path.indexOf(file)), file].join(' -> ');
          throw new Error(
            `chunks import each other, and the first to evaluate reads undefined: ${cycle}. ` +
              'A manual group has probably split a package from a dependency it uses at module load; ' +
              'add the dependency to the group (see codeSplitting in web/vite.config.ts).',
          );
        }
        state.set(file, 'open');
        for (const next of edges.get(file) ?? []) walk(next, [...path, file]);
        state.set(file, 'done');
      };
      for (const file of edges.keys()) walk(file, []);
    },
  };
}

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
  plugins: [react(), tailwindcss(), licenses(), precache(), noChunkCycles()],
  // Stated false so it FOLDS. `isDemo()` guards on
  // `typeof __DEMO__ !== 'undefined'`, which is safe when the identifier is
  // absent but cannot be evaluated at build time — so the demo's dynamic
  // import survived, and every production build emitted the in-page demo
  // server and its seed vault as a 229 KB chunk no real user ever fetches.
  // Defining it lets the branch fold away, which is what web/src/lib/demo.ts
  // has always claimed happens.
  // __LAG__ carries the artificial-latency switch (lagMs() in lib/api.ts)
  // into a build, so the loading states can be looked at on a real device
  // against the real server. Stated false the same way __DEMO__ is, so an
  // ordinary build folds the whole thing out.
  define: { __DEMO__: 'false', __LAG__: process.env.CHESS_LAG === '1' ? 'true' : 'false' },
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
     * scrolls past with it. 700 clears the editor with headroom and
     * still catches real growth. The editor stack now has its own chunk
     * (the `editor` group below, 530 kB) and NoteView is 114 kB; the
     * runner-up is pdfjs at 427 kB. If this needs raising again, that is
     * the signal to split the editor further rather than the number.
     */
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        /**
         * Two named groups over rolldown's automatic split. Without them
         * the React runtime sat inside the entry chunk (index, 249 kB;
         * 71 kB with React in its own 190 kB chunk), whose hash changes
         * with every release, and NoteView carried the whole
         * TipTap/ProseMirror stack in one 644 kB chunk. `react` changes
         * only when React does, so it stays cached across app releases;
         * `editor` keeps the editor stack (530 kB) out of the note VIEW
         * (114 kB), so the two fetch in parallel and an editor update
         * leaves the view's hash alone. Boot bytes are unchanged: the
         * entry's static graph is 592 kB of JS with these groups and
         * 591 kB without.
         *
         * `includeDependenciesRecursively` is off because on it pulled a
         * group's dependencies in with it: TipTap's use-sync-external-store
         * landed in `editor`, zustand imports the same module, and the
         * editor chunk became part of first paint (measured: 1.2 MB of
         * eager JS instead of 0.6).
         *
         * No `@base-ui` group, though one was tried both ways: as one
         * chunk it put every Base UI primitive the lazy routes use into
         * the boot path (+106 kB eager); `entriesAware` split it into 24
         * fragments, several under 1 kB, for no fewer eager bytes. The
         * automatic split already keeps each route's primitives with the
         * route.
         *
         * The `editor` group must be CLOSED under the stack's own small
         * dependencies, which is what the second half of its pattern
         * is. With only the named packages in it, prosemirror-history's
         * rope-sequence fell into the NoteView chunk, so the editor
         * chunk imported from the view chunk that imports it; rolldown
         * evaluated the editor chunk first, its import was still
         * undefined, and `Branch.empty = new Branch(RopeSequence.empty)`
         * threw at module load: every note page opened to the error
         * boundary, and shipped that way on 2026-09-04. Each package
         * listed is reached only through TipTap, ProseMirror or
         * markdown-it (`npm ls` says so), so the group grows by their
         * few kilobytes and nothing eager. use-sync-external-store and
         * @floating-ui are deliberately NOT here: both are shared with
         * the boot path (see above). noChunkCycles fails the build if
         * two chunks ever import each other again.
         */
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            {
              name: 'editor',
              test: /node_modules[\\/](@tiptap|prosemirror-[a-z-]+|markdown-it|rope-sequence|orderedmap|w3c-keyname|linkify-it|linkifyjs|mdurl|uc\.micro|entities|punycode\.js|fast-equals)[\\/]/,
              priority: 2,
            },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // These ship as prebuilt ESM and choke esbuild's dep scan otherwise.
    exclude: ['stockfish'],
  },
});
