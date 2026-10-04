import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { historyExcludeFile, historyMatcherFor } from './historyExcludes.ts';
import { finishInterruptedPurge, forgetHistoryLeaks, historyCount, historyLeaks, purgeHistory, type HistoryLeaks, type PurgeOutcome } from './historyPurge.ts';
import { VAULT } from './paths.ts';
import { git, historyGitDir, HISTORY_DIR_NAME, RESTORE_DIR_NAME, restoreJournalPath, unsafeHistoryRepo } from './vaultGit.ts';

/**
 * Vault safety net: every change inside vault/ is auto-committed to a
 * dedicated history repo, so any bug (or bad edit) that mangles a study,
 * game or book is recoverable with plain git.
 *
 * How the repo is addressed — the git-dir inside the vault, the worktree
 * flag, the committer identity — lives in server/vaultGit.ts, shared with
 * the reader that serves this history back to the app.
 *
 * Browse it with:  git --git-dir=vault/.history.git log --stat
 */

const DEBOUNCE_MS = 15_000;

export interface VaultBackup {
  /** Debounced; called by the fs watcher, exposed for tests. */
  schedule: () => void;
  /** Commit now if anything changed, unless a restore stands part way
      (see startVaultBackup). Resolves when the commit is done. */
  commitNow: () => Promise<void>;
  /**
   * Stop watching, and resolve once the git work already in flight is
   * finished — not merely once it has been abandoned.
   *
   * Clearing the timer and closing the watcher stops anything NEW from
   * starting, but a commit already running is a child process with its
   * work-tree inside the vault. On Windows a directory a live process
   * holds cannot be removed, so a caller that stopped the backup and
   * immediately deleted the vault got EPERM — intermittently, depending
   * on whether the commit had finished. On Linux the delete succeeds
   * regardless, which is why it showed up on one platform only.
   */
  stop: () => Promise<void>;
  /**
   * Run `work` with the history to itself: git work already in flight
   * finishes first, and no autosave starts until `work` settles. `work`
   * records states itself through `commit`, which commits whatever
   * changed under the message given and throws when git does.
   *
   * For a restore from a copy (server/restore.ts), which swaps the
   * vault's folders and records the state on each side of the swap. An
   * autosave that ran its `add -A` across that swap would commit half of
   * one vault and half of the other.
   */
  exclusive: <T>(work: (commit: (message: string) => Promise<void>) => Promise<T>) => Promise<T>;
  /** What the history holds that it never should (the list in
      server/historyExcludes.ts), as last counted (server/historyPurge.ts). */
  leaks: () => Promise<HistoryLeaks>;
  /** Write the history again without them, holding it to itself. */
  purge: () => Promise<PurgeOutcome>;
}

/**
 * Bring a history repo's own settings up to what this version expects.
 *
 * A function of its own because two repos need it: the vault's, on every
 * startup, and one taken over from a copy being restored
 * (server/restore.ts), which was made by whatever version wrote the copy.
 *
 * Repo-side excludes (never a file in the vault): what the history never
 * holds, and why each, is the list in server/historyExcludes.ts.
 */
