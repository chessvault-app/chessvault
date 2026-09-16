/**
 * A picture of every route's OUTLINE — what a page draws while its own
 * code is still on the wire.
 *
 *   npm run build:demo
 *   npm run shots:placeholders                      # .shots/placeholders
 *   OUT=.shots/before npm run shots:placeholders    # somewhere else
 *   ROUTES='#/settings,#/notes' narrows a run (Git Bash: MSYS_NO_PATHCONV=1,
 *   or the '#/' is rewritten as a path and the route never matches).
 *
 * WHY. `shots:grid` photographs SETTLED pages, so it proves a change
 * moved nothing — and it cannot see an outline at all, because on the
 * demo every chunk is local and arrives before the 200 ms the outline
 * waits for. The outline is therefore the one part of the app no
 * existing harness can look at, which is how it went years with a shape
 * that guessed. This holds each route's chunk back long enough for its
 * outline to be up, and takes the picture.
 *
 * NOT a pixel diff, and it should not become one. Two runs of this
 * differ only where the app does, and the useful comparison is against
 * the SETTLED page from `shots:grid` — does the board, the first card,
 * the first row land at the same y? That is a reading, not a subtraction:
 * the outline is grey where the page has words, so a diff of the two is
 * 100% different and says nothing.
 *
 * HOW THE WAIT IS HELD. Route chunks are named after their page
 * (`NotesView-<hash>.js`), and an outline is named `<Page>.skeleton-`,
 * so the page is easy to delay and the outline is easy not to. The
 * editor's own chunk is held too: the note editor is a lazy route inside
 * the Notes chunk and has its own outline, and that wait is the longest
 * download in the app.
 */
import { chromium, type BrowserContext } from 'playwright';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const DEMO = resolve(REPO_ROOT, 'dist-demo');
const OUT = resolve(REPO_ROOT, process.env.OUT ?? '.shots/placeholders');
const PORT = Number(process.env.SHOT_PORT ?? 8136);
/** How long a page's chunk is held: past PENDING_MS, and past the stay. */
const HOLD_MS = 6000;
/** `ROUTES=#/settings,#/notes` narrows a run while iterating. */
const ONLY = process.env.ROUTES?.split(',').map((r) => r.trim()).filter(Boolean);

/** Every route that carries an outline, and the two widths it is drawn at. */
const ROUTES = [
  '#/board',
  '#/games',
  `#/games/${encodeURIComponent('Kowal, D - Rasmussen, I')}`,
  '#/studies',
  `#/studies/${encodeURIComponent('Minority attack')}`,
  '#/notes',
  `#/notes/${encodeURIComponent('Thinking process')}`,
  '#/books',
  '#/puzzles',
  '#/endgames',
  '#/insights',
  '#/databases',
  '#/settings',
  '#/settings/licenses',
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

async function shoot(context: BrowserContext, hash: string, width: number): Promise<void> {
  const page = await context.newPage();
  // The demo's banner would sit over the top of every picture.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('chess-vault:demo-banner', 'dismissed');
    } catch {
      /* private mode; the banner stays and the shot is 33px taller */
    }
  });
  await page.goto(`http://localhost:${PORT}/${hash}`, { waitUntil: 'commit' });
  // Past PENDING_MS and the outline's own fetch, well inside the hold.
  await page.waitForTimeout(2500);
  const name = `${hash.replace(/[#/]/g, '-').replace(/^-+/, '') || 'home'}--${width}.png`;
  await page.screenshot({ path: join(OUT, name) });
  await page.close();
}

const server = await serve();
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });
const routes = ONLY ?? ROUTES;
for (const { width, height } of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'en-US',
    // The precache worker would serve the previous build's chunks, and
    // the hold below would then match nothing.
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
  });
  await context.route('**/assets/*.js', async (route) => {
    if (isPageChunk(route.request().url())) await new Promise((r) => setTimeout(r, HOLD_MS));
    await route.continue();
  });
  for (const hash of routes) await shoot(context, hash, width);
  await context.close();
}
await browser.close();
server.close();
console.log(`placeholders: ${routes.length * WIDTHS.length} pictures in ${OUT}`);
