/**
 * A screenshot grid over the demo, and a pixel diff between two runs.
 *
 *   npm run build:demo
 *   OUT=.shots/base npm run shots:grid                    # record a baseline
 *   ...edit, npm run build:demo...
 *   OUT=.shots/after BASE_DIR=.shots/base npm run shots:grid   # diff against it
 *   ROUTES='#/games,#/studies' narrows a run (Git Bash: MSYS_NO_PATHCONV=1,
 *   or the '#/' is rewritten as a path and the route never matches).
 *
 * WHY. `check:contrast` measures colour and takes no pictures; `shots`
 * recaptures the manual's images in Electron. Neither answers the
 * question a UI refactor has to answer: did anything move? A
 * behaviour-neutral commit is proved by an all-zero diff over every route
 * at every width, and a visual commit by a diff confined to the rectangle
 * it meant to change. This is that proof, on the demo because it is the
 * one vault that is the same for everyone.
 *
 * WHAT IT WALKS. Every route `check:contrast` walks plus the pages the
 * phone reaches through More and two leaf pages that claim the bottom
 * bar. Desktop and phone widths, light and dark, and three phone-only
 * states: 320px (where six tab labels used to overprint), scrolled 240px
 * inside the page's scroller (the header's compact state), and with the
 * keyboard flag set on the root (the bar must be gone). Reduced motion is
 * emulated so nothing is caught mid-transition.
 *
 * WHAT IS NOISE. The board's engine output and the puzzle dashboard's
 * pick settle rather than render, so those shots differ between two runs
 * of one build; capture-screenshots.mjs measured the same. Diff a pair of
 * runs of the SAME build first if a number there looks like a change.
 * Measured on 0.8.5: 27 of 98 pictures differed between two runs. The
 * puzzle trainer differed by 5 to 8% (a different puzzle each load) and
 * the dashboard by 0.01%; the other 22 were under 0.01% and inside a box
 * a few pixels wide (thumbnail edges). So a change that matters shows as
 * a box the size of the thing changed, anywhere but the trainer.
 */
import { chromium, type BrowserContext } from 'playwright';
import sharp from 'sharp';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const DEMO = resolve(REPO_ROOT, 'dist-demo');
const PORT = Number(process.env.GRID_PORT ?? 8135);
const OUT = resolve(REPO_ROOT, process.env.OUT ?? '.shots/current');
const BASE_DIR = process.env.BASE_DIR ? resolve(REPO_ROOT, process.env.BASE_DIR) : null;
/** `ROUTES=#/games,#/studies` narrows a run while iterating. */
const ONLY = process.env.ROUTES?.split(',').map((r) => r.trim()).filter(Boolean);

const ROUTES = [
  '#/home',
  '#/games',
  '#/puzzles',
  '#/puzzles/dashboard',
  '#/puzzles/hub',
  '#/puzzles/books',
  '#/puzzles/themes',
  '#/studies',
  `#/studies/${encodeURIComponent('Minority attack')}`,
  '#/notes',
  `#/notes/${encodeURIComponent('Thinking process')}`,
  '#/databases',
  '#/settings',
  '#/settings/licenses',
  '#/openingmap',
  '#/books',
  '#/board',
  '#/more',
];

const THEMES = [
  { name: 'light', prefs: { preference: 'light' } },
  { name: 'dark', prefs: { preference: 'dark' } },
];

/**
 * One row per picture kind. `routes` narrows a state to the pages where
 * it means something: the keyboard flag on a page with no field proves
 * nothing, and the 320px case exists for the bar's labels.
 */
const STATES: {
  name: string;
  width: number;
  height: number;
  routes?: string[];
  prepare?: string;
}[] = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'phone', width: 375, height: 812 },
  { name: 'phone-320', width: 320, height: 568, routes: ['#/games', '#/studies', '#/more'] },
  {
    name: 'phone-scrolled',
    width: 375,
    height: 812,
    routes: [
      '#/studies',
      '#/notes',
      '#/books',
      '#/puzzles/books',
      '#/puzzles/themes',
      '#/settings',
      '#/settings/licenses',
      '#/more',
    ],
    // The page's own scroller, marked by PageShell; fall back to the
    // first vertical scroller under main for pages that manage their own.
    prepare: `(() => {
      const el = document.querySelector('[data-page-scroll]')
        ?? [...document.querySelectorAll('main *')].find((n) => {
          const s = getComputedStyle(n); return (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight;
        });
      if (el) el.scrollTop = 240;
    })()`,
  },
  {
    name: 'phone-keyboard',
    width: 375,
    height: 812,
    routes: ['#/studies', '#/notes'],
    prepare: `document.documentElement.classList.add('kb-open')`,
  },
];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.wasm': 'application/wasm',
  '.sqlite': 'application/octet-stream',
  '.zst': 'application/octet-stream',
  '.pdf': 'application/pdf',
  '.tsv': 'text/tab-separated-values',
};

