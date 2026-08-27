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
 * Every target is captured TWICE, once in each theme, as `<name>.png`
 * (light) and `<name>-dark.png`. The app at rest is shadcn's neutral theme
 * and follows the viewer's system setting, so the README (GitHub's
 * `<picture>` + `prefers-color-scheme`) and the landing page (the same media
 * query) show whichever matches the reader; a white screenshot on a dark
 * page, or the reverse, is a picture of a different app from the one that
 * opens when they click through.
 *
 * The theme is FORCED through the app's own persisted store, not left to
 * the OS of whoever runs this script: the store's `system` default resolves
 * through Electron's nativeTheme, which is why the previous set came out
 * dark on one machine and would have come out light on the next.
 */
const THEMES = [
  { suffix: '', prefs: { 'chess-vault:theme': '{"state":{"preference":"light"},"version":0}' } },
  { suffix: '-dark', prefs: { 'chess-vault:theme': '{"state":{"preference":"dark"},"version":0}' } },
];

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
 *
 * Four optional fields, all for the opening map and all earning their
 * keep there:
 *
 * `settle` — extra milliseconds before the shutter. The map lays itself
 * out twice: once from the document, then again when the tagged studies
 * have been fetched and parsed and every dot knows how big it is. The
 * default wait catches the first layout, which is a picture of the map
 * rearranging itself.
 *
 * `select` — a node label to click first. Selection is component state,
 * not a route, so there is no URL that opens a map with a move chosen.
 *
 * `crop` — capture one element instead of the window. A panel shown at
 * 320px has to BE the picture; the same panel inside a 1904px frame is a
 * detail nobody can read.
 *
 * `prefs` — localStorage to write before routing, for the settings that
 * live on the device rather than in the vault. A fresh profile is the
 * right default for a screenshot, except where the default is the feature
 * turned off.
 */
const TARGETS = [
  // README + the landing hero: the full desktop layout.
  // The README hero and the landing page's. NOT the app at rest: `#/board`
  // opens on the starting position with both panels switched off, and the
  // picture that made was a board nobody had touched beside a panel reading
  // "Play a move on the board, or load a FEN or PGN" — an advertisement for
  // an empty app, in the one image most people see before any other.
  //
  // So the shot plays an opening first and turns the two panels on. What it
  // costs is that this shot now depends on the engine actually running,
  // which on the demo means the single-threaded build (no COOP/COEP on a
  // static host, so supportsThreads() is false and defaultFlavor() falls
  // back to `lite-single`) — hence `think`, which is time for a search to
  // have something to show rather than an empty panel with the switch on.
  {
    hash: '#/board',
    out: 'board.png',
    win: [1904, 996],
    css: 1100,
    wait: 'cg-board',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'],
    // The ENGINE only, and the explorer deliberately left shut. The explorer
    // picks its source with activeBook(), which falls back to the vault's own
    // games whenever `refDbs` is empty — and in the demo it always is, because
    // the list comes from GET /api/refgames and demo/server.ts does not answer
    // that route. So the panel can only ever say "None of your games reached
    // this position", which is the empty vault advertising itself one panel
    // further down. A shot cannot fix that; the demo answering /api/refgames
    // would, and until it does this shot shows the half that works.
    clicks: ['[aria-label="Engine on/off"]'],
    think: 5000,
  },
  { hash: '#/games', out: 'games.png', win: [1904, 996], css: 1100, wait: '.divide-border' },
  { hash: '#/puzzles/dashboard', out: 'dashboard.png', win: [1904, 996], css: 1100, wait: 'ul' },
  // The whole repertoire at once — README and the landing page's map section.
  //
  // NOT ZOOMED, and NARROW. Both for the same reason.
  //
  // The map fits itself to its canvas, and a repertoire tree is taller
  // than it is wide, so HEIGHT is what the fit is up against. The labels
  // fade with the fitted scale (far out you read the shape, close in the
  // names), which ties them to the height too: zooming this shot to 1100
  // CSS the way the others do costs the canvas two thirds of its height
  // and takes every label with it — measured, k = 0.23 against the 0.3
  // labels begin at. Laying out at the window's own width instead gives
  // the map 836 CSS px of height, k = 0.47, and names on the dots. A
  // taller WINDOW would be the obvious fix and does nothing: it clamps to
  // the screen, which is why this file zooms at all.
  //
  // Width is then free, and spending it is what made the first version
  // of this shot look empty — the fit was still height-bound, so a wider
  // frame only added margin: the constellation filled 40% of a 1904px
  // canvas and 69% of a 1200px one, at the same scale.
  {
    hash: '#/openingmap',
    out: 'opening-map.png',
    win: [1200, 996],
    css: 1200,
    wait: 'svg[role="tree"]',
    settle: 7000,
    // The field is a device-local choice and defaults to off, which is a
    // map with nothing to say about what opponents actually play: no dot
    // sizes, no gap badges, no lit mainline. Half the feature, and the
    // half the words beside these pictures are about. `refgames` is the
    // demo's single mounted database (SINGLE_DB_SOURCE in field.ts).
    prefs: { 'vault:openingmap-field': '{"source":"refgames","ratings":"1600"}' },
  },
  // The landing page's three side figures.
  {
    hash: `#/notes/${encodeURIComponent('Blunders to stop making')}`,
    out: 'note-phone.png',
    win: [585, 780],
    css: 390,
    wait: 'cg-board',
  },
  { hash: '#/games', out: 'games-phone.png', win: [585, 780], css: 390, wait: '.divide-border' },
  // One node's answer to "what is prepared here" — the half of the feature
  // a picture of the constellation cannot show. Whole, never cut: this
  // panel IS the figure, and a figure with its last rows sliced off is a
  // picture of the app failing to fit.
  //
  // WIDER than the map shot, which is what keeps it whole and usable. The
  // panel is 22rem below `xl` and 26rem above it, and the narrow one is
  // not a smaller picture but a taller one — every row wraps, and 308×820
  // beside a paragraph is a column of unreadable text. Laid out at 1904
  // the same content comes back around 380 wide and much shorter.
  //
  // It still needs the map to have named its dots: a label is how a dot is
  // identified to a script as well as to a reader, and below the fitted
  // scale where labels fade they are not in the DOM at all.
  {
    hash: '#/openingmap',
    out: 'opening-map-node.png',
    win: [1904, 996],
    css: 1904,
    wait: 'svg[role="tree"]',
    settle: 7000,
    // The same field as the shot above, for the same reason — and here it
    // is also what fills the panel's lower half: which replies the field
    // plays, and which of them run into preparation.
    prefs: { 'vault:openingmap-field': '{"source":"refgames","ratings":"1600"}' },
    select: '3. Bb5',
    crop: 'aside[aria-label]',
  },
];

