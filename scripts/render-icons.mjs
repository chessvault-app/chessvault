import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import pngToIco from 'png-to-ico';

/**
 * The mark, twice. The LINE is the same drawing as
 * web/src/components/brand-mark.tsx: a knight's head as one open stroke
 * on an 80-unit box. The SOLID is a silhouette of the same head drawn
 * separately for the sizes where a line cannot live: at 16 px the
 * 7-unit stroke is 1.4 px, so the favicon and the .ico carry the solid
 * and everything from 180 px up carries the line. Everything below is a
 * choice of ink and ground around one of the two.
 */
const LINE = 'M22 66 C24 61 27 57 29 54 L19 45 L11 39 L19 29 L33 11 L39 19 L45 15 L52 23 L61 33 C64 41 65 53 64 66';
const SOLID = 'M28 72 L32 48 L10 42 L21 27 L35 7 L44 18 L50 13 L64 27 C69 40 69 56 66 72 Z';
const MARK = (ink) => `
  <path d="${LINE}" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
const CUT = (ink) => `
  <path d="${SOLID}" fill="${ink}"/>`;

/**
 * Bare, on nothing — how the app itself wears the mark since the sidebar
 * and lock screen dropped their tiles. Browser surfaces can afford it:
 * the SVG favicon adapts its ink to the tab's scheme, the .ico fallback
 * only reaches legacy contexts, and Android backdrops a manifest icon it
 * puts on a home screen.
 */
const bare = (ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${MARK(ink)}</svg>`;
const bareCut = (ink) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">${CUT(ink)}</svg>`;

/**
 * Grounded — for the icons an OS composites onto grounds the image cannot
 * see. iOS fills apple-touch transparency with solid black (full bleed:
 * it masks its own corners, and the old rounded tile's corners were
 * being blackfilled anyway); a desktop taskbar or dock is as often dark
 * as light, where a bare near-black glyph simply vanishes. These two keep
 * the dark ground and the white mark.
 */
const grounded = (rx) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="${rx}" fill="#0a0a0a"/>
  <g transform="translate(12 12) scale(1.2)">${MARK('#ffffff')}</g></svg>`;

const INK = '#0a0a0a';

/**
 * The favicon is written here rather than read from here, so the tab
 * icon and every raster stay one drawing. It carries the SOLID: a tab
 * strip shows it at 16 or 32 px, where the line is a thread. currentColor
 * plus the media query is what lets the bare mark survive a dark strip.
 */
writeFileSync(
  'web/public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">
  <style>:root{color:${INK}}@media(prefers-color-scheme:dark){:root{color:#ffffff}}</style>
  <path d="${SOLID}" fill="currentColor"/>
</svg>
`,
);
console.log('web/public/favicon.svg  bare solid, scheme-adaptive');

const render = (svg, size, path) => {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(path, png);
  console.log(`${path}  ${size}x${size}  ${png.length} bytes`);
};
render(bare(INK), 512, 'web/public/icon-512.png');
render(bare(INK), 192, 'web/public/icon-192.png');
// The maskable pair: Android cuts a home-screen icon to the launcher's
// shape and, given only the bare mark, first drops it on a white disc
// and shrinks it, which is how a website looks on a home screen and how
// no app does. Full bleed on the dark ground, mark well inside the 80%
// safe zone (it spans 52% of the canvas), so any mask keeps the whole
// glyph. Declared `purpose: maskable` in the manifest beside the bare
// `any` pair, which browsers that do not mask still prefer.
render(grounded(0), 512, 'web/public/icon-512-maskable.png');
render(grounded(0), 192, 'web/public/icon-192-maskable.png');
render(grounded(0), 180, 'web/public/apple-touch-icon.png');
// Three sizes, because the platforms disagree and one file cannot satisfy
// any two of them. NSIS refuses anything over 256 — desktop/build-server.mjs
// turns the 256 into icon.ico, and feeding it a 512 produced "invalid icon
// file size" and no Windows installer.
//
// macOS refuses anything UNDER 512 ("Icon must be at least 512x512 pixels,
// provided: 256x256"), which is how it ended up on exactly 512 — the
// minimum, read as the answer. A Mac icon wants 1024: the .icns generated
// from a 512 has no @2x slot for its largest size, so every Retina display
// in the Finder was upscaling a 512 and the result looked like a bad
// thumbnail, because it was one.
render(grounded(27), 1024, 'desktop/icon-1024.png');
render(grounded(27), 512, 'desktop/icon.png');
render(grounded(27), 256, 'desktop/icon-256.png');

