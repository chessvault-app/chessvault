/**
 * The three states of every route, held still long enough to be read:
 *
 *   O — the OUTLINE, what the route draws while its own chunk is on the
 *       wire (lib/lazyRoute, `outline`);
 *   D — the DATA wait, the page mounted with its answers still out;
 *   L — the LOADED page.
 *
 * `shots:placeholders` photographs them and `check:skeletons` holds them
 * to each other; both read this file so that the two cannot come to mean
 * different things by "the data wait". scripts/shot-placeholders.ts says
 * why it takes all three.
 *
 * WARM, not cold. Each route is visited and settled once before it is
 * read, because that first visit is what writes the page's reservations
 * (the shelf's card count, the themes histogram, a book's page shape). A
 * cold pass reads the floors and says nothing about whether a remembered
 * shape is drawn.
 *
 * HOW THE WAITS ARE HELD. Route chunks are named after their page
 * (`NotesView-<hash>.js`) and an outline is named `<Page>.skeleton-`, so
 * the page is easy to delay and the outline is easy not to. The hold is a
 * GATE and not a sleep: a request that arrived while it was on has to be
 * let go when it comes off, or the chunk is still on the wire for the
 * other two states and all three are the outline. The API is held by a
 * setter trap on `window.fetch`, because the demo answers `/api/` from
 * the page and a `page.route` never sees it: every path but `/api/auth`,
 * which is the shell's own gate (auth/PasswordGate). Held, nothing
 * renders at all and every state is the blank ground.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { REPO_ROOT } from '../../server/paths.ts';

const DEMO = resolve(REPO_ROOT, 'dist-demo');
/** How long a held answer takes, which must outlast the reading of it. */
const API_HOLD_MS = 8000;

/** Every route that carries an outline, and the two widths it is drawn at. */
export const ROUTES = [
  '#/home',
  '#/board',
  '#/games',
  `#/games/${encodeURIComponent('Kowal, D - Rasmussen, I')}`,
  '#/studies',
  `#/studies/${encodeURIComponent('Minority attack')}`,
  '#/notes',
  `#/notes/${encodeURIComponent('Thinking process')}`,
  '#/books',
  // The demo's one book, by its id (web/src/demo/server.ts, BOOK_ID). It
  // was addressed by its title, which the reader does not resolve, so
  // every picture of this route was the "not on the shelf" page.
  '#/books/b5a3e1c07f2d49b8c',
  '#/puzzles',
  '#/puzzles/hub',
  '#/puzzles/themes',
  '#/puzzles/dashboard',
  '#/puzzles/books',
  '#/endgames',
  // A class in the address is a DRILL, which is a board page and not the
  // list: its own outline, which nothing visited while the section was
  // represented by its picker alone. The demo reaches no tablebase, so
  // this route's L is the trainer's error box; its O against D is the
  // half worth reading here (check:skeletons, KNOWN).
  '#/endgames/pawn',
  '#/insights',
  '#/databases',
  '#/settings',
  '#/settings/licenses',
  '#/workspace',
  '#/editor',
  '#/repertoire',
  '#/openingmap',
];
export const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

export interface Landmark {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Whether the landmark is the ROUTE's, inside `#main`, rather than the
   * shell's: the skip link, the toast layers, the sidebar, the phone's
   * tab bar. Every route carries those and they are identical in all
   * three states, so counting them as shared says a comparison happened
   * when none did. Absent in a report written before this field, which
   * reads as the route's own and leaves such a report as it was.
   */
  own?: boolean;
}
export interface Shot {
  rows: Landmark[];
  docH: number;
  /** Placeholder bars on screen, which is how a reader tells a wait from a settled page. */
  bars: number;
}
export type Report = Record<string, { O: Shot; D: Shot; L: Shot }>;

/** The name a route and a width are filed under: `settings-licenses--390`. */
export const shotName = (hash: string, width: number): string =>
  `${hash.replace(/[#/]/g, '-').replace(/^-+/, '') || 'home'}--${width}`;

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

