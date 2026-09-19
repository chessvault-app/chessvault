/**
 * Three pictures of every route, in the order a reader meets them:
 *
 *   O — the OUTLINE, what the route draws while its own chunk is on the
 *       wire (lib/lazyRoute, `outline`);
 *   D — the DATA wait, the page mounted with its answers still out;
 *   L — the LOADED page.
 *
 * Plus the landmark rects of each, written to `report.json`, so "the
 * first card moved 56px" is a number rather than a squint.
 *
 *   npm run build:demo
 *   npm run shots:placeholders                      # .shots/placeholders
 *   OUT=.shots/before npm run shots:placeholders    # somewhere else
 *   ROUTES='#/settings,#/notes' narrows a run (Git Bash: MSYS_NO_PATHCONV=1,
 *   or the '#/' is rewritten as a path and the route never matches).
 *
 * WHY. `shots:grid` photographs SETTLED pages, so it proves a change
 * moved nothing — and it cannot see either wait, because on the demo
 * every chunk is local and every answer is in the page. Those two are
 * the surfaces no other harness can look at, which is how the app went
 * so long with one shape guessed for fifteen routes and with five that
 * drew nothing at all.
 *
 * It took all three to be useful. Holding the chunk alone shows the
 * outline and says nothing about whether the page's own wait agrees with
 * it; and "one skeleton per page" is exactly the claim that O and D are
 * the same picture. Read the run that way: O against D is the app's
 * rule, and D against L is whether the placeholder is the page's shape.
 *
 * NOT a pixel diff, and it should not become one. Two runs of this differ
 * only where the app does, and the useful comparison is a reading: does
 * the board, the first card, the first row land at the same y? The
 * outline is grey where the page has words, so a subtraction of the two
 * is 100% different and says nothing.
 *
 * WARM, not cold. Each route is visited and settled once before it is
 * photographed, because that first visit is what writes the page's
 * reservations — the shelf's card count, the themes histogram, a book's
 * page shape. A cold pass photographs the floors and says nothing about
 * whether a remembered shape is drawn.
 *
 * How the waits are held, and the routes and widths, are in
 * scripts/lib/placeholders.ts, which `check:skeletons` reads too.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';
import { ROUTES, WIDTHS, readPlaceholders } from './lib/placeholders.ts';

const OUT = resolve(REPO_ROOT, process.env.OUT ?? '.shots/placeholders');
const PORT = Number(process.env.SHOT_PORT ?? 8136);
/** `ROUTES=#/settings,#/notes` narrows a run while iterating. */
const ONLY = process.env.ROUTES?.split(',').map((r) => r.trim()).filter(Boolean);

await mkdir(OUT, { recursive: true });
const routes = ONLY ?? ROUTES;
const report = await readPlaceholders({
  port: PORT,
  routes,
  lanes: Number(process.env.LANES ?? 4),
  picture: async (name, state, page) => {
    await page.screenshot({ path: join(OUT, `${name}--${state}.png`) });
  },
  log: (line) => console.log(line),
});
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`placeholders: ${routes.length * WIDTHS.length * 3} pictures in ${OUT}`);
