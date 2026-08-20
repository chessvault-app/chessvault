import { Hono } from 'hono';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { writeAtomic } from './atomic.ts';
import { VAULT } from './paths.ts';
import { validId } from '../shared/vaultNames.ts';
import { git, historyGitDir } from './vaultGit.ts';

/**
 * Reading the vault's safety net back out, from inside the app.
 *
 * server/vaultBackup.ts has auto-committed every vault change to
 * vault/.history.git since the first release, and until now the only way to
 * USE that was `git --git-dir=vault/.history.git checkout …` in a terminal.
 * That made recovery — the one moment a user is already having a bad day —
 * the single thing the app could not do, against the standing rule that
 * every user action must be possible in the app.
 *
 * Two questions get answered here, because a wrecked document and a deleted
 * one are found in different places: a document that still exists can ask
 * its own history, and one that is gone has to be found from a list of what
 * is missing.
 *
 * Mounted in server/index.ts rather than server/mountVault.ts. That is
 * deliberate: mountVault's list is shared with the in-page demo, which runs
 * these modules over a shimmed filesystem with no node:child_process and no
 * git at all. History is exactly the kind of thing the two deployments
 * genuinely disagree about, which is what that file says belongs at the
 * call site.
 */

/**
 * Which directory each kind of document lives in, relative to the vault
 * root — the form paths take inside the history repo — and the extension
 * its files carry.
 *
 * Written here rather than derived from paths.ts, because the history repo
 * stores relative paths and the constants are absolute. server/
 * vaultHistory.test.ts asserts the two still agree: if they drift, every
 * document of that kind would report no versions, which reads exactly like
 * "this vault has no history" rather than like a bug.
 */
export const KINDS = {
  studies: { base: 'studies', ext: '.pgn' },
  notes: { base: 'notes', ext: '.md' },
  games: { base: 'games/collection', ext: '.pgn' },
} as const;

export type DocKind = keyof typeof KINDS;

/** The kinds, as the route matcher spells them. */
const KIND_PATTERN = Object.keys(KINDS).join('|');

const SHA = /^[0-9a-f]{7,40}$/;

export interface DocVersion {
  /** The autosave commit this version was taken from. */
  sha: string;
  /** When it was committed, ISO. */
  at: string;
}

export interface DeletedDoc {
  kind: DocKind;
  /** Id relative to its kind's directory, without the extension. */
  id: string;
  /** When it went missing, ISO. */
  at: string;
}

/**
 * The repo path for a document.
 *
 * Traversal is impossible by construction rather than by filtering: the
 * base comes from KINDS and never from the request, and the id is checked
 * by the same validId the document routes use, which rejects empty
 * segments, dot segments and separators. There is therefore no request
 * that can name vault/config.json — which holds the app password, the TOTP
 * secret and the Lichess token — or sessions.json. vaultBackup.ts also
 * excludes both from the repo; this is the second of the two locks, and
 * the one that does not depend on that exclude list staying correct.
 */
function repoPath(kind: DocKind, id: string): string | null {
  if (!validId(id)) return null;
  const { base, ext } = KINDS[kind];
  return `${base}/${id}${ext}`;
}

/**
 * Every route answers this shape when there is nothing to read, rather than
 * erroring. A vault whose history repo has not been created yet, a packaged
 * desktop install with no git on PATH, a fresh checkout — none of those is
 * a fault, and a recovery screen that shows a red error in those cases
 * teaches people to distrust the one screen that has to be trustworthy.
 */
const UNAVAILABLE = { available: false as const };

