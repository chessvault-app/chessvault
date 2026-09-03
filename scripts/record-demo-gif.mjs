/**
 * Record docs/screenshots/book-to-board.gif — the README's moving picture.
 *
 *   npm run build:site
 *   npx http-server dist-site -p 8129 --silent   (any static server)
 *   node scripts/record-demo-gif.mjs             (or BASE=... node ...)
 *
 * WHAT IT SHOWS, and why it is this and not something else. The one thing
 * this app does that the others do not is read a printed book: a diagram on
 * a page becomes a position on the board beside it. That is a claim a still
 * cannot make — a screenshot of a board next to a book is just two panels —
 * so it is the clip. It runs against the DEMO for the same reason the
 * screenshots do (capture-screenshots.mjs): the demo's vault is the only one
 * that is the same for everyone, and now that it has a book, it is the only
 * one whose book may be shown at all. A page out of somebody's own library
 * would be a page of a copyrighted book in the README.
 *
 * THE DIAGRAM PASS RUNS FIRST, OFF CAMERA. Opening a book starts a
 * background read of every page (books/diagramJob.ts), which takes some
 * seconds and puts a progress bar over the page. That is honest but it is
 * not the story, and a GIF that spends a third of its length waiting is one
 * nobody watches to the end. So the recording waits for the pass to finish
 * before the first frame, then goes back to the shelf and starts.
 *
 * THE CURSOR IS DRAWN, because there isn't one. A headless browser's clicks
 * leave no pointer, so a viewer sees panels changing for no visible reason.
 * The arrow below is a div that moves to whatever is about to be clicked,
 * with a ring on the click itself.
 *
 * SIZE. A GIF has no interframe compression worth the name, and a README
 * that costs 20 MB to scroll past is worse than no README picture. Two
 * things keep it down: the frame is 944x576 (the app laid out at 1180 wide,
 * rastered at 0.8), and every pixel that did not change since the previous
 * frame is written as transparent over a frame that is not disposed. On a
 * mostly-still UI that is most of them.
 */
import { chromium } from 'playwright';
// The ESM build by path: gifenc declares no `exports` map and its `main` is
// the UMD bundle, so a bare specifier resolves to CJS and the named imports
// come back undefined.
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(REPO, 'docs/screenshots/book-to-board.gif');
const BASE = process.env.BASE ?? 'http://localhost:8129';
const BOOK = 'b5a3e1c07f2d49b8c';

/** Laid out at 1180 (landscape, so `wide`: book and board side by side). */
const VIEW = { width: 1180, height: 720 };
const SCALE = 0.8;
/** Nothing is held longer than this between frames, so a pause stays a pause. */
const MAX_DELAY = 400;

/** The pointer, and the ring a click leaves. */
const CURSOR = `
  (() => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText =
      'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;' +
      'pointer-events:none;transition:transform .42s cubic-bezier(.4,0,.2,1);' +
      'transform:translate(120px,300px)';
    c.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24">' +
      '<path d="M5 2.5l14.5 8.4-6.6 1.5-2.7 6.4z" fill="#111" stroke="#fff" ' +
      'stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    window.__moveCursor = (x, y) => {
      c.style.transform = 'translate(' + (x - 4) + 'px,' + (y - 3) + 'px)';
    };
    window.__ring = (x, y) => {
      const r = document.createElement('div');
      r.style.cssText =
        'position:fixed;z-index:2147483646;pointer-events:none;border-radius:999px;' +
        'border:2px solid #111;opacity:.9;width:14px;height:14px;' +
        'left:' + (x - 7) + 'px;top:' + (y - 7) + 'px;' +
        'transition:all .45s ease-out';
      document.body.appendChild(r);
      requestAnimationFrame(() => {
        r.style.width = '44px'; r.style.height = '44px';
        r.style.left = (x - 22) + 'px'; r.style.top = (y - 22) + 'px';
        r.style.opacity = '0';
      });
      setTimeout(() => r.remove(), 600);
    };
    return true;
  })()
`;

