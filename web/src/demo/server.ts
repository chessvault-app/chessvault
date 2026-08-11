import { Hono } from 'hono';
import { installBuffer } from './nodeShim/buffer.ts';
import { seedFile } from './nodeShim/fs.ts';
import { loadDemoDatabases } from './nodeShim/sqlite.ts';
import { mountVault } from '../../../server/mountVault.ts';
import { DATA_BOOKS, DATA_OPENINGS, REPO_ROOT } from '../../../server/paths.ts';
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
/** The curated opening book, at the path books.ts resolves for a book named 'demo'. */
const BOOK_DB = `${DATA_BOOKS}/demo.sqlite`;

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
  // The same vault routes the real server mounts, over the in-memory
  // filesystem and the curated databases. One list, in server/mountVault.ts,
  // so a route added to the app cannot quietly miss the demo.
  mountVault(app, {
    studies: `${VAULT}/studies`,
    notes: `${VAULT}/notes`,
    games: `${VAULT}/games`,
    puzzlesDb: PUZZLES_DB,
    puzzlesState: `${VAULT}/puzzles`,
    refgamesDb: REFGAMES_DB,
  });

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
   * The opening explorer, served from the curated book.
   *
   * Calling Lichess from the page was the plan and it does not work:
   * measured, explorer.lichess.org answers 401 without a token, and a token
   * cannot be shipped in a bundle every visitor can read. So the demo
   * answers the question locally instead — which is what the app's own
   * local-first explorer does anyway, and needs no network at all.
   *
   * Delegated to the real /api/books route rather than reimplemented: it
   * already returns moves with w/d/b/total and its hash-collision guard,
   * and its shape is what the client expects.
   */
  app.get('/api/explorer/:db', async (c) => {
    const fen = c.req.query('fen') ?? '';
    const answer = await app.request(
      `/api/books/demo?fen=${encodeURIComponent(fen)}`,
    );
    if (!answer.ok) {
      // Past the book's depth is not an error — it is the position the
      // repertoire trainer calls "out of book", and it expects no moves.
      return c.json({ opening: null, moves: [], topGames: [] });
    }
    const book = (await answer.json()) as { moves?: unknown[]; topGames?: unknown[] };
    return c.json({ opening: null, moves: book.moves ?? [], topGames: book.topGames ?? [] });
  });

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
    // The opening PICKER is a different file again: openings.ts reads the
    // vendored ECO tsvs directly, so the searchable list of 3,800 openings
    // needs them present, not just the position lookup.
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map(async (letter) => {
        const res = await fetch(new URL(`demo/eco/${letter}.tsv`, document.baseURI));
        if (res.ok) {
          seedFile(`${REPO_ROOT}/scripts/vendor/chess-openings/${letter}.tsv`, await res.text(), Date.now());
        }
      }),
    );
  } catch {
    // Names are a nicety; the boards still work without them.
  }

  try {
    await loadDemoDatabases({
      [PUZZLES_DB]: 'demo/puzzles.sqlite',
      [REFGAMES_DB]: 'demo/refgames.sqlite',
      [BOOK_DB]: 'demo/book.sqlite',
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
