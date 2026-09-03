import Database from 'better-sqlite3';

/**
 * The query worker: one child process owning one read-only connection
 * to one reference-games file, running the statements the server sends
 * it (refgamesQuery.ts is the other half, and owns its lifetime).
 *
 * It exists because better-sqlite3 is synchronous and the server is one
 * event loop. Every route in refgames.ts used to run its statements on
 * that loop, so a statement's cost was the server's outage: the explore
 * route's live join over a crowded position held it for 44 s (measured
 * on a 10 M-game file) and nothing — not the health check, not a static
 * file — answered until it returned. The client's abort could not even
 * be seen until then. Here a statement's cost is this process's alone,
 * and a request the client gives up on is stopped by killing it.
 *
 * A process, not a worker thread, and that is the whole reason: a
 * thread's `terminate()` interrupts JavaScript, but a statement is one
 * native call into SQLite that runs to its end regardless — measured:
 * the terminated thread kept the file open until its 400 M-row walk
 * finished. better-sqlite3 exposes no interrupt. A process can be
 * killed mid-call, and the kernel takes the handle back.
 *
 * Deliberately dumb: SQL in, rows out, one statement at a time in the
 * order they arrive. What is heavy and what is cheap is the route's
 * call — the cheap metadata reads stay on the main thread's own
 * read-only handle, since a round trip costs more than they do.
 */

const path = process.argv[2];
if (!path || !process.send) {
  console.error('query worker: forked with a database path and an IPC channel only');
  process.exit(1);
}
const db = new Database(path, { readonly: true, fileMustExist: true });

/** Prepared once per distinct text. The search route composes its SQL
    per filter combination, so the set is open-ended: past a modest
    size it is emptied rather than grown, since a statement is cheap to
    prepare again and a leak is not cheap to find. */
const STATEMENT_CAP = 64;
const statements = new Map<string, ReturnType<typeof db.prepare>>();

process.on(
  'message',
  (m: { seq: number; sql: string; params: unknown[]; mode: 'all' | 'get' }) => {
    try {
      let statement = statements.get(m.sql);
      if (!statement) {
        if (statements.size >= STATEMENT_CAP) statements.clear();
        statement = db.prepare(m.sql);
        statements.set(m.sql, statement);
      }
      // One array binds positionally in better-sqlite3, which is what the
      // route composed on the other side of the channel.
      const rows = m.mode === 'get' ? statement.get(m.params as never) : statement.all(m.params as never);
      process.send!({ seq: m.seq, rows });
    } catch (error) {
      process.send!({ seq: m.seq, error: (error as Error).message });
    }
  },
);

// The channel closing is the server going away: nothing to serve.
process.on('disconnect', () => process.exit(0));
