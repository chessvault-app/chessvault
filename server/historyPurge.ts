import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { git, gitPipe, HISTORY_DIR_NAME } from './vaultGit.ts';

/**
 * Taking the old secrets out of the vault's history, from inside the app.
 *
 * The history (server/vaultBackup.ts) leaves config.json and sessions.json
 * out, and its own folder with them. Two kinds of vault still hold them in
 * earlier saves: one older than the exclude, and one wiped with "Wipe all
 * data" before 0.12.1, whose new history saved them, and the repo's own
 * files, until the server restarted. Every password hash, authenticator
 * secret and Lichess token config.json ever held is then in each copy
 * "Download a copy" makes and each one scripts/backup-vault.sh pulls. The
 * way out was a page of git in the README, which is a user action that
 * needed a shell; this is that page, run by the server.
 *
 * What it does: every save from the first that held one of them is
 * written again without them, keeping every other file, the message, the
 * author, the committer and both dates byte for byte, and the same graph.
 * The saves before that one keep their ids, since nothing of them changes.
 * Then the old saves are made unreachable and deleted from git's store,
 * which is the half that matters: rewritten saves alone leave the old
 * ones in the packs that a copy carries.
 *
 * How: `cat-file --batch` reads every commit and its top-level tree, and
 * `fast-import` writes the new ones, one process each. The purged entries
 * are all at the top of the vault, so only a commit's root tree changes and
 * every folder under it is reused by id. The obvious plumbing, `ls-tree`,
 * `mktree` and `commit-tree` per save, is three processes a save, and one
 * measured 28 ms on a Windows desktop (200 `commit-tree`s in 5.6 s): about
 * four minutes for 3,000 saves. This way, a generated history of 3,000
 * saves and 30 MB of packs took 1.3 s, half of it the `gc`, and one of
 * 10,000 saves and 114 MB took 3.9 s.
 */

/** The credentials: what the history must never hold. */
const CREDENTIALS = ['config.json', 'sessions.json'];

/** Every top-level entry a purge takes out. */
const PURGED = new Set([...CREDENTIALS, HISTORY_DIR_NAME]);

/** Where fast-import puts what it writes until the refs are moved. Its
    own name, so nothing else in the repo is ever touched by the import. */
const WORK_REF = 'refs/chessvault/purge';

/** Written before the refs move and deleted once the old saves are gone
    from git's store; found at a start, it means a purge was cut off between
    the two, and the start finishes it (finishInterruptedPurge). */
const MARKER = 'chessvault-purging';

/** fast-import's record of which new commit is which mark. */
const MARKS = 'chessvault-purge-marks';

/** What the history holds that it must not, and how much of it. */
export interface HistoryLeaks {
  /** Saves that wrote any of them, each counted once. */
  commits: number;
  /** Saves that wrote config.json or sessions.json. */
  credentials: number;
  /** Saves that wrote the history's own folder. */
  folder: number;
  /** A purge was cut off after the rewrite: the old saves are out of the
      history but still in git's store, so a copy still carries them. */
  pending: boolean;
}

/** What a purge did. */
export interface PurgeOutcome {
  /** Saves written again: every one from the first that held them. */
  rewritten: number;
  /** What the history held before. */
  removed: HistoryLeaks;
  /** Whether the old saves are gone from git's store too. False leaves
      the marker, and the next start (or the next purge) deletes them. */
  pruned: boolean;
  /** How long it took, in milliseconds. */
  ms: number;
}

/**
 * The saves that wrote any of `paths`: added or changed them, not the ones
 * that only took them out. A save that holds one either wrote it or has an
 * ancestor that did, so none of these means none hold them, and a save
 * that untracked them (the first after a start that found them) does not
 * count as one more.
 *
 * --full-history so a side branch is walked even where a merge matches
 * the other side; --no-renames so a renamed config.json is still a
 * config.json written.
 */
