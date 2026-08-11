/**
 * Curate small puzzle and reference-game databases for the static demo.
 *
 * The real ones are 2.6 GB and 168 MB; neither can be a static asset. These
 * carry the SAME schema and the same derived count tables, so the demo runs
 * the real `server/puzzles.ts` queries unchanged against a smaller table —
 * a demo that reimplemented the queries would drift from the app, and one
 * that shipped a different schema would drift the moment a query changed.
 *
 *   npx tsx scripts/build-demo-dbs.ts [--puzzles N] [--games N]
 *
 * Sampling is spread rather than random: every rating band and every theme
 * the dashboard can filter by has to have puzzles in it, or the demo shows
 * empty states that the real app would never show.
 */
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DATA, DATA_PUZZLES, REPO_ROOT } from '../server/paths.ts';

const arg = (flag: string, fallback: number): number => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? fallback : Number(process.argv[at + 1]);
};

const PUZZLE_TARGET = arg('--puzzles', 4000);
const GAME_TARGET = arg('--games', 3000);
const OUT_DIR = resolve(REPO_ROOT, 'web/public/demo');
mkdirSync(OUT_DIR, { recursive: true });

// --- puzzles ------------------------------------------------------------------

const puzzlesOut = resolve(OUT_DIR, 'puzzles.sqlite');
rmSync(puzzlesOut, { force: true });

if (!existsSync(DATA_PUZZLES)) {
  console.error(`no puzzle database at ${DATA_PUZZLES} — run npm run build:puzzles first`);
  process.exit(1);
}

