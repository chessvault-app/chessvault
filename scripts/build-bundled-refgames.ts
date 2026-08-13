/**
 * Curate a small reference-games database out of a big one.
 *
 * The full build (`build:refgames`) keeps every game its sources hold —
 * ~200 MB for one Lichess Elite month — which is right for a database you
 * build for yourself and far too heavy to ship inside an installer. This
 * walks the same file and keeps the strongest games of EVERY opening, so
 * the elite browser a fresh install gets answers player searches, opening
 * searches and ECO prefixes across the whole tree rather than deeply in
 * one corner of it.
 *
 * Strongest WITHIN each ECO code, not strongest overall. Sorting the whole
 * table by combined rating was tried for the demo subset and was wrong:
 * in the Lichess Elite set the very top ratings belong to engines, and the
 * browser filled up with bot-versus-bot blitz. Spreading per ECO is what
 * gives the opening and ECO search something to find everywhere — the same
 * lesson `build-demo-dbs.ts` records, at demo scale.
 *
 *   npx tsx scripts/build-bundled-refgames.ts [--games 50000]
 *                                             [--from data/refgames.sqlite]
 *                                             [--out assets/refgames-elite.sqlite]
 *
 * The output file name MUST keep the `refgames-` prefix: that prefix is how
 * first-run seeding tells the bundled reference games apart from the
 * bundled opening book sitting in the same assets/ directory.
 */
import Database from 'better-sqlite3';
import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { DATA, REPO_ROOT } from '../server/paths.ts';
import { REFGAMES_INDEXES } from './lib/db-tuning.ts';

const argValue = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
};

const GAMES = Number(argValue('--games') ?? 50_000);
const FROM = resolve(process.cwd(), argValue('--from') ?? resolve(DATA, 'refgames.sqlite'));
const OUT = resolve(process.cwd(), argValue('--out') ?? resolve(REPO_ROOT, 'assets/refgames-elite.sqlite'));

if (!basename(OUT).startsWith('refgames-')) {
  console.error(`output must be named refgames-*.sqlite (got ${basename(OUT)}) — seeding relies on the prefix`);
  process.exit(1);
}

const started = Date.now();
const from = new Database(FROM, { readonly: true, fileMustExist: true });

mkdirSync(dirname(OUT), { recursive: true });
const tmp = `${OUT}.building`;
rmSync(tmp, { force: true });
rmSync(OUT, { force: true });
const out = new Database(tmp);

out.exec(`
  CREATE TABLE games (
    id INTEGER PRIMARY KEY,
    white TEXT NOT NULL COLLATE NOCASE,
    black TEXT NOT NULL COLLATE NOCASE,
    white_elo INTEGER NOT NULL,
    black_elo INTEGER NOT NULL,
    result TEXT NOT NULL,
    date TEXT,
    event TEXT,
    eco TEXT,
    opening TEXT,
    moves TEXT NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Games without an ECO cannot be spread by opening, so they are simply not
// candidates — in a Lichess Elite month effectively every game has one.
const codes = (
  from.prepare("SELECT COUNT(DISTINCT eco) AS n FROM games WHERE eco IS NOT NULL AND eco <> ''").get() as {
    n: number;
  }
).n;
const perEco = Math.max(1, Math.ceil(GAMES / Math.max(1, codes)));

const rows = from
  .prepare(
    `SELECT * FROM (
       SELECT *, ROW_NUMBER() OVER (
         PARTITION BY eco ORDER BY (white_elo + black_elo) DESC
       ) AS rank FROM games WHERE eco IS NOT NULL AND eco <> ''
     ) WHERE rank <= ? LIMIT ?`,
  )
  .all(perEco, GAMES) as Record<string, unknown>[];

const put = out.prepare(
  `INSERT INTO games (id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves)
   VALUES (@id, @white, @black, @white_elo, @black_elo, @result, @date, @event, @eco, @opening, @moves)`,
);
out.transaction(() => {
  for (const row of rows) put.run(row);
})();

const sourceMeta = Object.fromEntries(
  (from.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]),
);
const setMeta = out.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
setMeta.run('games', String(rows.length));
setMeta.run(
  'sources',
  `${sourceMeta.sources ?? basename(FROM)} — strongest ${perEco} games per ECO code`,
);
setMeta.run('built_at', new Date().toISOString());

out.exec(REFGAMES_INDEXES);
out.exec('VACUUM');
out.close();
from.close();

renameSync(tmp, OUT);

console.log(
  `done: ${rows.length.toLocaleString()} games across ${codes} ECO codes (${perEco}/code), ` +
    `${(statSync(OUT).size / 1e6).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(1)}s → ${OUT}`,
);
