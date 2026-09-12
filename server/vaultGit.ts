import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * How the vault's history repo is addressed.
 *
 * Extracted from server/vaultBackup.ts when a second caller appeared (the
 * in-app recovery API in server/vaultHistory.ts). The writer and the reader
 * must agree exactly on the git-dir name, the worktree flag and the
 * committer identity — a reader that addressed the repo even slightly
 * differently would read a different repo, or none, and report "no history"
 * over a vault that has one.
 */

/**
 * The history repo's git-dir lives INSIDE the vault so it moves with the
 * data, and is deliberately not named `.git`: the project repo tracks vault
 * documents too, and a real `.git` there would turn the vault into a
 * submodule boundary. Every command therefore passes both --git-dir and
 * --work-tree, the dotfiles pattern.
 */
export const HISTORY_DIR_NAME = '.history.git';

/** The history git-dir for a given vault directory. */
export function historyGitDir(vaultDir: string): string {
  return resolve(vaultDir, HISTORY_DIR_NAME);
}

/** Committer identity for autosaves; nothing global is touched. */
const IDENTITY = [
  '-c',
  'user.name=Chess Vault',
  '-c',
  'user.email=vault@localhost',
];

/**
 * Config keys whose value git runs as a command, forced to nothing.
 *
 * The vault is a folder the user picks, and its `.history.git` is adopted
 * if one is already there (server/vaultBackup.ts) — so the repo's own
 * config is attacker-supplied whenever the folder is. Several git config
 * keys are commands: `core.fsmonitor` runs on the `status` that the
 * backup does at startup, and `core.hooksPath` points at the hooks that
 * `commit` runs. A folder that arrived by download or by sync could
 * therefore execute code as whoever runs the server, with no traversal
 * and no request involved.
 *
 * `-c` beats the repo's config, so overriding each one here disarms it.
 * This is the second line: vaultBackup refuses such a repo before any git
 * command runs (a `filter.<name>.clean`, which `add` runs, is named
 * dynamically and cannot be listed here — which is why the refusal, not
 * this list, is the actual defence).
 *
 * `false` is a real program that exits non-zero; the empty string is what
 * git reads as "unset" for the path-shaped ones.
 */
const NO_EXEC = [
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.hooksPath=',
  '-c',
  'core.sshCommand=false',
  '-c',
  'core.askPass=',
  '-c',
  'core.editor=false',
  '-c',
  'core.pager=cat',
  '-c',
  'diff.external=',
];

/**
 * The environment a git child gets: this process's, minus anything git
 * reads as configuration. An inherited `GIT_DIR` or `GIT_WORK_TREE` would
 * silently redirect a command whose whole point is the two flags below,
 * and `GIT_CONFIG_GLOBAL`/`NOSYSTEM` keep a machine's own ~/.gitconfig out
 * of a vault's history (it is the vault's repo, not the operator's).
 */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = '';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/**
 * Keys a repo's own config can use to name a program. Matched on the
 * config file as TEXT, before git is asked to read it — the point is to
 * decide without running anything.
 *
 * `filter\..*\.(clean|smudge)` is why this is a text scan rather than a
 * list of `-c` overrides: a filter is named by whoever wrote the config,
 * so there is no fixed key to override, and `git add` runs it for any
 * path a `.gitattributes` in the vault assigns to it.
 */
const EXEC_CONFIG =
  /^\s*(?:hooksPath|fsmonitor|sshCommand|askPass|editor|pager|externalDiff|alternateRefsCommand|gitProxy|clean|smudge|process|textconv|command|packObjectsHook)\s*=/im;

/**
 * Why a history repo is not safe to use, or null if it is.
 *
 * A vault is a folder the user chooses, and it may have arrived from
 * anywhere: a download, a sync folder, a copy of somebody else's vault
 * (the README's own backup story is "copy the folder, history included").
 * If it already holds a `.history.git`, the backup adopts it — and from
 * that moment git is reading a config and running hooks that came with
 * the folder rather than from this server. `git status`, which the backup
 * runs at startup, is enough: `core.fsmonitor` is a command.
 *
 * So a repo this server did not make is inspected with plain fs calls
 * first, and refused if it can execute anything. Refusing is cheap: the
 * caller logs and runs without a safety net, which is what happens anyway
 * when git is missing.
 */
export function unsafeHistoryRepo(gitDir: string): string | null {
  let config = '';
  try {
    config = readFileSync(resolve(gitDir, 'config'), 'utf-8');
  } catch {
    return null; // no config to read is no config to fear
  }
  if (EXEC_CONFIG.test(config)) return 'its config names a program to run';
  try {
    const hooks = readdirSync(resolve(gitDir, 'hooks'));
    // `git init` fills hooks/ with .sample files it will never run.
    if (hooks.some((name) => !name.endsWith('.sample'))) return 'it carries git hooks';
  } catch {
    // No hooks directory at all is the safe shape.
  }
  return null;
}

export function git(gitDir: string, workTree: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      // --literal-pathspecs: a document id may hold `[`, which git reads
      // as a glob, so `log -- studies/a[bc].pgn` listed another document's
      // versions. Every path this helper is handed is a real name.
      [
        '--literal-pathspecs',
        '--git-dir',
        gitDir,
        '--work-tree',
        workTree,
        ...IDENTITY,
        ...NO_EXEC,
        ...args,
      ],
      // 64 MB rather than execFile's 1 MB default. `git show` of a study
      // hands back a whole PGN, which the studies route caps at 20 MB, and
      // `status --porcelain` over a vault mid-import lists thousands of
      // paths — both silently became "command failed" at the default, and
      // for the writer that meant an autosave that quietly did not happen.
      { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, env: gitEnv() },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr.trim() || error.message));
        else resolvePromise(stdout);
      },
    );
  });
}
