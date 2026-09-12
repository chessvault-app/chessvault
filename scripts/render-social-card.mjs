import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

/**
 * The social card: docs/screenshots/social-card.png, 1280x640, what a link
 * to the landing page or the repository unfurls into. It is rendered, not
 * drawn, because a hand-drawn card kept the mark, the wordmark and the
 * engine version the app had the day it was drawn: the last one carried
 * the cube tile a fortnight after the knight replaced it.
 *
 * Everything on it comes from somewhere the app already keeps: the mark's
 * path is brand-mark.tsx's (copied here as render-icons.mjs copies it, the
 * scripts having no TSX), the palette is the landing page's dark scheme,
 * the face is the app's Pretendard, and the board is a crop of the
 * analysis shot `npm run shots` captures. Recapture the shots, run this,
 * commit both. The engine name is read from the README so the chip cannot
 * lag the version the app ships.
 *
 *   node scripts/render-social-card.mjs
 *
 * GitHub's own preview (Settings, Social preview) is uploaded by hand from
 * the same file; the landing page and its docs point at it directly.
 */
const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'docs/screenshots/social-card.png');
const W = 1280;
const H = 640;

const LINE = 'M22 66 C24 61 27 57 29 54 L19 45 L11 39 L19 29 L33 11 L39 19 L45 15 L52 23 L61 33 C64 41 65 53 64 66';

const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
const engine = /Stockfish \d+/.exec(readme)?.[0] ?? 'Stockfish';

// The right half is the analysis shot from the eval bar to the h file,
// scaled to the card's height: the whole board, the bar and the engine's
// arrow, which is what the tagline beside it claims. A 1904x996 capture
// puts the bar at x=475 and the board at y=110..768; the crop keeps a
// little of the page's ground on each side so the panel reads as a window
// onto the app rather than a pasted board.
const shot = sharp(resolve(ROOT, 'docs/screenshots/board-dark.png'));
const { width: sw, height: sh } = await shot.metadata();
const region = { left: 450, top: 40, width: Math.min(775, sw - 450), height: Math.min(790, sh - 40) };
const crop = { width: Math.round((region.width * H) / region.height), height: H };
const board = (await shot.extract(region).resize(crop).png().toBuffer()).toString('base64');

const font = resolve(ROOT, 'node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Pretendard; src: url("file:///${font.replace(/\\/g, '/')}") format("woff2"); font-weight: 45 920; }
  :root {
    --background: oklch(14.5% 0 0);
    --foreground: oklch(98.5% 0 0);
    --muted-foreground: oklch(74% 0 0);
    --hairline: oklch(98.5% 0 0 / 10%);
    --chip: oklch(98.5% 0 0 / 7%);
  }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body {
    display: grid; grid-template-columns: ${W - crop.width}px ${crop.width}px;
    background: var(--background); color: var(--foreground);
    font: 15px/1.5 Pretendard, ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .copy { padding: 0 0 0 76px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .mark { display: flex; align-items: center; gap: 10px; font-weight: 500; font-size: 27px; letter-spacing: -0.01em; }
  .mark svg { width: 34px; height: 34px; }
  h1 { margin: 0; font-size: 72px; line-height: 1.02; letter-spacing: -0.03em; font-weight: 600; }
  h1 span { color: var(--muted-foreground); }
  .tagline { margin: 0; font-size: 24px; line-height: 1.35; color: var(--muted-foreground); max-width: 520px; }
  .chips { display: flex; flex-wrap: wrap; gap: 10px; max-width: 500px; margin-top: 6px; }
  .chip { font-size: 15.5px; padding: 8px 16px; border-radius: 999px; background: var(--chip); box-shadow: inset 0 0 0 1px var(--hairline); }
  .shot { position: relative; box-shadow: inset 1px 0 0 var(--hairline); }
  .shot img { display: block; width: ${crop.width}px; height: ${crop.height}px; }
</style>
<div class="copy">
  <div class="mark">
    <svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><path d="${LINE}" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    chessvault
  </div>
  <h1>Your chess,<br><span>in plain files.</span></h1>
  <p class="tagline">A self-hosted chess workbench. PGN, markdown and JSON, in one folder you own.</p>
  <div class="chips">
    <span class="chip">${engine}</span><span class="chip">Opening explorer</span><span class="chip">Studies &amp; notes</span><span class="chip">Book puzzles</span><span class="chip">Offline-first</span>
  </div>
</div>
<div class="shot"><img src="data:image/png;base64,${board}" alt=""></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark' });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();
writeFileSync(OUT, png);
console.log(`${OUT}  ${W}x${H}  ${png.length} bytes  (${engine})`);