function serve(port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let file = join(DEMO, decodeURIComponent(url.pathname));
    if (!existsSync(file) || url.pathname === '/') file = join(DEMO, 'index.html');
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        // The demo is cross-origin isolated in production; keep it so the
        // page takes the same paths it does for a reader.
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((done) => server.listen(port, () => done(server)));
}

/** A page's own chunk, which is held; never its outline, which is not. */
const isPageChunk = (url: string): boolean =>
  /\/[A-Za-z0-9]+(View|Page)-[A-Za-z0-9_-]{6,}\.js$/.test(url) ||
  /\/editor-[A-Za-z0-9_-]{6,}\.js$/.test(url);

/**
 * The fetch trap. The demo ASSIGNS window.fetch, so the setter is what has
 * to be caught; the getter hands back a wrapper that answers as the demo
 * would and then sleeps.
 *
 * Three things were wrong with it for as long as the harness had existed,
 * and between them no D picture it ever took was a data wait (the third
 * is where the trap is installed, below):
 *
 *  - Anything that is not `/api/` goes to the NATIVE fetch, never to the
 *    demo's. The demo keeps `window.fetch.bind(window)` as its own way
 *    out for those, and with this trap in place that is the wrapper
 *    again: wrapper, demo, wrapper, demo. One load of the licences page
 *    made 3,514 calls that way.
 *  - The hold is `??=`. It is switched on by a page init script, and
 *    Playwright does not define which of a context's and a page's init
 *    scripts runs first; assigned outright, this ran second and put the
 *    hold back to nothing.
 */
const API_TRAP = (): void => {
  const w = window as unknown as { __slowApi?: number; fetch: typeof fetch };
  w.__slowApi ??= 0;
  const native = window.fetch.bind(window);
  let demo: typeof fetch = native;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    const api = url.includes('/api/');
    const answer = await (api ? demo : native)(input, init);
    const ms = w.__slowApi ?? 0;
    // The licences page fetches a built JSON rather than an /api/ path.
    if (ms > 0 && !url.includes('/api/auth/') && (api || url.includes('/licenses/')))
      await new Promise((r) => setTimeout(r, ms));
    return answer;
  };
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    get: () => wrapped,
    set: (fn: typeof fetch) => {
      demo = fn;
    },
  });
};

/** Every landmark on screen, keyed the way the audit reads them: the
    tag, its role, its slot and its name, with an ordinal for repeats. */
const LANDMARKS = (): Shot => {
  const seen = new Map<string, number>();
  const rows: Landmark[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(
    'h1,h2,h3,h4,button,a,th,section,ul,li,[role],[data-slot]',
  )) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const name = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 24);
    const own = el.closest('#main') !== null;
    const base = [el.tagName.toLowerCase(), el.getAttribute('role') ?? '', el.dataset.slot ?? '', name].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({
      key: `${base}#${n}`,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      own,
    });
  }
  const bars = [...document.querySelectorAll('[data-slot="skeleton"]')].filter(
    (el) => el.getBoundingClientRect().width > 0,
  ).length;
  return { rows, docH: document.documentElement.scrollHeight, bars };
};

