/**
 * Three pictures of every route, in the order a reader meets them:
 *
 *   O — the OUTLINE, what the route draws while its own chunk is on the
 *       wire (lib/lazyRoute, `outline`);
 *   D — the DATA wait, the page mounted with its answers still out;
 *   L — the LOADED page.
 *
 * Plus the landmark rects of each, written to `report.json`, so "the
 * first card moved 56px" is a number rather than a squint.
 *
 *   npm run build:demo
 *   npm run shots:placeholders                      # .shots/placeholders
 *   OUT=.shots/before npm run shots:placeholders    # somewhere else
 *   ROUTES='#/settings,#/notes' narrows a run (Git Bash: MSYS_NO_PATHCONV=1,
 *   or the '#/' is rewritten as a path and the route never matches).
 *
 * WHY. `shots:grid` photographs SETTLED pages, so it proves a change
 * moved nothing — and it cannot see either wait, because on the demo
 * every chunk is local and every answer is in the page. Those two are
 * the surfaces no other harness can look at, which is how the app went
 * so long with one shape guessed for fifteen routes and with five that
 * drew nothing at all.
 *
 * It took all three to be useful. Holding the chunk alone shows the
 * outline and says nothing about whether the page's own wait agrees with
 * it; and "one skeleton per page" is exactly the claim that O and D are
 * the same picture. Read the run that way: O against D is the app's
 * rule, and D against L is whether the placeholder is the page's shape.
 *
 * NOT a pixel diff, and it should not become one. Two runs of this differ
 * only where the app does, and the useful comparison is a reading: does
 * the board, the first card, the first row land at the same y? The
 * outline is grey where the page has words, so a subtraction of the two
 * is 100% different and says nothing.
 *
 * WARM, not cold. Each route is visited and settled once before it is
 * photographed, because that first visit is what writes the page's
 * reservations — the shelf's card count, the themes histogram, a book's
 * page shape. A cold pass photographs the floors and says nothing about
 * whether a remembered shape is drawn.
 *
 * HOW THE WAITS ARE HELD. Route chunks are named after their page
 * (`NotesView-<hash>.js`) and an outline is named `<Page>.skeleton-`, so
 * the page is easy to delay and the outline is easy not to. The hold is a
 * GATE and not a sleep: a request that arrived while it was on has to be
 * let go when it comes off, or the chunk is still on the wire for the
 * other two pictures and all three show the outline. The API is held by
 * a setter trap on `window.fetch`, because the demo answers `/api/` from
 * the page and a `page.route` never sees it — every path but `/api/auth`,
 * which is the shell's own gate (auth/PasswordGate): held, nothing
 * renders at all and every picture is the blank ground.
 */
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const DEMO = resolve(REPO_ROOT, 'dist-demo');
const OUT = resolve(REPO_ROOT, process.env.OUT ?? '.shots/placeholders');
const PORT = Number(process.env.SHOT_PORT ?? 8136);
/** How long a held answer takes, which must outlast the picture of it. */
const API_HOLD_MS = 8000;
/** `ROUTES=#/settings,#/notes` narrows a run while iterating. */
const ONLY = process.env.ROUTES?.split(',').map((r) => r.trim()).filter(Boolean);

/** Every route that carries an outline, and the two widths it is drawn at. */
const ROUTES = [
  '#/home',
  '#/board',
  '#/games',
  `#/games/${encodeURIComponent('Kowal, D - Rasmussen, I')}`,
  '#/studies',
  `#/studies/${encodeURIComponent('Minority attack')}`,
  '#/notes',
  `#/notes/${encodeURIComponent('Thinking process')}`,
  '#/books',
  `#/books/${encodeURIComponent('A sample book')}`,
  '#/puzzles',
  '#/puzzles/hub',
  '#/puzzles/themes',
  '#/puzzles/dashboard',
  '#/puzzles/books',
  '#/endgames',
  '#/insights',
  '#/databases',
  '#/settings',
  '#/settings/licenses',
  '#/workspace',
  '#/editor',
  '#/repertoire',
  '#/openingmap',
];
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];

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

function serve(): Promise<Server> {
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
  return new Promise((done) => server.listen(PORT, () => done(server)));
}

