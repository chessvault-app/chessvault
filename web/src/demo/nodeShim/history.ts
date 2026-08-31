/**
 * The demo's answer to "what did this document used to say?"
 *
 * A real deployment keeps every vault change in `vault/.history.git` and
 * `server/vaultHistory.ts` reads it with five git commands. A page has no
 * git and no child processes, so both of the Settings cards built on it —
 * earlier versions, and restoring a deleted document — were simply absent
 * from the demo. They are the app's safety net, and a safety net nobody
 * can look at is a poor advertisement for one.
 *
 * What the demo has instead is better than an imitation: it sees every
 * write, because every write goes through the filesystem shim beside this
 * file. So it keeps the versions itself, and answers the same five
 * questions from them. The QUESTIONS still live in vaultHistory.ts — this
 * only supplies the answers, in the shapes git would have used.
 *
 * A version is kept per write, newest last, capped per path: a visitor
 * editing a note in the demo is making history, and after a hundred
 * keystrokes of autosave only the last few are worth offering back.
 */

interface Version {
  /** Stands in for a commit sha: 40 hex characters, from a counter. */
  sha: string;
  /** ISO, as `%aI` writes it. */
  at: string;
  /** The document as it stood. `null` marks the write that deleted it. */
  content: string | null;
}

/** Vault-relative path -> its versions, oldest first. */
const versions = new Map<string, Version[]>();
let counter = 0;

/**
 * Enough to be going on with, and few enough to read.
 *
 * The card lists versions to choose between, so a hundred autosaves of one
 * note would bury the one somebody wants under ninety-nine that differ by
 * a word.
 */
const PER_PATH = 12;

/** Where the demo's vault is, so a path can be made relative to it. */
let root = '/vault';

export function setHistoryRoot(path: string): void {
  root = path.replace(/\/+$/, '');
}

/**
 * The path as the history repo would spell it, or null for anything that
 * is not a document — the shim sees bookmark files, puzzle progress and
 * the derived index too, and none of those has versions worth offering.
 */
function repoPath(path: string): string | null {
  if (!path.startsWith(`${root}/`)) return null;
  const rel = path.slice(root.length + 1);
  const document =
    (rel.startsWith('studies/') && rel.endsWith('.pgn')) ||
    (rel.startsWith('notes/') && rel.endsWith('.md')) ||
    (rel.startsWith('games/collection/') && rel.endsWith('.pgn'));
  if (!document) return null;
  // A dotfile is bookkeeping — .bookmarks.json lives among the documents.
  return rel.split('/').some((segment) => segment.startsWith('.')) ? null : rel;
}

const shaFor = (): string => {
  counter += 1;
  return counter.toString(16).padStart(40, '0');
};

/** Called by the shim on every write, and on every delete with null. */
export function recordVersion(path: string, content: string | null, at = Date.now()): void {
  const rel = repoPath(path);
  if (rel === null) return;
  const list = versions.get(rel) ?? [];
  const last = list.at(-1);
  // Writing a document unchanged is not a version of it. Autosave fires on
  // a timer as well as on a keystroke, and without this every document in
  // the vault would collect versions identical to the one before.
  if (last && last.content === content) return;
  list.push({ sha: shaFor(), at: new Date(at).toISOString(), content });
  versions.set(rel, list.slice(-PER_PATH));
}

/** Whether anything has been written yet — the `available` question. */
export function haveVersions(): boolean {
  return versions.size > 0;
}

/**
 * The five git commands `vaultHistory.ts` issues, answered from the map
 * above in the shapes its own parser expects. Anything else is refused
 * rather than guessed at, so a sixth command added there fails loudly here
 * instead of returning something plausible.
 */
export async function runHistory(args: string[]): Promise<string> {
  const [command] = args;

  if (command === 'rev-parse') {
    if (!haveVersions()) throw new Error('no commits yet');
    return '';
  }

  if (command === 'show') {
    // `show <sha>:<path>`
    const [sha, path] = (args[1] ?? '').split(/:(.*)/s);
    const found = (versions.get(path ?? '') ?? []).find((v) => v.sha === sha);
    if (!found || found.content === null) throw new Error('no such version');
    return found.content;
  }

  if (command === 'log' && args.includes('--diff-filter=AM')) {
    // Versions of one path, newest first, as `%H%x09%aI`.
    const path = args.at(-1) ?? '';
    return (versions.get(path) ?? [])
      .filter((v) => v.content !== null)
      .reverse()
      .map((v) => `${v.sha}\t${v.at}`)
      .join('\n');
  }

  if (command === 'log' && args.includes('--diff-filter=D')) {
    // Deletions under one base, newest first: a `\0`-prefixed date line,
    // then the paths that went with it.
    const base = args.at(-1) ?? '';
    const lines: string[] = [];
    const gone: { at: string; path: string }[] = [];
    for (const [path, list] of versions) {
      if (!path.startsWith(`${base}/`)) continue;
      const last = list.at(-1);
      if (last?.content === null) gone.push({ at: last.at, path });
    }
    gone.sort((a, b) => b.at.localeCompare(a.at));
    for (const { at, path } of gone) lines.push(`\0${at}`, path);
    return lines.join('\n');
  }

  throw new Error(`demo history cannot answer: git ${args.join(' ')}`);
}