export function vaultHistoryApi(
  vaultDir: string = VAULT,
  options: { commitNow?: () => Promise<void> } = {},
): Hono {
  const api = new Hono();
  const run = (args: string[]): Promise<string> => git(historyGitDir(vaultDir), vaultDir, args);
  const haveHistory = (): boolean => existsSync(historyGitDir(vaultDir));

  /** Whether this deployment can offer recovery at all. The UI asks first. */
  api.get('/history', async (c) => {
    if (!haveHistory()) return c.json(UNAVAILABLE);
    try {
      // A repo with no commits yet, or no git binary, is not an error.
      await run(['rev-parse', '--quiet', '--verify', 'HEAD']);
    } catch {
      return c.json(UNAVAILABLE);
    }
    return c.json({ available: true });
  });

  /**
   * The versions of one document.
   *
   * --diff-filter=AM keeps the commits where the file was added or changed,
   * which are exactly the commits it HAS content at. A commit that deleted
   * it would list here too without the filter, and offering to restore a
   * version whose content is the file's absence is not an offer worth
   * making.
   */
  api.get(`/history/doc/:kind{${KIND_PATTERN}}/:id{.+}`, async (c) => {
    const path = repoPath(c.req.param('kind') as DocKind, c.req.param('id'));
    if (!path) return c.json({ error: 'bad id' }, 400);
    if (!haveHistory()) return c.json(UNAVAILABLE);
    try {
      const out = await run(['log', '--diff-filter=AM', '--format=%H%x09%aI', '--', path]);
      const versions: DocVersion[] = out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha = '', at = ''] = line.split('\t');
          return { sha, at };
        })
        .filter((v) => SHA.test(v.sha) && v.at);
      return c.json({ available: true, versions });
    } catch {
      return c.json(UNAVAILABLE);
    }
  });

  /** One version's bytes, for the preview. Never writes. */
  api.get(`/history/at/:sha/:kind{${KIND_PATTERN}}/:id{.+}`, async (c) => {
    const sha = c.req.param('sha');
    if (!SHA.test(sha)) return c.json({ error: 'bad sha' }, 400);
    const path = repoPath(c.req.param('kind') as DocKind, c.req.param('id'));
    if (!path) return c.json({ error: 'bad id' }, 400);
    if (!haveHistory()) return c.json(UNAVAILABLE);
    try {
      return c.json({ available: true, content: await run(['show', `${sha}:${path}`]) });
    } catch {
      return c.json({ error: 'no such version' }, 404);
    }
  });

  /**
   * Documents the history remembers and the vault no longer has.
   *
   * The per-document panel cannot reach these by construction — there is no
   * document left to open it from — and a deleted study is the case people
   * actually needed the terminal for.
   */
  api.get('/history/deleted', async (c) => {
    if (!haveHistory()) return c.json(UNAVAILABLE);
    const deleted: DeletedDoc[] = [];
    try {
      for (const kind of Object.keys(KINDS) as DocKind[]) {
        const { base, ext } = KINDS[kind];
        // %x00 marks the header lines apart from the --name-only paths that
        // follow each one; a path can contain anything a name can, so it
        // needs a separator a name cannot produce.
        const out = await run([
          'log',
          '--diff-filter=D',
          '--format=%x00%aI',
          '--name-only',
          '--',
          base,
        ]);
        // Newest first, so the first sighting of a path is its latest
        // deletion — a document deleted, restored and deleted again is
        // offered from when it last went missing.
        const seen = new Set<string>();
        let at = '';
        for (const line of out.split('\n')) {
          if (line.startsWith('\0')) {
            at = line.slice(1).trim();
            continue;
          }
          const path = line.trim();
          if (!path.startsWith(`${base}/`) || !path.endsWith(ext)) continue;
          if (seen.has(path)) continue;
          seen.add(path);
          // Deleted and later re-created: it is in the vault now, so it is
          // not missing and must not be offered back.
          if (existsSync(resolve(vaultDir, path))) continue;
          const id = path.slice(base.length + 1, -ext.length);
          if (!validId(id)) continue;
          deleted.push({ kind, id, at });
        }
      }
    } catch {
      return c.json(UNAVAILABLE);
    }
    deleted.sort((a, b) => b.at.localeCompare(a.at));
    return c.json({ available: true, deleted });
  });

  /**
   * Put a past version back.
   *
   * Two things make writing over the current file the safe answer rather
   * than a reckless one. First, the current state is committed HERE, before
   * the write, instead of trusting the watcher's 15-second debounce to have
   * already fired — so the version being replaced is itself in the history,
   * and this restore is undoable through the same panel that performed it.
   * Second, the write goes through writeAtomic, so a crash mid-restore
   * leaves the old file whole rather than a truncated one.
   *
   * It deliberately does NOT use `git checkout`, which would move the
   * history repo's index and race the watcher committing to it. The blob is
   * read out and written as an ordinary vault file; the watcher then
   * records the restore as one more autosave, which is what it is.
   */
  api.post('/history/restore', async (c) => {
    if (!haveHistory()) return c.json({ error: 'no history' }, 409);
    const body = (await c.req.json().catch(() => null)) as {
      kind?: string;
      id?: string;
      sha?: string;
    } | null;
    const kind = body?.kind ?? '';
    const sha = body?.sha ?? '';
    if (!(kind in KINDS) || !body?.id) return c.json({ error: 'bad request' }, 400);
    if (!SHA.test(sha)) return c.json({ error: 'bad sha' }, 400);
    const path = repoPath(kind as DocKind, body.id);
    if (!path) return c.json({ error: 'bad id' }, 400);

    let content: string;
    try {
      content = await run(['show', `${sha}:${path}`]);
    } catch {
      return c.json({ error: 'no such version' }, 404);
    }

    // Capture what is about to be overwritten, so this is undoable. A
    // failure here must not block the restore: the worst case is that the
    // overwritten state was already committed a moment ago anyway.
    await options.commitNow?.().catch(() => undefined);

    try {
      // A deleted document can have taken its folder with it — restoring
      // the last study out of a collection leaves no directory to write
      // into. Recreating it is part of putting the document back.
      const target = resolve(vaultDir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeAtomic(target, content);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
    return c.json({ ok: true });
  });

  return api;
}
