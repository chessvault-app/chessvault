/**
 * Text contrast, measured on the rendered page rather than on the tokens.
 *
 *   npm run build:demo && npm run check:contrast
 *   BASE=http://localhost:8787 npm run check:contrast   (any running app)
 *
 * WHY THIS IS NOT IN check-repo.ts. That file greps source, and every
 * contrast defect this app has actually had was invisible to a grep. The
 * ratio depends on what the text is painted ON, and the backgrounds that
 * fail are the composed ones: a 10% wash of a colour over a card, a row
 * that fills with --accent under the pointer, a chip carrying its own
 * tint over both. None of that exists until a browser has composited it.
 * Four were found by hand in one afternoon — the wipe-vault button at
 * 3.97, the ECO chip at 4.11, the opening name at 4.13, and the whole
 * semantic palette under High contrast — and three of the four were only
 * visible in a state or a scheme nobody was looking at.
 *
 * THE DEMO IS THE TARGET, for the reason capture-screenshots.mjs gives:
 * it is the only vault that is the same for everyone, so a failure here
 * is a failure on your machine too, and it answers /api in the page so
 * nothing needs a server.
 *
 * WHAT IT CANNOT SEE. Text over a background IMAGE or gradient is
 * skipped, not guessed at — the board is drawn that way, and so are the
 * piece sets. Anything `aria-hidden` is skipped because it is not text to
 * a reader. And it only knows the states it is told to force, below.
 */
import { chromium, type Page } from 'playwright';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';

const DEMO = resolve(REPO_ROOT, 'dist-demo');
const PORT = Number(process.env.CONTRAST_PORT ?? 8131);
/** The landing pages get their own, so both servers can be up at once. */
const STATIC_PORT = PORT + 1;

/** Routes worth walking: every section that renders a list, a form or a panel. */
const ROUTES = [
  '#/home',
  '#/games',
  '#/puzzles',
  '#/puzzles/dashboard',
  '#/studies',
  '#/notes',
  '#/databases',
  '#/settings',
  '#/openingmap',
  '#/books',
  '#/board',
];

/**
 * The schemes to walk, as the app's own persisted preference.
 *
 * Set before the app boots rather than by toggling `.dark` afterwards:
 * the theme store re-asserts that class on hydration, so a test that
 * strips it races the app and silently measures a mix of both themes.
 */
const THEMES = [
  { name: 'light', prefs: { preference: 'light' } },
  { name: 'dark', prefs: { preference: 'dark' } },
  // High contrast is a scheme, not a theme, and it moves every surface —
  // which is exactly the case that was broken. Walked in dark, where its
  // ladder is furthest from the default.
  { name: 'dark + high contrast', prefs: { preference: 'dark' }, scheme: 'high-contrast' },
];

interface Finding {
  route: string;
  theme: string;
  state: string;
  text: string;
  ratio: number;
  needs: number;
  color: string;
  fontPx: number;
}

// ---------------------------------------------------------------------------
// The static server. The demo is a folder of files; nothing here needs an API.
// ---------------------------------------------------------------------------
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
};