/**
 * Click the map dot carrying a label. The dots are SVG groups with no id
 * in the DOM — the label is what identifies one to a human reading the
 * picture, so it is what identifies one here.
 */
const SELECT_NODE = (label) => `
  (() => {
    const text = [...document.querySelectorAll('svg text')]
      .find((t) => t.textContent.trim() === ${JSON.stringify(label)});
    if (!text) return 0;
    text.closest('g').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return 1;
  })()
`;

/**
 * Where the board is, in the page's CSS pixels, and which way up.
 *
 * Orientation is read rather than assumed: every square below is derived
 * from it, so a flipped board would not fail — it would quietly play a
 * different opening from the one named in the target.
 */
const BOARD_BOX = `
  (() => {
    const el = document.querySelector('cg-board');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      size: r.width / 8,
      flipped: !!el.closest('.orientation-black'),
    };
  })()
`;

/** Two squares of `.last-move` is chessground saying a move was accepted. */
const MOVE_LANDED = `document.querySelectorAll('cg-board square.last-move').length`;

/** The centre of a square like `e4`, in the same CSS pixels as BOARD_BOX. */
const centreOf = (square, board) => {
  const file = square.charCodeAt(0) - 97; // a..h -> 0..7
  const rank = Number(square[1]) - 1; // 1..8 -> 0..7
  const col = board.flipped ? 7 - file : file;
  const row = board.flipped ? rank : 7 - rank;
  return { x: board.x + (col + 0.5) * board.size, y: board.y + (row + 0.5) * board.size };
};

/**
 * A real click, not one dispatched into the DOM.
 *
 * chessground binds its own pointer handling, and a MouseEvent built in JS
 * arrives without the state that handling keeps between press and release —
 * the same reason SELECT_NODE can get away with a synthetic event on a plain
 * SVG group and this cannot. sendInputEvent goes in where the OS's would.
 *
 * The window's pixels are zoomed and getBoundingClientRect's are not, so
 * these scale by the factor that decoupled them, exactly as the crop box does.
 */
const clickAt = (win, { x, y }, z) => {
  const at = { x: Math.round(x * z), y: Math.round(y * z), button: 'left', clickCount: 1 };
  win.webContents.sendInputEvent({ type: 'mouseDown', ...at });
  win.webContents.sendInputEvent({ type: 'mouseUp', ...at });
};

