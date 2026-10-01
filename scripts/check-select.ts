/**
 * The Select's guard against Base UI's fallback, held in a browser.
 *
 *   npm run check:select
 *
 * Base UI 1.8's Select reports a value of its own when the options it
 * renders change and the value its store holds is not among them
 * (SelectPositioner's onMapChange): the value the root was first mounted
 * with, or null. Its store lags the value prop by one commit there, so a
 * caller that changes its options and its value together had a value
 * that IS in the new list overwritten: the Databases hunt turned a Rook
 * endgame search into a Pawn endgame one. ui/select.tsx drops that
 * report, and only that one, by WHEN it arrives: inside the wrapper's own
 * commit, while the caller's value is in the list. Nothing else tells it
 * apart. Base's eventDetails are the same for the fallback and for a
 * typeahead pick on the closed trigger (reason "none", a synthetic
 * untrusted Event of type "base-ui", no trigger; measured, and printed
 * here every run in case a Base upgrade changes that).
 *
 * A guard that depends on when a dependency makes a call is turned off,
 * silently, by the upgrade that moves the call. Typecheck, lint and the
 * pixel grid would pass over that, and no unit test renders a Select
 * (they run in node, with no DOM). So this builds a small
 * page (scripts/lib/select-page.tsx) around the app's real ui/select.tsx,
 * with Vite, the app's aliases and the React Compiler the way the app
 * builds it (web/vite.compiler.ts), drives it in headless Chromium, and
 * fails unless all of these still hold:
 *
 *   - two lists swapped in one unkeyed slot, by a click and from outside
 *     any event with the trigger focused, write nothing over the
 *     caller's in-list value;
 *   - the same slot drawn with Base's bare Root DOES write its fallback
 *     there, which is what makes the quiet swap above mean the guard
 *     held rather than that the shape stopped reaching Base's path (if
 *     Base stops overwriting here, the guard may be dead code: read
 *     Base's onMapChange before removing it or this);
 *   - a click, ArrowDown with Enter, and typeahead on the closed trigger
 *     are each reported once, including a typeahead pick right after a
 *     swap;
 *   - a value that has LEFT its list still gets Base's fallback, the
 *     first-mount value, which the editor's en passant square and the
 *     puzzle list's tier filter lean on.
 *
 * A desktop width only: below 640px the wrapper opens a sheet with no
 * Base root, and there is no fallback to guard. No server and no demo
 * build: it bundles its own page in memory, and the whole run took about
 * ten seconds when it was written.
 */
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium, type Browser, type Page } from 'playwright';
import { REPO_ROOT } from '../server/paths.ts';
import { reactCompiler } from '../web/vite.compiler.ts';
import type { Report } from './lib/select-page.tsx';

const ORIGIN = 'http://select.check';
const slash = (p: string): string => p.replace(/\\/g, '/');
const ROOT = slash(REPO_ROOT);

/** The page and its chunks, in memory, by path. */
async function bundle(): Promise<Map<string, string>> {
  const result = await build({
    configFile: false,
    envDir: false,
    root: ROOT,
    publicDir: false,
    logLevel: 'warn',
    mode: 'production',
    // As web/vite.config.ts has them: the plugin-react transform, the
    // compiler over web/src (so ui/select.tsx runs compiled, as it ships),
    // the two aliases and the two build flags.
    plugins: [react(), ...reactCompiler(`${ROOT}/web/src`)],
    resolve: { alias: { '@shared': `${ROOT}/shared`, '@': `${ROOT}/web/src` } },
    define: { __DEMO__: 'false', __LAG__: 'false' },
    build: {
      write: false,
      minify: false,
      modulePreload: false,
      rolldownOptions: {
        input: `${ROOT}/scripts/lib/select-page.tsx`,
        output: { entryFileNames: 'page.js', chunkFileNames: '[name]-[hash].js' },
      },
    },
  });
  const files = new Map<string, string>();
  for (const out of Array.isArray(result) ? result : 'output' in result ? [result] : []) {
    for (const item of out.output) {
      if (item.type === 'chunk') files.set(item.fileName, item.code);
    }
  }
  if (!files.has('page.js')) throw new Error('the select page did not build');
  return files;
}

const HTML = '<!doctype html><meta charset="utf-8"><title>check:select</title><div id="root"></div><script type="module" src="/page.js"></script>';

