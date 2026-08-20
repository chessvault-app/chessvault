import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { logger } from 'hono/logger';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { authApi, migratePlaintextPassword, requireAuth } from './auth.ts';
import { crossSiteGuard } from './crossSite.ts';
import { lichessExplorerApi, lichessStudiesApi } from './lichess.ts';
import { mountVault } from './mountVault.ts';
import { puzzleBooksApi } from './puzzlebooks.ts';
import { sweepUnfinishedPuzzleBuild } from './puzzles.ts';
import { migrateLegacyRefgames, seedBundledRefgames, sweepUnfinishedBuilds } from './refgames.ts';
import { settingsApi } from './settings.ts';
import { startVaultBackup } from './vaultBackup.ts';
import { vaultHistoryApi } from './vaultHistory.ts';
import { seedWelcomeDocs } from './welcome.ts';
import { APP_VERSION, DATA, REPO_ROOT, VAULT_GAMES, VAULT_NOTES, VAULT_SOURCES, VAULT_STUDIES, UPDATES } from './paths.ts';

const PORT = Number(process.env.PORT ?? 8787);

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
const LOOPBACK_BIND = BIND === '127.0.0.1' || BIND === 'localhost' || BIND === '::1';

// Opening an empty folder as a vault must Just Work: create the skeleton
// up front so every listing endpoint finds its directory.
for (const d of [VAULT_STUDIES, VAULT_NOTES, VAULT_GAMES, VAULT_SOURCES, DATA]) {
  mkdirSync(d, { recursive: true });
}

// The starter reference games that ship with the app, copied in the
// first time this data directory is used — so the explorer, the
// repertoire trainer and the elite game browser all have something to
// answer from on a fresh install. Deletable like anything the user
// built, and it does not come back once it has been. The single-file
// refgames layout migrates first, so the seed lands beside it, never
// over it.
migrateLegacyRefgames();
// A build the app was quit in the middle of left a `.building` file no
// listing shows and no page can delete — hundreds of megabytes of it, and
// gigabytes for the puzzle database. Nothing can be building now, so what
// is there is either finished and owed its rename, or rubble.
sweepUnfinishedBuilds();
sweepUnfinishedPuzzleBuild();
seedBundledRefgames();
// A fresh vault opens with a welcome study and note — onboarding as
// content, seeded once and never resurrected (see welcome.ts).
seedWelcomeDocs();
// A config still holding the app password verbatim is rewritten to its
// scrypt form before the server answers anything (see auth.ts) — the same
// rewrite a successful login performs, done here so the plaintext does
// not have to wait on one.
migratePlaintextPassword();

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

/**
 * When this build was made.
 *
 * The version number moves once per release, so between releases every
 * deploy reports the same string and there is no way — from the device —
 * to tell a freshly shipped app from one a cache has been holding on to.
 * That question comes up every time a fix cannot be reproduced, and the
 * only honest answer needs a stamp that changes per BUILD.
 *
 * The built index.html's mtime is that stamp: it is rewritten by every
 * build, needs no git (the desktop app is not a checkout) and no
 * generated file. Read once at boot, because it cannot change under a
 * running server without that server being restarted.
 */
const BUILD_STAMP = ((): string | null => {
  try {
    return statSync(`${REPO_ROOT}/dist/index.html`).mtime.toISOString().slice(0, 19).replace('T', ' ');
  } catch {
    return null; // dev, where Vite serves the app and there is no dist
  }
})();

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    // Reported so the UI can show whether threads are actually available.
    crossOriginIsolated: true,
    version: APP_VERSION,
    build: BUILD_STAMP,
  }),
);

/**
 * Gzip the API.
 *
 * A book's detail response is its whole puzzle list — 1.9 MB of JSON for
 * the largest, every byte of it repetitive FENs and move lists, which is
 * exactly what gzip is good at.
 */
app.use('/api/*', compress());

/**
 * And the app's own text, which was the bigger miss.
 *
 * This used to say that everything under /dist was "already compressed
 * (jpeg, wasm)", so squeezing it would cost CPU for nothing. That is true
 * of the pictures and the engine and false of the two files that matter
 * most: the stylesheet and the bundle went over the wire RAW — measured
 * on the deployed server, 267 kB of CSS and 222 kB of JS, on every cold
 * launch, over whatever connection a phone happens to have.
 *
 * The stylesheet is the one that hurts. It is render-blocking, so nothing
 * paints until all of it has arrived — and on an installed app iOS holds
 * its startup image up exactly that long, so stylesheet bytes are launch
 * time.
 *
 * By extension, not by path: a woff2, a jpeg and the engine's wasm are
 * already compressed and gzipping them again spends CPU to add bytes, so
 * only the text types are listed.
 */
const COMPRESSIBLE = /\.(css|js|mjs|json|webmanifest|svg|map|txt)$/;
app.use('/*', async (c, next) => {
  if (!COMPRESSIBLE.test(c.req.path)) return next();
  return compress()(c, next);
});