function serve(root: string, port: number): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      let path = join(root, decodeURIComponent((req.url ?? '/').split('?')[0]!));
      if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

const slug = (s: string): string => s.replace(/^#\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'root';

/**
 * Pixels that differ between two PNGs of the same size, as a share of the
 * whole, plus the box they fall in. Any channel off by any amount counts:
 * the renderer is deterministic for everything but the settling shots,
 * and a tolerance would hide a one-pixel shift, which is the thing this
 * exists to catch. Writes `<name>.diff.png` with the changes in red over
 * the faded baseline when there are any.
 */
async function diff(a: string, b: string, out: string): Promise<{ pct: number; px: number; box: string } | null> {
  const [ia, ib] = await Promise.all([
    sharp(a).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) {
    return { pct: 100, px: -1, box: `size ${ia.info.width}x${ia.info.height} vs ${ib.info.width}x${ib.info.height}` };
  }
  const { width, height } = ia.info;
  const overlay = Buffer.alloc(ia.data.length);
  let changed = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0, p = 0; i < ia.data.length; i += 4, p++) {
    const same =
      ia.data[i] === ib.data[i] &&
      ia.data[i + 1] === ib.data[i + 1] &&
      ia.data[i + 2] === ib.data[i + 2];
    if (same) {
      // Faded baseline: 25% of the way to white.
      overlay[i] = (ia.data[i]! + 3 * 255) >> 2;
      overlay[i + 1] = (ia.data[i + 1]! + 3 * 255) >> 2;
      overlay[i + 2] = (ia.data[i + 2]! + 3 * 255) >> 2;
      overlay[i + 3] = 255;
    } else {
      changed++;
      const x = p % width, y = (p / width) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      overlay[i] = 220; overlay[i + 1] = 30; overlay[i + 2] = 30; overlay[i + 3] = 255;
    }
  }
  if (!changed) return null;
  await sharp(overlay, { raw: { width, height, channels: 4 } }).png().toFile(out);
  return { pct: (100 * changed) / (width * height), px: changed, box: `x ${x0}-${x1}, y ${y0}-${y1}` };
}

if (!existsSync(join(DEMO, 'index.html'))) {
  console.error(`no demo build at ${DEMO}; run \`npm run build:demo\` first`);
  process.exit(2);
}
await mkdir(OUT, { recursive: true });
const server = await serve(DEMO, PORT);
const browser = await chromium.launch();
const results: { name: string; pct: number; px: number; box: string }[] = [];
let shots = 0;
try {
  for (const theme of THEMES) {
    for (const state of STATES) {
      const context: BrowserContext = await browser.newContext({
        viewport: { width: state.width, height: state.height },
        deviceScaleFactor: 1,
        locale: 'en-US',
        reducedMotion: 'reduce',
        // The demo registers a precaching worker; a fresh context has none,
        // and blocking keeps a re-run from ever serving the previous build.
        serviceWorkers: 'block',
        hasTouch: state.width < 768,
        isMobile: state.width < 768,
      });
      await context.addInitScript((prefs) => {
        localStorage.setItem('chess-vault:theme', JSON.stringify({ state: prefs, version: 0 }));
      }, theme.prefs);
      const page = await context.newPage();
      for (const route of state.routes ?? ROUTES) {
        if (ONLY && !ONLY.includes(route)) continue;
        await page.goto(`http://localhost:${PORT}/${route}`, { waitUntil: 'networkidle' });
        // Lazy chunks and their first fetch; the same settle check:contrast uses.
        await page.waitForTimeout(1200);
        if (state.prepare) {
          await page.evaluate(state.prepare);
          await page.waitForTimeout(200);
        }
        const name = `${slug(route)}--${state.name}--${theme.name}.png`;
        const file = join(OUT, name);
        await page.screenshot({ path: file });
        shots++;
        if (BASE_DIR) {
          const base = join(BASE_DIR, name);
          if (!existsSync(base)) {
            results.push({ name, pct: 100, px: -1, box: 'no baseline' });
            continue;
          }
          const d = await diff(base, file, join(OUT, name.replace(/\.png$/, '.diff.png')));
          if (d) results.push({ name, ...d });
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`shots: ${shots} pictures in ${OUT}`);
if (BASE_DIR) {
  if (!results.length) {
    console.log(`diff: every picture identical to ${BASE_DIR}`);
  } else {
    results.sort((a, b) => b.pct - a.pct);
    for (const r of results) console.log(`${r.pct.toFixed(2).padStart(6)}%  ${String(r.px).padStart(7)} px  ${r.name}  (${r.box})`);
    console.log(`diff: ${results.length} of ${shots} pictures differ from ${BASE_DIR}`);
  }
}
