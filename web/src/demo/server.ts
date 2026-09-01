import { Hono } from 'hono';
import { installBuffer } from './nodeShim/buffer.ts';
import { installSetImmediate } from './nodeShim/timers.ts';
import { seedBytes, seedFile } from './nodeShim/fs.ts';
import { registerDiagram } from '../puzzles/books/localDiagrams.ts';
import { haveVersions, runHistory, setHistoryRoot } from './nodeShim/history.ts';
import { vaultHistoryApi } from '../../../server/vaultHistory.ts';
import { loadDemoDatabases } from './nodeShim/sqlite.ts';
import { normaliseHomeLayout, type HomeLayout } from '@shared/homeLayout';
import { normaliseTraining, type Training } from '@shared/training';
import { mountVault } from '../../../server/mountVault.ts';
import { puzzleBooksApi } from '../../../server/puzzlebooks.ts';
import { storageApi } from '../../../server/storage.ts';
import { DATA_OPENINGS, REPO_ROOT } from '../../../server/paths.ts';
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
/** Built in the page rather than fetched — see the sqlite shim's write path. */
const MYGAMES_DB = '/demo/mygames.sqlite';

/**
 * The sample book: its bytes, and the two things a reader changes about it.
 *
 * Held here rather than in the in-memory filesystem because that shim
 * stores strings — it was built for the vault, which is PGN, markdown and
 * JSON — and a PDF put through it would not come back out the same file.
 * Everything here lasts exactly as long as the tab, like every other edit
 * the demo accepts.
 */
const DEMO_BOOK_PAGES = 8;
/**
 * The library book the sample PDF is filed under, and the one the seeded
 * puzzle book points at with `pdfBook`.
 *
 * `b` and SIXTEEN hex characters, because that is what a library book id
 * is (server/bookIds.ts). This was one character short for as long as the
 * library here was hand-written and nothing checked — and the moment the
 * real puzzle-shelf module was mounted, its `pdfBook` link went quietly
 * dead: isLibraryBookId said no, so the shelf reported a book with no PDF
 * and hid the way through to the reader.
 */
const BOOK_ID = 'b5a3e1c07f2d49b8c';
/** The puzzle book seeded from it — demo-seed/puzzlebooks/. */
const PUZZLE_BOOK = 'b7d4c1e93a06f52bd';
let demoBook: Uint8Array | null = null;
let demoBookPage: number | null = null;
const demoBookDiagrams = new Map<string, unknown>();