// Before anything that can write: refuse cross-site requests. An ungated
// vault has no session for the cookie-based gate to protect, so without
// this any web page open in the user's own browser could reach the API on
// loopback — including /api/settings/wipe. See server/crossSite.ts.
app.use('/api/*', crossSiteGuard({ loopbackOnly: LOOPBACK_BIND }));

// Cap request bodies before any handler buffers them: the vault-write
// routes (studies, notes, draft images) otherwise accept unbounded input.
// 32 MB clears the largest legitimate case (a book's draft batch) with room
// to spare; the per-route byte checks refine it.
//
// One exemption: the PGN source upload is streamed to disk precisely
// because an elite month is hundreds of megabytes, and this middleware
// broke it two ways — a declared Content-Length over the cap 413s the
// route outright, and a chunked body is BUFFERED WHOLE to measure it,
// defeating the streaming on the 2 GB box the route exists to protect.
// The route enforces its own cap on the bytes as they stream past.
const apiBodyCap = bodyLimit({ maxSize: 32 * 1024 * 1024 });
app.use('/api/*', (c, next) =>
  c.req.method === 'POST' && c.req.path === '/api/sources' ? next() : apiBodyCap(c, next),
);

// Auth first: its own routes stay reachable while everything /api after
// this point requires the session (no-op unless appPassword is set).
app.route('/api', authApi());
app.use('/api/*', requireAuth());

// Everything that reads or writes the vault. Shared with the static demo,
// which mounts the same list over an in-memory filesystem — see
// server/mountVault.ts for why that list is not written twice any more.
mountVault(app);

/**
 * The safety net, started here so recovery can force a commit before it
 * overwrites anything. Failing to start is not fatal — the app runs fine
 * without a history, and the recovery routes then report themselves
 * unavailable rather than erroring.
 */
const vaultBackup = startVaultBackup().catch((error: Error) => {
  console.error('[vault-backup] disabled:', error.message);
  return null;
});

/**
 * Reading that safety net back out. NOT in mountVault: the demo shares
 * that list and has neither git nor node:child_process, so it answers 404
 * here and the recovery UI shows its unavailable state.
 */
app.route(
  '/api',
  vaultHistoryApi(undefined, {
    commitNow: async () => {
      await (await vaultBackup)?.commitNow();
    },
  }),
);

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

  // Streamed, and with Range honoured. readFileSync here held a whole
  // ~80 MB installer in memory PER REQUEST on the 2 GB box, and without
  // Range electron-updater's blockmap differential update degrades to a
  // full download every time.
  const size = statSync(path).size;
  const headers: Record<string, string> = {
    'content-type': file.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream',
    // latest.yml must never be cached — it is the thing that changes.
    'cache-control': file.endsWith('.yml') ? 'no-store' : 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return c.body(null, 416, { 'content-range': `bytes */${size}` });
    }
    const part = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return c.body(part, 206, {
      ...headers,
      'content-range': `bytes ${start}-${end}/${size}`,
      'content-length': String(end - start + 1),
    });
  }
  const whole = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return c.body(whole, 200, { ...headers, 'content-length': String(size) });
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

  /**
   * How long anything may be believed without asking.
   *
   * The static handler sent Last-Modified and nothing else, and a response
   * with no cache-control is one a cache may keep for a HEURISTIC time of
   * its own choosing — commonly a tenth of the file's age. That is fine
   * for a picture and wrong for index.html, which is the one file whose
   * name never changes: keep a stale copy of it and the whole app is the
   * build it names, however many times the server has been updated since.
   * A phone that had banked an older copy would go on launching the old
   * app, and every fix shipped to it would look like it had not worked.
   *
   * So the two halves get opposite answers. Everything under /assets
   * carries a content hash in its filename, so it can never change
   * meaning and is immutable for a year. index.html and the service
   * worker are `no-cache`, which does NOT mean "do not store" — it means
   * "store it, but ask before using it". The ask costs a 304 and a round
   * trip on launch, and buys the guarantee that what starts is what is
   * deployed.
   */
  app.use('/*', async (c, next) => {
    await next();
    if (c.res.headers.get('cache-control')) return; // a route said its own
    const path = c.req.path;
    const html = c.res.headers.get('content-type')?.startsWith('text/html');
    if (html || path === '/sw.js' || path === '/manifest.webmanifest') {
      c.res.headers.set('cache-control', 'no-cache');
    } else if (path.startsWith('/assets/')) {
      c.res.headers.set('cache-control', 'public, max-age=31536000, immutable');
    }
  });

  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

serve({ fetch: app.fetch, port: PORT, hostname: BIND }, (info) => {
  console.log(`  chess-vault server  http://127.0.0.1:${info.port}`);
  console.log(`  cross-origin isolation: on (Stockfish threads enabled)`);
  // Phones on the same network reach the app through Vite's LAN address.
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal);
  if (lan) console.log(`  on your phone:      http://${lan.address}:5173`);
});

