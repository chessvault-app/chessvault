import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import { seedFile } from './fs.ts';

/**
 * `better-sqlite3`'s shape, over sql.js.
 *
 * The demo build aliases `better-sqlite3` to this, so `server/puzzles.ts`
 * and `server/refgames.ts` run their real SQL — the same statements, the
 * same indexes, against the same schema — over a curated few thousand rows
 * instead of six million. Nothing about the queries is demo-specific, which
 * is the only way the demo can stay honest about how the app behaves.
 *
 * better-sqlite3 is synchronous and sql.js needs to load a WASM module, so
 * the databases are fetched and opened by `load()` BEFORE any route is
 * built. After that `new Database(path)` is a synchronous lookup, exactly
 * as the routes expect.
 */

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;
const opened = new Map<string, SqlJsDatabase>();

/** Fetch and open every database the demo serves. Call once, before routes. */
export async function loadDemoDatabases(paths: Record<string, string>): Promise<void> {
  // Fetch the WASM ourselves rather than letting sql.js guess a URL from
  // the bundled script's location. Under a project page the app lives at
  // /<repo>/, and every layer that guesses is a layer that can guess wrong
  // — this way there is exactly one place the path is decided, and a
  // failure says which URL it was.
  const wasmUrl = new URL('sqljs/sql-wasm.wasm', document.baseURI);
  const wasm = await fetch(wasmUrl);
  if (!wasm.ok) throw new Error(`demo: no sqlite runtime at ${wasmUrl} (${wasm.status})`);
  SQL = await initSqlJs({ wasmBinary: await wasm.arrayBuffer() });
  for (const [name, url] of Object.entries(paths)) {
    // no-cache, not no-store: the filenames carry no content hash (they are
    // copied verbatim into the build), so a rebuilt database would otherwise
    // be shadowed by the one a returning visitor already has. Revalidating
    // costs a 304 and removes a whole class of "why is it still showing the
    // old data" confusion.
    const response = await fetch(new URL(url, document.baseURI), { cache: 'no-cache' });
    if (!response.ok) {
      // A missing database is not fatal: the routes already have an empty
      // state for "no puzzle database yet", and showing it beats a blank
      // page. Only the feature that needed it is lost.
      console.warn(`demo: no database at ${url} (${response.status})`);
      continue;
    }
    opened.set(name, new SQL.Database(new Uint8Array(await response.arrayBuffer())));
    // The routes ask existsSync() before opening a database — a real file
    // is both a path on disk and a handle, and the two shims have to agree
    // about that or the route decides there is no database and never calls
    // the one that has it. A marker at the same path is what makes the
    // in-memory filesystem tell the truth about what sqlite holds.
    seedFile(name, '', Date.now());
  }
}

interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

/** One prepared statement, in the three shapes the routes call. */
class Statement {
  constructor(
    private readonly db: SqlJsDatabase,
    private readonly sql: string,
  ) {}

  private bind(params: unknown[]): Record<string, unknown> | unknown[] {
    // better-sqlite3 takes named parameters as one object and positional
    // ones spread; sql.js wants an array or an object with @-prefixed keys.
    if (params.length === 1 && params[0] !== null && typeof params[0] === 'object') {
      const named = params[0] as Record<string, unknown>;
      return Object.fromEntries(Object.entries(named).map(([k, v]) => [`@${k}`, v as unknown]));
    }
    return params as unknown[];
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const statement = this.db.prepare(this.sql);
    try {
      statement.bind(this.bind(params) as never);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as Record<string, unknown>);
      return rows;
    } finally {
      statement.free();
    }
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    return this.all(...params)[0];
  }

  run(...params: unknown[]): RunResult {
    this.db.run(this.sql, this.bind(params) as never);
    return { changes: this.db.getRowsModified(), lastInsertRowid: 0 };
  }

  /** better-sqlite3 lets a caller ask for arrays instead of objects. */
  raw(): Statement {
    return this;
  }

  pluck(): Statement {
    return this;
  }
}

export default class Database {
  readonly name: string;
  private readonly db: SqlJsDatabase;

  constructor(path: string, _options?: { readonly?: boolean; fileMustExist?: boolean }) {
    const db = opened.get(path);
    if (!db) {
      // The routes treat a throw here as "no database", which is the honest
      // answer and the state they already draw for it.
      throw Object.assign(new Error(`demo: database not loaded: ${path}`), { code: 'SQLITE_CANTOPEN' });
    }
    this.name = path;
    this.db = db;
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  pragma(): unknown[] {
    // Every pragma the server sets is a performance hint on a real file.
    return [];
  }

  transaction<T extends (...args: never[]) => unknown>(fn: T): T {
    return fn;
  }

  close(): void {
    // Left open: the databases are read-only and live for the page's life.
  }
}
