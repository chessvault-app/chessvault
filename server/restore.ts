import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, open, rm, statfs, utimes, type FileHandle } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { Hono } from 'hono';
import { readJson, renameRetrying, writeJson } from './atomic.ts';
import { VAULT, VAULT_SKELETON } from './paths.ts';
import { walk } from './storage.ts';
import { readTar, TarError, type TarFault } from './tarRead.ts';
import { prepareHistoryRepo, type VaultBackup } from './vaultBackup.ts';
import { vaultReplaced } from './vaultEvents.ts';
import { git, historyGitDir, HISTORY_DIR_NAME, RESTORE_DIR_NAME } from './vaultGit.ts';

/**
 * Putting a copy of the vault back, over the API: "Restore from a copy".
 *
 * "Download a copy" (server/backup.ts) made the file and nothing could
 * read it back: a restore meant unpacking a tar into the vault folder by
 * hand, which a phone cannot do and CLAUDE.md does not allow. This is the
 * other half. It is also the most destructive thing the app can be asked
 * to do short of the wipe, so it is built around four promises, each held
 * by server/restore.test.ts:
 *
 * 1. Nothing the vault held is lost. The restore moves what was there
 *    into `.restore/before/` instead of deleting it, and one request puts
 *    it back ("Undo the restore") until the user says to keep the
 *    restored vault, which is the only step that deletes. That covers
 *    what the history does not: the history repo leaves out book PDFs and
 *    uploaded PGN files, and keeps the rest where only git can reach it
 *    (the app restores studies, notes and games from it, not a book's
 *    progress or the puzzle record). The history records the vault on
 *    both sides of the restore as well, so after a keep the documents are
 *    still in Deleted documents and in their own earlier versions.
 *    Unpacking, checking and swapping are separate steps: the copy is
 *    unpacked into `.restore/<id>/in/`, and only an archive that read to
 *    its end marker with every header sound is swapped in. A failed or
 *    cancelled upload deletes its folder and has touched nothing.
 * 2. Credentials stay where they are. config.json and sessions.json are
 *    never moved, and never taken from a copy, whatever case or spelling
 *    the copy gives them. Nor are the vault's own dotfiles (the welcome
 *    marker, this work folder): a copy never carries them, so a restore
 *    leaves them alone.
 * 3. Nothing in an archive lands outside the vault. server/tarRead.ts
 *    refuses every path that could, every entry that is not a file or a
 *    folder, and every header that does not add up; and a name that
 *    reaches a credential by another road (a Windows short name such as
 *    CONFIG~1.JSO is one) is caught at the swap, which refuses to move
 *    anything onto a path where something already is.
 * 4. The running server answers from the restored files at once:
 *    vaultReplaced() tells every cache keyed on a file's mtime to forget
 *    (server/vaultEvents.ts), and the client reloads.
 *
 * The swap is a list of renames, written to `.restore/journal.json`
 * before the first one and deleted after the last, inside the vault so
 * every rename is on one filesystem. A rename that fails part way puts
 * back the ones before it; a server killed part way puts them back on its
 * next start (recoverInterruptedRestore), so the vault is always one
 * whole vault or the other. The last rename is what makes a restore
 * pending, `.restore/<id>/out` becoming `.restore/before`, so the state
 * changes at one instant too.
 *
 * The copy's own `.history.git` takes the vault's place only when the
 * vault's history holds no more than its first save: then nothing in it
 * is older than the vault as it stands, which is committed on top of the
 * copy's history before the swap, so taking the copy's history loses
 * nothing and brings every earlier version the copy remembers. A vault
 * with any history of its own keeps it, and the restore is recorded in
 * it; the copy's history is left in the copy. Only its objects and refs
 * are taken, into a repo initialised here: its config and hooks never
 * reach git, so they cannot run anything (see unsafeHistoryRepo for why
 * that matters).
 *
 * Not in mountVault, like the download: the demo's vault is a tab.
 */

/** A rename in the swap, as paths relative to the vault. */
interface Move {
  from: string;
  to: string;
}

/** What a pending restore says about itself, beside the vault it replaced. */
interface Restored {
  at: string;
  /** What happened to the history: the copy's taken, the vault's kept, or none to keep. */
  history: 'adopted' | 'kept' | 'none';
}

