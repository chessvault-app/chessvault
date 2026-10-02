import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';
import { git, historyGitDir, HISTORY_DIR_NAME, RESTORE_DIR_NAME, unsafeHistoryRepo } from './vaultGit.ts';

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
  /** Commit now if anything changed. Resolves when the commit is done. */
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
}

/**
 * Bring a history repo's own settings up to what this version expects.
 *
 * A function of its own because two repos need it: the vault's, on every
 * startup, and one taken over from a copy being restored
 * (server/restore.ts), which was made by whatever version wrote the copy.
 *
 * Repo-side excludes (never a file in the vault): the history repo must
 * not swallow its own git-dir (`.history.git` is not a magic name like
 * `.git`, so `add -A` would track it), the giant source PGN dumps are
 * rebuild inputs, the unsaved-changes swap files are a live buffer rather
 * than a version of anything (a history of every keystroke somebody had
 * not committed is exactly what this repo is not for), and — critically —
 * config.json holds the app password, TOTP secret and Lichess token,
 * which must never enter a repo that scripts/backup-vault.sh pulls
 * off-box (git would retain every past value). sessions.json sits under
 * the same rule: live session hashes are secrets-adjacent, and it churns
 * on every login, which is not a version of anything. A restore's work
 * folder holds a copy being unpacked and the vault it replaced, which the
 * history records as the vault on either side of the restore, not as files
 * of its own.
 */
export async function prepareHistoryRepo(gitDir: string, dir: string): Promise<void> {
  writeFileSync(
    resolve(gitDir, 'info', 'exclude'),
    `${HISTORY_DIR_NAME}/\n${RESTORE_DIR_NAME}/\nsources/\nbooks/*/book.pdf\n*.part\nconfig.json\nsessions.json\n*.swp\n`,
  );
  // Untrack them if an earlier version committed either; --ignore-unmatch
  // makes this a no-op once clean. Leaves the working files intact. The
  // helper passes --literal-pathspecs, so the pdf pattern is spelled as
  // git's own glob form rather than left to the shell-style default.
  await git(gitDir, dir, [
    'rm',
    '--cached',
    '--quiet',
    '--ignore-unmatch',
    'config.json',
    'sessions.json',
    ':(glob)books/*/book.pdf',
  ]).catch(() => undefined);
  // Untracking stops here; it does not reach into commits already made.
  // A history that carries an old config.json carries every password
  // hash, authenticator secret and Lichess token it ever held, and
  // scripts/backup-vault.sh copies the whole repo off-box. Said once,
  // loudly, at boot: rewriting history is the owner's call, not this
  // server's.
  const leaked = await git(gitDir, dir, [
    'log',
    '--all',
    '--format=%H',
    '--',
    'config.json',
    'sessions.json',
  ]).catch(() => '');
  const commits = leaked.split('\n').filter(Boolean).length;
  if (commits > 0) {
    console.warn(
      `[vault-backup] ${commits} commit(s) in ${HISTORY_DIR_NAME} still carry config.json or sessions.json from an older version. They hold past secrets; see "Backups" in README.md for how to purge them.`,
    );
  }
}

/**
 * Start watching `dir` and auto-committing its changes. Returns handles
 * for shutdown and tests; resolves after the repo exists and the current
 * state is committed, so the safety net has no startup gap.
 */
export async function startVaultBackup(
  dir: string = VAULT,
  debounceMs: number = DEBOUNCE_MS,
): Promise<VaultBackup> {
  const gitDir = historyGitDir(dir);

  // Before ANY git command touches it: a history repo that came with the
  // folder rather than from this server is not run. See unsafeHistoryRepo.
  const unsafe = existsSync(gitDir) ? unsafeHistoryRepo(gitDir) : null;
  if (unsafe !== null) {
    throw new Error(
      `refusing to use ${HISTORY_DIR_NAME} in this vault: ${unsafe}. ` +
        `A history repo that did not come from this app can run code when the app commits. ` +
        `Move or delete ${HISTORY_DIR_NAME} to get the safety net back.`,
    );
  }

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

  // Run on EVERY startup, not just first init, so a repo created before a
  // given exclude existed is repaired on the next boot.
  if (existsSync(gitDir)) await prepareHistoryRepo(gitDir, dir);

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

  /** commitAll, with a stale lock repaired and the commit tried once
      more. Throws what git says otherwise. */
  const commitRepairing = async (message: string): Promise<void> => {
    try {
      await commitAll(message);
    } catch (error) {
      if (!(error as Error).message.includes('index.lock') || !clearStaleLock()) throw error;
      await commitAll(message);
    }
  };

  const commitNow = (): Promise<void> => {
    // Serialised: git locks its index, and overlapping runs would just fail.
    running = running.then(async () => {
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
    const result = running.then(() => work(commitRepairing));
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
    stop: () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
      // `running` is the serialised chain of git calls; awaiting it is
      // what makes "stopped" mean the child processes are gone too.
      return running;
    },
  };
}
