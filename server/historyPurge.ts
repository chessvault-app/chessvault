import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HISTORY_ROOTS, historyMatcherFor, type HistoryExcludedKind, type HistoryMatcher } from './historyExcludes.ts';
import { isHashedPassword, verifyPassword } from './password.ts';
import { git, gitPipe } from './vaultGit.ts';

/**
 * Taking out of the vault's history, from inside the app, what it should
 * never have held.
 *
 * The history (server/vaultBackup.ts) leaves out what the list in
 * server/historyExcludes.ts names: config.json and sessions.json, its own
 * folder, the books' PDFs and open caches, the databases' PGN files, a
 * restore's work folder and .part and .swp files. Two kinds of vault still
 * hold some of them in earlier saves: one older than an exclude, and one
 * wiped with "Wipe all data" before 0.12.1, whose new history saved
 * everything until the server restarted. Every password hash,
 * authenticator secret and Lichess token config.json ever held is then in
 * each copy "Download a copy" makes and each one scripts/backup-vault.sh
 * pulls, and so is every book's PDF, often a commercial book, and the
 * gigabytes of PGN files. The way out was a page of git in the README,
 * which is a user action that needed a shell; this is that page, run by
 * the server.
 *
 * What it does: every save from the first that held one of them is
 * written again without them, at whatever depth each sits, keeping every
 * other file, the message, the author, the committer and both dates byte
 * for byte, and the same graph. The saves before that one keep their ids,
 * since nothing of them changes. Then the old saves are made unreachable
 * and deleted from git's store, which is the half that matters: rewritten
 * saves alone leave the old ones in the packs that a copy carries.
 *
 * How: one `cat-file --batch` reads every commit, one walk by name says
 * which saves hold a named path in a folder (holders), and one
 * `fast-import` writes the new commits. A save that holds one is written
 * as its own changes to its first parent (one `diff-tree --stdin` for all
 * of them) less the named paths, so fast-import builds only the folders
 * that changed, each as a change to the parent's; every other save as its
 * root less what the list names there (a second `cat-file --batch`), with
 * every folder under it reused by id. The obvious plumbing, `ls-tree`, `mktree` and `commit-tree` per save, is
 * three processes a save, and one measured 28 ms on a Windows desktop
 * (200 `commit-tree`s in 5.6 s): about four minutes for 3,000 saves.
 */

/** Every kind the list names, in the order a count reports them. */
const KINDS: readonly HistoryExcludedKind[] = ['credentials', 'folder', 'books', 'sources', 'other'];

/** The kinds a count says the size of: all but the credentials. */
type FileKind = Exclude<HistoryExcludedKind, 'credentials'>;
const FILE_KINDS: readonly FileKind[] = ['folder', 'books', 'sources', 'other'];

/** Where fast-import puts what it writes until the refs are moved. Its
    own name, so nothing else in the repo is ever touched by the import. */
const WORK_REF = 'refs/chessvault/purge';

/** Written before the refs move and deleted once the old saves are gone
    from git's store; found at a start, it means a purge was cut off between
    the two, and the start finishes it (finishInterruptedPurge). */
const MARKER = 'chessvault-purging';

/** fast-import's record of which new commit is which mark. */
const MARKS = 'chessvault-purge-marks';

/** What the history holds that it must not (the list in
    server/historyExcludes.ts), and how much of it. */
export interface HistoryLeaks {
  /** Saves that wrote any of them, each counted once. */
  commits: number;
  /** Saves that wrote config.json or sessions.json. */
  credentials: number;
  /** Saves that wrote the history's own folder. */
  folder: number;
  /** Saves that wrote a book's PDF or its open cache. */
  books: number;
  /** Saves that wrote a PGN file the databases are built from. */
  sources: number;
  /** Saves that wrote anything else of the list: a .part, a .swp, a
      restore's work folder. */
  other: number;
  /** What every version of the files those saves wrote takes in the
      history's store, per kind, each version once: the bytes git keeps,
      compressed, and for a version kept as a change to another, that
      change. About what a purge gives back. Not for the credentials, a
      few hundred bytes a version, whose every version would be one more
      object to ask about (10,000 in a history of 10,000 saves). */
  bytes: Record<FileKind, number>;
  /** A purge was cut off after the rewrite: the old saves are out of the
      history but still in git's store, so a copy still carries them. */
  pending: boolean;
  /** Which secrets those saves hold, set against the ones in use now;
      null where that cannot be told (a purge cut off, whose old saves
      nothing reaches, or a config.json that is not JSON). Kinds and
      numbers only, never a value. */
  secrets: HeldSecrets | null;
}

