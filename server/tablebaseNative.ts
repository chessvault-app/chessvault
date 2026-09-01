import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './paths.ts';
import { normalizeTablebase, type LichessTablebaseResponse, type TablebaseProbe } from './tablebase.ts';

/**
 * The tablebase answered from this machine's own Syzygy files.
 *
 * A `TablebaseProbe` like the HTTP one, and interchangeable with it by
 * design — same interface, same normaliser, same cache. What differs is
 * where the answer comes from: `chessvault-core tablebase --tables
 * <dir>` reads the `.rtbz` files directly, so a vault with the tables
 * needs neither a second server installed beside the app nor a network.
 *
 * The child is RESIDENT, and that is the whole point. Syzygy probing
 * wants its tables memory-mapped and kept; a process spawned per lookup
 * would pay tens of milliseconds of startup and a fresh mapping to read
 * a few hundred bytes, which is the wrong shape by orders of magnitude.
 * So this is the binary's one long-lived mode, the native counterpart of
 * `server/scanWorker.ts` — one owner of one structure, with questions
 * queued into it — rather than the spawn-per-job shape everything else
 * in this binary uses.
 *
 * Questions are answered strictly in order because the channel is one
 * pipe: a queue, not a pool. That costs nothing worth having, since a
 * warm probe is microseconds and every answer is cached on disk anyway.
 */

/** Long enough for a cold page fault off a slow disk, short enough that
    a wedged child is noticed rather than waited on for ever. */
const ANSWER_TIMEOUT_MS = 10_000;

export function nativeBinary(): string | null {
  if (process.env.CHESS_NATIVE === '0') return null;
  const exe = process.platform === 'win32' ? 'chessvault-core.exe' : 'chessvault-core';
  const path = resolve(REPO_ROOT, 'native', 'target', 'release', exe);
  return existsSync(path) ? path : null;
}

interface Pending {
  resolve: (value: LichessTablebaseResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Null when this machine cannot answer that way — no binary built, or
 * no such directory. The caller falls back to the network source, which
 * is the right behaviour: a missing table directory is a vault that has
 * not set one up, not a vault whose endgames should stop working.
 */
/**
 * One prober per directory, for the life of the process.
 *
 * The point of this source is a child that STAYS, and the route picks
 * its prober per request (so a setting saved in Settings takes effect
 * without a restart) — so building a fresh closure each time would
 * spawn a fresh child each time and never reuse a mapping, which is
 * precisely the shape this exists to avoid. Keyed by directory, because
 * that is what a prober is: two directories are two sets of tables.
 */
const probers = new Map<string, TablebaseProbe | null>();

export function nativeTablebase(tablesDir: string): TablebaseProbe | null {
  const found = probers.get(tablesDir);
  if (found !== undefined) return found;
  const made = build(tablesDir);
  // A miss is remembered too — but only the "no binary, no directory"
  // kind, which cannot change without a restart or a new setting. The
  // Settings route re-reads by asking with the new path, which is a
  // different key.
  probers.set(tablesDir, made);
  return made;
}

function build(tablesDir: string): TablebaseProbe | null {
  const binary = nativeBinary();
  if (!binary || !existsSync(tablesDir)) return null;

  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = '';
  let ready = false;
  const queue: Pending[] = [];

  const fail = (error: Error): void => {
    // Everything waiting on a dead child fails together; the next probe
    // starts a new one. A half-read line belongs to the dead child too.
    buffer = '';
    ready = false;
    child = null;
    while (queue.length > 0) {
      const item = queue.shift()!;
      clearTimeout(item.timer);
      item.reject(error);
    }
  };

  const start = (): ChildProcessWithoutNullStreams => {
    const spawned = spawn(binary, ['tablebase', '--tables', tablesDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    spawned.stdout.setEncoding('utf-8');
    spawned.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      for (let nl = buffer.indexOf('\n'); nl !== -1; nl = buffer.indexOf('\n')) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        // The first line is the handshake, which is how "no tables here"
        // is told apart from "no answer for that position".
        if (!ready) {
          ready = true;
          continue;
        }
        const waiting = queue.shift();
        if (!waiting) continue; // an answer nobody is waiting for: drop it
        clearTimeout(waiting.timer);
        try {
          waiting.resolve(JSON.parse(line) as LichessTablebaseResponse);
        } catch {
          waiting.reject(new Error('tablebase child sent something unreadable'));
        }
      }
    });
    // Kept out of the app's own stdout: a table file that will not open
    // is the child's to report, and it belongs in the log as its own.
    spawned.stderr.setEncoding('utf-8');
    spawned.stderr.on('data', (line: string) => process.stderr.write(`[tablebase] ${line}`));
    spawned.on('error', (error) => fail(error));
    spawned.on('close', () => fail(new Error('tablebase child exited')));
    return spawned;
  };

  return {
    source: 'local',
    probe(fen: string) {
      return new Promise<LichessTablebaseResponse>((done, reject) => {
        child ??= start();
        const timer = setTimeout(() => {
          // A child that has stopped answering is worse than none: kill
          // it so the next question gets a fresh one rather than queuing
          // behind a silence.
          child?.kill();
          fail(new Error('tablebase child stopped answering'));
        }, ANSWER_TIMEOUT_MS);
        queue.push({ resolve: done, reject, timer });
        child.stdin.write(`${fen}\n`);
      }).then((body) => {
        const answer = normalizeTablebase(body);
        // Same rule as the HTTP source: a shrug is this source holding
        // nothing, which for local tables is the ordinary case — a
        // 3-4-5 set asked about six pieces.
        return answer.category === 'unknown' ? null : answer;
      });
    },
  };
}