/** Which history a restore would leave the vault with, said before it starts. */
type HistoryPlan = 'adopt' | 'keep' | 'none';

/** The vault files a restore never touches and never takes from a copy. */
const CREDENTIALS = new Set(['config.json', 'sessions.json']);

/**
 * A name folded the way a filesystem might fold it: case-insensitive
 * volumes (NTFS, APFS) treat `CONFIG.JSON` as config.json, and NFKC
 * catches the compatibility forms that fold to the same letters.
 */
const fold = (name: string): string => name.normalize('NFKC').toLowerCase();

/**
 * A root entry the restore leaves alone on both sides: the credentials,
 * and the vault's own dotfiles (the history is decided separately).
 */
const keptInPlace = (name: string): boolean => name.startsWith('.') || CREDENTIALS.has(fold(name));

/** What a vault's top level holds, any one of which makes an archive a
    copy of one rather than some other tar. */
const VAULT_ROOTS = new Set(['studies', 'notes', 'games', 'books', 'puzzlebooks', 'puzzles', 'repertoire', 'sources', 'activity.jsonl', HISTORY_DIR_NAME]);

/** What of a copy's history is taken: the objects and what points at them. */
const HISTORY_PARTS = new Set(['objects', 'refs', 'packed-refs', 'HEAD', 'shallow']);

/** No byte for this long and the upload is given up: a phone that went
    to sleep part way would otherwise hold the restore open for good. */
const IDLE_MS = 120_000;

/** Free space kept back beyond the copy's own size. */
const SPACE_MARGIN = 64 * 1024 * 1024;

/** Attempts at each rename of the swap; see renameRetrying. About two
    seconds of pauses in all, for a scanner holding files just written. */
const SWAP_TRIES = 25;

const workDir = (vault: string): string => resolve(vault, RESTORE_DIR_NAME);
const journalPath = (vault: string): string => resolve(workDir(vault), 'journal.json');
const beforeDir = (vault: string): string => resolve(workDir(vault), 'before');
const restoredPath = (vault: string): string => resolve(beforeDir(vault), '.restored.json');

const exists = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

/** Undo the renames that were made, newest first. A rename whose target
    is gone or whose source is back was never made, or is undone. */
function rollBack(vault: string, moves: Move[]): void {
  for (const move of [...moves].reverse()) {
    const from = resolve(vault, move.from);
    const to = resolve(vault, move.to);
    if (exists(to) && !exists(from)) {
      mkdirSync(dirname(from), { recursive: true });
      renameRetrying(to, from, SWAP_TRIES);
    }
  }
}

/**
 * Make every rename, or none: the plan is written down first, a failure
 * part way puts back the ones made, and a crash part way is put back by
 * recoverInterruptedRestore. Nothing is ever renamed onto a path that
 * exists, which is the last guard for a name that is the same file as a
 * credential by a road the name checks did not see.
 */
function swap(vault: string, moves: Move[], move: (from: string, to: string) => void): void {
  writeJson(journalPath(vault), { moves });
  const done: Move[] = [];
  try {
    for (const step of moves) {
      const to = resolve(vault, step.to);
      if (exists(to)) throw new Error(`something is already at ${step.to}`);
      move(resolve(vault, step.from), to);
      done.push(step);
    }
  } catch (error) {
    // If putting back fails too, the journal stays for the next start.
    rollBack(vault, done);
    rmSync(journalPath(vault), { force: true });
    throw error;
  }
  rmSync(journalPath(vault), { force: true });
}

/** A rename of the journal that could not be undone: the journal stays. */
class StillSwapped extends Error {}

/** What finishInterruptedSwap found to do. */
type Finished = 'nothing' | 'put-back' | 'unreadable';

/**
 * Put back a swap whose journal still stands, then delete the work folders
 * of operations that never finished. The one put-back there is, so that
 * whatever runs it does the same thing: recoverInterruptedRestore at the
 * start. Throws StillSwapped, with the journal left standing, when a
 * rename cannot be undone.
 */