async function writers(gitDir: string, dir: string, paths: string[]): Promise<Set<string>> {
  const out = await git(gitDir, dir, [
    'log',
    '--all',
    '--full-history',
    '--no-renames',
    '--diff-filter=d',
    '--format=%H',
    '--',
    ...paths,
  ]).catch(() => ''); // a repo with no commits yet holds nothing
  return new Set(out.split('\n').filter(Boolean));
}

/** Count afresh. */
async function countLeaks(gitDir: string, dir: string): Promise<HistoryLeaks> {
  const [credentials, folder] = await Promise.all([
    writers(gitDir, dir, CREDENTIALS),
    writers(gitDir, dir, [HISTORY_DIR_NAME]),
  ]);
  return {
    commits: new Set([...credentials, ...folder]).size,
    credentials: credentials.size,
    folder: folder.size,
    pending: existsSync(resolve(gitDir, MARKER)),
  };
}

/**
 * The last count per history repo. A count walks every save's diff, about
 * the cost of the start itself, and only a start, a restore (which can
 * take a copy's history), a wipe (which makes a new one) and a purge can
 * change what it says: the history's excludes keep every autosave out of
 * it. So it is counted then and remembered, and Settings asks for nothing
 * more than this map holds.
 */
const counted = new Map<string, Promise<HistoryLeaks>>();

/** What the history at `gitDir` holds, as last counted; counted now when
    `fresh` or when nothing has been. */
export function historyLeaks(gitDir: string, dir: string, { fresh = false } = {}): Promise<HistoryLeaks> {
  const key = resolve(gitDir);
  const known = fresh ? undefined : counted.get(key);
  if (known) return known;
  const count = countLeaks(gitDir, dir);
  counted.set(key, count);
  // A count that failed is not remembered: the next ask tries again.
  count.catch(() => {
    if (counted.get(key) === count) counted.delete(key);
  });
  return count;
}

/** Forget the count for `gitDir`: what the repo holds may have changed. */
export function forgetHistoryLeaks(gitDir: string): void {
  counted.delete(resolve(gitDir));
}

// --- Reading objects ----------------------------------------------------------

/** Every object in `ids`, read in one `cat-file --batch`, in order. */
async function readObjects(gitDir: string, dir: string, ids: string[]): Promise<Buffer[]> {
  if (ids.length === 0) return [];
  const out = await gitPipe(gitDir, dir, ['cat-file', '--batch'], `${ids.join('\n')}\n`);
  const objects: Buffer[] = [];
  let at = 0;
  for (const id of ids) {
    const end = out.indexOf(0x0a, at);
    const header = out.subarray(at, end).toString('latin1');
    const size = Number(header.split(' ')[2]);
    if (end < 0 || header.endsWith(' missing') || !Number.isInteger(size)) {
      throw new Error(`the history cannot read ${id}: ${header}`);
    }
    objects.push(out.subarray(end + 1, end + 1 + size));
    at = end + 1 + size + 1; // the object, then the newline after it
  }
  return objects;
}

/** A commit, as much of it as a rewrite carries over. Header values are
    latin1 strings, so whatever bytes a name holds go back out as they came. */
interface Commit {
  id: string;
  parents: string[];
  tree: string;
  author: string | null;
  committer: string;
  encoding: string | null;
  message: Buffer;
}

function parseCommit(id: string, parents: string[], raw: Buffer): Commit {
  const split = raw.indexOf('\n\n');
  const head = (split < 0 ? raw : raw.subarray(0, split)).toString('latin1');
  const fields = new Map<string, string>();
  for (const line of head.split('\n')) {
    // A line that starts with a space continues the field before it (a
    // signature), which a rewrite drops: it would not verify anyway.
    if (line.startsWith(' ')) continue;
    const space = line.indexOf(' ');
    const key = line.slice(0, space);
    if (!fields.has(key)) fields.set(key, line.slice(space + 1));
  }
  const tree = fields.get('tree');
  const committer = fields.get('committer');
  if (!tree || !committer) throw new Error(`the history cannot read commit ${id}`);
  return {
    id,
    parents,
    tree,
    author: fields.get('author') ?? null,
    committer,
    encoding: fields.get('encoding') ?? null,
    message: split < 0 ? Buffer.alloc(0) : raw.subarray(split + 2),
  };
}

