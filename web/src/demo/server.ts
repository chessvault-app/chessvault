import { Hono } from 'hono';
import { booksApi } from '../../../server/books.ts';
import { gamesApi } from '../../../server/games.ts';
import { openingsApi } from '../../../server/openings.ts';
import { puzzlesApi } from '../../../server/puzzles.ts';
import { refGamesApi } from '../../../server/refgames.ts';
import { studiesApi } from '../../../server/studies.ts';
import { installBuffer } from './nodeShim/buffer.ts';
import { seedFile } from './nodeShim/fs.ts';
import { loadDemoDatabases } from './nodeShim/sqlite.ts';
import { DATA_OPENINGS } from '../../../server/paths.ts';
import { SEED } from './seed.ts';

/**
 * The demo's "server": the real route modules, running in the page.
 *
 * `web/vite.demo.config.ts` aliases `node:fs`, `node:path` and `node:url` to
 * the shims beside this file, so importing `server/studies.ts` here gives
 * the SAME code that answers a real deployment — no second implementation
 * of the vault API to agree with the app today and drift from it later.
 *
 * It runs on the main thread rather than in a service worker on purpose: a
 * worker is terminated when it goes idle, and an in-memory vault would go
 * with it, so a visitor's edits would vanish after half a minute of
 * reading. In the page they last exactly as long as the tab, which is what
 * "try the editing flow" needs.
 */

const VAULT = '/vault';
/** Keys the sqlite shim resolves; the routes only ever see these as paths. */
const PUZZLES_DB = '/demo/puzzles.sqlite';
const REFGAMES_DB = '/demo/refgames.sqlite';

function buildApp(): Hono {
  // Before the routes run: they reference Buffer free, to size a document
  // in bytes rather than characters.
  installBuffer();

  for (const [path, content] of Object.entries(SEED)) {
    // One timestamp per file, spread so the lists have an order worth
    // looking at rather than every row claiming the same second.
    seedFile(`${VAULT}/${path}`, content, Date.now() - Object.keys(SEED).indexOf(path) * 3_600_000);
  }

  const app = new Hono();
  app.route('/api', studiesApi(`${VAULT}/studies`, 'studies', '.pgn'));
  app.route('/api', studiesApi(`${VAULT}/games/collection`, 'games/docs', '.pgn'));
  app.route('/api', studiesApi(`${VAULT}/notes`, 'notes', '.md'));
  // The real puzzle and reference-game routes, over the curated subsets.
  // books.ts owns /api/opening (ECO naming) and /api/books (the local
  // opening-book list) — the Board asks for both on mount and died on the
  // error shape when neither existed. The book list comes back empty here,
  // which is true: a demo ships no indexed PGN sources.
  app.route('/api', booksApi());
  app.route('/api', gamesApi(`${VAULT}/games`));
  app.route('/api', openingsApi());
  app.route('/api', puzzlesApi(PUZZLES_DB, `${VAULT}/puzzles`));
  app.route('/api', refGamesApi(REFGAMES_DB));
  app.get('/api/health', (c) => c.json({ ok: true, crossOriginIsolated: false, demo: true }));
  app.get('/api/settings', (c) =>
    c.json({
      profile: {},
      gate: false,
      totp: false,
      lichess: { configured: false, last4: null },
      vaultPath: 'demo',
      version: 'demo',
      demo: true,
    }),
  );
  /**
   * The opening explorer is not available without a server.
   *
   * Calling Lichess directly from the page was the plan, on the assumption
   * that the explorer's public endpoints work unauthenticated. Measured:
   * they do not — explorer.lichess.org and explorer.lichess.ovh both answer
   * 401 with no token. CORS is not the obstacle; authentication is.
   *
   * A token cannot be shipped instead. A static bundle is readable by
   * everyone who loads it, so embedding one would publish it — the same
   * leak that closed this route on the hosted demo, except worse, because
   * there it was at least behind a server.
   *
   * So this says what is true, in the shape the client already handles,
   * and the repertoire trainer reports it instead of hanging.
   */
  app.get('/api/explorer/:db', (c) =>
    c.json(
      { error: 'The opening explorer needs a server with a Lichess token, so it is off in this demo.' },
      503,
    ),
  );

  // Book puzzles are read from commercial books and are not in the demo at
  // all. The dashboard still draws a shelf, so this answers with the shape
  // the real route uses when a vault holds no books — an empty list, which
  // is the truth here. A 404 would be equally true and would crash the
  // page, which is the difference between honest and useful.
  app.get('/api/puzzlebooks', (c) => c.json({ books: [] }));

  // Anything the demo has no answer for says so, rather than falling
  // through to the page's own HTML and failing as a JSON parse error.
  app.all('/api/*', (c) => c.json({ error: 'not available in the static demo' }, 404));
  return app;
}

/**
 * Answer `/api` from the in-page app; let everything else reach the network.
 *
 * Patching fetch rather than installing a service worker keeps the whole
 * demo synchronous to reason about: there is no install/activate race, no
 * second lifecycle, and no way for the app to make a request before the
 * backend exists.
 */
export async function installDemoBackend(): Promise<void> {
  // Never fatal. The vault — studies, games, notes, the whole editing flow
  // — needs no database at all, and losing the puzzle trainer to a missing
  // asset must not cost the visitor everything else. The routes already
  // draw a "no puzzle database yet" state, which is the honest thing to
  // show when there genuinely is none.
  // The ECO catalogue is a plain file the openings lookup reads off disk,
  // so it is fetched once and written into the in-memory filesystem at the
  // exact path the real code resolves. 284 KB, and without it every line
  // in the app is nameless.
  try {
    const eco = await fetch(new URL('demo/openings.json', document.baseURI));
    if (eco.ok) seedFile(DATA_OPENINGS, await eco.text(), Date.now());
  } catch {
    // Names are a nicety; the boards still work without them.
  }

  try {
    await loadDemoDatabases({
      [PUZZLES_DB]: 'demo/puzzles.sqlite',
      [REFGAMES_DB]: 'demo/refgames.sqlite',
    });
  } catch (error) {
    console.warn('demo: puzzles and reference games unavailable —', error);
  }
  const app = buildApp();
  const real = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return real(input as RequestInfo, init);
    }
    return app.fetch(new Request(url.toString(), request));
  };
}
