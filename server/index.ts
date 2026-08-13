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
import { seedBundledBook } from './books.ts';
import { lichessExplorerApi, lichessStudiesApi } from './lichess.ts';
import { mountVault } from './mountVault.ts';
import { puzzleBooksApi } from './puzzlebooks.ts';
import { settingsApi } from './settings.ts';
import { startVaultBackup } from './vaultBackup.ts';
import { APP_VERSION, DATA, REPO_ROOT, VAULT_GAMES, VAULT_NOTES, VAULT_SOURCES, VAULT_STUDIES, UPDATES } from './paths.ts';

const PORT = Number(process.env.PORT ?? 8787);

// Opening an empty folder as a vault must Just Work: create the skeleton
// up front so every listing endpoint finds its directory.
for (const d of [VAULT_STUDIES, VAULT_NOTES, VAULT_GAMES, VAULT_SOURCES, DATA]) {
  mkdirSync(d, { recursive: true });
}

// The opening book that ships with the app, copied in the first time this
// data directory is used — so the explorer and the repertoire trainer have
// something to answer from on a fresh install. Deletable like any other
// book, and it does not come back once it has been.
seedBundledBook();

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
  }),
);

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

// Cap request bodies before any handler buffers them: the vault-write
// routes (studies, notes, draft images) otherwise accept unbounded input.
// 32 MB clears the largest legitimate case (a book's draft batch) with room
// to spare; the per-route byte checks refine it.
app.use('/api/*', bodyLimit({ maxSize: 32 * 1024 * 1024 }));

// Auth first: its own routes stay reachable while everything /api after
// this point requires the session (no-op unless appPassword is set).
app.route('/api', authApi());
app.use('/api/*', requireAuth());

// Everything that reads or writes the vault. Shared with the static demo,
// which mounts the same list over an in-memory filesystem — see
// server/mountVault.ts for why that list is not written twice any more.
mountVault(app);

app.route('/api', lichessExplorerApi());
app.route('/api', puzzleBooksApi());
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
  /**
   * The manifest, in the scheme the phone is actually in.
   *
   * Android draws its own launch screen from `background_color` — one
   * colour, baked into the manifest, so an app that has both schemes gets
   * one of them wrong: a white card in front of a dark app, or the
   * reverse. The manifest format has no media queries and no second
   * colour to offer.
   *
   * What it does have is a client hint. `Accept-CH:
   * Sec-CH-Prefers-Color-Scheme` on the page asks Chrome to say which
   * scheme it is in, and it then sends that header on same-origin
   * requests — including the manifest fetch, which is why this is a route
   * rather than a file. `Vary` keeps the two answers apart in every cache
   * between here and the phone.
   *
   * It is not live: Android reads these colours when the app is installed
   * and again when it refreshes the WebAPK (days, not seconds), so
   * switching a phone to dark mode does not repaint yesterday's splash.
   * It fixes the case that actually bites — installing in dark mode and
   * being handed a white flash for ever — and nothing here can do better
   * until the format grows a second colour.
   */
  app.get('/manifest.webmanifest', (c) => {
    const path = `${dist}/manifest.webmanifest`;
    if (!existsSync(path)) return c.notFound();
    const manifest = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    // Absent hint = the first visit, before Accept-CH has been honoured.
    // Dark is the app's own default, and the one a phone is more often in.
    const light = c.req.header('sec-ch-prefers-color-scheme') === 'light';
    const bg = light ? '#f9fafc' : '#090c12';
    return c.body(JSON.stringify({ ...manifest, background_color: bg, theme_color: bg }), 200, {
      // The manifest's own type, not application/json: c.json() would
      // serve it as the latter, which browsers accept and validators do
      // not.
      'content-type': 'application/manifest+json; charset=utf-8',
      vary: 'Sec-CH-Prefers-Color-Scheme',
      'cache-control': 'no-cache',
    });
  });

  /**
   * Ask for the hint on the page itself; the manifest request that
   * follows carries it.
   *
   * Accept-CH only — NOT Critical-CH. Critical-CH tells Chrome the
   * response is wrong without the hint, and Chrome answers by throwing
   * away the page it has just started and navigating again with the hint
   * attached. That is a second load of the whole app on a cold start, in
   * front of the launch screen, to correct a colour that Android only
   * reads when it installs. The hint arrives on the next request either
   * way.
   */
  app.use('/*', async (c, next) => {
    await next();
    if (c.res.headers.get('content-type')?.startsWith('text/html')) {
      c.res.headers.set('accept-ch', 'Sec-CH-Prefers-Color-Scheme');
      c.res.headers.append('vary', 'Sec-CH-Prefers-Color-Scheme');
    }
  });

  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

// Safety net: every vault change is auto-committed to vault/.history.git.
void startVaultBackup().catch((error: Error) =>
  console.error('[vault-backup] disabled:', error.message),
);

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

