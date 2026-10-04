import { git, HISTORY_DIR_NAME, RESTORE_DIR_NAME, type Pathspecs } from './vaultGit.ts';

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

/**
 * The list, asked of one path at a time.
 *
 * git reads the exclude file and nothing else does; what has to ask the
 * list without git (which tracked paths to untrack at a start, what a
 * count reports and what a purge takes out of each save) asks this. It
 * reads the same patterns with the same rules, for the part of .gitignore
 * the list uses: a leading slash, a slash in the middle, a trailing slash
 * and `*` within one name. A pattern outside that part throws when the
 * module loads, so the list cannot grow a rule this does not read, and
 * server/historyExcludes.test.ts holds it to git's own reading of the file.
 */
export interface HistoryMatcher {
  /** The kind of `path` if the list names it, as a folder when `folder`.
      The path's own folders are not asked: the caller came through them. */
  self: (path: string, folder: boolean) => HistoryExcludedKind | null;
  /** Of a file's path: the shallowest part of it the list names, a folder
      it is in or the file itself, and its kind; null where none is named. */
  within: (path: string) => { at: string; kind: HistoryExcludedKind } | null;
  /** Pathspecs that hold every path the list names and maybe more, for git
      to narrow a walk by before `within` decides. */
  pathspecs: string[];
  /** How git is to read them (server/vaultGit.ts). */
  mode: Pathspecs;
}

interface Rule {
  kind: HistoryExcludedKind;
  /** A folder only: the pattern ends in a slash. */
  folder: boolean;
  /** From the top, a pattern a level; else the last name, at any depth. */
  anchored: boolean;
  levels: string[];
}

/** What a pattern may hold: names, a slash, and `*`. */
const PLAIN = /^[A-Za-z0-9._/*-]+$/;

const RULES: Rule[] = NEVER_IN_HISTORY.map(({ pattern, kind }) => {
  if (!PLAIN.test(pattern) || pattern.includes('**')) throw new Error(`the history's exclude list reads only names, slashes and *: ${pattern}`);
  const folder = pattern.endsWith('/');
  const body = folder ? pattern.slice(0, -1) : pattern;
  // As git reads it: a slash at the start or in the middle ties a pattern
  // to the top of the vault.
  const anchored = body.includes('/');
  return { kind, folder, anchored, levels: (body.startsWith('/') ? body.slice(1) : body).split('/') };
});

const escape = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** The list's matcher, matching names in any case where `ignoreCase`. */
export function historyMatcher(ignoreCase: boolean): HistoryMatcher {
  const compiled = RULES.map((rule) => ({
    ...rule,
    levels: rule.levels.map((level) => new RegExp(`^${level.split('*').map(escape).join('[^/]*')}$`, ignoreCase ? 'i' : '')),
  }));
  const self = (path: string, folder: boolean): HistoryExcludedKind | null => {
    const names = path.split('/');
    const name = names[names.length - 1]!;
    for (const rule of compiled) {
      if (rule.folder && !folder) continue;
      if (rule.anchored ? names.length === rule.levels.length && rule.levels.every((level, i) => level.test(names[i]!)) : rule.levels[0]!.test(name)) {
        return rule.kind;
      }
    }
    return null;
  };
  const within = (path: string): { at: string; kind: HistoryExcludedKind } | null => {
    for (let end = path.indexOf('/'); ; end = path.indexOf('/', end + 1)) {
      const at = end < 0 ? path : path.slice(0, end);
      const kind = self(at, end >= 0);
      if (kind) return { at, kind };
      if (end < 0) return null;
    }
  };
  // In glob pathspecs `*` stays within one name, as it does here, and a
  // leading `**/` is any depth, the top included. The `/**` twins reach
  // into a folder the list names however it is spelled.
  const pathspecs = RULES.flatMap((rule) => {
    const body = rule.levels.join('/');
    return rule.anchored ? [body, `${body}/**`] : [`**/${body}`, `**/${body}/**`];
  });
  return { self, within, pathspecs, mode: ignoreCase ? 'glob-icase' : 'glob' };
}

/**
 * The matcher for the history at `gitDir`: in any case where the repo's
 * `core.ignorecase` is on, as git's `git init` sets it on a filesystem that
 * folds case (Windows, macOS), since git then reads the exclude file the
 * same way.
 */
export async function historyMatcherFor(gitDir: string, dir: string): Promise<HistoryMatcher> {
  const ignoreCase = (await git(gitDir, dir, ['config', '--bool', 'core.ignorecase']).catch(() => '')).trim() === 'true';
  return historyMatcher(ignoreCase);
}
