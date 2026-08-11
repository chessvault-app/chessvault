/**
 * Recapture docs/screenshots/ from the running demo.
 *
 *   npm run build:site
 *   npx http-server dist-site -p 8129 --silent   (any static server)
 *   npm run shots                                (or SHOT_BASE=... npm run shots)
 *
 * The demo is the source because it is the only vault that is the same for
 * everyone — capturing from a personal one would put somebody's games and
 * usernames in the README.
 *
 * Electron rather than the browser tooling because capturePage() gives real
 * PNG bytes — a JPEG round-trip would bake compression ringing into white
 * UI text on a dark background, which is the one thing these images are
 * for. Both are captured at the SAME size so they share an aspect ratio
 * exactly, and the landing page's shared box needs no letterboxing.
 *
 * Narrower than the originals (1440px) on purpose: at 1100 the app is still
 * the full desktop layout, and shown across the landing page's 960px column
 * that is 0.87x of life size instead of 0.67x — legible without cropping.
 */
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:8129';
// The window clamps to the screen, so the CSS viewport is set with zoom
// instead: a 1904px-wide raster showing a 1100px-wide layout. That keeps
// the app compact (a narrower view than the 1440px originals) AND leaves
// roughly 2x the pixels the landing page's 960px column needs.
const WIDTH = 1904;
const HEIGHT = 996;
const CSS_WIDTH = 1100;

const TARGETS = [
  { hash: '#/games', out: 'docs/screenshots/games.png', wait: '.divide-line' },
  { hash: '#/puzzles/dashboard', out: 'docs/screenshots/dashboard.png', wait: 'table, ul' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    useContentSize: true,
    webPreferences: { backgroundThrottling: false },
  });

  // English, and the demo's own banner out of the way: it is a property of
  // the demo, not of the app these images are meant to show.
  await win.loadURL(`${BASE}/app/`);
  await win.webContents.executeJavaScript(
    `localStorage.setItem('chess-vault:lang', 'en'); true`,
  );
  win.webContents.setZoomFactor(WIDTH / CSS_WIDTH);

  for (const { hash, out, wait } of TARGETS) {
    await win.loadURL(`${BASE}/app/${hash}`);
    win.webContents.setZoomFactor(WIDTH / CSS_WIDTH);
    await sleep(1500);
    await win.webContents.executeJavaScript(`
      (() => {
        for (const el of document.querySelectorAll('body *')) {
          const t = (el.textContent || '').trim();
          if (t.startsWith('Demo —') && el.children.length === 0) {
            const bar = el.closest('div');
            if (bar) bar.style.display = 'none';
          }
        }
        return document.querySelectorAll('${wait}').length;
      })()
    `);
    await sleep(1200);
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    const path = resolve(out);
    writeFileSync(path, png);
    const size = image.getSize();
    const css = await win.webContents.executeJavaScript('[innerWidth, innerHeight]');
    console.log(`${out}  raster ${size.width}x${size.height}, layout ${css[0]}x${css[1]} css, ${(png.length / 1e3).toFixed(0)} KB`);
  }

  win.destroy();
  app.quit();
});
