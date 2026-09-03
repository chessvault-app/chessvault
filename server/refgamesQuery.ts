import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './paths.ts';

/**
 * The query workers: per reference-games file, one child process holding
 * one read-only connection (queryWorker.ts), running the statements the
 * routes hand it one at a time, in order. This module is their
 * lifecycle — forked on the first statement, killed when the file is
 * closed or a statement is abandoned — and the typed face the routes
 * talk to.
 *
 * Why one process per file and not a pool: it is the shape the resident
 * scan index settled on (refgamesResident.ts), one owner of one
 * structure with requests queued into it. A pool would let two
 * statements on one file overlap, which SQLite handles, but it would
 * also let one client's burst take every worker, and the guarantee this
 * exists for is not "explores run in parallel" — it is that the event
 * loop is never the thing a statement is running on, so the server
 * answers everything else while it runs.
 *
 * Why a process and not a worker thread: a thread cannot be stopped
 * inside a native call, and a statement is one native call. See
 * queryWorker.ts. Killing the process is the one way to stop a
 * synchronous statement, and it is what a request the client gave up
 * on gets — with a fresh process forked for whatever was queued behind
 * it. The next statement pays the fork again (tens of milliseconds);
 * the alternative was finishing a 49 s aggregation nobody would read.
 * A request abandoned while still queued simply never runs.
 */

export interface Query {
  all<T>(sql: string, params: unknown[], signal?: AbortSignal): Promise<T[]>;
  get<T>(sql: string, params: unknown[], signal?: AbortSignal): Promise<T | undefined>;
}

/** What an abandoned statement rejects with. Named as the platform
    names a fetch abort, so one check covers both. */
export class AbortedQuery extends Error {
  constructor() {
    super('the request was abandoned');
    this.name = 'AbortError';
  }
}

export const isAbortedQuery = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

interface Job {
  seq: number;
  sql: string;
  params: unknown[];
  mode: 'all' | 'get';
  settle: (rows: unknown) => void;
  refuse: (error: Error) => void;
}

interface Entry {
  path: string;
  child: ChildProcess | null;
  seq: number;
  queue: Job[];
  running: Job | null;
}

const entries = new Map<string, Entry>();

/** The worker script: bundled beside a packaged server (see
    desktop/build-server.mjs), the TS source under tsx in dev. */
function workerPath(): string {
  const bundled = resolve(REPO_ROOT, 'server', 'query-worker.mjs');
  return existsSync(bundled) ? bundled : resolve(REPO_ROOT, 'server', 'queryWorker.ts');
}

/** Processes killed and not yet gone. A kill for an abandoned statement
    is not waited for by the request that caused it, so closeQueries()
    waits for these too: the file is not free until they have exited. */
const stopping = new Set<Promise<void>>();

/** Kill a process and resolve once it has exited — and, with it, let
    go of the file. A delete or a rename-over on Windows waits for this. */
function stop(child: ChildProcess): Promise<void> {
  const gone = new Promise<void>((done) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      done();
      return;
    }
    child.once('exit', () => done());
    child.kill();
  });
  stopping.add(gone);
  void gone.then(() => stopping.delete(gone));
  return gone;
}

function spawn(entry: Entry): ChildProcess {
  const script = workerPath();
  // The TS source needs the tsx loader IN THE CHILD, stated rather than
  // inherited — the host is not always tsx (vitest transforms through its
  // own pipeline). The bundled .mjs needs nothing. Advanced serialization
  // is structured clone over the channel: rows cross it as they are.
  const child = fork(script, [entry.path], {
    execArgv: script.endsWith('.ts') ? ['--import', 'tsx'] : [],
    serialization: 'advanced',
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  child.on('message', (m: { seq: number; rows?: unknown; error?: string }) => {
    const job = entry.running;
    // A message from a process this entry no longer owns (killed for an
    // abandoned statement, replaced) is nobody's answer.
    if (entry.child !== child || !job || job.seq !== m.seq) return;
    entry.running = null;
    if (m.error !== undefined) job.refuse(new Error(m.error));
    else job.settle(m.rows);
    pump(entry);
  });
  // A process that dies takes its statement with it: everything in
  // flight and queued fails, and the next statement forks afresh.
  const fail = (why: string): void => {
    if (entry.child !== child) return;
    entry.child = null;
    const running = entry.running;
    entry.running = null;
    running?.refuse(new Error(why));
    for (const job of entry.queue.splice(0)) job.refuse(new Error(why));
  };
  child.on('error', (error: Error) => fail(error.message));
  child.on('exit', (code, signal) => fail(`query worker exited (${signal ?? code})`));
  return child;
}

/** Start the next queued statement, if the process is idle. */
function pump(entry: Entry): void {
  if (entry.running) return;
  const job = entry.queue.shift();
  if (!job) return;
  if (!entry.child) entry.child = spawn(entry);
  entry.running = job;
  entry.child.send({ seq: job.seq, sql: job.sql, params: job.params, mode: job.mode });
}

function submit(
  entry: Entry,
  sql: string,
  params: unknown[],
  mode: 'all' | 'get',
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(new AbortedQuery());
  return new Promise((settle, refuse) => {
    const job: Job = {
      seq: ++entry.seq,
      sql,
      params,
      mode,
      settle: (rows) => {
        signal?.removeEventListener('abort', onAbort);
        settle(rows);
      },
      refuse: (error) => {
        signal?.removeEventListener('abort', onAbort);
        refuse(error);
      },
    };
    const onAbort = (): void => {
      if (entry.running === job) {
        // Mid-statement: the process is the only handle on it.
        const child = entry.child;
        entry.child = null;
        entry.running = null;
        if (child) void stop(child);
        job.refuse(new AbortedQuery());
        pump(entry);
        return;
      }
      const at = entry.queue.indexOf(job);
      if (at >= 0) entry.queue.splice(at, 1);
      job.refuse(new AbortedQuery());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.queue.push(job);
    pump(entry);
  });
}

/** The query face of one file. Nothing is forked until the first
    statement; the same face answers for the file's lifetime. */
export function queryFor(path: string): Query {
  let entry = entries.get(path);
  if (!entry) {
    entry = { path, child: null, seq: 0, queue: [], running: null };
    entries.set(path, entry);
  }
  const owned = entry;
  return {
    all: <T>(sql: string, params: unknown[], signal?: AbortSignal) =>
      submit(owned, sql, params, 'all', signal) as Promise<T[]>,
    get: <T>(sql: string, params: unknown[], signal?: AbortSignal) =>
      submit(owned, sql, params, 'get', signal) as Promise<T | undefined>,
  };
}

/**
 * Stop the process on `path` — or on every file when none is named.
 * A build or delete replaces the file, so the process's handle on the
 * old one must go with the main thread's; the test suite's afterAll
 * takes them all down. Resolves once the handles are gone.
 */
export function closeQueries(path?: string): Promise<void> {
  const gone: Promise<void>[] = [];
  for (const [key, entry] of entries) {
    if (path !== undefined && key !== path) continue;
    entries.delete(key);
    const child = entry.child;
    entry.child = null;
    const running = entry.running;
    entry.running = null;
    running?.refuse(new Error('the database was closed'));
    for (const job of entry.queue.splice(0)) job.refuse(new Error('the database was closed'));
    if (child) gone.push(stop(child));
  }
  return Promise.all([...gone, ...stopping]).then(() => undefined);
}
