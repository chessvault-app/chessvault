import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
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
  /** What the history holds of the credentials and its own folder, as
      last counted (server/historyPurge.ts). */
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
 * Repo-side excludes (never a file in the vault): the history repo must
 * not swallow its own git-dir (`.history.git` is not a magic name like
 * `.git`, so `add -A` would track it), the giant source PGN dumps are
 * rebuild inputs, the unsaved-changes swap files are a live buffer rather
 * than a version of anything (a history of every keystroke somebody had
 * not committed is exactly what this repo is not for), each book's
 * open.bin is a cache the server records from that book's PDF and
 * records again when the PDF changes (server/pdfWarm.ts), worth nothing
 * beside a PDF this repo does not hold (611 KB for a 448-page scan, and a
 * new copy each time the file is replaced), and — critically —
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
    `${HISTORY_DIR_NAME}/\n${RESTORE_DIR_NAME}/\nsources/\nbooks/*/book.pdf\nbooks/*/open.bin\n*.part\nconfig.json\nsessions.json\n*.swp\n`,
  );
  // Untrack them if an earlier version committed any; --ignore-unmatch
  // makes this a no-op once clean. Leaves the working files intact. The
  // per-book files are listed first and then named one by one: the
  // helper passes --literal-pathspecs, which turns off pathspec magic
  // as well as globs, so the `:(glob)books/*/book.pdf` this once passed
  // named a file of that literal name and untracked nothing.
  // In batches: a path is about 35 characters, and Windows refuses a
  // command line past 32,767, which a long shelf would otherwise reach.
  const perBook = (await git(gitDir, dir, ['ls-files', '-z', '--', 'books']).catch(() => ''))
    .split('\0')
    .filter((path) => /^books\/[^/]+\/(book\.pdf|open\.bin)$/.test(path));
  const untrack = ['config.json', 'sessions.json', ...perBook];
  for (let at = 0; at < untrack.length; at += 200) {
    const batch = untrack.slice(at, at + 200);
    await git(gitDir, dir, ['rm', '--cached', '--quiet', '--ignore-unmatch', ...batch]).catch(() => undefined);
  }
  // The repo's own folder and a restore's work folder, which are folders,
  // hence -r. A wipe before the one that writes this exclude at once
  // (server/settings.ts) let the autosave track .history.git itself, and
  // an exclude never untracks what the index already holds: every save
  // after a restart went on committing the repo's own index and refs.
  await git(gitDir, dir, [
    'rm',
    '-r',
    '--cached',
    '--quiet',
    '--ignore-unmatch',
    HISTORY_DIR_NAME,
    RESTORE_DIR_NAME,
  ]).catch(() => undefined);
  // Untracking stops here; it does not reach into commits already made.
  // The open caches an earlier version committed stay in the repo's
  // objects until its history is rewritten: dead weight rather than a
  // secret, so nothing is said about them at boot.
  // A history that carries an old config.json carries every password
  // hash, authenticator secret and Lichess token it ever held, and
  // scripts/backup-vault.sh copies the whole repo off-box. Said once,
  // loudly, at boot, and offered in Settings (server/historyPurge.ts):
  // rewriting history is the owner's call, not this server's. Counted
  // fresh here, which is also what Settings is answered from until the
  // history next changes under a restore, a wipe or a purge; which secrets
  // it holds is read at Settings' first ask, not here.
  const leaks = await historyCount(gitDir, dir, { fresh: true }).catch(() => null);
  if (leaks && leaks.commits > 0) {
    console.warn(
      `[vault-backup] ${leaks.commits} save(s) in ${HISTORY_DIR_NAME} hold config.json, sessions.json or the history's own folder, from an older version or an earlier wipe, and may hold past secrets. Settings, Security takes them out: "Remove old secrets", or "Remove old files" where they hold none (the paragraph on backups in README.md does the same from a terminal).`,
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

  // A purge the server was stopped in the middle of has rewritten the
  // history and not yet deleted the old saves; finished first, so the count
  // below is of a history that holds none of them.
  await finishInterruptedPurge(gitDir, dir).catch((error: Error) => {
    console.error('[vault-backup] could not finish removing the old secrets:', error.message);
  });

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

  /**
   * A restore that stopped part way and could not put itself back leaves
   * its journal standing (server/restore.ts), and the vault half one vault
   * and half another until something puts it back. An autosave's `add -A`
   * there saves the half vault as a version: measured on a running server,
   * the autosave 15 s after such a restore deleted the seven files the
   * restore had set aside, the put-back's own save added them again, and
   * each of them gained a duplicate version per episode. So nothing here records while
   * the journal stands: not the watcher's run, not the baseline at startup
   * (a journal that cannot be read stays in place at boot), not one a
   * route forces. Asked when the run starts, not when it was scheduled,
   * since a run queued behind a restore's swap starts after it. The saves a
   * restore makes itself go through exclusive(), before its journal is
   * written and after it is gone, and are not held. Said once per
   * episode, not on every skipped run.
   */
  const journal = restoreJournalPath(dir);
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
    purge: () => exclusive(() => purgeHistory(gitDir, dir)),
    stop: () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
      // `running` is the serialised chain of git calls; awaiting it is
      // what makes "stopped" mean the child processes are gone too.
      return running;
    },
  };
}