/** One kind of secret in the history: what closes the leak depends on
    whether it is still the one in use. */
export interface HeldSecret {
  /** The value in use now is in an earlier save. */
  current: boolean;
  /** Values no longer in use, replaced or removed, that earlier saves hold. */
  past: number;
}

/** The three secrets config.json holds. sessions.json holds only hashes
    of session tokens, which give nothing back, so it is not one. */
export interface HeldSecrets {
  /** appPassword: an scrypt hash, or in a save older than the hashing
      (which is every save older than the exclude), the password itself. */
  password: HeldSecret;
  /** totpSecret: what the authenticator's codes are made from. */
  totp: HeldSecret;
  /** lichessToken: valid at Lichess until deleted there, whatever this
      vault does with it. */
  token: HeldSecret;
}

/** The count alone, without which secrets: what the start's warning and a
    purge go by (see historyCount). */
export type HistoryCount = Omit<HistoryLeaks, 'secrets'>;

/** What a purge did. */
export interface PurgeOutcome {
  /** Saves written again: every one from the first that held them. */
  rewritten: number;
  /** What the history held before. */
  removed: HistoryCount;
  /** Whether the old saves are gone from git's store too. False leaves
      the marker, and the next start (or the next purge) deletes them. */
  pruned: boolean;
  /** How long it took, in milliseconds. */
  ms: number;
}

/** What one walk found the saves wrote of the list. */
interface Written {
  /** Each save that wrote any of it, by the kind it wrote. */
  commits: Record<HistoryExcludedKind, Set<string>>;
  /** Each version of a file written (its blob id), by kind. */
  blobs: Record<FileKind, Set<string>>;
  /** The versions of config.json, which the secrets are read from. */
  configs: Set<string>;
  /** Where each is in the vault: the shallowest part of a written path
      the list names (`sources`, `books/<id>/book.pdf`), which a purge
      looks for by name. */
  named: Set<string>;
}

const byKind = <T>(make: (kind: HistoryExcludedKind) => T): Record<HistoryExcludedKind, T> =>
  Object.fromEntries(KINDS.map((kind) => [kind, make(kind)])) as Record<HistoryExcludedKind, T>;

const byFileKind = <T>(make: (kind: FileKind) => T): Record<FileKind, T> =>
  Object.fromEntries(FILE_KINDS.map((kind) => [kind, make(kind)])) as Record<FileKind, T>;

const nothingWritten = (): Written => ({ commits: byKind(() => new Set()), blobs: byFileKind(() => new Set()), configs: new Set(), named: new Set() });

/** Every path is passed as the bytes it is, read as latin1 and written
    back the same way, so a name in any encoding goes back to git as it
    came: to fast-import, and to a walk by name on stdin. */
const BYTES = 'latin1';

/** The options every walk of what saves wrote shares. --full-history so a
    side branch is walked even where a merge matches the other side, and -m
    so a merge that brought one in is read against each parent; --no-renames
    so a renamed config.json is still a config.json written; -z so a path
    comes as the bytes it is. */
const WALK = ['--full-history', '--no-renames', '-m', '-z'];

/**
 * The log of what the saves in `revs` wrote under `paths`, by name: each
 * file a save added or changed, with its new id in full (--raw). The paths
 * go in on stdin, after `--`, so however many there are and whatever their
 * names, no command line holds them.
 */
async function logWritten(gitDir: string, dir: string, revs: string[], paths: readonly string[]): Promise<Buffer> {
  if (paths.length === 0) return Buffer.alloc(0);
  return gitPipe(
    gitDir,
    dir,
    ['log', '--stdin', ...revs, ...WALK, '--diff-filter=d', '--format=%H', '--raw', '--no-abbrev'],
    Buffer.from(`--\n${paths.join('\n')}\n`, BYTES),
  );
}

/** Into `written`, what of a logWritten() the list names, and as what
    kind, by its matcher. Ids, not contents. */