function serve(root: string, port = PORT): Promise<Server> {
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

// ---------------------------------------------------------------------------
// The measurement, as it runs inside the page.
// ---------------------------------------------------------------------------

/**
 * Composite every background down to the page and score the text on it.
 *
 * The alpha of a colour is recovered by painting it over black and over
 * white on a canvas and comparing: a translucent fill differs between the
 * two by exactly the light it lets through. Treating a translucent
 * background as opaque is the mistake that makes this kind of check
 * useless — it reports white text on a 4% white wash as white-on-white,
 * and invents two hundred failures a page.
 */
const SCAN = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 4;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const paint = (css, under) => {
    ctx.clearRect(0,0,4,4); ctx.fillStyle = under; ctx.fillRect(0,0,4,4);
    ctx.fillStyle = css; ctx.fillRect(0,0,4,4);
    const d = ctx.getImageData(2,2,1,1).data; return [d[0], d[1], d[2]];
  };
  const layer = (css) => {
    const b = paint(css, '#000'), w = paint(css, '#fff');
    return { a: Math.max(0, Math.min(1, 1 - (w[0] - b[0]) / 255)), pre: b };
  };
  const over = (top, bottom) => top.pre.map((c, i) => c + bottom[i] * (1 - top.a));
  const rel = (c) => {
    const [r,g,b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055) ** 2.4; });
    return 0.2126*r + 0.7152*g + 0.0722*b;
  };
  const ratio = (a, b) => { const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };

  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none') return null;
      const l = layer(s.backgroundColor);
      if (l.a > 0.001) stack.push(l);
      if (l.a > 0.999) break;
    }
    let acc = layer(getComputedStyle(document.body).backgroundColor).pre;
    for (const l of stack.reverse()) acc = over(l, acc);
    return acc;
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.closest('.cg-wrap')) continue;          // the board: gradients and piece art
    if (el.closest('[aria-hidden="true"]')) continue;  // not text to a reader
    const text = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(' ');
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || !el.getClientRects().length) continue;
    if (Number(cs.opacity) < 0.1) continue;
    const bg = bgOf(el);
    if (!bg) continue;
    const fg = over(layer(cs.color), bg);
    const px = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const needs = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
    const r = ratio(rel(fg), rel(bg));
    if (r < needs) out.push({ text: text.slice(0, 40), ratio: +r.toFixed(2), needs, color: cs.color, fontPx: px });
  }
  return out;
})()`;

/**
 * Turn every hover and active rule on at once.
 *
 * Not just the backgrounds: the app's usual pattern is
 * `text-muted-foreground hover:bg-accent hover:text-foreground`, so
 * forcing the fill alone would invent a state that never occurs and
 * report a failure nobody can see. Stripping the pseudo-class from the
 * whole rule reproduces each element's real hover appearance.
 *
 * Note the traversal: in Chrome every CSSStyleRule carries an empty
 * `cssRules` for nesting, so a naive `if (r.cssRules) recurse` never
 * reaches a single style rule and this quietly forces nothing.
 */
const FORCE_STATES = `(() => {
  const decls = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const r of list) {
        if (r.selectorText) {
          if (/:hover|:active|:focus-visible/.test(r.selectorText)) {
            const sel = r.selectorText
              .replaceAll(':hover', '').replaceAll(':active', '').replaceAll(':focus-visible', '');
            const body = r.cssText.slice(r.cssText.indexOf('{') + 1, r.cssText.lastIndexOf('}'));
            if (sel.trim() && body.trim()) decls.push(sel + '{' + body + '}');
          }
        } else if (r.cssRules) { walk(r.cssRules); continue; }
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    walk(rules);
  }
  const el = document.createElement('style');
  el.id = 'contrast-forced-states';
  el.textContent = decls.join('\\n');
  document.head.appendChild(el);
  return decls.length;
})()`;

const UNFORCE = `document.getElementById('contrast-forced-states')?.remove()`;

/**
 * The two static pages, walked separately from the app.
 *
 * WHY THEY ARE HERE. This file existed and still missed a live defect:
 * both landing pages hand-copy the app's tokens, index.html took the
 * registry's --muted-foreground (55.6%) where the app uses 48%, and four
 * text tiers shipped at 4.35:1 — the vault listing's whole caption layer
 * on one page, the figcaptions on the other. Nothing here looked at
 * either file, because ROUTES above is the app and only the app. A
 * checker with a blind spot the size of the site's front door is a
 * checker that certifies the wrong thing.
 *
 * They need their own walk for three reasons the app's loop cannot cover:
 * the scheme comes from prefers-color-scheme rather than a persisted
 * preference, so it is emulated; docs.html is twenty-three sections of
 * which one is visible, so each has to be brought forward in turn; and
 * neither page is in dist-demo — they are served from source, where the
 * inline stylesheet that decides every colour already is.
 */
const STATIC_ROOT = resolve(REPO_ROOT, 'web/landing');
const STATIC_SCHEMES = ['light', 'dark'] as const;

async function walkStatic(page: Page, base: string, scheme: 'light' | 'dark'): Promise<Finding[]> {
  const found: Finding[] = [];
  const scan = async (route: string) => {
    for (const state of ['rest', 'hover + focus'] as const) {
      if (state !== 'rest') await page.evaluate(FORCE_STATES);
      await page.waitForTimeout(80);
      const hits = (await page.evaluate(SCAN)) as Omit<Finding, 'route' | 'theme' | 'state'>[];
      if (state !== 'rest') await page.evaluate(UNFORCE);
      for (const h of hits) found.push({ ...h, route, theme: scheme, state });
    }
  };

  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  await scan('index.html');

  await page.goto(`${base}/docs.html`, { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const ids: string[] = await page.evaluate(
    `[...document.querySelectorAll('section.page')].map((s) => s.id)`,
  );
  for (const id of ids) {
    // Bring one page forward exactly as the nav does. Every page shares
    // the shell, so a scan of only the open one measures 1 of 23.
    await page.evaluate(`(() => {
      const all = [...document.querySelectorAll('section.page')];
      all.forEach((s) => s.classList.remove('is-active'));
      document.getElementById(${JSON.stringify(id)}).classList.add('is-active');
    })()`);
    await page.waitForTimeout(50);
    await scan(`docs.html#${id}`);
  }
  return found;
}