/** A tree's entries, in the tree's own order. */
interface Entry {
  mode: string;
  name: string;
  id: string;
}

function parseTree(raw: Buffer): Entry[] {
  const entries: Entry[] = [];
  let at = 0;
  while (at < raw.length) {
    const space = raw.indexOf(0x20, at);
    const nul = raw.indexOf(0, space);
    entries.push({
      mode: raw.subarray(at, space).toString('latin1'),
      name: raw.subarray(space + 1, nul).toString('latin1'),
      id: raw.subarray(nul + 1, nul + 21).toString('hex'),
    });
    at = nul + 21;
  }
  return entries;
}

// --- Writing ------------------------------------------------------------------

/** A path as fast-import reads one: quoted when it starts with a quote or
    holds a newline, which it would otherwise misread. */
function importPath(name: string): string {
  if (!name.startsWith('"') && !name.includes('\n')) return name;
  return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;
}

/** A ref to carry over: what it points at now, and the commit that is. */
interface Ref {
  name: string;
  old: string;
  commit: string;
}

/**
 * The refs a purge moves, and the ones it deletes.
 *
 * Kept: every ref at a commit, and a tag at one (written back as a plain
 * ref to the new commit). Deleted: what filter-branch leaves under
 * refs/original (the README's way of doing this, run by hand, keeps the
 * old saves there), what a purge cut off before its end left under its
 * own name, and anything that is not a commit at all, which a history this
 * app wrote never holds.
 */
async function readRefs(gitDir: string, dir: string): Promise<{ keep: Ref[]; drop: Ref[]; detached: string | null }> {
  const out = await git(gitDir, dir, [
    'for-each-ref',
    '--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)',
  ]);
  const keep: Ref[] = [];
  const drop: Ref[] = [];
  for (const line of out.split('\n').filter(Boolean)) {
    const [name = '', old = '', type, peeled = '', peeledType] = line.split('\0');
    const commit = type === 'commit' ? old : type === 'tag' && peeledType === 'commit' ? peeled : '';
    if (name.startsWith('refs/original/') || name === WORK_REF || commit === '') drop.push({ name, old, commit });
    else keep.push({ name, old, commit });
  }
  // A detached HEAD points at a commit no ref names, so it is moved too.
  const symbolic = await git(gitDir, dir, ['symbolic-ref', '-q', 'HEAD']).then(
    () => true,
    () => false,
  );
  const detached = symbolic ? null : (await git(gitDir, dir, ['rev-parse', '--verify', '-q', 'HEAD']).catch(() => '')).trim() || null;
  return { keep, drop, detached };
}

/**
 * The old saves deleted from git's store: the reflogs that still name them
 * emptied, then everything nothing reaches pruned and the packs written
 * again. ORIG_HEAD and FETCH_HEAD are files git keeps beside the refs, and
 * would hold an old save up if one were there.
 */
async function prune(gitDir: string, dir: string): Promise<void> {
  for (const name of ['ORIG_HEAD', 'FETCH_HEAD']) rmSync(resolve(gitDir, name), { force: true });
  await git(gitDir, dir, ['reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all']);
  await gitPipe(gitDir, dir, ['gc', '--prune=now', '--quiet']);
  rmSync(resolve(gitDir, MARKER), { force: true });
}

/**
 * A purge cut off after its refs moved left the old saves in git's store,
 * where a copy would still carry them, and nothing in the history any more
 * to say so. The start that finds its marker finishes the job.
 */
