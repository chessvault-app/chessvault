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
 * PNG bytes, and a JPEG round-trip would bake compression ringing into white
 * UI text on a dark background, which is the one thing these images are for.
 *
 * SIZE IS SET WITH ZOOM, NOT THE WINDOW. A BrowserWindow clamps to the
 * screen, so asking for a 1100px window on a 1920px display quietly gives
 * 1904. Zooming instead decouples the two: the raster is the window's size
 * and the LAYOUT is that divided by the zoom factor. So each shot names the
 * CSS width it wants the app laid out at, and gets a raster comfortably
 * denser than wherever it is displayed.
 */
import { app, BrowserWindow, session } from 'electron';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:8129';

/**
 * `css` is the width the app lays out at — the smaller it is, the larger
 * the app's own text is relative to the frame, which is what decides
 * whether a shot survives being shown small.
 *
 * The two landing-page figures are phone-shaped because they are shown at
 * 320px, and at that width nothing but a phone layout can be read. They
 * also each have to illustrate the paragraph beside them: a note carrying
 * markdown, a live board and wiki-links for "the files are the format",
 * and the collection on a phone for "reach it from anywhere".
 */
const TARGETS = [
  // README + the landing hero: the full desktop layout.
  { hash: '#/analysis', out: 'board.png', win: [1904, 996], css: 1100, wait: 'cg-board' },
  { hash: '#/games', out: 'games.png', win: [1904, 996], css: 1100, wait: '.divide-line' },
  { hash: '#/puzzles/dashboard', out: 'dashboard.png', win: [1904, 996], css: 1100, wait: 'ul' },
  // The landing page's two side figures.
  {
    hash: `#/notes/${encodeURIComponent('Blunders to stop making')}`,
    out: 'note-phone.png',
    win: [585, 780],
    css: 390,
    wait: 'cg-board',
  },
  { hash: '#/games', out: 'games-phone.png', win: [585, 780], css: 390, wait: '.divide-line' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The demo's own banner: a property of the demo, not of the app.
 *
 * A STYLESHEET rule on the attribute App.tsx marks it with, not an inline
 * style on whatever element happened to hold the sentence. The old version
 * matched the banner's own text and set `style.display` on the node it
 * found: it broke silently if the wording changed, and an inline style
 * only lasts as long as the node React put it on, so a re-render between
 * hiding and capturing put the banner back into the image. A rule in the
 * document applies to whatever is on screen at capture time.
 */
const HIDE_DEMO_BANNER = `
  (() => {
    const style = document.createElement('style');
    style.textContent = '[data-demo-banner]{display:none!important}';
    document.head.appendChild(style);
    return document.querySelectorAll('[data-demo-banner]').length;
  })()
`;

// Each shot gets its own window, and destroying the last one would
// otherwise end the run: Electron quits when no windows remain.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  // A picture of a cached build is a picture of the wrong app. index.html
  // is the one file whose name does not change between builds, so a stale
  // copy of it keeps pointing at the previous run's hashed bundle and
  // every shot silently shows yesterday's UI.
  await session.defaultSession.clearCache();

  for (const { hash, out, win: [w, h], css, wait } of TARGETS) {
    const win = new BrowserWindow({
      width: w,
      height: h,
      show: false,
      useContentSize: true,
      webPreferences: { backgroundThrottling: false },
    });

    // One load, then route from inside the page. A second loadURL to the
    // same document with a different hash aborts the first and rejects.
    await win.loadURL(`${BASE}/app/`);
    await win.webContents.executeJavaScript(
      `localStorage.setItem('chess-vault:lang', 'en'); location.hash = ${JSON.stringify(hash.slice(1))}; true`,
    );
    // BEFORE the waits, not after them. A rule in the document applies to
    // whatever appears later, so hiding first means no frame ever contains
    // the notice — which matters because an offscreen window's capture can
    // hand back a frame older than the last thing done to the DOM. Hiding
    // it a moment before the shutter left the notice in the raster while
    // the DOM said it was gone.
    await win.webContents.executeJavaScript(HIDE_DEMO_BANNER);
    // After the load, not before: a navigation resets it.
    win.webContents.setZoomFactor(w / css);
    await sleep(1800);
    const banners = await win.webContents.executeJavaScript(
      `document.querySelectorAll('[data-demo-banner]').length`,
    );
    const found = await win.webContents.executeJavaScript(
      `document.querySelectorAll('${wait}').length`,
    );
    await sleep(1200);

    // Checked at the shutter, not when the rule was added: the notice
    // getting into the docs is exactly the failure nobody notices until
    // the images are already published.
    const bannerHeight = await win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector('[data-demo-banner]');
        return el ? Math.round(el.getBoundingClientRect().height) : 0; })()`,
    );

    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    writeFileSync(resolve('docs/screenshots', out), png);
    const size = image.getSize();
    const layout = await win.webContents.executeJavaScript('[innerWidth, innerHeight]');
    console.log(
      `${out.padEnd(18)} raster ${size.width}x${size.height}  layout ${layout[0]}x${layout[1]}` +
        `  ${(png.length / 1e3).toFixed(0)} KB` +
        (found ? '' : `  (WARNING: no "${wait}" on the page — is it still loading?)`) +
        // Silence here would mean the demo notice is in the picture.
        (banners ? '' : `  (WARNING: no [data-demo-banner] — is the notice in the shot?)`) +
        (bannerHeight ? `  (WARNING: demo notice ${bannerHeight}px tall AT CAPTURE)` : ''),
    );
    win.destroy();
  }
  app.quit();
});