async function read(
  browser: Browser,
  port: number,
  hash: string,
  size: { width: number; height: number },
  stamp: number,
  picture?: (state: 'O' | 'D' | 'L', page: Page) => Promise<void>,
): Promise<{ O: Shot; D: Shot; L: Shot }> {
  const context = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    locale: 'en-US',
    // The precache worker would serve the previous build's chunks, and
    // the hold below would then match nothing.
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    isMobile: size.width < 700,
    hasTouch: size.width < 700,
  });
  try {
    let holdChunk = false;
    let openGate = (): void => {};
    let gate = new Promise<void>((r) => {
      openGate = r;
    });
    await context.route('**/assets/*.js', async (route) => {
      if (holdChunk && isPageChunk(route.request().url())) await gate;
      await route.continue();
    });
    // The demo's banner would sit over the top of every picture. It is
    // sessionStorage, not localStorage, which is what this harness had
    // wrong: every picture it ever took was 33px short at the top.
    await context.addInitScript(() => {
      try {
        sessionStorage.setItem('chess-vault:demo-banner', 'dismissed');
      } catch {
        /* private mode; the banner stays and the shot is 33px taller */
      }
    });
    // As text, with `__name` defined beside it. tsx compiles this file with
    // esbuild's keepNames, which rewrites `const wrapped = async () => …`
    // inside the trap to `__name(async () => …, "wrapped")`, a helper that
    // exists in this process and not in the page. Handed over as a
    // function, the trap threw a ReferenceError on its first line in every
    // page it was ever installed in, silently, and held nothing.
    await context.addInitScript({ content: `{ const __name = (f) => f; (${API_TRAP.toString()})(); }` });
    const page: Page = await context.newPage();
    const url = (n: number): string => `http://localhost:${port}/index.html?r=${n}${hash}`;
    // A warm device: settle the route once, which is what writes its
    // reservations, and only then read it.
    await page.goto(url(stamp), { waitUntil: 'commit' });
    await page.waitForTimeout(4000);
    // Applies from the NEXT navigation on, which is the held one.
    await page.addInitScript((ms) => {
      (window as unknown as { __slowApi: number }).__slowApi = ms;
    }, API_HOLD_MS);
    holdChunk = true;
    gate = new Promise<void>((r) => {
      openGate = r;
    });
    await page.goto(url(stamp + 1), { waitUntil: 'commit' });
    // Past PENDING_MS and the outline's own fetch, well inside the hold.
    await page.waitForTimeout(2600);
    await picture?.('O', page);
    const O = await page.evaluate(LANDMARKS);

    holdChunk = false;
    openGate();
    // The chunk lands and the page mounts into its own wait. The API hold
    // runs from each request, so this has to be read well inside it.
    await page.waitForTimeout(2400);
    await picture?.('D', page);
    const D = await page.evaluate(LANDMARKS);

    await page.evaluate(() => {
      (window as unknown as { __slowApi: number }).__slowApi = 0;
    });
    // Settled = no VISIBLE skeleton left. Counted visible only: a phone's
    // home keeps three hidden ones in a max-md:hidden card for ever. The
    // holds already out run their course first, hence the long timeout.
    await page
      .waitForFunction(
        () =>
          ![...document.querySelectorAll('[data-slot="skeleton"]')].some(
            (el) => el.getBoundingClientRect().width > 0,
          ),
        null,
        { timeout: API_HOLD_MS * 2 + 4000 },
      )
      .catch(() => {});
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(800);
    await picture?.('L', page);
    const L = await page.evaluate(LANDMARKS);
    return { O, D, L };
  } finally {
    await context.close();
  }
}

/**
 * Read every route at every width. `picture` is called at each state for
 * whoever wants a PNG of it; `lanes` is how many routes are read at once
 * (each in its own context, so nothing is shared but the CPU).
 */
export async function readPlaceholders(opts: {
  port: number;
  routes?: readonly string[];
  lanes?: number;
  picture?: (name: string, state: 'O' | 'D' | 'L', page: Page) => Promise<void>;
  log?: (line: string) => void;
}): Promise<Report> {
  if (!existsSync(join(DEMO, 'index.html'))) throw new Error('dist-demo is missing: run `npm run build:demo` first');
  const server = await serve(opts.port);
  const browser = await chromium.launch();
  const report: Report = {};
  const jobs = WIDTHS.flatMap((size) => (opts.routes ?? ROUTES).map((hash) => ({ hash, size })));
  let next = 0;
  const lane = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      const name = shotName(job.hash, job.size.width);
      try {
        const shot = await read(browser, opts.port, job.hash, job.size, i * 2 + 1, (state, page) =>
          opts.picture ? opts.picture(name, state, page) : Promise.resolve(),
        );
        report[name] = shot;
        opts.log?.(`${name}: O ${shot.O.rows.length}  D ${shot.D.rows.length}  L ${shot.L.rows.length}`);
      } catch (e) {
        opts.log?.(`${name}: FAILED ${String(e).slice(0, 160)}`);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: opts.lanes ?? 1 }, lane));
  } finally {
    await browser.close();
    server.close();
  }
  return report;
}
