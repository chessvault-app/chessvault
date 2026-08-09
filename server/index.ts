import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { authApi, requireAuth } from './auth.ts';
import { booksApi } from './books.ts';
import { gamesApi } from './games.ts';
import { lichessExplorerApi } from './lichess.ts';
import { puzzlesApi } from './puzzles.ts';
import { puzzleBooksApi } from './puzzlebooks.ts';
import { refGamesApi } from './refgames.ts';
import { settingsApi } from './settings.ts';
import { studiesApi } from './studies.ts';
import { startVaultBackup } from './vaultBackup.ts';
import { DATA, REPO_ROOT, VAULT_GAMES, VAULT_NOTES, VAULT_SOURCES, VAULT_STUDIES } from './paths.ts';

const PORT = Number(process.env.PORT ?? 8787);

// Opening an empty folder as a vault must Just Work: create the skeleton
// up front so every listing endpoint finds its directory.
import { mkdirSync } from 'node:fs';
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
    version: '0.1.0',
  }),
);

// Auth first: its own routes stay reachable while everything /api after
// this point requires the session (no-op unless appPassword is set).
app.route('/api', authApi());
app.use('/api/*', requireAuth());

app.route('/api', booksApi());
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
app.route('/api', puzzleBooksApi());
app.route('/api', settingsApi());

// In production the built SPA is served from ./dist; in dev Vite serves it.
const dist = `${REPO_ROOT}/dist`;
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

// Safety net: every vault change is auto-committed to vault/.history.git.
void startVaultBackup().catch((error: Error) =>
  console.error('[vault-backup] disabled:', error.message),
);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`  chess-vault server  http://127.0.0.1:${info.port}`);
  console.log(`  cross-origin isolation: on (Stockfish threads enabled)`);
  // Phones on the same network reach the app through Vite's LAN address.
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((iface) => iface && iface.family === 'IPv4' && !iface.internal);
  if (lan) console.log(`  on your phone:      http://${lan.address}:5173`);
});

export { app };