export async function prepareHistoryRepo(gitDir: string, dir: string): Promise<void> {
  writeFileSync(resolve(gitDir, 'info', 'exclude'), historyExcludeFile());
  // Untrack whatever of the list the index holds, which an exclude never
  // does: an older version committed some of it, and a wipe before the
  // one that writes this exclude at once (server/settings.ts) let the
  // autosave track everything, the repo's own folder, book PDFs and the
  // databases' PGN files included, and every save after a restart went on
  // committing them. Leaves the working files intact. git lists what the
  // list's globs reach, and the list's own matcher says which part of
  // each path it names, so a folder goes as one `-r` path however many
  // files it holds; the paths go back to git by name (the helper's
  // default --literal-pathspecs), in batches, since a path is about 35
  // characters and Windows refuses a command line past 32,767.
  const matcher = await historyMatcherFor(gitDir, dir, { fresh: true });
  const listed = (await git(gitDir, dir, ['ls-files', '-z', '--', ...matcher.pathspecs], matcher.mode).catch(() => '')).split('\0');
  const untrack = [...new Set(listed.flatMap((path) => matcher.within(path)?.at ?? []))];
  for (let at = 0; at < untrack.length; at += 200) {
    const batch = untrack.slice(at, at + 200);
    await git(gitDir, dir, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', '--', ...batch]).catch(() => undefined);
  }
  // Untracking stops here; it does not reach into commits already made.
  // A history that carries an old config.json carries every password
  // hash, authenticator secret and Lichess token it ever held, and one
  // that took in a book's PDF carries a copy of the book, and
  // scripts/backup-vault.sh copies the whole repo off-box and "Download a
  // copy" packs it. Said once, loudly, at boot, and offered in Settings
  // (server/historyPurge.ts): rewriting history is the owner's call, not
  // this server's. Counted fresh here, which is also what Settings is
  // answered from until the history next changes under a restore, a wipe
  // or a purge; which secrets it holds is read at Settings' first ask, not
  // here.
  const leaks = await historyCount(gitDir, dir, { fresh: true }).catch(() => null);
  if (leaks && leaks.commits > 0) {
    const mb = (bytes: number): string => (bytes >= 1024 * 1024 ? `, ${(bytes / (1024 * 1024)).toFixed(1)} MB` : '');
    const held = [
      leaks.credentials > 0 && `config.json or sessions.json (${leaks.credentials}, which may hold past secrets)`,
      leaks.folder > 0 && `its own folder (${leaks.folder}${mb(leaks.bytes.folder)})`,
      leaks.books > 0 && `book PDFs or open caches (${leaks.books}${mb(leaks.bytes.books)})`,
      leaks.sources > 0 && `the databases' PGN files (${leaks.sources}${mb(leaks.bytes.sources)})`,
      leaks.other > 0 && `.part, .swp or restore files (${leaks.other}${mb(leaks.bytes.other)})`,
    ].filter(Boolean);
    console.warn(
      `[vault-backup] ${leaks.commits} save(s) in ${HISTORY_DIR_NAME} hold what the history never keeps, from an older version or an earlier wipe: ${held.join('; ')}. Settings, Security takes them out: "Remove old secrets", or "Remove old files" where they hold no secret (the paragraph on backups in README.md does the same from a terminal).`,
    );
  }
}

/**
 * Start watching `dir` and auto-committing its changes. Returns handles
 * for shutdown and tests; resolves after the repo exists and the current
 * state is committed, so the safety net has no startup gap. Unless a
 * restore stands part way: then it resolves with neither, and both
 * happen at the first save after the vault is put back (see `open`).
 */
export async function startVaultBackup(
  dir: string = VAULT,
  debounceMs: number = DEBOUNCE_MS,
): Promise<VaultBackup> {
  const gitDir = historyGitDir(dir);
  const journal = restoreJournalPath(dir);

  // Before ANY git command touches it: a history repo that came with the
  // folder rather than from this server is not run. See unsafeHistoryRepo.
  const refuseUnsafe = (): void => {
    const unsafe = existsSync(gitDir) ? unsafeHistoryRepo(gitDir) : null;
    if (unsafe !== null) {
      throw new Error(
        `refusing to use ${HISTORY_DIR_NAME} in this vault: ${unsafe}. ` +
          `A history repo that did not come from this app can run code when the app commits. ` +
          `Move or delete ${HISTORY_DIR_NAME} to get the safety net back.`,
      );
    }
  };
  refuseUnsafe();

  /**
   * The repo made when there is none, a purge cut off finished, and its
   * settings repaired, before the first save. At the start, unless a
   * restore stands part way there (its journal, server/restore.ts), as it
   * does when the start could not put it back: the history may be one of
   * the folders set aside, and a repo made now would stand where it has to
   * go back to, so the put-back would leave the vault's own history behind
   * in `.restore`; or what stands there may be the copy's, which the
   * put-back moves away again. So it waits, and the first save after the
   * vault is put back or wiped opens it, asking again whether what stands
   * there now is safe to run.
   */
  let opened = false;
  const open = async (): Promise<void> => {
    if (opened) return;
    if (existsSync(journal)) throw new Error('the vault is part way through a restore; its history opens once it is put back');
    refuseUnsafe();
    if (!existsSync(gitDir)) {
      mkdirSync(dir, { recursive: true });
      // Plain init (no --work-tree: `git init --bare` refuses the flag).
      await new Promise<void>((resolvePromise, reject) => {
        execFile('git', ['init', '--quiet', '--bare', gitDir], (error, _out, stderr) => {
          if (error) reject(new Error(stderr.trim() || error.message));
          else resolvePromise();
        });
      });
      // A bare git-dir plus --work-tree is only accepted with bare=false.
      await git(gitDir, dir, ['config', 'core.bare', 'false']);
    }

    // A purge the server was stopped in the middle of has rewritten the
    // history and not yet deleted the old saves; finished first, so the
    // count below is of a history that holds none of them.
    await finishInterruptedPurge(gitDir, dir).catch((error: Error) => {
      console.error('[vault-backup] could not finish removing the old secrets:', error.message);
    });

    // Run on EVERY startup, not just first init, so a repo created before a
    // given exclude existed is repaired on the next boot.
    if (existsSync(gitDir)) await prepareHistoryRepo(gitDir, dir);
    opened = true;
  };
  if (!existsSync(journal)) await open();

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  /**
   * A commit interrupted mid-write (the server killed between `add` and
   * `commit`) leaves `index.lock` behind, and git then refuses every
   * commit after it — which silently turns the safety net off for good;
   * seen live on this vault, where a morning of edits (deleted games, a
   * book scan) sat unrecorded behind 38 straight lock failures. Nothing
   * else ever writes to this repo, so a lock old
   * enough that no live git process can be holding it is stale by
   * construction and safe to clear.
   */
  const STALE_LOCK_MS = 60_000;
  const clearStaleLock = (): boolean => {
    const lock = resolve(gitDir, 'index.lock');
    try {
      if (Date.now() - statSync(lock).mtimeMs < STALE_LOCK_MS) return false;
      unlinkSync(lock);
      console.error('[vault-backup] cleared a stale index.lock');
      return true;
    } catch {
      return false;
    }
  };

  /** Commit whatever changed, under `message`; nothing when nothing did. */
  const commitAll = async (message: string): Promise<void> => {
    const status = await git(gitDir, dir, ['status', '--porcelain']);
    if (!status.trim()) return;
    await git(gitDir, dir, ['add', '-A']);
    await git(gitDir, dir, ['commit', '-q', '-m', message]);
  };

  /** commitAll, with the repo opened first if the start could not, and a
      stale lock repaired and the commit tried once more. Throws what git
      says otherwise, and before a repo that never opened is made while a
      restore's journal stands (no route commits then anyway). */
  const commitRepairing = async (message: string): Promise<void> => {
    await open();
    try {
      await commitAll(message);
    } catch (error) {
      if (!(error as Error).message.includes('index.lock') || !clearStaleLock()) throw error;
      await commitAll(message);
    }
  };

  /**
   * A restore that stopped part way and could not put itself back leaves
   * its journal standing (server/restore.ts), and the vault half one vault
   * and half another until something puts it back. An autosave's `add -A`
   * there saves the half vault as a version: measured on a running server,
   * the autosave 15 s after such a restore deleted the seven files the
   * restore had set aside, the put-back's own save added them again, and
   * each of them gained a duplicate version per episode. So nothing here records while
   * the journal stands: not the watcher's run, not the baseline at startup
   * (a journal the start could not put back, or cannot read, stays in
   * place, and the server starts guarded by it), not one a
   * route forces. Asked when the run starts, not when it was scheduled,
   * since a run queued behind a restore's swap starts after it. The saves a
   * restore makes itself go through exclusive(), before its journal is
   * written and after it is gone, and are not held. Said once per
   * episode, not on every skipped run.
   */
  let held = false;

  const commitNow = (): Promise<void> => {
    // Serialised: git locks its index, and overlapping runs would just fail.
    running = running.then(async () => {
      if (existsSync(journal)) {
        if (!held) {
          console.warn(
            '[vault-backup] the vault is part way through a restore; nothing is saved to the history until it is put back',
          );
        }
        held = true;
        return;
      }
      held = false;
      try {
        await commitRepairing(`vault autosave ${new Date().toISOString()}`);
      } catch (error) {
        // Logged and retried on the next change — the safety net must
        // never take the server down.
        console.error('[vault-backup]', (error as Error).message);
      }
    });
    return running;
  };

  const exclusive = <T>(work: (commit: (message: string) => Promise<void>) => Promise<T>): Promise<T> => {
    // On the same chain as the autosaves, so it waits for the one in
    // flight and the next one waits for it, whichever way it settles.
    // Whatever ran may have put another history in place (a restore takes
    // a copy's), so the count is taken again when next asked; forgotten
    // before the caller hears back, so its own next ask is a fresh one.
    const result = running.then(() => work(commitRepairing)).finally(() => forgetHistoryLeaks(gitDir));
    running = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void commitNow(), debounceMs);
  };

  // Baseline commit so recovery covers the pre-watcher state too.
  await commitNow();

  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dir, { recursive: true }, (_event, filename) => {
      // The history repo's own writes must not retrigger the watcher, and
      // the source dumps and a restore's work folder are excluded anyway
      // (a copy being unpacked is thousands of writes the repo ignores).
      if (
        !filename ||
        filename.startsWith(HISTORY_DIR_NAME) ||
        filename.startsWith(RESTORE_DIR_NAME) ||
        filename.startsWith('sources')
      ) {
        return;
      }
      schedule();
    });
  } catch (error) {
    console.error('[vault-backup] watcher unavailable:', (error as Error).message);
  }

  return {
    schedule,
    commitNow,
    exclusive,
    leaks: () => historyLeaks(gitDir, dir),
    purge: () =>
      exclusive(async () => {
        await open();
        return purgeHistory(gitDir, dir);
      }),
    stop: () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
      // `running` is the serialised chain of git calls; awaiting it is
      // what makes "stopped" mean the child processes are gone too.
      return running;
    },
  };
}
