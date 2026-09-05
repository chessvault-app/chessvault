import Database from './sqlite.ts';

/**
 * `server/refgamesQuery.ts`'s shape, in the page.
 *
 * The real module forks one child process per reference-games file and
 * runs the routes' statements there, so a 44 s aggregation is never the
 * event loop's problem (see queryWorker.ts). A page has no processes to
 * fork, and the demo's file is a few thousand rows, so the same
 * statements simply run here, on the sql.js shim the rest of the demo's
 * SQL already runs on. `refgames.ts` is not touched: it composes the
 * SQL, hands it to this face, and gets the same rows either way. That
 * is the only way the demo's explorer can stay an honest copy of the
 * app's.
 *
 * Kept deliberately to the worker's contract: positional parameters,
 * one statement at a time, a rejection carrying the statement's error
 * text, and an already-abandoned request refused with the same
 * AbortError the routes turn into a 499.
 */

export interface Query {
  all<T>(sql: string, params: unknown[], signal?: AbortSignal): Promise<T[]>;
  get<T>(sql: string, params: unknown[], signal?: AbortSignal): Promise<T | undefined>;
}

export class AbortedQuery extends Error {
  constructor() {
    super('the request was abandoned');
    this.name = 'AbortError';
  }
}

export const isAbortedQuery = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const handles = new Map<string, Database>();

/** The read-only handle the worker would hold, opened at the first
    statement rather than at queryFor(), as the worker is forked. */
function open(path: string): Database {
  let db = handles.get(path);
  if (!db) {
    db = new Database(path, { readonly: true, fileMustExist: true });
    handles.set(path, db);
  }
  return db;
}

async function run(
  path: string,
  sql: string,
  params: unknown[],
  mode: 'all' | 'get',
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal?.aborted) throw new AbortedQuery();
  // Off the caller's synchronous path, as the channel round trip is:
  // the routes never see rows before their await.
  await Promise.resolve();
  const statement = open(path).prepare(sql);
  // One array binds positionally, as the routes composed it.
  return mode === 'get' ? statement.get(...params) : statement.all(...params);
}

export function queryFor(path: string): Query {
  return {
    all: <T>(sql: string, params: unknown[], signal?: AbortSignal) =>
      run(path, sql, params, 'all', signal) as Promise<T[]>,
    get: <T>(sql: string, params: unknown[], signal?: AbortSignal) =>
      run(path, sql, params, 'get', signal) as Promise<T | undefined>,
  };
}

/** Let go of the handle on `path`, or on every file: the next statement
    opens afresh, which is what a rebuilt file needs. */
export function closeQueries(path?: string): Promise<void> {
  for (const [key, db] of handles) {
    if (path !== undefined && key !== path) continue;
    db.close();
    handles.delete(key);
  }
  return Promise.resolve();
}
