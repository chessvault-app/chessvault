/**
 * The phone's page turn, measured on the built demo.
 *
 *   npm run build:demo && npm run check:page-turn
 *
 * A push and a pop on a phone slide (docs/design-principles, Motion). The
 * route commits inside a React Transition and each kept route slot
 * animates its own <ViewTransition>, and nothing else in the toolchain can
 * tell whether that still happens: typecheck, lint, the tests and the
 * pixel grid at rest all passed on a build where every pop had become a
 * cut. That build had the React Compiler taking a module variable for a
 * constant in lib/router's useRoute, so the direction was read after the
 * hash had moved (2026-09-14); before it, a hovered tooltip closing with
 * flushSync inside the pending transition made React skip it. Both are
 * the kind of thing only a browser sees.
 *
 * So this drives the demo at phone width, taps a study card and the back
 * chevron, and asks the browser's own API: did document.startViewTransition
 * run, and with which direction on the root. Twice: with taps, which is
 * what a phone does, and with mouse clicks, which hover the chevron first
 * and open its tooltip, the case that used to cut. It fails on any trip
 * with no transition or the wrong direction. Not a frame-rate test: the
 * dropped-frame numbers live in the scratch probes that measured the
 * design, and would be noise on a shared CI runner.
 *
 * Chromium only (the API is the same in WebKit and the design was
 * measured on both by hand); the demo answers /api in the page, so nothing
 * needs a server.
 */
import { chromium, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const DEMO = resolve(REPO_ROOT, process.env.DEMO_DIR ?? 'dist-demo');
const PORT = Number(process.env.PAGE_TURN_PORT ?? 8136);
const TRIPS = 3;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.sqlite': 'application/octet-stream',
  '.zst': 'application/octet-stream',
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

interface Turn {
  nav: string | undefined;
  finished: 'done' | 'skipped' | null;
}
declare global {
  interface Window {
    __turns: Turn[];
  }
}

/** One trip: the studies shelf, into a study, back. Returns what the browser saw. */
async function trip(page: Page, press: 'tap' | 'click'): Promise<Turn[]> {
  await page.goto(`http://localhost:${PORT}/#/studies`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const card = page.locator('main a[href^="#/studies/"], main [role="link"], main button').filter({ hasText: 'Minority' }).first();
  await (press === 'tap' ? card.tap() : card.click());
  await page.waitForTimeout(900);
  const back = page.locator('main button:has(svg.lucide-chevron-left)').filter({ visible: true }).first();
  await (press === 'tap' ? back.tap() : back.click());
  await page.waitForTimeout(900);
  return page.evaluate(() => window.__turns);
}

/** Whether the router still thinks a turn is in flight (data-nav on the root). */
function stillTurning(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.dataset.nav !== undefined);
}

async function main(): Promise<void> {
  if (!existsSync(join(DEMO, 'index.html'))) {
    console.error(`no demo build at ${DEMO}; run npm run build:demo first`);
    process.exit(2);
  }
  const server = await serve(DEMO, PORT);
  const browser = await chromium.launch();
  const problems: string[] = [];
  let turns = 0;
  for (const press of ['tap', 'click'] as const) {
    for (let run = 0; run < TRIPS; run++) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'en-US',
        serviceWorkers: 'block',
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'no-preference',
      });
      // Every transition the document starts, with the direction the router
      // stamped on the root at that moment and whether it finished or was
      // skipped (React skips one when something flushes synchronously
      // while it is pending; a skipped transition rejects `finished`).
      await ctx.addInitScript(() => {
        window.__turns = [];
        const original = document.startViewTransition.bind(document);
        document.startViewTransition = ((callback: () => void | Promise<void>) => {
          const record: Turn = { nav: document.documentElement.dataset.nav, finished: null };
          window.__turns.push(record);
          const t = original(callback);
          t.finished.then(
            () => {
              record.finished = 'done';
            },
            () => {
              record.finished = 'skipped';
            },
          );
          return t;
        }) as Document['startViewTransition'];
      });
      const page = await ctx.newPage();
      const seen = await trip(page, press);
      // The router must also know the turn has ENDED: routeSettled and
      // routeChanging hang on it, and so does the toast that waits for a
      // page to finish arriving. A root still carrying data-nav 900 ms
      // after the pop is a turn the router never heard finish.
      const turning = await stillTurning(page);
      await ctx.close();
      const label = `${press} trip ${run + 1}`;
      const [push, pop] = seen;
      if (!push) problems.push(`${label}: no transition ran for the push`);
      else if (push.nav !== 'push') problems.push(`${label}: push ran with direction "${push.nav ?? '-'}"`);
      else if (push.finished !== 'done') problems.push(`${label}: the push transition was ${push.finished ?? 'still pending'}`);
      if (!pop) problems.push(`${label}: no transition ran for the pop`);
      else if (pop.nav !== 'pop') problems.push(`${label}: pop ran with direction "${pop.nav ?? '-'}"`);
      else if (pop.finished !== 'done') problems.push(`${label}: the pop transition was ${pop.finished ?? 'still pending'}`);
      if (seen.length > 2) problems.push(`${label}: ${seen.length} transitions for two page changes`);
      if (turning) problems.push(`${label}: the router still reports a turn in flight 900 ms after the pop`);
      turns += seen.length;
    }
  }
  await browser.close();
  server.close();
  console.log(`page turn: ${TRIPS * 2} trips (taps and hovering clicks), ${turns} transitions seen, ${problems.length} problems`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