function readWritten(out: Buffer, matcher: HistoryMatcher, written: Written): void {
  // <id>\0, then for each file it wrote :<modes> <old id> <new id> <status>\0<path>\0
  const fields = out.toString(BYTES).split('\0');
  let commit = '';
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!.replace(/^\n/, '');
    if (!field.startsWith(':')) {
      if (field) commit = field;
      continue;
    }
    const path = fields[++i] ?? '';
    const found = matcher.within(path);
    if (!found) continue;
    written.commits[found.kind].add(commit);
    written.named.add(found.at);
    const id = field.split(' ')[3] ?? '';
    if (!/^[0-9a-f]+$/.test(id) || /^0+$/.test(id)) continue;
    if (found.kind !== 'credentials') written.blobs[found.kind].add(id);
    else if (path === 'config.json') written.configs.add(id);
  }
}

/** Whether a walk by HISTORY_ROOTS reaches `path`. */
const reached = (path: string): boolean => HISTORY_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));

/**
 * Where the count keeps how far it has looked everywhere (elsewhere()):
 * the tips it looked from, and the named paths outside HISTORY_ROOTS it
 * found. In the repo beside git's own files, so it goes with the history;
 * a restore takes only a copy's objects and refs (server/restore.ts), so
 * no copy brings one. What it says is a fact about commits, which are
 * named by their content, so it stays true for as long as they exist.
 */
const SCANNED = 'chessvault-scanned';

interface Scanned {
  tips: string[];
  found: string[];
}

function readScanned(gitDir: string): Scanned | null {
  try {
    const known = JSON.parse(readFileSync(resolve(gitDir, SCANNED), BYTES)) as Scanned;
    return Array.isArray(known.tips) && Array.isArray(known.found) ? known : null;
  } catch {
    return null;
  }
}

/** Written beside and renamed over, so a start never reads half of one. */
function writeScanned(gitDir: string, scanned: Scanned): void {
  const file = resolve(gitDir, SCANNED);
  try {
    writeFileSync(`${file}.tmp`, JSON.stringify(scanned), BYTES);
    renameSync(`${file}.tmp`, file);
  } catch {
    // Not kept is looked for again next time, which is all it costs.
  }
}

/**
 * Every path outside HISTORY_ROOTS that a save has held and the list
 * names: the entries that match at any depth (`*.part`, `*.swp`), which a
 * walk by name cannot reach. git has to look into every folder a save
 * changed to find them, so this asks the least it can, the paths each
 * save added (every path any save has held was added by one), and asks it
 * once: what was looked at is kept (SCANNED), and the next count looks at
 * the saves made since. On a generated history of 10,000 saves over a
 * folder of 2,000 games, the first look took about 1 s on a Windows
 * desktop. A tip it kept that is gone (a purge, a ref deleted) has it look
 * at everything again.
 */
async function elsewhere(gitDir: string, dir: string, matching: Promise<HistoryMatcher>): Promise<string[]> {
  // The tips, before anything is walked: a save made while it walks is
  // one the next count looks at.
  const tips = (await gitPipe(gitDir, dir, ['log', '--all', '--no-walk', '--format=%H'])).toString(BYTES).split('\n').filter(Boolean);
  if (tips.length === 0) return [];
  const added = (since: string[]): Promise<Buffer> =>
    gitPipe(gitDir, dir, ['log', '--stdin', ...WALK, '--diff-filter=A', '--format=', '--name-only'], `${[...tips, ...since.map((tip) => `^${tip}`)].join('\n')}\n`);
  const known = readScanned(gitDir);
  let found = new Set(known?.found ?? []);
  let out: Buffer;
  try {
    out = await added(known?.tips ?? []);
  } catch {
    found = new Set();
    out = await added([]);
  }
  const matcher = await matching;
  for (const field of out.toString(BYTES).split('\0')) {
    const named = matcher.within(field.replace(/^\n/, ''));
    if (named && !reached(named.at)) found.add(named.at);
  }
  writeScanned(gitDir, { tips, found: [...found] });
  return [...found];
}