/** A page's own chunk, which is held; never its outline, which is not. */
const isPageChunk = (url: string): boolean =>
  /\/[A-Za-z0-9]+(View|Page)-[A-Za-z0-9_-]{6,}\.js$/.test(url) ||
  /\/editor-[A-Za-z0-9_-]{6,}\.js$/.test(url);

/** The fetch trap. The demo ASSIGNS window.fetch, so the setter is what
    has to be caught; the getter hands back a wrapper that answers as the
    demo would and then sleeps. */
const API_TRAP = (): void => {
  const w = window as unknown as { __slowApi: number; fetch: typeof fetch };
  w.__slowApi = 0;
  let real = window.fetch;
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    const answer = await real(input, init);
    const ms = w.__slowApi;
    // The licences page fetches a built JSON rather than an /api/ path.
    if (ms > 0 && !url.includes('/api/auth/') && (url.includes('/api/') || url.includes('/licenses/')))
      await new Promise((r) => setTimeout(r, ms));
    return answer;
  };
  Object.defineProperty(window, 'fetch', {
    configurable: true,
    get: () => wrapped,
    set: (fn: typeof fetch) => {
      real = fn;
    },
  });
};

interface Landmark {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Shot {
  rows: Landmark[];
  docH: number;
}

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
    const base = [el.tagName.toLowerCase(), el.getAttribute('role') ?? '', el.dataset.slot ?? '', name].join('|');
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    rows.push({
      key: `${base}#${n}`,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }
  return { rows, docH: document.documentElement.scrollHeight };
};

const report: Record<string, { O: Shot; D: Shot; L: Shot }> = {};

async function shoot(
  browser: Browser,
  hash: string,
  size: { width: number; height: number },
  stamp: number,
): Promise<void> {
  const name = `${hash.replace(/[#/]/g, '-').replace(/^-+/, '') || 'home'}--${size.width}`;
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
  await context.addInitScript(API_TRAP);
  const page: Page = await context.newPage();
  const url = (n: number): string => `http://localhost:${PORT}/index.html?r=${n}${hash}`;
  try {
    // A warm device: settle the route once, which is what writes its
    // reservations, and only then photograph it.
    await page.goto(url(stamp), { waitUntil: 'commit' });
    await page.waitForTimeout(4000);
    // Applies from the NEXT navigation on, which is the held one.
    await page.addInitScript(() => {
      (window as unknown as { __slowApi: number }).__slowApi = API_HOLD_MS;
    });
    holdChunk = true;
    gate = new Promise<void>((r) => {
      openGate = r;
    });
    await page.goto(url(stamp + 1), { waitUntil: 'commit' });
    // Past PENDING_MS and the outline's own fetch, well inside the hold.
    await page.waitForTimeout(2600);
    await page.screenshot({ path: join(OUT, `${name}--O.png`) });
    const O = await page.evaluate(LANDMARKS);

    holdChunk = false;
    openGate();
    await page.waitForTimeout(3200);
    await page.screenshot({ path: join(OUT, `${name}--D.png`) });
    const D = await page.evaluate(LANDMARKS);

    await page.evaluate(() => {
      (window as unknown as { __slowApi: number }).__slowApi = 0;
    });
    // Settled = no VISIBLE skeleton left. Counted visible only: a phone's
    // home keeps three hidden ones in a max-md:hidden card for ever.
    await page
      .waitForFunction(
        () =>
          ![...document.querySelectorAll('[data-slot="skeleton"]')].some(
            (el) => el.getBoundingClientRect().width > 0,
          ),
        null,
        { timeout: 12_000 },
      )
      .catch(() => {});
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `${name}--L.png`) });
    const L = await page.evaluate(LANDMARKS);

    report[name] = { O, D, L };
    console.log(`${name}: O ${O.rows.length}  D ${D.rows.length}  L ${L.rows.length}`);
  } catch (e) {
    console.log(`${name}: FAILED ${String(e).slice(0, 160)}`);
  }
  await context.close();
}

const server = await serve();
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const routes = ONLY ?? ROUTES;
let stamp = 0;
for (const size of WIDTHS) {
  for (const hash of routes) {
    await shoot(browser, hash, size, (stamp += 2));
  }
}
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
await browser.close();
server.close();
console.log(`placeholders: ${routes.length * WIDTHS.length * 3} pictures in ${OUT}`);
