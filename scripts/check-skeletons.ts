/**
 * A placeholder is a second drawing of its page, and second drawings
 * drift. This holds every route's three states to each other:
 *
 *   O against D — the outline the route draws while its chunk is on the
 *     wire, and the page's own wait once it has mounted. The app's rule
 *     is one picture over both waits, so nothing drawn in both may move.
 *   D against L — the wait, and the page that replaces it. Whatever the
 *     placeholder draws that the page also draws has to be where the
 *     page puts it.
 *
 *   npm run build:demo
 *   npm run check:skeletons
 *   ROUTES='#/settings,#/notes' narrows a run (Git Bash: MSYS_NO_PATHCONV=1).
 *   REPORT=.shots/placeholders/report.json reads a finished
 *   `shots:placeholders` run instead of driving the browser again, which
 *   is the quick way to look at the pictures of whatever this names.
 *
 * WHY. The audit this replaces was run by hand six times and found drift
 * on five of them, each time weeks after the edit that caused it: a row
 * that gained a touch floor its placeholder did not, a header that gained
 * a subtitle line. The page and its outline are edited by different
 * commits, for different reasons, and nothing failed when they parted.
 *
 * WHAT MOVED MEANS. Landmarks are read the way the audit read them (tag,
 * role, slot, name), and only those whose key is unique in BOTH states
 * are compared, because a repeated key pairs by ordinal and the ordinals
 * are not the same elements once the rows arrive. A landmark has moved on
 * an axis when its start, its centre and its end have ALL gone further
 * than the tolerance: the whole box translated, which is what a layout
 * shift is. A box that keeps an edge or its centre has only resized in
 * place (a title whose actions arrived beside it, a line that re-wrapped
 * inside a reserved block), and anything it pushed is a landmark of its
 * own and is caught as one.
 *
 * It also fails when no route at all drew a placeholder bar in its data
 * wait, which is what a harness that holds nothing looks like: the script
 * this grew out of photographed the loaded page as D for its whole life
 * (scripts/lib/placeholders.ts says how), and a check built on that would
 * have compared the page with itself and reported no drift.
 *
 * KNOWN, below, is for a difference that is understood: one that is
 * meant, or one that is OWED and says so, which keeps a found drift in
 * front of whoever reads the file without holding every other change
 * hostage to it. Every entry says why, and an entry that no longer
 * matches anything fails the run, so the list cannot outlive its reasons
 * and a fix has to take its entry out.
 *
 * A tripwire, not a proof. It reads the demo's vault, warm, in English,
 * at two widths: a drift that needs Korean's line breaks, a cold device
 * or a vault of books is still found by looking. And it cannot see a
 * route the demo cannot load (Insights' report, the endgame tablebase),
 * which is why those pages share their words and frames with their
 * outlines instead (insights/copy.ts).
 *
 * The static half runs first and needs no browser: every lazy route in
 * web/src/shell/routes.ts names an outline that exists, every
 * `*.skeleton.tsx` is some route's outline or is imported by something,
 * and every section the router can draw is a route this check visits.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { REPO_ROOT } from '../server/paths.ts';
import { ROUTES, WIDTHS, readPlaceholders, shotName, type Report, type Shot, type Landmark } from './lib/placeholders.ts';

const TOLERANCE = 1;
const PORT = Number(process.env.SHOT_PORT ?? 8138);
const ONLY = process.env.ROUTES?.split(',').map((r) => r.trim()).filter(Boolean);

/**
 * Differences that are understood. `shot` is a route's file name without
 * the width (`puzzles-hub`), or with it to pin one width; `key` is the
 * start of the landmark's key.
 */
const KNOWN: { shot: string; pair: 'O~D' | 'D~L'; key: string; why: string }[] = [
  // Meant.
  {
    shot: 'books-b5a3e1c07f2d49b8c',
    pair: 'D~L',
    key: 'button|',
    why: 'the reader centres its toolbar, and the page count in the middle of it is a fact about the PDF: "1" while it opens, "12" after, so each half steps 8px outward. Nothing below it moves.',
  },
  {
    shot: 'books-b5a3e1c07f2d49b8c',
    pair: 'D~L',
    key: 'input|',
    why: 'the same toolbar: the page field itself, on a desktop.',
  },
];

const SRC = resolve(REPO_ROOT, 'web/src');
const problems: string[] = [];

