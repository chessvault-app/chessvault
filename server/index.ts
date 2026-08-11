import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { authApi, requireAuth } from './auth.ts';
import { DEMO, demoGuard, startDemoResets } from './demo.ts';
import { booksApi } from './books.ts';
import { gamesApi } from './games.ts';
import { lichessExplorerApi, lichessStudiesApi } from './lichess.ts';
import { openingsApi } from './openings.ts';
import { puzzlesApi } from './puzzles.ts';
import { puzzleBooksApi } from './puzzlebooks.ts';
import { refGamesApi } from './refgames.ts';
import { settingsApi } from './settings.ts';
import { studiesApi } from './studies.ts';
import { startVaultBackup } from './vaultBackup.ts';
import { APP_VERSION, DATA, REPO_ROOT, VAULT_GAMES, VAULT_NOTES, VAULT_SOURCES, VAULT_STUDIES, UPDATES } from './paths.ts';

const PORT = Number(process.env.PORT ?? 8787);

// Opening an empty folder as a vault must Just Work: create the skeleton
// up front so every listing endpoint finds its directory.
for (const d of [VAULT_STUDIES, VAULT_NOTES, VAULT_GAMES, VAULT_SOURCES, DATA]) {
  mkdirSync(d, { recursive: true });
}

const app = new Hono();
app.use('*', logger());

/**
 * Cross-origin isolation. Stockfish's multi-threaded WASM build needs
 * SharedArrayBuffer, which browsers gate behind these headers. Without them the
 * engine silently drops to single-threaded, so they are not optional.
 */
app.use('*', async (c, next) => {
  await next();
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Embedder-Policy', 'require-corp');
  c.header('Cross-Origin-Resource-Policy', 'same-origin');
});

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    // Reported so the UI can show whether threads are actually available.
    crossOriginIsolated: true,
    version: APP_VERSION,
    ...(DEMO && { demo: true }),
  }),
);

// Cap request bodies before any handler buffers them: the vault-write
/**
 * Gzip the API only.
 *
 * A book's detail response is its whole puzzle list — 1.9 MB of JSON for
 * the largest, every byte of it repetitive FENs and move lists, which is
 * exactly what gzip is good at. Everything under /dist is already
 * compressed (jpeg, wasm) or served by the static handler, so squeezing
 * those would cost CPU for nothing.
 */
app.use('/api/*', compress());

// routes (studies, notes, draft images) otherwise accept unbounded input.
// 32 MB clears the largest legitimate case (a book's draft batch) with room
// to spare; the per-route byte checks refine it.
// The demo has no book imports and no draft batches, so the ceiling that
// exists for those is only a ceiling on what a stranger may post.
app.use('/api/*', bodyLimit({ maxSize: (DEMO ? 1 : 32) * 1024 * 1024 }));

// Auth first: its own routes stay reachable while everything /api after
// this point requires the session (no-op unless appPassword is set).
app.route('/api', authApi());
app.use('/api/*', requireAuth());

// After auth, before every route: in demo mode nothing may be changed
// except through the short list in demo.ts.
if (DEMO) app.use('/api/*', demoGuard());

app.route('/api', booksApi());
app.route('/api', openingsApi());
app.route('/api', lichessExplorerApi());
app.route('/api', studiesApi());
// The games collection speaks the same document API as studies: an annotated
// game is a one-chapter study living in vault/games/collection/.
app.route('/api', studiesApi(resolve(VAULT_GAMES, 'collection'), 'games/docs'));
// Notes: the same document API over markdown files.
app.route('/api', studiesApi(VAULT_NOTES, 'notes', '.md'));
app.route('/api', gamesApi());
app.route('/api', puzzlesApi());
app.route('/api', refGamesApi());
// Book puzzles are read from commercial PDFs and are not ours to
// redistribute, so in demo mode the route is never created — the guard
// already refuses it, and a route that does not exist cannot be reached
// past a mistake in the guard.
if (!DEMO) app.route('/api', puzzleBooksApi());
app.route('/api', settingsApi());
app.route('/api', lichessStudiesApi());

/**
 * Desktop update feed. Deliberately OUTSIDE /api and outside the password
 * gate: the updater is a background process with no session and no way to
 * get one. On a tailnet-only deployment the network is the boundary; on a
 * public one, these are the same bytes you hand out as an installer
 * anyway, and every download is checked against the sha512 in latest.yml.
 *
 * No directory listing, and only the file shapes a release actually
 * consists of — the folder is not a general file server.
 */
app.get('/updates/:file', (c) => {
  const file = c.req.param('file');
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,80}\.(yml|exe|blockmap|dmg|zip|AppImage)$/.test(file)) {
    return c.json({ error: 'not an update file' }, 404);
  }
  const path = resolve(UPDATES, file);
  // resolve() collapses any traversal the pattern let through.
  if (!path.startsWith(resolve(UPDATES))) return c.json({ error: 'not an update file' }, 404);
  if (!existsSync(path)) return c.json({ error: 'no such update file' }, 404);
  return c.body(new Uint8Array(readFileSync(path)), 200, {
    'content-type': file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
    // latest.yml must never be cached — it is the thing that changes.
    'cache-control': file.endsWith('.yml') ? 'no-store' : 'public, max-age=31536000, immutable',
  });
});

// In production the built SPA is served from ./dist; in dev Vite serves it.
const dist = `${REPO_ROOT}/dist`;
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

// Safety net: every vault change is auto-committed to vault/.history.git.
// Not in the demo: a history repo of strangers' edits grows without bound
// and is the one directory the reset does not empty.
if (!DEMO) {
  void startVaultBackup().catch((error: Error) =>
    console.error('[vault-backup] disabled:', error.message),
  );
}

// Shared demo vault: restore it from the seed now and on a timer.
startDemoResets();

/**
 * Which interfaces to answer on.
 *
 * Unset means every one, which is what a server wants — devices on the
 * tailnet have to reach it. The desktop app's LOCAL mode sets this to
 * loopback, because that server is for the window in front of you and
 * has no password: without it, opening the app on a café network put an
 * unauthenticated vault on that network.
 */
const BIND = process.env.CHESS_BIND?.trim() || undefined;

serve({ fetch: app.fetch, port: PORT, hostname: BIND }, (info) => {
  console.log(`  chess-vault server  http://127.0.0.1:${info.port}`);
  console.log(`  cross-origin isolation: on (Stockfish threads enabled)`);
  // Phones on the same network reach the app through Vite's LAN address.
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal);
  if (lan) console.log(`  on your phone:      http://${lan.address}:5173`);
});