/**
 * favicon.ico, still, in 2026.
 *
 * The SVG favicon is linked and served correctly, but a browser that does
 * not render SVG icons — and anything that simply asks for /favicon.ico —
 * got the SPA's index.html back with a 200 and showed nothing. A real .ico
 * at the conventional path is the fallback that makes the tab icon appear
 * everywhere rather than almost everywhere.
 */
const ICO_SIZES = [16, 32, 48];
const tmp = ICO_SIZES.map((size) => {
  const path = `web/public/.favicon-${size}.png`;
  render(bareCut(INK), size, path);
  return path;
});
writeFileSync('web/public/favicon.ico', await pngToIco(tmp));
for (const path of tmp) rmSync(path);
console.log('web/public/favicon.ico  16+32+48');

/**
 * iOS splash screens, and the tags that point at them.
 *
 * Without an apple-touch-startup-image iOS opens a standalone web app on
 * plain white and holds it there until the page paints — a white flash in
 * front of an almost-black app. One image per device geometry fixes it,
 * and iOS matches them by EXACT device-width, device-height, pixel ratio
 * and orientation: a device with no matching tag gets the white.
 *
 * Which is why the tags are generated here rather than written by hand.
 * There are three dozen of them, the file names are the geometry, and a
 * hand-kept list drifts from the folder the first time a device is added.
 * This writes both, from one table, into the markers in web/index.html.
 *
 * (pwa-asset-generator does this job too, and would have brought Puppeteer
 * and a headless Chromium along to rasterise an SVG this repo already
 * rasterises with resvg — a second toolchain, a browser download in CI,
 * and screenshots instead of a vector. The table below is the part of it
 * that was actually wanted.)
 */
/**
 * One pair per scheme: the app's own background, and the mark in the
 * app's ink — near-black on the light ground, white on the dark one, the
 * same two colours as the icon itself. The grounds match index.html's
 * launch background.
 *
 * Two images per geometry, because iOS picks a startup image by media
 * query and never adapts one: a dark-only splash is a black screen in
 * front of a white app for anyone who runs their phone in light mode,
 * which is the same flash this exists to remove, only reversed.
 */
const SCHEMES = {
  light: { bg: '#ffffff', fg: '#0a0a0a' },
  dark: { bg: '#0a0a0a', fg: '#ffffff' },
};

/**
 * Device geometry in POINTS, plus its scale. Portrait; landscape is the
 * same entry with the axes swapped.
 *
 * Several models share a geometry — 393x852@3 is the 14 Pro, the 15, the
 * 15 Pro and the 16 — so these are named for their size rather than for a
 * phone, which is also why the list needs no maintenance when a model is
 * announced that reuses one.
 */