/* ------------------------------------------------------------ static */

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function checkStatic(): void {
  const routesFile = readFileSync(join(SRC, 'shell/routes.ts'), 'utf8');
  // One lazyRoute's text runs to the next one, which is far enough to
  // hold its options and never reaches another route's outline.
  const lazy = [...routesFile.matchAll(/lazyRoute\(\s*\(\)\s*=>\s*import\('@\/([^']+)'\)(?:(?!lazyRoute\()[\s\S])*/g)];
  const outlines = new Set<string>();
  for (const m of lazy) {
    const outline = /outline:\s*\(\)\s*=>\s*import\('@\/([^']+)'\)/.exec(m[0])?.[1];
    if (!outline) {
      problems.push(`routes.ts: ${m[1]} is a lazy route with no outline`);
      continue;
    }
    outlines.add(outline);
    if (!existsSync(join(SRC, `${outline}.tsx`))) problems.push(`routes.ts: outline ${outline}.tsx does not exist`);
    if (outline !== `${m[1]}.skeleton`)
      problems.push(`routes.ts: ${m[1]} draws ${outline}, not the outline beside it (${m[1]}.skeleton)`);
  }
  if (lazy.length === 0) problems.push('routes.ts: no lazyRoute was recognised, so this check is reading nothing');

  const files = walk(SRC);
  const sources = files.map((f) => readFileSync(f, 'utf8'));
  for (const f of files.filter((p) => p.endsWith('.skeleton.tsx'))) {
    const id = relative(SRC, f).replace(/\\/g, '/').replace(/\.tsx$/, '');
    if (outlines.has(id)) continue;
    const base = id.split('/').pop()!;
    const imported = sources.some((s, i) => files[i] !== f && s.includes(`/${base}'`));
    if (!imported) problems.push(`${id}.tsx is no route's outline and nothing imports it`);
  }

  // Every section the router can draw lazily is one this check visits.
  const sections = [...routesFile.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]!);
  for (const s of sections)
    if (!ROUTES.some((r) => r === `#/${s}` || r.startsWith(`#/${s}/`)))
      problems.push(`the router draws #/${s} and scripts/lib/placeholders.ts ROUTES does not visit it`);
}

/* ----------------------------------------------------------- dynamic */

const unique = (shot: Shot): Map<string, Landmark> => {
  const count = new Map<string, number>();
  const base = (r: Landmark): string => r.key.replace(/#\d+$/, '');
  for (const r of shot.rows) count.set(base(r), (count.get(base(r)) ?? 0) + 1);
  return new Map(shot.rows.filter((r) => count.get(base(r)) === 1).map((r) => [base(r), r]));
};

/** How far a box translated on one axis: the least its start, centre and end moved. */
const shift = (a0: number, aLen: number, b0: number, bLen: number): number => {
  const d = [b0 - a0, b0 + bLen / 2 - (a0 + aLen / 2), b0 + bLen - (a0 + aLen)];
  return d.reduce((least, v) => (Math.abs(v) < Math.abs(least) ? v : least));
};

interface Move {
  key: string;
  dx: number;
  dy: number;
  from: Landmark;
}

function compare(a: Shot, b: Shot): { shared: number; moved: Move[] } {
  const A = unique(a);
  const B = unique(b);
  const moved: Move[] = [];
  let shared = 0;
  for (const [key, ra] of A) {
    const rb = B.get(key);
    if (!rb) continue;
    shared++;
    const dx = shift(ra.x, ra.w, rb.x, rb.w);
    const dy = shift(ra.y, ra.h, rb.y, rb.h);
    if (Math.abs(dx) > TOLERANCE || Math.abs(dy) > TOLERANCE) moved.push({ key, dx, dy, from: ra });
  }
  return { shared, moved };
}

function checkReport(report: Report, names: string[]): void {
  const used = new Set<number>();
  for (const name of names) {
    const shot = report[name];
    if (!shot) {
      problems.push(`${name}: the route could not be read`);
      continue;
    }
    const od = compare(shot.O, shot.D);
    const dl = compare(shot.D, shot.L);
    if (od.shared === 0) problems.push(`${name}: the outline and the page's wait share no landmark, so nothing was compared`);
    for (const [pair, result] of [['O~D', od], ['D~L', dl]] as const) {
      for (const m of result.moved) {
        const k = KNOWN.findIndex((e) => (e.shot === name || name.startsWith(`${e.shot}--`)) && e.pair === pair && m.key.startsWith(e.key));
        if (k >= 0) {
          used.add(k);
          continue;
        }
        const by = [m.dx && `${m.dx > 0 ? '+' : ''}${Math.round(m.dx)}px across`, m.dy && `${m.dy > 0 ? '+' : ''}${Math.round(m.dy)}px down`]
          .filter(Boolean)
          .join(', ');
        problems.push(`${name} ${pair}: ${m.key} at ${m.from.x},${m.from.y} (${m.from.w}x${m.from.h}) moved ${by}`);
      }
    }
  }
  // Some routes wait on nothing the demo serves and draw no bar in either
  // wait, so one route without bars says nothing. None at all does.
  if (!ONLY && names.every((n) => (report[n]?.D.bars ?? 0) === 0))
    problems.push('no route drew a placeholder bar in its data wait: the API hold is not holding, and D is L everywhere');
  if (!ONLY)
    KNOWN.forEach((e, i) => {
      if (!used.has(i)) problems.push(`KNOWN: "${e.shot} ${e.pair} ${e.key}" matched nothing; it is fixed or renamed, so remove the entry`);
    });
}

checkStatic();
const routes = ONLY ?? ROUTES;
const names = WIDTHS.flatMap((w) => routes.map((r) => shotName(r, w.width)));
const report: Report = process.env.REPORT
  ? (JSON.parse(readFileSync(resolve(REPO_ROOT, process.env.REPORT), 'utf8')) as Report)
  : await readPlaceholders({ port: PORT, routes, lanes: Number(process.env.LANES ?? 4) });
checkReport(report, names);

if (problems.length > 0) {
  console.error(`check:skeletons: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nSee the three states side by side: npm run shots:placeholders');
  process.exit(1);
}
const owed = KNOWN.filter((e) => e.why.startsWith('OWED'));
console.log(
  `check:skeletons: ${names.length} route pictures, nothing drawn in two states moved` +
    (owed.length > 0 ? ` (${owed.length} known drifts still owed, listed in KNOWN)` : ''),
);