/**
 * What the saves in `revs` wrote of the list: added or changed, not only
 * took out. A save that holds one either wrote it or has an ancestor that
 * did, so none of these means none hold them, and a save that untracked
 * them (the first after a start that found them) does not count as one
 * more.
 *
 * A walk by name, since what a walk costs is which folders git has to look
 * into: under the places the list's top-level entries are (HISTORY_ROOTS:
 * the history's folder, sources/, books/, config.json and the rest), where
 * git looks into nothing else, and at the paths `outside` them that the
 * list names, which a history that never held one has none of. A pathspec
 * with a wildcard in it would find them all in one walk, and git matches
 * every pathspec against every entry it compares: on a generated history
 * of 10,000 saves the list's globs took 0.4 to 1.6 s, against 0.05 to 0.1
 * s for the two names it walked before. The matcher, which reads the
 * repo's config, and `outside`, are waited for while the walk runs.
 */
async function writers(
  gitDir: string,
  dir: string,
  matching: HistoryMatcher | Promise<HistoryMatcher>,
  revs: string[],
  outside: string[] | Promise<string[]>,
): Promise<Written> {
  const [matcher, roots, more] = await Promise.all([matching, logWritten(gitDir, dir, revs, HISTORY_ROOTS), outside]);
  const written = nothingWritten();
  readWritten(roots, matcher, written);
  readWritten(await logWritten(gitDir, dir, revs, more), matcher, written);
  return written;
}

/** What the versions in `blobs` take in git's store, per kind, in one
    `cat-file --batch-check`; nothing for an id it does not have. */
async function storeBytes(gitDir: string, dir: string, blobs: Record<FileKind, Set<string>>): Promise<Record<FileKind, number>> {
  const ids = [...new Set(FILE_KINDS.flatMap((kind) => [...blobs[kind]]))];
  const sizes = new Map<string, number>();
  if (ids.length > 0) {
    const out = await gitPipe(gitDir, dir, ['cat-file', '--batch-check=%(objectname) %(objectsize:disk)'], `${ids.join('\n')}\n`);
    for (const line of out.toString('latin1').split('\n')) {
      const [id = '', size = ''] = line.split(' ');
      if (/^\d+$/.test(size)) sizes.set(id, Number(size));
    }
  }
  return byFileKind((kind) => [...blobs[kind]].reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0));
}

/** A count: what the client is told, and what it is not: the versions of
    config.json the secrets are read from, and for a purge, the saves that
    wrote any of it and where in the vault the named paths are. */
interface Count {
  leaks: HistoryCount;
  configs: string[];
  wrote: Set<string>;
  named: string[];
  matcher: HistoryMatcher;
}