async function walk(page: Page, base: string, theme: (typeof THEMES)[number]): Promise<Finding[]> {
  const found: Finding[] = [];
  for (const route of ROUTES) {
    await page.goto(`${base}/${route}`, { waitUntil: 'networkidle' });
    // Routes are lazy chunks and most fetch before they have anything to
    // show; a scan that arrives early measures an empty page and passes.
    await page.waitForTimeout(1200);

    for (const state of ['rest', 'hover + focus'] as const) {
      if (state !== 'rest') await page.evaluate(FORCE_STATES);
      await page.waitForTimeout(150);
      const hits = (await page.evaluate(SCAN)) as Omit<Finding, 'route' | 'theme' | 'state'>[];
      if (state !== 'rest') await page.evaluate(UNFORCE);
      for (const h of hits) found.push({ ...h, route, theme: theme.name, state });
    }
  }
  return found;
}

const base = process.env.BASE ?? `http://localhost:${PORT}`;
let server: Server | null = null;

if (!process.env.BASE) {
  if (!existsSync(join(DEMO, 'index.html'))) {
    console.error(
      `no demo build at ${DEMO}\n` +
        'Run `npm run build:demo` first, or point this at a running app:\n' +
        '  BASE=http://localhost:8787 npm run check:contrast',
    );
    process.exit(2);
  }
  server = await serve(DEMO);
}

const browser = await chromium.launch();
const findings: Finding[] = [];
try {
  for (const theme of THEMES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // The preference goes in before the app's first line runs, so the
    // first paint is already the scheme being measured.
    await context.addInitScript(
      ([prefs, schemeId]) => {
        localStorage.setItem('chess-vault:theme', JSON.stringify({ state: prefs, version: 0 }));
        // schemeId, not the scheme itself: the store re-reads the preset
        // from the list on rehydrate, because the list is what a preset
        // MEANS and it has changed before.
        if (schemeId) {
          localStorage.setItem('chess-vault:prefs', JSON.stringify({ state: { schemeId }, version: 0 }));
        }
      },
      [theme.prefs, theme.scheme ?? null] as const,
    );
    const page = await context.newPage();
    findings.push(...(await walk(page, base, theme)));
    await context.close();
  }

  // The two static pages, from source, on their own port. Skipped when
  // BASE points somewhere else, because then the app under test is not
  // necessarily this checkout and these files might not match it.
  if (!process.env.BASE) {
    const staticServer = await serve(STATIC_ROOT, STATIC_PORT);
    try {
      for (const scheme of STATIC_SCHEMES) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          colorScheme: scheme,
        });
        const page = await context.newPage();
        findings.push(...(await walkStatic(page, `http://localhost:${STATIC_PORT}`, scheme)));
        await context.close();
      }
    } finally {
      staticServer.close();
    }
  }
} finally {
  await browser.close();
  server?.close();
}

// ---------------------------------------------------------------------------
// The report. One line per failure, worst first.
// ---------------------------------------------------------------------------
if (!findings.length) {
  console.log(
    `contrast: nothing below the floor — ${ROUTES.length} app routes x ${THEMES.length} schemes, plus index.html and every docs.html page in light and dark, at rest and with hover/focus forced`,
  );
  process.exit(0);
}

/**
 * One line per DEFECT, not per sighting.
 *
 * A element in the app shell fails on every route it appears under, and
 * a report that prints it eleven times buries the one that appears once
 * — which is exactly what happened the first time this ran: two defects,
 * twenty-three lines, and the interesting one was off the top of the
 * screen.
 */
const groups = new Map<string, { worst: Finding; where: Set<string> }>();
for (const f of findings) {
  const key = `${f.color}|${f.fontPx}|${f.text}`;
  const g = groups.get(key);
  if (!g) groups.set(key, { worst: f, where: new Set([`${f.route} (${f.theme}, ${f.state})`]) });
  else {
    g.where.add(`${f.route} (${f.theme}, ${f.state})`);
    if (f.ratio < g.worst.ratio) g.worst = f;
  }
}

const ordered = [...groups.values()].sort((a, b) => a.worst.ratio - b.worst.ratio);
for (const { worst, where } of ordered) {
  const seen = [...where];
  const shown = seen.slice(0, 3).join(', ');
  console.error(
    `${worst.ratio.toFixed(2)}:1 (needs ${worst.needs})  ${worst.fontPx}px  ${worst.color}\n` +
      `    "${worst.text}"\n` +
      `    ${shown}${seen.length > 3 ? ` and ${seen.length - 3} more` : ''}`,
  );
}
console.error(
  `\ncontrast: ${ordered.length} below the floor in ${findings.length} place(s) — ` +
    'see docs/design-principles.md, "The color grammar"',
);
process.exit(1);
