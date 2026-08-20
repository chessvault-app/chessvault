import { execFile } from 'node:child_process';
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

export function git(gitDir: string, workTree: string, args: string[]): Promise<string> {
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
