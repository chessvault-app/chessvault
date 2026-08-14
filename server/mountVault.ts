import type { Hono } from 'hono';
import { resolve } from 'node:path';
import { sourcesApi } from './sources.ts';
import { gamesApi } from './games.ts';
import { myGamesApi } from './myGames.ts';
import { openingsApi } from './openings.ts';
import { puzzlesApi } from './puzzles.ts';
import { refGamesApi } from './refgames.ts';
import { studiesApi } from './studies.ts';
import { DATA_PUZZLES, VAULT, VAULT_GAMES, VAULT_NOTES, VAULT_SOURCES, VAULT_STUDIES } from './paths.ts';

/**
 * Every route that reads or writes the vault, mounted in one place.
 *
 * This list used to be written twice — once in server/index.ts and once in
 * the static demo, which runs these same modules over an in-memory
 * filesystem. The copies differed only in which directories and databases
 * they were handed, and keeping them in step was left to whoever remembered.
 * Nobody did: adding the games routes to one and not the other left the
 * demo's Games page blank, with a clean build and passing tests.
 *
 * So the list is data now, and the differences are arguments. What is NOT
 * here is anything the two deployments genuinely disagree about — the
 * password gate, settings, the Lichess proxies, book puzzles. Those stay at
 * their call sites, because a shared function threaded with `if (demo)`
 * would make the real server harder to read for the demo's benefit.
 */
export interface VaultRoutes {
  /** Directory of .pgn studies. */
  studies?: string;
  /** Directory of .md notes. */
  notes?: string;
  /** Directory holding `collection/` and the archive caches. */
  games?: string;
  /** Directory of uploaded PGN collections, the databases' raw material. */
  sources?: string;
  /** The puzzle database file. */
  puzzlesDb?: string;
  /** Directory holding puzzle history and counters. */
  puzzlesState?: string;
  /** The reference-game database file. */
  refgamesDb?: string;
  /** The live index over the vault's own games. Derived, rebuildable. */
  myGamesDb?: string;
}

export function mountVault(app: Hono, paths: VaultRoutes = {}): void {
  const studies = paths.studies ?? VAULT_STUDIES;
  const notes = paths.notes ?? VAULT_NOTES;
  const games = paths.games ?? VAULT_GAMES;

  // Given the caller's paths, not the module defaults: the demo mounts a
  // vault at /vault, and a no-argument mount looked at the real one
  // instead — so its own uploads were invisible.
  app.route('/api', sourcesApi(paths.sources ?? VAULT_SOURCES));
  app.route('/api', openingsApi());
  app.route('/api', studiesApi(studies));
  // The games collection speaks the same document API as studies: an
  // annotated game is a one-chapter study living in games/collection/.
  app.route('/api', studiesApi(resolve(games, 'collection'), 'games/docs'));
  // Notes: the same document API over markdown files.
  app.route('/api', studiesApi(notes, 'notes', '.md'));
  app.route('/api', gamesApi(games));
  // The vault's own games, explorable under filters. Not a book: see
  // server/myGames.ts for why they are indexed rather than compiled.
  app.route('/api', paths.myGamesDb ? myGamesApi(games, paths.myGamesDb) : myGamesApi(games));
  app.route(
    '/api',
    paths.puzzlesDb || paths.puzzlesState
      ? puzzlesApi(paths.puzzlesDb ?? DATA_PUZZLES, paths.puzzlesState ?? resolve(VAULT, 'puzzles'))
      : puzzlesApi(),
  );
  app.route('/api', paths.refgamesDb ? refGamesApi(paths.refgamesDb) : refGamesApi());
}