export async function finishInterruptedPurge(gitDir: string, dir: string): Promise<void> {
  if (!existsSync(resolve(gitDir, MARKER))) return;
  await prune(gitDir, dir);
  forgetHistoryLeaks(gitDir);
  console.warn('[vault-backup] a removal of old secrets from the history was cut off; it is finished now');
}

/** prune(), said rather than thrown: by then the history is rewritten,
    and the marker it leaves is what has the next start finish it. */
async function pruned(gitDir: string, dir: string): Promise<boolean> {
  try {
    await prune(gitDir, dir);
    return true;
  } catch (error) {
    console.error('[vault-backup] the history is rewritten, but its old saves could not be deleted yet:', (error as Error).message);
    return false;
  }
}

/**
 * Write the history again without the credentials and its own folder,
 * then delete the old saves from git's store.
 *
 * The caller holds the history to itself (VaultBackup.exclusive): an
 * autosave between the read and the move of the refs would be a save the
 * new history does not have. Nothing moves until the new history is
 * written and checked, so a failure before then leaves the history as it
 * was; a failure after it leaves the marker, and the next start prunes.
 */
export async function purgeHistory(gitDir: string, dir: string): Promise<PurgeOutcome> {
  const started = Date.now();
  const removed = await historyLeaks(gitDir, dir, { fresh: true });
  if (removed.commits === 0) {
    // Nothing to write again; only what a cut-off purge left to delete.
    const done = !removed.pending || (await pruned(gitDir, dir));
    forgetHistoryLeaks(gitDir);
    return { rewritten: 0, removed, pruned: done, ms: Date.now() - started };
  }

  const { keep, drop, detached } = await readRefs(gitDir, dir);
  const tips = [...new Set([...keep.map((ref) => ref.commit), ...(detached ? [detached] : [])])];
  // Parents first, so a parent's new id is known before its children ask.
  const listed = (await gitPipe(gitDir, dir, ['rev-list', '--topo-order', '--reverse', '--parents', '--stdin'], `${tips.join('\n')}\n`))
    .toString('latin1')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '));
  const raw = await readObjects(gitDir, dir, listed.map(([id]) => id!));
  const commits = listed.map(([id, ...parents], i) => parseCommit(id!, parents, raw[i]!));
  const trees = new Map<string, Entry[]>();
  const rootIds = [...new Set(commits.map((commit) => commit.tree))];
  const rootRaw = await readObjects(gitDir, dir, rootIds);
  rootIds.forEach((id, i) => trees.set(id, parseTree(rootRaw[i]!)));

  // The import: each commit that held a purged entry or has a parent that
  // was rewritten, with its own author, committer, encoding and message
  // and its root tree less the purged entries. A commit that needs neither
  // keeps its id; its parents are named by id, the rewritten ones by mark.
  const marks = new Map<string, number>();
  const parts: Buffer[] = [];
  const say = (text: string): void => {
    parts.push(Buffer.from(text, 'latin1'));
  };
  for (const commit of commits) {
    const entries = trees.get(commit.tree)!;
    const kept = entries.filter((entry) => !PURGED.has(entry.name));
    if (kept.length === entries.length && !commit.parents.some((parent) => marks.has(parent))) continue;
    const mark = marks.size + 1;
    marks.set(commit.id, mark);
    const parents = commit.parents.map((parent) => (marks.has(parent) ? `:${marks.get(parent)}` : parent));
    // A root commit starts the work ref afresh, or it would take the last
    // commit written as its parent.
    if (parents.length === 0) say(`reset ${WORK_REF}\n`);
    say(`commit ${WORK_REF}\nmark :${mark}\n`);
    if (commit.author !== null) say(`author ${commit.author}\n`);
    say(`committer ${commit.committer}\n`);
    if (commit.encoding !== null) say(`encoding ${commit.encoding}\n`);
    say(`data ${commit.message.length}\n`);
    parts.push(commit.message);
    say('\n');
    if (parents[0]) say(`from ${parents[0]}\n`);
    for (const parent of parents.slice(1)) say(`merge ${parent}\n`);
    say('deleteall\n');
    for (const entry of kept) {
      // A tree's raw mode is 40000; fast-import spells it 040000.
      say(`M ${entry.mode === '40000' ? '040000' : entry.mode} ${entry.id} ${importPath(entry.name)}\n`);
    }
    say('\n');
  }
  say('done\n');

  const marksFile = resolve(gitDir, MARKS);
  let rewritten: Map<string, string>;
  try {
    // The 'done' feature: a stream cut short is an error, not a short history.
    await gitPipe(gitDir, dir, ['fast-import', '--quiet', '--done', '--force', `--export-marks=${marksFile}`], Buffer.concat(parts));
    const byMark = new Map<number, string>();
    for (const line of readFileSync(marksFile, 'latin1').split('\n').filter(Boolean)) {
      const [mark = '', id = ''] = line.split(' ');
      byMark.set(Number(mark.slice(1)), id);
    }
    rewritten = new Map([...marks].map(([old, mark]) => [old, byMark.get(mark)!]));
  } finally {
    rmSync(marksFile, { force: true });
  }
  const now = (id: string): string => rewritten.get(id) ?? id;

  // Checked before anything points at it: the same number of saves, and
  // none of them holding what was taken out.
  const newTips = tips.map(now);
  const [before, after, still] = await Promise.all([
    git(gitDir, dir, ['rev-list', '--count', ...tips]),
    git(gitDir, dir, ['rev-list', '--count', ...newTips]),
    git(gitDir, dir, ['log', '--full-history', '--no-renames', '--diff-filter=d', '--format=%H', ...newTips, '--', ...PURGED]),
  ]);
  if (before.trim() !== after.trim() || still.trim() !== '') {
    await git(gitDir, dir, ['update-ref', '-d', WORK_REF]).catch(() => undefined);
    throw new Error(`the rewritten history does not match (${before.trim()} saves before, ${after.trim()} after, ${still.split('\n').filter(Boolean).length} still holding them)`);
  }

  // Every ref at once or none: update-ref --stdin locks them all first.
  writeFileSync(resolve(gitDir, MARKER), `${new Date().toISOString()}\n`);
  const moves = [
    ...keep.filter((ref) => now(ref.commit) !== ref.commit).map((ref) => `update ${ref.name} ${now(ref.commit)} ${ref.old}\n`),
    ...(detached && now(detached) !== detached ? [`option no-deref\nupdate HEAD ${now(detached)} ${detached}\n`] : []),
    ...drop.filter((ref) => ref.name !== WORK_REF).map((ref) => `delete ${ref.name} ${ref.old}\n`),
    `delete ${WORK_REF}\n`,
  ];
  try {
    await gitPipe(gitDir, dir, ['update-ref', '--stdin'], moves.join(''));
  } catch (error) {
    rmSync(resolve(gitDir, MARKER), { force: true });
    await git(gitDir, dir, ['update-ref', '-d', WORK_REF]).catch(() => undefined);
    throw error;
  }
  forgetHistoryLeaks(gitDir);

  // The index to the new tip, keeping what it knows of each file's stat,
  // so the next autosave does not read the whole vault again. --reset, not
  // -m: -m refuses to drop an entry whose file has changed since, and the
  // repo's own folder, which an index this old may still list, always
  // has. Not fatal: the next autosave's `add -A` puts right whatever this
  // leaves.
  await git(gitDir, dir, ['read-tree', '--reset', 'HEAD']).catch((error: Error) => {
    console.error('[vault-backup] could not point the index at the rewritten history:', error.message);
  });
  const done = await pruned(gitDir, dir);
  forgetHistoryLeaks(gitDir);
  return { rewritten: rewritten.size, removed, pruned: done, ms: Date.now() - started };
}
