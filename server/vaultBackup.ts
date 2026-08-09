import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';

/**
 * Vault safety net: every change inside vault/ is auto-committed to a
 * dedicated history repo, so any bug (or bad edit) that mangles a study,
 * game or book is recoverable with plain git.
 *
 * The history repo's git-dir lives INSIDE the vault as `.history.git` (it
 * moves with the data) but there is no `.git` file or directory marker in
 * the worktree itself — the project repo, which deliberately tracks vault
 * documents too, keeps seeing plain files rather than a submodule
 * boundary. All commands run as `git --git-dir=… --work-tree=…`, the
 * dotfiles pattern.
 *
 * Browse it with:  git --git-dir=vault/.history.git log --stat
 */

const HISTORY_DIR_NAME = '.history.git';
const DEBOUNCE_MS = 15_000;

/** Committer identity for autosaves; nothing global is touched. */
const IDENTITY = [
  '-c',
  'user.name=Chess Vault',
  '-c',
  'user.email=vault@localhost',
];

function git(gitDir: string, workTree: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['--git-dir', gitDir, '--work-tree', workTree, ...IDENTITY, ...args],
      { timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolvePromise(stdout);
      },
    );
  });
}

export interface VaultBackup {
  /** Debounced; called by the fs watcher, exposed for tests. */
  schedule: () => void;
  /** Commit now if anything changed. Resolves when the commit is done. */
  commitNow: () => Promise<void>;
  stop: () => void;
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
  const gitDir = resolve(dir, HISTORY_DIR_NAME);

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
  // would track it), the giant source PGN dumps are rebuild inputs, and —
  // critically — config.json holds the app password, TOTP secret and
  // Lichess token, which must never enter a repo that scripts/backup-vault.sh
  // pulls off-box (git would retain every past value).
  if (existsSync(gitDir)) {
    writeFileSync(
      resolve(gitDir, 'info', 'exclude'),
      `${HISTORY_DIR_NAME}/\nsources/\nconfig.json\n`,
    );
    // Untrack config.json if an earlier version committed it; --ignore-unmatch
    // makes this a no-op once clean. Leaves the working file intact.
    await git(gitDir, dir, ['rm', '--cached', '--quiet', '--ignore-unmatch', 'config.json']).catch(
      () => undefined,
    );
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  const commitNow = (): Promise<void> => {
    // Serialised: git locks its index, and overlapping runs would just fail.
    running = running.then(async () => {
      try {
        const status = await git(gitDir, dir, ['status', '--porcelain']);
        if (!status.trim()) return;
        await git(gitDir, dir, ['add', '-A']);
        await git(gitDir, dir, ['commit', '-q', '-m', `vault autosave ${new Date().toISOString()}`]);
      } catch (error) {
        // Never let the safety net take the server down; a failed commit
        // retries on the next change.
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
    },
  };
}
