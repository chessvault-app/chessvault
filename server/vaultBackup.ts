import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';
import { git, historyGitDir, HISTORY_DIR_NAME } from './vaultGit.ts';

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
  // given exclude existed is repaired on the next boot. Repo-side excludes
  // (never a file in the vault): the history repo must not swallow its own
  // git-dir (`.history.git` is not a magic name like `.git`, so `add -A`
  // would track it), the giant source PGN dumps are rebuild inputs, the
  // unsaved-changes swap files are a live buffer rather than a version of
  // anything (a history of every keystroke somebody had not committed is
  // exactly what this repo is not for), and — critically — config.json
  // holds the app password, TOTP secret and Lichess token, which must
  // never enter a repo that scripts/backup-vault.sh pulls off-box (git
  // would retain every past value). sessions.json sits under the same
  // rule: live session hashes are secrets-adjacent, and it churns on
  // every login, which is not a version of anything.
  if (existsSync(gitDir)) {
    writeFileSync(
      resolve(gitDir, 'info', 'exclude'),
      `${HISTORY_DIR_NAME}/\nsources/\nbooks/*/book.pdf\n*.part\nconfig.json\nsessions.json\n*.swp\n`,
    );
    // Untrack them if an earlier version committed either; --ignore-unmatch
    // makes this a no-op once clean. Leaves the working files intact.
    await git(gitDir, dir, [
      'rm',
      '--cached',
      '--quiet',
      '--ignore-unmatch',
      'config.json',
      'sessions.json',
      'books/*/book.pdf',
    ]).catch(() => undefined);
  }

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

  const commitNow = (): Promise<void> => {
    // Serialised: git locks its index, and overlapping runs would just fail.
    running = running.then(async () => {
      const commit = async (): Promise<void> => {
        const status = await git(gitDir, dir, ['status', '--porcelain']);
        if (!status.trim()) return;
        await git(gitDir, dir, ['add', '-A']);
        await git(gitDir, dir, ['commit', '-q', '-m', `vault autosave ${new Date().toISOString()}`]);
      };
      try {
        await commit();
      } catch (error) {
        // A stale lock is repaired and the commit retried once; anything
        // else is logged and retried on the next change — the safety net
        // must never take the server down.
        if ((error as Error).message.includes('index.lock') && clearStaleLock()) {
          try {
            await commit();
            return;
          } catch (retryError) {
            console.error('[vault-backup]', (retryError as Error).message);
            return;
          }
        }
        console.error('[vault-backup]', (error as Error).message);
      }
    });
    return running;
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
      // the source dumps are excluded anyway.
      if (!filename || filename.startsWith(HISTORY_DIR_NAME) || filename.startsWith('sources')) {
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
    stop: () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
      // `running` is the serialised chain of git calls; awaiting it is
      // what makes "stopped" mean the child processes are gone too.
      return running;
    },
  };
}
