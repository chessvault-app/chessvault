import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

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
  plugins: [react(), tailwindcss()],
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
    sourcemap: true,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    // These ship as prebuilt ESM and choke esbuild's dep scan otherwise.
    exclude: ['stockfish'],
  },
});
