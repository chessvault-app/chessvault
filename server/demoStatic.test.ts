import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { DATA, DATA_PUZZLES, REPO_ROOT } from './paths.ts';
import { demoSourceRefgames } from '../scripts/lib/refgamesFiles.ts';

/**
 * Does the static demo still cover the app?
 *
 * The demo runs the app's real route modules, so a change to how a route
 * behaves reaches it for free. Two things do NOT come for free, and both
 * fail silently — a page that quietly answers "not available", or a route
 * that 500s on a column its database has never heard of. Every demo bug in
 * this repository's history has been one of those two, and only one of them
 * ever broke a build.
 *
 * So this test compares the demo against the app rather than exercising it:
 * cheap, no browser, no WASM, and it fails at `npm test` the moment the two
 * drift apart.
 */

const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf-8');

/** The `xApi(...)` modules a file mounts under /api. */
function mounted(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/app\.route\(\s*['"]\/api['"]\s*,\s*(\w+)\s*\(/g)) {
    names.add(match[1]!);
  }
  return names;
}

/**
 * Route modules the demo leaves out ON PURPOSE, each with the reason.
 *
 * A test that simply allowed any omission would pass forever and catch
 * nothing; the point is that leaving something out has to be a decision
 * somebody wrote down, not a line nobody added.
 */
const DELIBERATELY_ABSENT: Record<string, string> = {
  authApi: 'no password gate: the demo vault is a sample and lives in the tab',
  settingsApi: 'settings write a vault and secrets, neither of which exists here',
  puzzleBooksApi: 'book puzzles come from commercial PDFs and are not ours to publish',
  booksApi:
    'the library is the user\'s own PDFs, streamed to and from disk; the demo ' +
    'answers /api/books with an empty shelf (see server.ts) and nothing to upload into',
  storageApi: 'a disk inventory of a vault the demo does not have; Settings shows the demo card instead',
  lichessExplorerApi: 'proxying the explorer needs the deployment\'s Lichess token',
  tablebaseApi:
    'the tablebase needs no token and would work here, and is still left out: ' +
    'a demo page that reaches a third party the moment somebody drags the ' +
    'pieces into an ending is not a demo of this app. The explorer pane hides ' +
    'the section in the demo (web/src/explorer/tablebase.ts), so nothing asks ' +
    'for a route that is not there',
  lichessStudiesApi: 'importing a study needs that same token',
  vaultHistoryApi:
    'recovery reads vault/.history.git through git; the demo vault lives in ' +
    'the tab and the shims have no node:child_process, so there is no ' +
    'history to offer and the recovery UI shows its unavailable state',
};

describe('the static demo keeps up with the app', () => {
  it('shares one vault route list with the server', () => {
    // The list itself is server/mountVault.ts, so the routes in it cannot
    // drift. What CAN drift is a caller quietly dropping the call — then
    // every vault route disappears from the demo at once.
    expect(read('server/index.ts')).toContain('mountVault(app)');
    expect(read('web/src/demo/server.ts')).toContain('mountVault(app,');
  });

  it('mounts every route module the server does, or says why not', () => {
    // Anything mounted DIRECTLY in index.ts rather than through mountVault:
    // the auth gate, settings, the Lichess proxies. Those are the ones a
    // future route is likely to join, and the ones the demo must decide about.
    const server = mounted(read('server/index.ts'));
    const demo = mounted(read('web/src/demo/server.ts'));

    const missing = [...server].filter(
      (name) => !demo.has(name) && !(name in DELIBERATELY_ABSENT),
    );

    expect(
      missing,
      `web/src/demo/server.ts does not mount: ${missing.join(', ')}.\n` +
        'Add it there, or add it to DELIBERATELY_ABSENT with the reason. ' +
        'Left alone, the demo answers "not available" for those routes and ' +
        'the page that needs them breaks with nothing in the build to show it.',
    ).toEqual([]);
  });

  it('keeps the absent list honest — nothing listed that the server dropped', () => {
    // Matched loosely rather than through mounted(): puzzleBooksApi is
    // mounted conditionally, and the point here is only that the module
    // still exists to be excluded.
    const anywhere = read('server/index.ts');
    const stale = Object.keys(DELIBERATELY_ABSENT).filter(
      (name) => !anywhere.includes(`${name}(`),
    );
    expect(stale, `no longer in server/index.ts: ${stale.join(', ')}`).toEqual([]);
  });

  it('ships the databases and assets the demo build needs', () => {
    for (const file of [
      'web/demo-assets/puzzles.sqlite',
      'web/demo-assets/refgames.sqlite',
      'web/demo-assets/openings.json',
    ]) {
      expect(existsSync(resolve(REPO_ROOT, file)), `missing ${file}`).toBe(true);
    }
  });
});

/** Columns of every table in a database, for comparison. */
function schema(path: string): Record<string, string[]> {
  const db = new Database(path, { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    return Object.fromEntries(
      tables.map((table) => [
        table.name,
        (db.prepare(`PRAGMA table_info(${table.name})`).all() as { name: string }[])
          .map((column) => column.name)
          .sort(),
      ]),
    );
  } finally {
    db.close();
  }
}

/**
 * The curated databases must carry every column the real ones do, because
 * the demo runs the real SQL. A column added to a query is invisible until
 * the query runs — which, in a demo, means until a stranger opens the page.
 *
 * Skipped where the full databases are absent: they are gigabytes and are
 * not in the repository, so this runs for whoever is actually in a position
 * to have changed them.
 */
describe('curated databases match the real ones', () => {
  const cases = [
    { demo: 'web/demo-assets/puzzles.sqlite', real: DATA_PUZZLES, tables: ['puzzles', 'themes', 'meta'] },
    {
      demo: 'web/demo-assets/refgames.sqlite',
      // Reference databases are plural now; the demo subset is curated
      // from the biggest LICHESS-sourced one (see demoSourceRefgames —
      // other corpora must not leak into repository content by size).
      real: demoSourceRefgames() ?? resolve(DATA, 'refgames.sqlite'),
      // `plies` too: the demo's explorer and repertoire answer from the
      // position index, exactly like a real reference database.
      tables: ['games', 'meta', 'plies'],
    },
  ];

  for (const { demo, real, tables } of cases) {
    const runnable = existsSync(real) && existsSync(resolve(REPO_ROOT, demo));
    it.skipIf(!runnable)(`${demo.split('/').pop()} has every column the full one has`, () => {
      const full = schema(real);
      const small = schema(resolve(REPO_ROOT, demo));
      for (const table of tables) {
        if (!full[table]) continue;
        expect(small[table], `${demo} is missing the table ${table}`).toBeDefined();
        const absent = full[table]!.filter((column) => !small[table]!.includes(column));
        expect(
          absent,
          `${demo} table ${table} is missing ${absent.join(', ')} — rebuild it with ` +
            'npm run build:demo-dbs, or the demo 500s on any query touching them.',
        ).toEqual([]);
      }
    });
  }

  it('the demo reference games carry the position index its routes join', () => {
    const demo = resolve(REPO_ROOT, 'web/demo-assets/refgames.sqlite');
    if (!existsSync(demo)) return;
    const small = schema(demo);
    // refgames.ts joins plies to games; both must exist even when empty,
    // because a missing table is an error rather than no rows.
    for (const table of ['games', 'plies', 'meta']) {
      expect(small[table], `refgames.sqlite has no ${table} table`).toBeDefined();
    }
    for (const column of ['pos', 'game_id', 'uci', 'ply']) {
      expect(small.plies, `plies has no ${column}`).toContain(column);
    }
  });
});
