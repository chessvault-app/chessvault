import { HISTORY_DIR_NAME, RESTORE_DIR_NAME } from './vaultGit.ts';

/**
 * What the vault's history never holds, in one list.
 *
 * The history repo (server/vaultBackup.ts) writes this list into its own
 * exclude file, never a file in the vault, at every start and at once
 * after a wipe or a restore makes a new repo. Every pattern means what it
 * means in a .gitignore at the top of the vault: one that starts with a
 * slash is at the top only, and the rest match at any depth. Everything
 * here that the server writes at the top of the vault is said so, since
 * a pattern with no slash in it matches every folder of that name: with
 * `sources/`, a notes or studies folder named sources was never saved.
 *
 * Each entry has a kind, which is how Settings names it when an earlier
 * save holds one anyway (server/historyPurge.ts):
 *
 * - credentials: config.json holds the app password, the 2FA secret and
 *   the Lichess token, which must never enter a repo that
 *   scripts/backup-vault.sh pulls off-box and that "Download a copy"
 *   packs (git would retain every past value). sessions.json sits under
 *   the same rule: live session hashes are secrets-adjacent, and it
 *   churns on every login, which is not a version of anything.
 * - folder: the history repo's own git-dir. `.history.git` is not a
 *   magic name like `.git`, so `add -A` would track it.
 * - books: a book's PDF is the user's own copy of a book, often a
 *   commercial one, megabytes that never change; and its open.bin is a
 *   cache the server records from that PDF and records again when the
 *   PDF changes (server/pdfWarm.ts), worth nothing beside a PDF this repo
 *   does not hold (611 KB for a 448-page scan, and a new copy each time
 *   the file is replaced).
 * - sources: the PGN files the reference databases are built from, which
 *   are rebuild inputs, and gigabytes.
 * - other: a restore's work folder, which holds a copy being unpacked
 *   and the vault it replaced, and which the history records as the
 *   vault on either side of the restore, not as files of its own; a
 *   download or an upload still on its way (`.part`); and the
 *   unsaved-changes swap files, a live buffer rather than a version of
 *   anything (a history of every keystroke somebody had not committed is
 *   exactly what this repo is not for).
 */
export type HistoryExcludedKind = 'credentials' | 'folder' | 'books' | 'sources' | 'other';

export const NEVER_IN_HISTORY: readonly { pattern: string; kind: HistoryExcludedKind }[] = [
  { pattern: `/${HISTORY_DIR_NAME}/`, kind: 'folder' },
  { pattern: `/${RESTORE_DIR_NAME}/`, kind: 'other' },
  { pattern: '/sources/', kind: 'sources' },
  { pattern: '/books/*/book.pdf', kind: 'books' },
  { pattern: '/books/*/open.bin', kind: 'books' },
  { pattern: '*.part', kind: 'other' },
  { pattern: '/config.json', kind: 'credentials' },
  { pattern: '/sessions.json', kind: 'credentials' },
  { pattern: '*.swp', kind: 'other' },
];

/** The history repo's exclude file: the list, one pattern a line. */
export function historyExcludeFile(): string {
  return NEVER_IN_HISTORY.map(({ pattern }) => `${pattern}\n`).join('');
}