const source = new Database(DATA_PUZZLES, { readonly: true });
const out = new Database(puzzlesOut);
out.exec(`
  CREATE TABLE puzzles (
    id TEXT PRIMARY KEY, fen TEXT NOT NULL, moves TEXT NOT NULL,
    rating INTEGER NOT NULL, rd INTEGER NOT NULL, popularity INTEGER NOT NULL,
    plays INTEGER NOT NULL, themes TEXT NOT NULL, game_url TEXT, opening_tags TEXT
  );
  CREATE TABLE themes (theme TEXT NOT NULL, rating INTEGER NOT NULL, id TEXT NOT NULL);
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

/** The bands the trainer offers, so each one has something to serve. */
const BANDS = [
  { min: 0, max: 1399 },
  { min: 1400, max: 1799 },
  { min: 1800, max: 2199 },
  { min: 2200, max: 9999 },
];

const chosen = new Map<string, Record<string, unknown>>();
const perBand = Math.floor(PUZZLE_TARGET / (BANDS.length + 1));

// Popularity first: a demo should show puzzles people actually liked.
const byBand = source.prepare(
  `SELECT * FROM puzzles WHERE rating BETWEEN ? AND ? ORDER BY popularity DESC, plays DESC LIMIT ?`,
);
for (const band of BANDS) {
  for (const row of byBand.all(band.min, band.max, perBand) as Record<string, unknown>[]) {
    chosen.set(row.id as string, row);
  }
}

// Then top up per theme, so the themes page is not a wall of empty rows.
const themes = (
  source.prepare('SELECT theme FROM theme_counts ORDER BY count DESC LIMIT 60').all() as {
    theme: string;
  }[]
).map((r) => r.theme);
const byTheme = source.prepare(
  `SELECT * FROM puzzles WHERE themes LIKE ? ORDER BY popularity DESC LIMIT ?`,
);
const perTheme = Math.max(8, Math.floor(perBand / Math.max(1, themes.length)) * 2);
for (const theme of themes) {
  for (const row of byTheme.all(`%${theme}%`, perTheme) as Record<string, unknown>[]) {
    chosen.set(row.id as string, row);
  }
}

const insert = out.prepare(
  `INSERT OR IGNORE INTO puzzles (id, fen, moves, rating, rd, popularity, plays, themes, game_url, opening_tags)
   VALUES (@id, @fen, @moves, @rating, @rd, @popularity, @plays, @themes, @game_url, @opening_tags)`,
);
const insertTheme = out.prepare('INSERT INTO themes (theme, rating, id) VALUES (?, ?, ?)');
out.transaction(() => {
  for (const row of chosen.values()) {
    insert.run(row);
    for (const theme of String(row.themes).split(/\s+/).filter(Boolean)) {
      insertTheme.run(theme, row.rating, row.id);
    }
  }
})();

// The derived tables the dashboard and the picker read. Built here rather
// than left to tune-dbs.ts, because a static asset has nobody to tune it.
out.exec(`
  CREATE INDEX idx_puzzles_rating ON puzzles (rating);
  CREATE INDEX idx_themes ON themes (theme, rating);
  CREATE TABLE theme_counts AS SELECT theme, COUNT(*) AS count FROM themes GROUP BY theme;
  CREATE TABLE rating_counts AS SELECT rating, COUNT(*) AS n FROM puzzles GROUP BY rating;
  CREATE TABLE theme_rating_counts AS
    SELECT theme, rating, COUNT(*) AS n FROM themes GROUP BY theme, rating;
`);
const putMeta = out.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
putMeta.run('source', 'Lichess puzzle database (CC0) — curated subset for the demo');
// The dashboard reads its headline count from here, not from COUNT(*).
putMeta.run(
  'puzzles',
  String((out.prepare('SELECT COUNT(*) n FROM puzzles').get() as { n: number }).n),
);
out.exec('VACUUM');
const puzzleCount = (out.prepare('SELECT COUNT(*) n FROM puzzles').get() as { n: number }).n;
out.close();
source.close();

// --- reference games ----------------------------------------------------------

const gamesSource = resolve(DATA, 'refgames.sqlite');
const gamesOut = resolve(OUT_DIR, 'refgames.sqlite');
rmSync(gamesOut, { force: true });
let gameCount = 0;

if (existsSync(gamesSource)) {
  const from = new Database(gamesSource, { readonly: true });
  const to = new Database(gamesOut);
  to.exec(`
    CREATE TABLE games (
      id INTEGER PRIMARY KEY, white TEXT NOT NULL COLLATE NOCASE,
      black TEXT NOT NULL COLLATE NOCASE, white_elo INTEGER NOT NULL,
      black_elo INTEGER NOT NULL, result TEXT NOT NULL, date TEXT,
      event TEXT, eco TEXT, opening TEXT, moves TEXT NOT NULL
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // Spread across ECO codes, strongest first WITHIN each opening.
  //
  // Sorting the whole table by combined rating was the obvious thing and it
  // was wrong: this database is the Lichess Elite set, where the very top
  // ratings belong to engines, so the "elite games" browser filled up with
  // bot-versus-bot blitz. Sampling per ECO gives the opening and ECO search
  // something to find across 492 codes, which is what the browser is for.
  const rows = from
    .prepare(
      `SELECT * FROM (
         SELECT *, ROW_NUMBER() OVER (
           PARTITION BY eco ORDER BY (white_elo + black_elo) DESC
         ) AS rank FROM games WHERE eco IS NOT NULL AND eco <> ''
       ) WHERE rank <= ? LIMIT ?`,
    )
    .all(Math.max(1, Math.ceil(GAME_TARGET / 492)), GAME_TARGET) as Record<string, unknown>[];
  const put = to.prepare(
    `INSERT INTO games (id, white, black, white_elo, black_elo, result, date, event, eco, opening, moves)
     VALUES (@id, @white, @black, @white_elo, @black_elo, @result, @date, @event, @eco, @opening, @moves)`,
  );
  to.transaction(() => {
    for (const row of rows) put.run(row);
  })();
  to.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    'games',
    String(rows.length),
  );
  to.exec('CREATE INDEX idx_games_players ON games (white, black, opening, eco); VACUUM');
  gameCount = rows.length;
  to.close();
  from.close();
} else {
  console.warn(`no reference games at ${gamesSource} — the demo will show its empty state`);
}

const size = (path: string): string =>
  existsSync(path) ? `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB` : '—';
console.log(`demo puzzles: ${puzzleCount} -> ${puzzlesOut} (${size(puzzlesOut)})`);
console.log(`demo games:   ${gameCount} -> ${gamesOut} (${size(gamesOut)})`);