const DEVICES = [
  { w: 440, h: 956, scale: 3 }, // iPhone 16/17 Pro Max
  { w: 430, h: 932, scale: 3 }, // iPhone 14 Pro Max … 16 Plus, 17
  { w: 402, h: 874, scale: 3 }, // iPhone 16/17 Pro
  { w: 393, h: 852, scale: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { w: 390, h: 844, scale: 3 }, // iPhone 12, 13, 14, 16e
  { w: 375, h: 812, scale: 3 }, // iPhone X, XS, 11 Pro, 12/13 mini
  { w: 414, h: 896, scale: 3 }, // iPhone XS Max, 11 Pro Max
  { w: 414, h: 896, scale: 2 }, // iPhone XR, 11
  { w: 414, h: 736, scale: 3 }, // iPhone 8 Plus
  { w: 375, h: 667, scale: 2 }, // iPhone SE (2nd/3rd), 8
  { w: 1032, h: 1376, scale: 2 }, // iPad Pro 13" (M4)
  { w: 1024, h: 1366, scale: 2 }, // iPad Pro 12.9"
  { w: 834, h: 1210, scale: 2 }, // iPad Pro 11" (M4)
  { w: 834, h: 1194, scale: 2 }, // iPad Pro 11"
  { w: 820, h: 1180, scale: 2 }, // iPad Air 11", iPad 10th/11th
  { w: 810, h: 1080, scale: 2 }, // iPad 10.2"
  { w: 744, h: 1133, scale: 2 }, // iPad mini 6/7
  { w: 768, h: 1024, scale: 2 }, // iPad 9.7", mini 5, Air 2
];

/** The mark alone, centred — no rounded square. The square is the app
    ICON, which sits among other icons and needs an edge; a launch screen
    is the app's own background, and a badge floating in the middle of it
    reads as a smaller screen inside the screen.

    The mark lives ONLY here, on the OS's side of the launch. iOS
    cross-dissolves this image into the page's first paint, so the mark
    fades out over the page's plain ground for ~100 ms — measured on
    lanph3re's recordings and accepted by lanph3re as benign. What is NOT
    acceptable is a mark drawn by the PAGE to receive that dissolve: it
    moves with the still-settling launch viewport, twice built and twice
    measured doing so. Brand on the image, never on the page. */
const splashSvg = (w, h, { bg, fg }) => {
  const logo = Math.round(Math.min(w, h) * 0.22);
  return `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${bg}"/>
  <g transform="translate(${(w - logo) / 2}, ${(h - logo) / 2}) scale(${logo / 80})">${MARK(fg)}
  </g>
</svg>`;
};

// Regenerated wholesale: a stale file from a device that has left the
// table would otherwise sit in the folder for ever, referenced by nothing.
rmSync('web/public/splash', { recursive: true, force: true });
mkdirSync('web/public/splash', { recursive: true });

const tags = [];
for (const { w, h, scale } of DEVICES) {
  for (const orientation of ['portrait', 'landscape']) {
    const [dw, dh] = orientation === 'portrait' ? [w, h] : [h, w];
    for (const [scheme, colours] of Object.entries(SCHEMES)) {
      const name = `${dw}x${dh}@${scale}x-${scheme}.png`;
      const png = new Resvg(splashSvg(dw * scale, dh * scale, colours)).render().asPng();
      writeFileSync(`web/public/splash/${name}`, png);
      // prefers-color-scheme LAST in the query, and present on both: a
      // tag without it matches either scheme, so a light tag left bare
      // would win the dark one on some iOS versions by sheer document
      // order. Every tag says which scheme it is for.
      tags.push(
        `    <link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme})" href="/splash/${name}" />`,
      );
    }
  }
}
const bytes = readdirSync('web/public/splash').reduce(
  (sum, f) => sum + readFileSync(`web/public/splash/${f}`).length,
  0,
);
console.log(
  `web/public/splash  ${DEVICES.length} devices x 2 orientations x ${Object.keys(SCHEMES).length} schemes = ${tags.length} images, ${Math.round(bytes / 1024)} kB`,
);

const START = '    <!-- splash:start — generated by scripts/render-icons.mjs; do not edit -->';
const END = '    <!-- splash:end -->';
const html = readFileSync('web/index.html', 'utf-8');
const from = html.indexOf(START);
const to = html.indexOf(END);
if (from === -1 || to === -1) throw new Error('web/index.html is missing the splash markers');
const NL = '\n';
writeFileSync('web/index.html', html.slice(0, from) + START + NL + tags.join(NL) + NL + html.slice(to));
console.log(`web/index.html  ${tags.length} startup-image tags`);