function finishInterruptedSwap(vault: string): Finished {
  const work = workDir(vault);
  if (!existsSync(work)) return 'nothing';
  let outcome: Finished = 'nothing';
  if (existsSync(journalPath(vault))) {
    let journal: { moves?: Move[] } | null = null;
    try {
      journal = JSON.parse(readFileSync(journalPath(vault), 'utf-8')) as { moves?: Move[] };
    } catch {
      journal = null;
    }
    if (!Array.isArray(journal?.moves)) {
      // Unreadable: nothing here may be deleted, since the work folders
      // may hold half of the vault.
      console.error(`[restore] ${RESTORE_DIR_NAME}/journal.json cannot be read; the vault may be part way through a restore. Nothing was changed.`);
      return 'unreadable';
    }
    try {
      rollBack(vault, journal.moves);
    } catch (error) {
      throw new StillSwapped((error as Error).message);
    }
    rmSync(journalPath(vault), { force: true });
    console.warn('[restore] a restore was cut off part way; the vault is back as it was before it');
    outcome = 'put-back';
  }
  for (const name of readdirSync(work)) {
    if (name === 'before') continue;
    const path = join(work, name);
    // A folder holding vault entries it was meant to hand on is kept and
    // said: deleting it could only lose them.
    const out = join(path, 'out');
    if (existsSync(out) && readdirSync(out).length > 0) {
      console.error(`[restore] ${RESTORE_DIR_NAME}/${name}/out still holds files; left in place`);
      continue;
    }
    rmSync(path, { recursive: true, force: true });
  }
  return outcome;
}

/**
 * Finish what a server killed part way through a restore left behind.
 * Called at startup, before anything else reads the vault: a swap cut off
 * after its first rename is put back from its journal, and the work
 * folders of operations that never finished are deleted.
 */
export function recoverInterruptedRestore(vault: string = VAULT): void {
  try {
    finishInterruptedSwap(vault);
  } catch (error) {
    if (!(error instanceof StillSwapped)) throw error;
    // Starting on half of one vault and half of another would have the
    // history record it and every page show it; the files are all still
    // on disk, and the next start tries again.
    throw new Error(
      `a restore was cut off part way and could not be put back (${error.message}); ` +
        `the vault's folders are all in ${workDir(vault)}, and the next start tries again`,
    );
  }
}

class Stalled extends Error {}

/** The request body, with a limit on how long it may go quiet. */
async function* idleLimited(body: ReadableStream<Uint8Array>, ms: number): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const read = reader.read();
      // A read the stall abandons must not surface as an unhandled rejection.
      read.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Stalled()), ms);
      });
      let next: ReadableStreamReadResult<Uint8Array>;
      try {
        next = await Promise.race([read, stalled]);
      } finally {
        clearTimeout(timer);
      }
      if (next.done) return;
      yield next.value;
    }
  } finally {
    // Lets the connection go after a stall; a no-op on a finished body.
    reader.cancel().catch(() => undefined);
  }
}

async function writeAll(handle: FileHandle, piece: Buffer): Promise<void> {
  for (let at = 0; at < piece.length; ) {
    const { bytesWritten } = await handle.write(piece, at, piece.length - at);
    at += bytesWritten;
  }
}

/** A time from a header that utimes will take, or null. */
const usableTime = (seconds: number): number | null =>
  Number.isFinite(seconds) && seconds > 0 && seconds < 32_503_680_000 ? seconds : null;

function runGit(args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    execFile('git', args, { timeout: 60_000 }, (error, _out, stderr) => {
      if (error) fail(new Error(stderr.trim() || error.message));
      else done();
    });
  });
}