async function open(browser: Browser, files: Map<string, string>, shape: string): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
  // Served from memory under a made-up origin: no port, no files on disk.
  await context.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (path === '') return route.fulfill({ contentType: 'text/html', body: HTML });
    const body = files.get(path);
    if (body === undefined) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ contentType: 'text/javascript', body });
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ORIGIN}/?shape=${shape}`);
  await page.waitForFunction(() => window.__select && Object.keys(window.__select.state).length > 0);
  return { page, errors };
}

/** Two frames and a beat, so a report that follows a commit has landed. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
  await page.waitForTimeout(150);
}

/** Every report since the last call. */
function take(page: Page): Promise<Report[]> {
  return page.evaluate(() => window.__select.reports.splice(0));
}

/** Waits for `n` reports (or gives up after 3s), lets any extra land, takes them. */
async function reportsAfter(page: Page, n: number): Promise<Report[]> {
  if (n > 0) {
    await page
      .waitForFunction((count) => window.__select.reports.length >= count, n, { timeout: 3000 })
      .catch(() => undefined);
  }
  await settle(page);
  return take(page);
}

const trigger = (page: Page, list: string) => page.getByRole('combobox', { name: list });
const show = (rs: Report[]): string => (rs.length ? rs.map((r) => `${r.who} = ${JSON.stringify(r.value)}`).join(', ') : 'no report');

const lines: string[] = [];
const problems: string[] = [];
let steps = 0;

/** One step's verdict: the reports it saw against the ones it wanted. */
function verdict(where: string, seen: Report[], want: [string, string | null][], face?: [string, string]): void {
  steps++;
  const got = seen.map((r) => [r.who, r.value]);
  let ok = JSON.stringify(got) === JSON.stringify(want);
  let note = show(seen);
  if (face && face[0] !== face[1]) {
    ok = false;
    note += `, the trigger reads ${JSON.stringify(face[0])}`;
  }
  if (ok) lines.push(`  ok    ${where}: ${note}`);
  else {
    const wanted = want.length ? want.map(([w, v]) => `${w} = ${JSON.stringify(v)}`).join(', ') : 'no report';
    lines.push(`  FAIL  ${where}: ${note}, expected ${wanted}${face ? ` reading ${JSON.stringify(face[1])}` : ''}`);
    problems.push(where);
  }
}

async function pickByClick(page: Page, list: string, option: string): Promise<void> {
  await trigger(page, list).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/**
 * One key on the focused, closed trigger. Base joins keys typed within
 * 750ms into one search ("f" then "b" looks for "fb"), so a typeahead
 * step waits that out first.
 */
async function typeOnClosedTrigger(page: Page, list: string, key: string): Promise<void> {
  await page.getByRole('listbox').waitFor({ state: 'hidden' }).catch(() => undefined);
  await trigger(page, list).focus();
  await page.waitForTimeout(800);
  await page.keyboard.press(key);
}

async function swapByClick(page: Page, to: string): Promise<void> {
  await page.getByRole('button', { name: 'Swap lists' }).click();
  await page.waitForFunction((kind) => window.__select.state.kind === kind, to);
}

/** The swap from outside any event (a default update), the trigger kept focused. */
async function swapFocused(page: Page, list: string, to: string): Promise<void> {
  await trigger(page, list).focus();
  await page.evaluate(() => window.__select.swap());
  await page.waitForFunction((kind) => window.__select.state.kind === kind, to);
}

/** What the closed trigger says: its text, leaving out the chevron's svg. */
const faceOf = (page: Page, list: string): Promise<string> =>
  trigger(page, list).evaluate((el) =>
    [...el.childNodes]
      .filter((n) => n.nodeName.toLowerCase() !== 'svg')
      .map((n) => n.textContent ?? '')
      .join('')
      .trim(),
  );
const detailsOf = (r: Report | undefined): string =>
  r ? `reason ${JSON.stringify(r.reason)}, event ${JSON.stringify(r.event)}${r.trusted ? ' trusted' : ' untrusted'}` : 'nothing';

async function main(): Promise<void> {
  const started = performance.now();
  const files = await bundle();
  const compiler = process.env.CHESS_COMPILER === '0' ? 'React Compiler off (CHESS_COMPILER=0)' : 'React Compiler on';
  lines.push(`built the page around ui/select.tsx (${compiler}, production React) in ${((performance.now() - started) / 1000).toFixed(1)}s`);
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    // The control: Base's bare Root in the swapped slot.
    {
      const { page, errors: e } = await open(browser, files, 'raw-swap');
      await pickByClick(page, 'List A', 'Charlie');
      await reportsAfter(page, 1);
      await swapByClick(page, 'b');
      const fallback = await reportsAfter(page, 1);
      await typeOnClosedTrigger(page, 'List B', 'f');
      const typed = await reportsAfter(page, 1);
      await swapFocused(page, 'List B', 'a');
      const back = await reportsAfter(page, 1);
      steps++;
      if (fallback.length === 0 || back.length === 0) {
        lines.push(
          `  FAIL  control, Base's bare Root in the swapped slot: ${show([...fallback, ...back])}. The shape no longer reaches ` +
            "Base's fallback, so a quiet swap below proves nothing. Read SelectPositioner's onMapChange in @base-ui/react: " +
            "if Base has stopped overwriting a value that is in the new list, the guard in ui/select.tsx (inCommit) may be dead code.",
        );
        problems.push('control');
      } else {
        lines.push(`  ok    control, Base's bare Root in the swapped slot: overwrote ${show([...fallback, ...back])}`);
      }
      // Step 1 of the guard's design, asked again every run: does anything
      // Base hands onValueChange tell its fallback from a typeahead pick?
      // Informational, never a failure.
      if (fallback[0] && typed[0]) {
        const f = detailsOf(fallback[0]);
        const t = detailsOf(typed[0]);
        lines.push(
          f === t
            ? `        Base's eventDetails, the fallback and a closed-trigger typeahead pick alike: ${f}. Only commit timing tells them apart.`
            : `        Base's eventDetails now differ: the fallback has ${f}, a closed-trigger typeahead pick ${t}. ` +
                'The guard in ui/select.tsx could read that instead of commit timing.',
        );
      }
      errors.push(...e);
      await page.context().close();
    }

    // The wrapper in the same slot.
    {
      const { page, errors: e } = await open(browser, files, 'swap');
      await pickByClick(page, 'List A', 'Charlie');
      verdict('swap, a click pick in list A', await reportsAfter(page, 1), [['A', 'Charlie']], [await faceOf(page, 'List A'), 'Charlie']);
      await swapByClick(page, 'b');
      verdict('swap, A to B by a click', await reportsAfter(page, 0), [], [await faceOf(page, 'List B'), 'Delta']);
      await typeOnClosedTrigger(page, 'List B', 'f');
      verdict('swap, typeahead on B right after the swap', await reportsAfter(page, 1), [['B', 'Foxtrot']], [await faceOf(page, 'List B'), 'Foxtrot']);
      await swapFocused(page, 'List B', 'a');
      verdict('swap, B to A outside any event, trigger focused', await reportsAfter(page, 0), [], [await faceOf(page, 'List A'), 'Charlie']);
      await typeOnClosedTrigger(page, 'List A', 'b');
      verdict('swap, typeahead on A right after the swap', await reportsAfter(page, 1), [['A', 'Bravo']], [await faceOf(page, 'List A'), 'Bravo']);
      errors.push(...e);
      await page.context().close();
    }

    // A value that leaves its list.
    {
      const { page, errors: e } = await open(browser, files, 'leaves');
      await pickByClick(page, 'List A', 'Charlie');
      verdict('leaves, a click pick', await reportsAfter(page, 1), [['A', 'Charlie']]);
      await page.getByRole('button', { name: 'Drop the last option' }).click();
      verdict(
        "leaves, Charlie dropped from the list: Base's fallback, the first-mount value",
        await reportsAfter(page, 1),
        [['A', 'Alpha']],
        [await faceOf(page, 'List A'), 'Alpha'],
      );
      errors.push(...e);
      await page.context().close();
    }

    // Every way a user picks.
    {
      const { page, errors: e } = await open(browser, files, 'picks');
      await pickByClick(page, 'List A', 'Charlie');
      verdict('picks, a click', await reportsAfter(page, 1), [['A', 'Charlie']], [await faceOf(page, 'List A'), 'Charlie']);
      await page.getByRole('listbox').waitFor({ state: 'hidden' }).catch(() => undefined);
      await trigger(page, 'List A').focus();
      await page.keyboard.press('ArrowDown');
      await page.getByRole('listbox').waitFor({ state: 'visible' });
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      verdict('picks, ArrowDown, ArrowDown, Enter', await reportsAfter(page, 1), [['A', 'Delta']], [await faceOf(page, 'List A'), 'Delta']);
      await typeOnClosedTrigger(page, 'List A', 'b');
      verdict('picks, typeahead on the closed trigger', await reportsAfter(page, 1), [['A', 'Bravo']], [await faceOf(page, 'List A'), 'Bravo']);
      errors.push(...e);
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
  for (const e of errors) {
    lines.push(`  FAIL  the page threw: ${e}`);
    problems.push('page error');
  }
  console.log(lines.join('\n'));
  console.log(`select: ${steps} steps over 4 shapes, ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  if (problems.length > 0) {
    console.log('  the guard is in web/src/components/ui/select.tsx (inCommit); this file says what each step is for');
  }
  process.exit(problems.length > 0 ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