function buildApp(): Hono {
  // Before the routes run: they reference Buffer free, to size a document
  // in bytes rather than characters, and setImmediate free, to hand the
  // page back its turn between slices of the my-games index walk.
  installBuffer();
  installSetImmediate();

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
    // Nothing is fetched for this one: it is built in the page from the
    // seeded vault, the same way the real server builds it from disk.
    myGamesDb: MYGAMES_DB,
    repertoireState: `${VAULT}/repertoire`,
  });

  /**
   * The same four fields the real route answers with.
   *
   * `version` and `build` were missing, and the Version card in Settings
   * reads their absence as an answer still in flight: it holds the Built
   * row open with a skeleton, which in the demo pulsed for as long as
   * anybody looked at it, under a Server row reading "—". Both are known
   * at build time (`web/vite.demo.config.ts`), so the demo can say them
   * as plainly as a server does.
   */
  app.get('/api/health', (c) =>
    c.json({
      ok: true,
      crossOriginIsolated: false,
      version: __DEMO_VERSION__,
      build: __DEMO_BUILD__,
      demo: true,
    }),
  );
  /**
   * Settings is the one API written out here rather than mounted: the real
   * module reaches for node:child_process and node:crypto, which the demo
   * config does not shim.
   *
   * Home's arrangement is the exception it has to answer for real, or the
   * customise sheet would be a control that does nothing in the app most
   * people meet first. It lives in a variable for the life of the tab —
   * the same promise the demo banner already makes about every edit made
   * here — and is validated by the shared normaliser, so the demo cannot
   * accept a layout the real route would refuse.
   *
   * Training state is here for the same reason: the difficulty picker is
   * one of the first things a visitor touches, and a route that 404s would
   * have the trainer quietly disagree with the word the hub shows.
   */
  let home: HomeLayout | null = null;
  let training: Training = {};
  app.get('/api/settings', (c) =>
    c.json({
      profile: {},
      gate: false,
      totp: false,
      lichess: { configured: false, last4: null },
      // Shaped like the real answer even though the demo draws no
      // Tablebase card (it never probes): a page that reads a field the
      // route does not send is one refresh away from a crash, and the
      // cost of not lying about the shape is one line.
      tablebase: { url: null, fallback: 'https://tablebase.lichess.ovh/standard' },
      home,
      training,
      vaultPath: 'demo',
      version: 'demo',
      demo: true,
    }),
  );
  app.put('/api/settings/training', async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'invalid training' }, 400);
    // Merged, exactly like the real route: two pages patch this one object.
    training = { ...training, ...normaliseTraining(body) };
    return c.json({ ok: true });
  });
  app.put('/api/settings/home', async (c) => {
    const next = normaliseHomeLayout(await c.req.json().catch(() => null));
    if (!next) return c.json({ error: 'invalid home layout' }, 400);
    home = next;
    return c.json({ ok: true });
  });
  app.delete('/api/settings/home', (c) => {
    home = null;
    return c.json({ ok: true });
  });
  /**
   * The opening explorer, served from the demo's own reference games.
   *
   * Calling Lichess from the page was the plan and it does not work:
   * measured, explorer.lichess.org answers 401 without a token, and a token
   * cannot be shipped in a bundle every visitor can read. So the demo
   * answers the question locally instead — which is what the app's own
   * local-first explorer does anyway, and needs no network at all.
   *
   * Delegated to the real /api/refgames/explore route rather than
   * reimplemented: the demo's refgames.sqlite carries the same position
   * index every reference database does (built by build-demo-dbs.ts), and
   * the route already returns moves with w/d/b/total behind its
   * hash-collision guard.
   */
  app.get('/api/explorer/:db', async (c) => {
    const fen = c.req.query('fen') ?? '';
    const answer = await app.request(`/api/refgames/explore?fen=${encodeURIComponent(fen)}`);
    if (!answer.ok) {
      // Past the slice's depth is not an error — it is the position the
      // repertoire trainer calls "out of book", and it expects no moves.
      return c.json({ opening: null, moves: [], topGames: [] });
    }
    const body = (await answer.json()) as { moves?: unknown[]; topGames?: unknown[] };
    return c.json({ opening: null, moves: body.moves ?? [], topGames: body.topGames ?? [] });
  });

  /**
   * The puzzle shelf, answered by the real module over the seeded vault.
   *
   * This used to be one line returning an empty list, with a note saying
   * book puzzles come from commercial books and so cannot be in the demo.
   * The books cannot; a book CAN — the demo draws its own (see
   * scripts/build-demo-book.mjs), and the three positions it prints are
   * seeded as a puzzle book under demo-seed/puzzlebooks/. So the app's
   * most distinctive feature — a position transcribed from a page, solved
   * against the page it came from — is now something a visitor can do
   * rather than read about.
   *
   * Mounted rather than reimplemented, which needed `server/books.ts`'s
   * three id helpers to move into `server/bookIds.ts`: books.ts reaches
   * for node:crypto and node:stream to move an uploaded PDF around, and
   * this config shims neither.
   */
  app.route('/api', puzzleBooksApi(`${VAULT}/puzzlebooks`, `${VAULT}/books`));

  /**
   * What each part of the vault takes on disk.
   *
   * The one screen that explains what a vault IS — games, studies, notes
   * and the rebuildable caches, each with its own size — and it was a 404
   * here, so the card did not appear at all. The in-memory filesystem can
   * answer it as well as a real one can; `data` is pointed at a directory
   * that does not exist, which is the honest answer for the derived files
   * the demo has none of.
   */
  app.route('/api', storageApi(VAULT, `${VAULT}/.data`));

  /**
   * Earlier versions, and restoring a deleted document.
   *
   * The app's safety net, and the demo could not show it: it is read out
   * of `vault/.history.git` with five git commands, and a page has no git.
   * What a page does have is every write the visitor makes, because they
   * all go through the filesystem shim — so the shim keeps the versions
   * and answers those five questions from them (nodeShim/history.ts). The
   * questions are still asked by the real module; only the source moves.
   *
   * So the demo's history is honest: it is the visitor's own editing, not
   * a fabricated past. It starts empty and fills as they work, which is
   * also what the card says it is for.
   */
  setHistoryRoot(VAULT);
  app.route('/api', vaultHistoryApi(VAULT, { run: runHistory, available: haveVersions }));

  /**
   * The library, holding the one book the demo draws for itself.
   *
   * WRITTEN OUT HERE rather than mounted, which is the exception this file
   * otherwise exists to avoid — the same exception, and the same reason, as
   * settings above: `server/books.ts` reaches for `node:crypto` (ids),
   * `node:stream` and `node:stream/promises` (the upload and the Range
   * response), and the demo config shims none of the three. Mounting the
   * real module would mean shimming streams, which is a great deal of
   * machinery for a shelf that is read-only anyway.
   *
   * So this is a SECOND implementation, and it is kept to the shape of the
   * routes the reader actually calls. What it does not do — upload,
   * replace, rename, delete, folders, covers — falls through to the 404
   * below, and the shelf's buttons for those already handle a refusal.
   *
   * scripts/build-demo-book.mjs says why there is a book at all, and why it
   * is drawn rather than borrowed.
   */
  app.get('/api/books/bookmarks', (c) => c.json({ ids: [] }));
  app.post('/api/books/bookmarks/toggle', (c) => c.json({ ids: [] }));
  app.get('/api/books', (c) =>
    c.json({
      // No book if the file did not arrive: an empty shelf is what the real
      // route returns for an empty vault, and the page draws it properly.
      books: demoBook
        ? [
            {
              id: BOOK_ID,
              title: 'A sample book',
              name: 'sample.pdf',
              bytes: demoBook.byteLength,
              pages: DEMO_BOOK_PAGES,
              addedAt: new Date(Date.now() - 86_400_000).toISOString(),
              lastPage: demoBookPage,
              cover: false,
              collection: null,
              puzzleBook: null,
            },
          ]
        : [],
      folders: [],
    }),
  );
  /**
   * The file, with Range honoured — pdf.js asks for one page's bytes at a
   * time and will not accept a 200 where it asked for a 206. Served from
   * memory: 59 KB, fetched once at boot, which is cheaper than teaching the
   * shim about streams and exact about the byte ranges either way.
   */
  app.get('/api/books/:id/pdf', (c) => {
    if (c.req.param('id') !== BOOK_ID || !demoBook) return c.json({ error: 'unknown book' }, 404);
    const size = demoBook.byteLength;
    const headers = {
      'content-type': 'application/pdf',
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-cache',
      etag: `"${size}-demo"`,
    };
    const match = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '');
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start > end || start >= size) {
        return c.body(null, 416, { 'content-range': `bytes */${size}` });
      }
      return c.body(demoBook.slice(start, end + 1) as unknown as ArrayBuffer, 206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      });
    }
    return c.body(demoBook as unknown as ArrayBuffer, 200, {
      ...headers,
      'content-length': String(size),
    });
  });
  // Where the reader left off, and the diagrams it has already read off a
  // page — both for the life of the tab, the promise the banner makes about
  // every other edit here.
  app.put('/api/books/:id/reading', async (c) => {
    if (c.req.param('id') !== BOOK_ID) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { page?: unknown };
    const page = Number(body.page);
    if (!Number.isInteger(page) || page < 1 || page > DEMO_BOOK_PAGES) {
      return c.json({ error: 'bad page' }, 400);
    }
    demoBookPage = page;
    return c.json({ ok: true });
  });
  app.get('/api/books/:id/diagrams', (c) =>
    c.req.param('id') === BOOK_ID
      ? c.json({ pages: Object.fromEntries(demoBookDiagrams) })
      : c.json({ error: 'unknown book' }, 404),
  );
  app.put('/api/books/:id/diagrams/:page', async (c) => {
    if (c.req.param('id') !== BOOK_ID) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { diagrams?: unknown };
    demoBookDiagrams.set(c.req.param('page'), Array.isArray(body.diagrams) ? body.diagrams : []);
    return c.json({ ok: true });
  });

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
  // exact path the real code resolves. ~430 KB, and without it every line
  // in the app is nameless and no move is book.
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

  // The sample book. Small enough to hold whole, and not fatal when absent:
  // the shelf simply comes up empty, which is the state the real route
  // returns for a vault with no books.
  try {
    const pdf = await fetch(new URL('demo/books/sample.pdf', document.baseURI), {
      cache: 'no-cache',
    });
    if (pdf.ok) {
      demoBook = new Uint8Array(await pdf.arrayBuffer());
      // The puzzle shelf asks the FILESYSTEM whether the library book still
      // has its PDF, and answers "no PDF" by hiding the way through to the
      // reader. The demo's copy is these bytes, held here because the shim
      // stores strings — so the path it looks at gets a marker saying the
      // book is there, which is the truth about what the demo will serve.
      seedFile(`${VAULT}/books/${BOOK_ID}/book.pdf`, 'served from memory — see installDemoBackend', Date.now());
    }
    else console.warn(`demo: no sample book (${pdf.status})`);
  } catch (error) {
    console.warn('demo: sample book unavailable —', error);
  }

  /**
   * The pages the seeded puzzle book's positions were printed on.
   *
   * Evidence is the part of a book puzzle that says where it came from,
   * and the shelf serves it out of the book's own `diagrams/` folder —
   * so the images go into the in-memory vault at exactly that path, as
   * bytes (see the fs shim's `Entry.bytes`). Drawn by
   * scripts/build-demo-book.mjs from the same sheets it makes the PDF
   * from, so the crop a puzzle shows is the page it is actually on.
   * Not fatal: without them the source pane simply has nothing to show.
   */
  try {
    for (const page of ['page003.jpg', 'page005.jpg', 'page007.jpg']) {
      const res = await fetch(new URL(`demo/book-pages/${page}`, document.baseURI));
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      seedBytes(`${VAULT}/puzzlebooks/${PUZZLE_BOOK}/diagrams/${page}`, bytes, Date.now());
      // And again as an object URL, because the pane that shows a page uses
      // an <img src> — a resource load, which a patched fetch never sees.
      registerDiagram(PUZZLE_BOOK, page, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    }
  } catch (error) {
    console.warn('demo: book pages unavailable —', error);
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