/** How many commits a history has, or 0 when it has none or will not say. */
async function commitCount(gitDir: string, vault: string): Promise<number> {
  try {
    return Number((await git(gitDir, vault, ['rev-list', '--count', 'HEAD'])).trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * The copy's history as a repo made here: a fresh `git init`, and the
 * copy's objects, refs and HEAD moved into it. The copy's config, hooks,
 * index and alternates are never used. False, with nothing left at
 * `target`, when what the copy holds is not a history git can read.
 */
async function assembleHistory(raw: string, target: string, vault: string): Promise<boolean> {
  try {
    const head = readFileSync(join(raw, 'HEAD'), 'utf-8');
    if (!/^(ref: refs\/heads\/[A-Za-z0-9._/-]+|[0-9a-f]{40}|[0-9a-f]{64})\n?$/.test(head)) return false;
    await runGit(['init', '--quiet', '--bare', target]);
    for (const part of HISTORY_PARTS) {
      if (!existsSync(join(raw, part))) continue;
      rmSync(join(target, part), { recursive: true, force: true });
      renameSync(join(raw, part), join(target, part));
    }
    // An alternate makes git read objects from any path it names.
    rmSync(join(target, 'objects', 'info', 'alternates'), { force: true });
    rmSync(join(target, 'objects', 'info', 'http-alternates'), { force: true });
    await git(target, vault, ['config', 'core.bare', 'false']);
    await prepareHistoryRepo(target, vault);
    // Every commit reachable, or it is not a history worth taking.
    await git(target, vault, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    await git(target, vault, ['rev-list', '--count', 'HEAD']);
    return true;
  } catch (error) {
    console.error('[restore] the copy\'s history cannot be read, so it is left out:', (error as Error).message);
    rmSync(target, { recursive: true, force: true });
    return false;
  }
}

/** Commit what changed in `vault` to the repo at `gitDir`. */
async function commitTo(gitDir: string, vault: string, message: string): Promise<void> {
  const status = await git(gitDir, vault, ['status', '--porcelain']);
  if (!status.trim()) return;
  await git(gitDir, vault, ['add', '-A']);
  // A repo assembled from a copy has no index yet, so status lists every
  // file even when the vault holds what HEAD does. Once added there is
  // nothing to commit, and git would fail the commit for it.
  if (!(await git(gitDir, vault, ['diff', '--cached', '--name-only'])).trim()) return;
  await git(gitDir, vault, ['commit', '-q', '-m', message]);
}

/** The reply for a copy that will not restore, and why, in the words
    the app shows (the dictionary has each one). Every reply here is a
    sentence, because the restore window shows it as it comes, under its
    own question. The first is word for word what the page says when it
    can tell a file is no tar before sending it. */
const FAULTS: Record<TarFault, string> = {
  'not-tar': 'That file is not a copy of a vault.',
  checksum: 'This copy is damaged.',
  malformed: 'This copy is damaged.',
  truncated: 'This copy is cut short.',
  'unsafe-path': 'This copy holds a file name that could land outside the vault.',
  'unsupported-entry': 'This copy holds something other than files and folders.',
};

const NO_SPACE = 'The server does not have enough free space for this copy.';

const RUNNING = 'A restore is already running.';

/** A swap that failed and could not be put back leaves its journal for
    the next start, and the vault half one and half the other until then.
    Nothing may build on that: a second swap would write its own journal
    over this one, and an undo would delete what the first had put back. */
const STUCK = 'The vault is still part way through a restore. Restart the server to finish putting it back.';

export interface RestoreOptions {
  /** The running history writer, or null where there is none. */
  history?: () => Promise<VaultBackup | null>;
  /** Why the vault cannot be replaced right now, as the sentence the
      restore window shows, or null. */
  busy?: () => string | null;
  /** Free bytes where the vault is, or null when the system will not say. */
  free?: () => Promise<number | null>;
  /** How each rename of the swap is made. Tests make one fail. */
  move?: (from: string, to: string) => void;
  /** How long the upload may go quiet; IDLE_MS unless a test is waiting. */
  idleMs?: number;
}

/** A reply, built away from the route so the restore can return early. */
interface Reply {
  status: 200 | 400 | 408 | 409 | 500 | 507;
  body: Record<string, unknown>;
}

export function restoreApi(vaultDir: string = VAULT, options: RestoreOptions = {}): Hono {
  const vault = resolve(vaultDir);
  /** A path under the vault, as the journal writes it. */
  const rel = (path: string): string => relative(vault, path);
  const api = new Hono();
  const history = options.history ?? (async () => null);
  const move = options.move ?? ((from: string, to: string) => renameRetrying(from, to, SWAP_TRIES));
  const free =
    options.free ??
    (async (): Promise<number | null> => {
      try {
        const stats = await statfs(vault);
        return stats.bavail * stats.bsize;
      } catch {
        return null;
      }
    });
  /** One restore, undo or keep at a time. */
  let running = false;

  const newWork = (): { id: string; dir: string } => {
    const id = randomBytes(4).toString('hex');
    const dir = join(workDir(vault), id);
    mkdirSync(dir, { recursive: true });
    return { id, dir };
  };

  /** Root entries of `dir` that a restore moves: everything but what stays in place. */
  const movable = (dir: string): string[] => readdirSync(dir).filter((name) => !keptInPlace(name));

  const plan = async (backup: VaultBackup | null): Promise<HistoryPlan> => {
    if (!backup) return 'none';
    return (await commitCount(historyGitDir(vault), vault)) <= 1 ? 'adopt' : 'keep';
  };

  /**
   * What the Vault card asks before it offers anything: a restore waiting
   * to be kept or undone, what the history would do, and the free space.
   */
  api.get('/storage/restore', async (c) => {
    let pending: (Restored & { bytes: number }) | null = null;
    if (existsSync(beforeDir(vault))) {
      const meta = readJson<Partial<Restored>>(restoredPath(vault), {});
      pending = {
        at: typeof meta.at === 'string' ? meta.at : '',
        history: meta.history === 'adopted' || meta.history === 'none' ? meta.history : 'kept',
        bytes: (await walk(beforeDir(vault))).bytes,
      };
    }
    return c.json({ pending, history: await plan(await history()), free: await free() });
  });

  api.post('/storage/restore', async (c) => {
    if (running) return c.json({ error: RUNNING }, 409);
    if (existsSync(journalPath(vault))) return c.json({ error: STUCK }, 409);
    // Taken before the first await, so two uploads cannot both get past it.
    running = true;
    try {
      if (existsSync(beforeDir(vault))) return c.json({ error: 'Keep or undo the last restore first.' }, 409);
      const reason = options.busy?.();
      if (reason) return c.json({ error: reason }, 409);
      const body = c.req.raw.body;
      if (!body) return c.json({ error: FAULTS['not-tar'], reason: 'not-tar' }, 400);
      const declared = Number(c.req.header('content-length'));
      const room = await free();
      if (Number.isFinite(declared) && room !== null && declared + SPACE_MARGIN > room) {
        return c.json({ error: NO_SPACE }, 507);
      }
      const { body: answer, status } = await restore(body);
      return c.json(answer, status);
    } finally {
      running = false;
    }
  });

  const reply = (body: Record<string, unknown>, status: Reply['status'] = 200): Reply => ({ body, status });

  const restore = async (body: ReadableStream<Uint8Array>): Promise<Reply> => {
    const backup = await history();
    const historyPlan = await plan(backup);
    const work = newWork();
    const copy = join(work.dir, 'in');
    const rawHistory = join(work.dir, 'history');
    mkdirSync(copy);
    const input = idleLimited(body, options.idleMs ?? IDLE_MS);
    const roots = new Set<string>();
    const folders: { path: string; mtime: number }[] = [];
    let files = 0;
    let bytes = 0;

    const fail = async (error: unknown): Promise<Reply> => {
      await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof Stalled) return reply({ error: 'The upload stopped.' }, 408);
      // The rest of the upload is read and dropped, so the reply reaches a
      // browser that is still sending; one that is not gets nothing either way.
      try {
        for await (const _ of input) {
          // discarded
        }
      } catch {
        // The client went away, or stalled: nobody is left to answer.
      }
      if (error instanceof TarError) {
        console.error(`[restore] refused a copy: ${error.message}`);
        return reply({ error: FAULTS[error.fault], reason: error.fault }, 400);
      }
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') return reply({ error: NO_SPACE }, 507);
      console.error(`[restore] the upload failed: ${(error as Error).message}`);
      return reply({ error: 'The upload failed.' }, 500);
    };

    try {
      await readTar(input, async (entry, data) => {
        const [root] = entry.segments as [string, ...string[]];
        let target: string;
        if (root === HISTORY_DIR_NAME) {
          // Only what assembleHistory takes, and only when it will be taken.
          if (historyPlan !== 'adopt' || !HISTORY_PARTS.has(entry.segments[1] ?? '')) return;
          target = join(rawHistory, ...entry.segments.slice(1));
        } else {
          if (keptInPlace(root)) return;
          target = join(copy, ...entry.segments);
        }
        roots.add(root);
        try {
          if (entry.type === 'directory') {
            await mkdir(target, { recursive: true });
            folders.push({ path: target, mtime: entry.mtime });
            return;
          }
          await mkdir(dirname(target), { recursive: true });
          const handle = await open(target, 'w');
          try {
            for await (const piece of data) await writeAll(handle, piece);
          } finally {
            await handle.close();
          }
          const mtime = usableTime(entry.mtime);
          if (mtime !== null) await utimes(target, mtime, mtime);
        } catch (error) {
          // A file where a folder has to go, or the other way round: the
          // archive contradicts itself.
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR') {
            throw new TarError('malformed', `two entries at one path: ${entry.segments.join('/')}`);
          }
          throw error;
        }
        files += 1;
        bytes += entry.size;
      });
      // Past the end marker: GNU tar pads to a 10 KiB record.
      for await (const _ of input) {
        // discarded
      }
    } catch (error) {
      return fail(error);
    }

    // Checked before anything moves: a tar of something else is refused
    // here rather than swapped in as an empty vault.
    if (![...roots].some((root) => VAULT_ROOTS.has(root))) return fail(new TarError('not-tar', 'no vault folder in it'));
    // The folders startup makes and every route expects, parents first,
    // so a copy that lacks one does not 500 its page until a restart.
    for (const name of VAULT_SKELETON) {
      const path = join(copy, name);
      const stat = lstatSync(path, { throwIfNoEntry: false });
      if (stat && !stat.isDirectory()) return fail(new TarError('malformed', `${name} is not a folder`));
      if (!stat) mkdirSync(path);
    }
    // Deepest first, so writing a folder's children does not move its time.
    folders.sort((a, b) => b.path.length - a.path.length);
    for (const folder of folders) {
      const mtime = usableTime(folder.mtime);
      if (mtime !== null) await utimes(folder.path, mtime, mtime).catch(() => undefined);
    }

    const at = new Date().toISOString();
    const out = join(work.dir, 'out');
    const bin = join(work.dir, 'bin');
    mkdirSync(out);
    mkdirSync(bin);

    const putInPlace = async (commit: ((message: string) => Promise<void>) | null): Promise<Restored['history']> => {
      // The vault as it stands, in the history it already has, so the
      // documents the copy does not hold are in Deleted documents after.
      await commit?.(`vault before restoring a copy ${at}`).catch((error: Error) => {
        console.error('[restore] could not record the vault before the restore:', error.message);
      });
      let adopted = false;
      if (backup && historyPlan === 'adopt' && existsSync(rawHistory)) {
        // Asked again now that the state before is committed: a save made
        // during the upload is a second commit, and that history stays.
        if ((await commitCount(historyGitDir(vault), vault)) <= 1) {
          const target = join(copy, HISTORY_DIR_NAME);
          if (await assembleHistory(rawHistory, target, vault)) {
            // The vault as it stands, on top of the copy's history: the
            // one commit the vault's own history held, carried over.
            adopted = await commitTo(target, vault, `vault before restoring a copy ${at}`).then(
              () => true,
              (error: Error) => {
                console.error('[restore] could not carry the vault over to the copy\'s history:', error.message);
                return false;
              },
            );
          }
          if (!adopted) rmSync(target, { recursive: true, force: true });
        }
      }
      const meta: Restored = { at, history: adopted ? 'adopted' : backup ? 'kept' : 'none' };
      writeFileSync(join(out, '.restored.json'), `${JSON.stringify(meta)}\n`);
      const moves: Move[] = [
        ...movable(vault).map((name) => ({ from: name, to: rel(join(out, name)) })),
        ...(adopted && existsSync(historyGitDir(vault))
          ? [{ from: HISTORY_DIR_NAME, to: rel(join(bin, HISTORY_DIR_NAME)) }]
          : []),
        ...readdirSync(copy)
          .filter((name) => !keptInPlace(name) || (adopted && name === HISTORY_DIR_NAME))
          .map((name) => ({ from: rel(join(copy, name)), to: name })),
        { from: rel(out), to: rel(beforeDir(vault)) },
      ];
      swap(vault, moves, move);
      vaultReplaced();
      await commit?.(`vault restored from a copy ${at}`).catch((error: Error) => {
        console.error('[restore] could not record the restore:', error.message);
      });
      return meta.history;
    };

    let outcome: Restored['history'];
    try {
      outcome = backup ? await backup.exclusive((commit) => putInPlace(commit)) : await putInPlace(null);
    } catch (error) {
      console.error(`[restore] could not put the copy in place: ${(error as Error).message}`);
      const stuck = existsSync(journalPath(vault));
      if (!stuck) await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
      return reply(
        {
          error: stuck
            ? 'Could not put the copy in place or put everything back. Restart the server to finish putting it back.'
            : 'Could not put the copy in place, so the vault is as it was.',
        },
        500,
      );
    }
    await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
    return reply({ ok: true, history: outcome, files, bytes });
  };

  /**
   * Put back the vault as it was before the restore. The restored files
   * go, which the confirmation says; what changed in documents since the
   * restore is committed first, so it is in their history.
   */
  api.post('/storage/restore/undo', async (c) => {
    if (running) return c.json({ error: RUNNING }, 409);
    if (existsSync(journalPath(vault))) return c.json({ error: STUCK }, 409);
    if (!existsSync(beforeDir(vault))) return c.json({ error: 'There is no restore to undo.' }, 409);
    // An undo moves sources/ as a restore does.
    const reason = options.busy?.();
    if (reason) return c.json({ error: reason }, 409);
    running = true;
    try {
      const backup = await history();
      const at = new Date().toISOString();
      const work = newWork();
      const bin = join(work.dir, 'bin');
      mkdirSync(bin);
      const putBack = async (commit: ((message: string) => Promise<void>) | null): Promise<void> => {
        await commit?.(`vault before undoing a restore ${at}`).catch((error: Error) => {
          console.error('[restore] could not record the vault before the undo:', error.message);
        });
        const moves: Move[] = [
          ...movable(vault).map((name) => ({ from: name, to: rel(join(bin, name)) })),
          ...movable(beforeDir(vault)).map((name) => ({ from: rel(join(beforeDir(vault), name)), to: name })),
          { from: rel(beforeDir(vault)), to: rel(join(work.dir, 'before')) },
        ];
        swap(vault, moves, move);
        vaultReplaced();
        await commit?.(`vault restore undone ${at}`).catch((error: Error) => {
          console.error('[restore] could not record the undo:', error.message);
        });
      };
      try {
        await (backup ? backup.exclusive((commit) => putBack(commit)) : putBack(null));
      } catch (error) {
        console.error(`[restore] could not undo the restore: ${(error as Error).message}`);
        const stuck = existsSync(journalPath(vault));
        if (!stuck) await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
        return c.json(
          {
            error: stuck
              ? 'Could not undo the restore or put everything back. Restart the server to finish putting it back.'
              : 'Could not undo the restore, so the vault is as it was.',
          },
          500,
        );
      }
      await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
      return c.json({ ok: true });
    } finally {
      running = false;
    }
  });

  /** Keep the restored vault: what it replaced is deleted, for good. */
  api.post('/storage/restore/keep', async (c) => {
    if (running) return c.json({ error: RUNNING }, 409);
    if (existsSync(journalPath(vault))) return c.json({ error: STUCK }, 409);
    if (!existsSync(beforeDir(vault))) return c.json({ error: 'There is no restore to keep.' }, 409);
    running = true;
    try {
      const freed = (await walk(beforeDir(vault))).bytes;
      // One rename ends the pending state; the delete after it can take
      // its time, and what it leaves the next start sweeps.
      const work = newWork();
      try {
        move(beforeDir(vault), join(work.dir, 'before'));
      } catch (error) {
        // Nothing moved: the restore is still pending and can be undone.
        console.error(`[restore] could not keep the restored vault: ${(error as Error).message}`);
        await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
        return c.json({ error: 'Could not keep the restored vault, so the restore can still be undone.' }, 500);
      }
      await rm(work.dir, { recursive: true, force: true }).catch(() => undefined);
      return c.json({ ok: true, freed });
    } finally {
      running = false;
    }
  });

  return api;
}