/** The demo's own banner: a property of the demo, not of the app. */
const HIDE_BANNER = `
  (() => {
    const s = document.createElement('style');
    s.textContent = '[data-demo-banner]{display:none!important}';
    document.head.appendChild(s);
    return true;
  })()
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });

await page.goto(`${BASE}/app/`, { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('chess-vault:lang', 'en'));
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(HIDE_BANNER);

// Off camera: open the book so the diagram pass runs, and wait for it to have
// filed the pages that carry diagrams. Polled through the page's own fetch —
// the demo answers /api in the page, so nothing about this is visible from
// outside it (web/src/demo/server.ts).
await page.evaluate((id) => { location.hash = `/books/${id}/3`; }, BOOK);
const deadline = Date.now() + 120_000;
for (;;) {
  const ready = await page.evaluate(async (id) => {
    const body = await (await fetch(`/api/books/${id}/diagrams`)).json();
    return Object.values(body.pages ?? {}).filter((v) => v.some((d) => d.fen)).length;
  }, BOOK);
  if (ready >= 3) break;
  if (Date.now() > deadline) throw new Error(`diagram pass never finished (${ready}/3 pages)`);
  await page.waitForTimeout(1000);
}

// Back to the shelf, and start from there.
await page.evaluate(() => { location.hash = '/books'; });
await page.waitForTimeout(2500);
await page.evaluate(CURSOR);

const frames = [];
const times = [];
/**
 * Capture for `ms`, as fast as the shutter goes.
 *
 * The moment of each frame is kept, and the GIF's per-frame delays are the
 * gaps between them — so it plays back at the speed it happened. A fixed
 * delay guesses at the capture rate, and the first cut guessed 100 ms
 * against a real ~45 ms, which played the whole clip at half speed.
 */
async function hold(ms) {
  const until = Date.now() + ms;
  do {
    frames.push(await page.screenshot({ type: 'png' }));
    times.push(Date.now());
  } while (Date.now() < until);
}

/** Move the drawn pointer onto something, then press it. */
async function clickOn(locator, { settle = 700 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('nothing to click');
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.evaluate(([px, py]) => window.__moveCursor(px, py), [x, y]);
  await hold(520);
  await page.evaluate(([px, py]) => window.__ring(px, py), [x, y]);
  await locator.click();
  await hold(settle);
}

await hold(700);
// The shelf, and the one button on the row. Its label depends on whether the
// book has been opened before — and by here it has, because the diagram pass
// above had to open it, which also files a reading position. "Carry on
// reading" is the honest state and a useful one: it opens on the page that
// prints a diagram, which is where the clip is going anyway.
await clickOn(page.getByText(/^(Read|Carry on reading)$/).first(), { settle: 2400 });
// The button the page's own diagram carries. Found by the inline `left:
// calc(...)` DiagramHotspots positions it with — `title` is a tooltip in this
// app, not an attribute, so there is nothing to match on there.
await clickOn(page.locator('button[style*="left: calc"]').first(), { settle: 900 });
// A diagram does not say whose move it is, so the app asks.
await clickOn(page.getByText('White to move').first(), { settle: 2600 });

await browser.close();

// ---- encode -------------------------------------------------------------
const rgba = (buf) => {
  const png = PNG.sync.read(buf);
  return { w: png.width, h: png.height, data: new Uint8Array(png.data) };
};
const first = rgba(frames[0]);
// One palette for the whole clip: a per-frame one costs a 768-byte colour
// table every frame and makes still areas shimmer as the quantiser changes
// its mind. Built from a spread of frames so nothing that only appears late
// — the board full of pieces — is missing from it.
const sample = [];
for (let i = 0; i < frames.length; i += Math.max(1, Math.floor(frames.length / 8))) {
  const f = rgba(frames[i]);
  for (let p = 0; p < f.data.length; p += 4 * 7) {
    sample.push(f.data[p], f.data[p + 1], f.data[p + 2], 255);
  }
}
// 255, not 256: the last slot is the one that means "unchanged".
const palette = quantize(new Uint8Array(sample), 255, { format: 'rgb565' });
const withHole = [...palette, [0, 0, 0]];
const HOLE = palette.length;

const gif = GIFEncoder();
let previous = null;
let changedTotal = 0;
for (const [n, buf] of frames.entries()) {
  const f = rgba(buf);
  const index = applyPalette(f.data, palette, 'rgb565');
  if (previous) {
    // Anything identical to the frame already on screen is left transparent,
    // and the frame beneath is not disposed — so it shows through.
    for (let p = 0, i = 0; p < f.data.length; p += 4, i += 1) {
      if (
        f.data[p] === previous[p] &&
        f.data[p + 1] === previous[p + 1] &&
        f.data[p + 2] === previous[p + 2]
      ) {
        index[i] = HOLE;
      } else {
        changedTotal += 1;
      }
    }
  }
  // How long this frame was actually on screen, capped so a long wait does
  // not become a long freeze.
  const gap = n + 1 < times.length ? times[n + 1] - times[n] : 600;
  gif.writeFrame(index, f.w, f.h, {
    // The colour table goes out once, with the first frame.
    ...(n === 0 ? { palette: withHole, repeat: 0 } : {}),
    delay: Math.min(MAX_DELAY, Math.max(20, gap)),
    transparent: n > 0,
    transparentIndex: HOLE,
    dispose: 1,
  });
  previous = f.data;
}
gif.finish();
const bytes = gif.bytes();
writeFileSync(OUT, bytes);
const pixels = first.w * first.h * (frames.length - 1);
console.log(
  `${OUT}\n  ${first.w}x${first.h}  ${frames.length} frames  ` +
    `${(bytes.length / 1024 / 1024).toFixed(2)} MB  ` +
    `${((times[times.length - 1] - times[0]) / 1000).toFixed(1)}s  ` +
    `${((changedTotal / pixels) * 100).toFixed(1)}% of pixels redrawn`,
);