/** Count afresh. */
async function countLeaks(gitDir: string, dir: string): Promise<Count> {
  const matching = historyMatcherFor(gitDir, dir);
  // A repo with no commits yet holds nothing.
  const written = await writers(gitDir, dir, matching, ['--all'], elsewhere(gitDir, dir, matching)).catch(nothingWritten);
  const bytes = await storeBytes(gitDir, dir, written.blobs);
  const matcher = await matching;
  const wrote = new Set(KINDS.flatMap((kind) => [...written.commits[kind]]));
  return {
    leaks: {
      commits: wrote.size,
      credentials: written.commits.credentials.size,
      folder: written.commits.folder.size,
      books: written.commits.books.size,
      sources: written.commits.sources.size,
      other: written.commits.other.size,
      bytes,
      pending: existsSync(resolve(gitDir, MARKER)),
    },
    configs: [...written.configs],
    wrote,
    named: [...written.named],
    matcher,
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
const counted = new Map<string, Promise<Count>>();

/**
 * The last reading of which secrets the history holds, per history repo.
 * It depends on the count and on the secrets in use now, which change
 * without the history changing (a new password, a token replaced), so it
 * is kept beside a digest of the secrets it was read against and read
 * again when either has moved. Of the secrets only, so the trainer's
 * settings, which config.json also holds and which change often, do not
 * cost a reading: on a generated history of 3,000 saves each writing a
 * different config.json, one took about 100 ms on a Windows desktop.
 * What is kept is the answer and that digest, keyed afresh at each start:
 * no old value and no current one outlives the reading.
 */
const judged = new Map<string, { count: Promise<Count>; config: string; secrets: Promise<HeldSecrets | null> }>();
const DIGEST_KEY = randomBytes(32);

/** The count for `gitDir`, as last taken; taken now when `fresh` or when
    nothing has been. */
function countFor(gitDir: string, dir: string, fresh: boolean): Promise<Count> {
  const key = resolve(gitDir);
  const known = fresh ? undefined : counted.get(key);
  if (known) return known;
  const counting = countLeaks(gitDir, dir);
  counted.set(key, counting);
  // A count that failed is not remembered: the next ask tries again.
  counting.catch(() => {
    if (counted.get(key) === counting) counted.delete(key);
  });
  return counting;
}

/**
 * How many saves hold them, without which secrets: all the start's warning
 * and a purge need. The reading is a `cat-file` of every version of
 * config.json and an scrypt for each password kept from before the hashing,
 * which on a generated history of 10,000 saves each writing a different
 * config.json took 267-284 ms on a Windows desktop, and a purge that did
 * it took 1.48-1.52 s against 1.20-1.29 s without. So neither does, and
 * the first ask from Settings reads them.
 */
export async function historyCount(gitDir: string, dir: string, { fresh = false } = {}): Promise<HistoryCount> {
  return (await countFor(gitDir, dir, fresh)).leaks;
}

/** What the history at `gitDir` holds and which secrets, as last counted;
    counted now when `fresh` or when nothing has been. */
export async function historyLeaks(gitDir: string, dir: string, { fresh = false } = {}): Promise<HistoryLeaks> {
  const key = resolve(gitDir);
  const count = countFor(gitDir, dir, fresh);
  const { leaks, configs } = await count;
  // Cut off, the old saves are in git's store but in no save, so nothing
  // here can say what they held.
  if (leaks.pending) return { ...leaks, secrets: null };
  const now = secretsInUse(dir);
  const config = createHmac('sha256', DIGEST_KEY).update(JSON.stringify(now)).digest('hex');
  let known = judged.get(key);
  if (!known || known.count !== count || known.config !== config) {
    const reading = { count, config, secrets: heldSecrets(gitDir, dir, configs, now) };
    judged.set(key, reading);
    // Like a count, a reading that failed is not remembered.
    reading.secrets.catch(() => {
      if (judged.get(key) === reading) judged.delete(key);
    });
    known = reading;
  }
  return { ...leaks, secrets: await known.secrets.catch(() => null) };
}

/** Forget the count for `gitDir`: what the repo holds may have changed. */
export function forgetHistoryLeaks(gitDir: string): void {
  counted.delete(resolve(gitDir));
  judged.delete(resolve(gitDir));
}

// --- Which secrets ------------------------------------------------------------

/** The secrets in use now: none without a config.json, null for one that
    cannot be read for them. */
function secretsInUse(dir: string): Secrets | null {
  let raw: Buffer;
  try {
    raw = readFileSync(resolve(dir, 'config.json'));
  } catch {
    return { password: null, totp: null, token: null };
  }
  return secretsIn(raw);
}

interface Secrets {
  password: string | null;
  totp: string | null;
  token: string | null;
}

/** The three secrets in one version of config.json, as the server reads
    them (settings.ts, auth.ts): trimmed, and absent when blank. Null for a
    file that is not a JSON object, which cannot be read for them. */
function secretsIn(raw: Buffer): Secrets | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const config = parsed as Record<string, unknown>;
  const value = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return { password: value(config.appPassword), totp: value(config.totpSecret), token: value(config.lichessToken) };
}

/**
 * Whether an old app password is the one in use. The same text is; so is a
 * password kept from before the hashing that the hash in use now verifies,
 * which is how every such vault's password reads once a login has
 * rewritten it. Two different hashes cannot be told apart without the
 * password, so a password set again to itself counts as a past one.
 */
async function samePassword(old: string, now: string): Promise<boolean> {
  if (old === now) return true;
  const oldHashed = isHashedPassword(old);
  if (oldHashed === isHashedPassword(now)) return false;
  return oldHashed ? verifyPassword(now, old) : verifyPassword(old, now);
}

/**
 * Which secrets the versions of config.json in `configs` hold, against the
 * ones in use `now`. One `cat-file --batch` for every version; each is
 * read, compared and let go, and only kinds and numbers come back.
 */
async function heldSecrets(gitDir: string, dir: string, configs: string[], now: Secrets | null): Promise<HeldSecrets | null> {
  if (now === null) return null;
  const old = new Map<keyof Secrets, Set<string>>([
    ['password', new Set()],
    ['totp', new Set()],
    ['token', new Set()],
  ]);
  for (const version of await readObjects(gitDir, dir, configs)) {
    const held = secretsIn(version);
    if (held === null) return null;
    for (const [kind, values] of old) {
      const value = held[kind];
      if (value !== null) values.add(value);
    }
  }
  const tally = async (kind: keyof Secrets, same: (old: string, now: string) => boolean | Promise<boolean>): Promise<HeldSecret> => {
    const inUse = now[kind];
    let current = false;
    let past = 0;
    for (const value of old.get(kind)!) {
      if (inUse !== null && (await same(value, inUse))) current = true;
      else past += 1;
    }
    return { current, past };
  };
  const equal = (a: string, b: string): boolean => a === b;
  return {
    password: await tally('password', samePassword),
    totp: await tally('totp', equal),
    token: await tally('token', equal),
  };
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

/**
 * Which of the named paths in a folder (`deep`, every one below the top
 * of the vault) each save holds, from one walk by name over them that
 * lists every change a save made to one. A save holds what its parent
 * held, and what it added or changed, less what it deleted. A merge holds
 * what any parent held and what it brought in, and keeps what it deleted
 * too: maybe more than it holds, which only costs writing it as its
 * changes when its whole root would have done, never a save left holding
 * one. Files, by save; a save that changed none shares its parent's set,
 * and a parent outside `commits` holds none.
 */
async function holders(gitDir: string, dir: string, tips: string[], commits: Commit[], deep: string[]): Promise<Map<string, Set<string>>> {
  const held = new Map<string, Set<string>>();
  if (deep.length === 0) return held;
  const out = await gitPipe(
    gitDir,
    dir,
    ['log', '--stdin', ...WALK, '--format=%H', '--raw', '--no-abbrev'],
    Buffer.from(`${tips.join('\n')}\n--\n${deep.join('\n')}\n`, BYTES),
  );
  // <id>\0, then for each file it changed :<modes> <ids> <status>\0<path>\0
  const changes = new Map<string, { put: string[]; gone: string[] }>();
  const fields = out.toString(BYTES).split('\0');
  let commit = '';
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!.replace(/^\n/, '');
    if (!field.startsWith(':')) {
      if (field) commit = field;
      continue;
    }
    const path = fields[++i] ?? '';
    let change = changes.get(commit);
    if (!change) changes.set(commit, (change = { put: [], gone: [] }));
    (field.split(' ')[4] === 'D' ? change.gone : change.put).push(path);
  }
  const none = new Set<string>();
  for (const commit of commits) {
    const [first, ...others] = commit.parents.map((parent) => held.get(parent) ?? none);
    const from = others.length === 0 ? (first ?? none) : new Set([first!, ...others].flatMap((set) => [...set]));
    const change = changes.get(commit.id);
    if (!change) {
      held.set(commit.id, from);
      continue;
    }
    const now = new Set(from);
    for (const path of change.put) now.add(path);
    if (others.length === 0) for (const path of change.gone) now.delete(path);
    held.set(commit.id, now);
  }
  return held;
}

// --- Writing ------------------------------------------------------------------

/** One file a save changed against its first parent. */
interface Change {
  /** The new mode and id; null for a file the save deleted. */
  mode: string | null;
  id: string;
  path: string;
}

/**
 * What each save in `saves` changed against its first parent, or for a
 * save with none, every file it holds: one `diff-tree --stdin` for all of
 * them, each line a save and the parent to compare it with, so a merge is
 * compared with its first parent only. Every file, at any depth, with its
 * mode and id (-r --raw), its path as bytes (-z).
 */
async function changesOf(gitDir: string, dir: string, saves: Commit[]): Promise<Map<string, Change[]>> {
  const changes = new Map<string, Change[]>(saves.map((save) => [save.id, []]));
  if (saves.length === 0) return changes;
  const out = await gitPipe(
    gitDir,
    dir,
    ['diff-tree', '--stdin', '-r', '-z', '--root', '--no-renames', '--raw', '--no-abbrev'],
    `${saves.map((save) => [save.id, ...save.parents.slice(0, 1)].join(' ')).join('\n')}\n`,
  );
  // <id>\0, then for each file :<old mode> <new mode> <old id> <new id> <status>\0<path>\0
  const fields = out.toString(BYTES).split('\0');
  let into: Change[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!.replace(/^\n/, '');
    if (!field.startsWith(':')) {
      if (field) into = changes.get(field) ?? [];
      continue;
    }
    const path = fields[++i] ?? '';
    const [, mode = '', , id = '', status = ''] = field.split(' ');
    into.push(status === 'D' ? { mode: null, id: '', path } : { mode, id, path });
  }
  return changes;
}

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
 * Write the history again without anything the list names, at any depth,
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
  const { leaks: removed, wrote, named, matcher } = await countFor(gitDir, dir, true);
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

  // Every save before the first that wrote any of it keeps its id. From
  // that one on, a save that holds a named path in a folder (holders) is
  // written again as its own changes to its first parent less every path
  // the list names: fast-import builds its tree from the parent's, writes
  // each folder that changed as a change to the parent's version of it,
  // and reuses every other folder by id. Every other save is written as
  // its whole root less what the list names there, every folder by id, so
  // nothing under it is read or written again. On a generated history of
  // 10,000 saves with a swap file beside 2,000 games in 997 of them, this
  // took 5.3 to 6.2 s on a Windows desktop and left the history at 15.1
  // MB (14.9 before). Writing every save as its changes took 11 s, nearly
  // all of it fast-import building the folder of games again for 9,000
  // saves that never held the swap file; writing each as its whole root
  // with a delete for the swap file took 7.2 s, but stored each of the 997
  // new versions of the folder whole, and left the history at 61.1 MB.
  const first = commits.findIndex((commit) => wrote.has(commit.id));
  const rest = first < 0 ? [] : commits.slice(first);
  const held = await holders(gitDir, dir, tips, rest, named.filter((path) => path.includes('/')));
  const deep = new Set(rest.filter((commit) => (held.get(commit.id)?.size ?? 0) > 0).map((commit) => commit.id));
  const whole = [...new Set(rest.filter((commit) => !deep.has(commit.id)).map((commit) => commit.tree))];
  const [changes, rootRaw] = await Promise.all([
    changesOf(gitDir, dir, rest.filter((commit) => deep.has(commit.id))),
    readObjects(gitDir, dir, whole),
  ]);
  const roots = new Map(whole.map((id, i) => [id, parseTree(rootRaw[i]!).filter((entry) => !matcher.self(entry.name, entry.mode === '40000'))]));

  // The import: each commit that wrote a named path or has a parent that
  // was rewritten, with its own author, committer, encoding and message,
  // and its tree less the named paths. A commit that needs neither keeps
  // its id; its parents are named by id, the rewritten ones by mark.
  const marks = new Map<string, number>();
  const parts: Buffer[] = [];
  const say = (text: string): void => {
    parts.push(Buffer.from(text, 'latin1'));
  };
  for (const commit of rest) {
    if (!wrote.has(commit.id) && !commit.parents.some((parent) => marks.has(parent))) continue;
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
    if (deep.has(commit.id)) {
      for (const change of changes.get(commit.id) ?? []) {
        if (matcher.within(change.path)) continue;
        say(change.mode === null ? `D ${importPath(change.path)}\n` : `M ${change.mode} ${change.id} ${importPath(change.path)}\n`);
      }
    } else {
      say('deleteall\n');
      for (const entry of roots.get(commit.tree)!) {
        // A tree's raw mode is 40000; fast-import spells it 040000.
        say(`M ${entry.mode === '40000' ? '040000' : entry.mode} ${entry.id} ${importPath(entry.name)}\n`);
      }
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
  // none of them writing anything the list names, by the count's own walk.
  const newTips = tips.map(now);
  // The paths the count found outside HISTORY_ROOTS are the only ones there
  // the list names, so the check walks those by name and looks nowhere else.
  const [before, after, still] = await Promise.all([
    git(gitDir, dir, ['rev-list', '--count', ...tips]),
    git(gitDir, dir, ['rev-list', '--count', ...newTips]),
    writers(gitDir, dir, matcher, newTips, named.filter((path) => !reached(path))),
  ]);
  const left = new Set(KINDS.flatMap((kind) => [...still.commits[kind]])).size;
  if (before.trim() !== after.trim() || left > 0) {
    await git(gitDir, dir, ['update-ref', '-d', WORK_REF]).catch(() => undefined);
    throw new Error(`the rewritten history does not match (${before.trim()} saves before, ${after.trim()} after, ${left} still holding them)`);
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
  // What the next count would look everywhere for again, since every tip
  // it kept is gone: the new tips hold nothing the list names, which the
  // check above has just shown.
  writeScanned(gitDir, { tips: newTips, found: [] });

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