const BOX_OF = (selector) => `
  (() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()
`;

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

  const shots = TARGETS.flatMap((target) =>
    THEMES.map((theme) => ({
      ...target,
      out: target.out.replace(/\.png$/, `${theme.suffix}.png`),
      prefs: { ...theme.prefs, ...(target.prefs ?? {}) },
    })),
  );
  for (const {
    hash, out, win: [w, h], css, wait, settle = 0, select, crop, prefs,
    moves, clicks, think = 0,
  } of shots) {
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
      `localStorage.setItem('chess-vault:lang', 'en');
       ${Object.entries(prefs)
         .map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
         .join('\n       ')}
       true`,
    );
    // Write the settings, then boot again ON TOP of them, and only THEN
    // route. Three steps, and the order of the last two is not tidiness.
    //
    // The reload is because the language is read once, at startup, and
    // falls back to navigator.language when nothing is stored
    // (lib/i18n.ts): writing it into a page that has already started only
    // changes what the NEXT boot reads. On an English machine that is
    // invisible, since the fallback agrees with the pref — on a Korean one
    // every shot came out in Korean, which is how it was found. These
    // images are English wherever they are shown, so the language cannot
    // be a property of whoever ran the script.
    //
    // The route goes on AFTER the reload, not into the hash before it, so
    // that the app still comes up on its default route and is routed to
    // the target once it is warm. Booting straight into a hash costs the
    // opening map its layout: the map fits itself to its canvas, and
    // mounting it into a page that is still starting fits it to a canvas
    // that has not been sized yet, which the simulation never recovers
    // from. Measured — a tree with clean edges either side of this change,
    // and a hairball of crossing edges and overlapping labels when the
    // hash was set before the reload, at both 7s and 22s of settling.
    await new Promise((done) => {
      win.webContents.once('did-finish-load', done);
      win.webContents.reload();
    });
    await win.webContents.executeJavaScript(
      `location.hash = ${JSON.stringify(hash.slice(1))}; true`,
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
    // The window's pixels over the page's. Everything that crosses between
    // the two — a click going in, a crop box coming out — goes through this.
    const z = w / css;
    await sleep(1800);
    const banners = await win.webContents.executeJavaScript(
      `document.querySelectorAll('[data-demo-banner]').length`,
    );
    const found = await win.webContents.executeJavaScript(
      `document.querySelectorAll('${wait}').length`,
    );
    await sleep(1200);
    // After the waits: whatever this clicks has to be on the page, and on
    // the map it also has to have stopped moving.
    await sleep(settle);
    const selected = select
      ? await win.webContents.executeJavaScript(SELECT_NODE(select))
      : null;
    if (select) await sleep(600);

    // Play the opening, then switch the panels on — in that order, because
    // an engine told to search the starting position and then handed ten
    // moves spends the shot catching up with the board.
    let played = null;
    if (moves) {
      const board = await win.webContents.executeJavaScript(BOARD_BOX);
      if (board) {
        for (const move of moves) {
          clickAt(win, centreOf(move.slice(0, 2), board), z);
          await sleep(140);
          clickAt(win, centreOf(move.slice(2, 4), board), z);
          await sleep(280);
        }
        // Chessground marks the move it accepted. No mark after ten of them
        // means the clicks landed somewhere that was not a legal move, and
        // the shot is of the starting position with the panels on — which
        // looks deliberate, so it has to say so out loud.
        played = await win.webContents.executeJavaScript(MOVE_LANDED);
      } else {
        played = 0;
      }
    }
    for (const selector of clicks ?? []) {
      await win.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(selector)})?.click(); true`,
      );
      await sleep(400);
    }
    // The engine has to have found something to say before the shutter.
    await sleep(think);

    // Checked at the shutter, not when the rule was added: the notice
    // getting into the docs is exactly the failure nobody notices until
    // the images are already published.
    const bannerHeight = await win.webContents.executeJavaScript(
      `(() => { const el = document.querySelector('[data-demo-banner]');
        return el ? Math.round(el.getBoundingClientRect().height) : 0; })()`,
    );

    // The box is measured in the page's CSS pixels and the raster is the
    // window's, so it scales by the zoom factor that decoupled them.
    const box = crop ? await win.webContents.executeJavaScript(BOX_OF(crop)) : null;
    // A hidden window paints lazily, and asking it for a REGION before it
    // has ever been asked for a frame hands back that region of a surface
    // nothing has drawn to yet: a rectangle of the right size, correctly
    // placed, and empty. One full capture first is what makes it paint.
    // The cost is a discarded frame on the one shot that crops.
    if (box) await win.webContents.capturePage();
    const image = await win.webContents.capturePage(
      box
        ? {
            x: Math.round(box.x * z),
            y: Math.round(box.y * z),
            width: Math.round(box.width * z),
            height: Math.round(box.height * z),
          }
        : undefined,
    );
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
        (bannerHeight ? `  (WARNING: demo notice ${bannerHeight}px tall AT CAPTURE)` : '') +
        // A missed click or a missed crop is a plausible-looking picture of
        // the wrong thing, which is the failure worth shouting about.
        (selected === 0 ? `  (WARNING: no dot labelled "${select}" — nothing selected)` : '') +
        (played === 0 ? `  (WARNING: no move landed — is this the starting position?)` : '') +
        (crop && !box ? `  (WARNING: no "${crop}" to crop to — captured the window)` : ''),
    );
    win.destroy();
  }
  app.quit();
});
