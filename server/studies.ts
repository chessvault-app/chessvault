import { Hono } from 'hono';
import { renameRetrying, writeAtomic } from './atomic.ts';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { VAULT_STUDIES } from './paths.ts';
import { readAliases, splitAliasList, splitFrontMatter } from '../shared/frontMatter.ts';
import { validId } from '../shared/vaultNames.ts';
import { mainlineEndFen } from '../shared/pgn.ts';

/**
 * Studies are plain multi-game PGN files in vault/studies/ — one game per
 * chapter, Lichess annotation syntax. Reading and writing a document moves
 * bytes and nothing else: the shared codec runs in the client, and no route
 * here rewrites what somebody wrote. Writes are atomic (temp file + rename)
 * because a study is user data: a crash mid-write must never leave a
 * truncated vault file.
 *
 * The one exception is the LISTING, which replays the first game of each
 * document to work out the position its card should show — the same thing
 * the games list has always done for its preview eye, through the same
 * shared codec. It reads; it never writes back what it read.
 */

/**
 * A study id is its vault-relative path without `.pgn`; folders (collections)
 * are real subdirectories, e.g. "Openings/Najdorf Repertoire". Every path
 * segment must be a plain name — no leading dots, no empty segments — which
 * rules out traversal by construction.
 */
export { sanitizeSegment, validId } from '../shared/vaultNames.ts';

const MAX_PGN_BYTES = 20 * 1024 * 1024;

/**
 * Chapter count and names without parsing: every game carries an Event
 * header, and a Lichess export names each chapter outright in
 * `[ChapterName "…"]` — with `[Event "Study: Chapter"]` as the fallback,
 * the same order pgnToChapters resolves a chapter's name in. Only the
 * first few names ship: they are a card's caption, not a table of
 * contents.
 */
function chapterInfo(pgn: string): { count: number; names: string[] } {
  const events = [...pgn.matchAll(/^\[Event\s+"([^"]*)"\]/gm)].map((m) => m[1]!.trim());
  const count = events.length || (pgn.trim() ? 1 : 0);
  const stated = [...pgn.matchAll(/^\[ChapterName\s+"([^"]*)"\]/gm)].map((m) => m[1]!.trim());
  let names = stated.length === events.length && stated.length > 0 ? stated : events;
  if (names === events && events.length > 0) {
    // Every event naming the same "Study:" is the study's own name
    // repeated; the card is already on the study, so it goes.
    const prefixes = events.map((v) => {
      const at = v.indexOf(':');
      return at === -1 ? null : v.slice(0, at).trim();
    });
    if (prefixes[0] && prefixes.every((p) => p === prefixes[0])) {
      names = events.map((v) => v.slice(v.indexOf(':') + 1).trim());
    }
  }
  const kept = names.filter((n) => n && n !== '?');
  // A run of "Chapter 1 · Chapter 2" is numbering, not naming — a card
  // caption made of it says nothing, so it is dropped whole.
  if (kept.every((n) => /^Chapter \d+$/.test(n))) return { count, names: [] };
  return { count, names: kept.slice(0, 4) };
}

/**
 * How much of a document is read for its card.
 *
 * Enough for front matter, a heading, a first paragraph and a whole
 * embedded game — a listing must never depend on how long the longest
 * note is, and 2KB stopped mid-fence on anything past a dozen moves.
 * A board that does not close inside this window is not drawn at all.
 */
const PREVIEW_BYTES = 8192;

/** The position every game begins at. */
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * A thumbnail worth drawing, or null.
 *
 * A board that has not moved off the starting position says nothing: it
 * is the same picture as every other game ever recorded, and a shelf of
 * them is a shelf of identical pictures — which is what the previous
 * version of this drew. Measured on a real vault: 32 of 33 studies are
 * stubs with no moves, so 32 cards would have carried the same board.
 * They keep their icon instead.
 */
function meaningfulFen(fen: string | null): string | null {
  if (!fen) return null;
  // Compared on the placement field alone: a study that opens on the
  // standard position with a different move number or clock is still the
  // standard position as far as a 64px picture is concerned.
  return fen.split(' ')[0] === START_FEN.split(' ')[0] ? null : fen;
}

export interface DocPreview {
  /** The first line somebody actually wrote. */
  excerpt: string | null;
  /** Where the document's first board ends up. */
  fen: string | null;
  /**
   * Other names this document answers to, for `[[wiki links]]`.
   *
   * Read here rather than in a route of its own because the listing is
   * already reading each file's head and caching it by mtime — an alias
   * costs a regex over bytes that are in hand, where a second walk of the
   * vault would be the same read done twice.
   */
  aliases?: string[];
}

/** `[Aliases "B90, Najdorf"]`, the PGN answer to front matter. */
function pgnAliases(head: string): { aliases?: string[] } {
  const found = /^\[Aliases\s+"([^"]*)"\]/m.exec(head);
  const list = found ? splitAliasList(found[1]!) : [];
  return list.length ? { aliases: list } : {};
}



/**
 * Where the note's first board ENDS UP.
 *
 * It used to be where the board opened, read straight off the fence's
 * `[FEN]` header — which is the standard starting position for almost
 * every board anybody records, so the shelf drew the same picture on
 * every card that had one. Of the notes in a real vault: one board, no
 * FEN header, one identical thumbnail.
 *
 * So the moves are replayed. That crosses the line this module's header
 * draws — "the server never parses move text" — deliberately and with
 * the comment updated to say so: the games list has replayed PGN to a
 * finalFen since it was written, which is where the preview eye on every
 * game row comes from, and one module's rule is not worth a feature that
 * shows nothing.
 *
 * Only a board that CLOSES inside the read window is used. Replaying a
 * move list that was cut off mid-file gives a position that is wrong
 * rather than merely incomplete, and a confidently wrong board is worse
 * than none.
 */
function firstBoardFen(body: string[]): string | null {
  const open = body.findIndex((line) => line.trim() === '```chess');
  if (open < 0) return null;
  const close = body.findIndex((line, at) => at > open && line.trim().startsWith('```'));
  if (close < 0) return null;
  const fence = body.slice(open + 1, close).join('\n').trim();
  if (!fence) return null;
  // A bare move list is not a PGN; the headers make one so a single
  // parser serves both forms — the same trick the note editor uses.
  return meaningfulFen(
    mainlineEndFen(fence.startsWith('[') ? fence : `[Result "*"]\n\n${fence}`),
  );
}

/**
 * The note's first line of prose.
 *
 * Skips the heading — that is the note's name, which the card already
 * shows — and anything that is punctuation rather than words: a rule, a
 * bullet's dash, an embedded board. What is left is the sentence somebody
 * actually wrote, flattened to one line.
 */
function firstProseLine(body: string[]): string | null {
  let inFence = false;
  for (const raw of body) {
    const line = raw.trim();
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line) continue;
    if (line.startsWith('#') || line.startsWith('---') || line.startsWith('===')) continue;
    const text = line
      .replace(/^[-*+>]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
    if (text) return text.length > 140 ? `${text.slice(0, 139)}…` : text;
  }
  return null;
}

/**
 * Where a study's first chapter ends up.
 *
 * Bounded by the same window as everything else, and by the same rule:
 * the chapter has to be COMPLETE inside it. A game is complete when its
 * terminator has been read, or when the next chapter's `[Event` proves
 * the first one finished — otherwise the file was cut mid-game and the
 * position would be a confident lie. `read < PREVIEW_BYTES` means the
 * whole file fit, so nothing was cut.
 */
function firstChapterFen(head: string, read: number): string | null {
  const next = head.indexOf('[Event ', 1);
  const first = next > 0 ? head.slice(0, next) : head;
  const whole = next > 0 || read < PREVIEW_BYTES;
  if (!whole && !/\s(\*|1-0|0-1|1\/2-1\/2)\s*$/.test(first.trimEnd())) return null;
  return meaningfulFen(mainlineEndFen(first));
}

/** Everything a note's card shows beyond its name, size and time. */
function readPreview(head: string): DocPreview {
  // Front matter is a BLOCK, not a rule, and only if it opens the file:
  // skipping just its `---` fences left "tags: endgame" standing there as
  // the note's first sentence. Finding it is shared with the editor, which
  // takes the same block off before parsing — the two were written
  // separately and disagreed; see shared/frontMatter for the three inputs
  // that proved it.
  const { front, body } = splitFrontMatter(head);
  const lines = body.split('\n');
  const aliases = readAliases(front);
  return {
    excerpt: firstProseLine(lines),
    fen: firstBoardFen(lines),
    ...(aliases.length ? { aliases } : {}),
  };
}

/**
 * What else follows a rename. Bookmarks are this API's own concern
 * (remark, below); anything OUTSIDE it that stores document ids — the
 * opening map's tags — registers here and is told after the rename has
 * happened on disk. Deletes are deliberately not reported: a bookmark to
 * a deleted study is noise, but an outside reference to one is
 * information, and each store decides that for itself.
 */
export interface StudiesHooks {
  onMoved?: (from: string, to: string) => void;
  onFolderMoved?: (from: string, to: string) => void;
}

/**
 * Plain-file document CRUD over a directory. Mounted three times: `studies`
 * (vault/studies, .pgn), `games/docs` (the games collection, .pgn — an
 * annotated game is a one-chapter study), and `notes` (vault/notes, .md).
 */
export function studiesApi(
  dir: string = VAULT_STUDIES,
  base = 'studies',
  ext = '.pgn',
  hooks: StudiesHooks = {},
): Hono {
  mkdirSync(dir, { recursive: true });
  const api = new Hono();
  const pathOf = (id: string): string => resolve(dir, `${id}${ext}`);

  /**
   * Where a document's unsaved copy waits out a crash.
   *
   * Saving is manual, so a browser that dies with an hour of annotation
   * in it takes the hour with it — the buffer only ever existed in a tab.
   * This is the vault's answer: while a document is pending, the client
   * parks the pending text here, and clears it the moment the document is
   * saved or the changes are discarded. A swap left behind is therefore
   * exactly the thing that should not exist, and finding one on open is
   * how the app knows to offer it back.
   *
   * Beside the document rather than in a drafts directory, so it travels
   * with a move and dies with a delete. Dot-prefixed and `.swp`-suffixed:
   * the listing only takes files ending in the document extension, so a
   * swap is already invisible to it, and `validId` refuses any segment
   * starting with a dot — so no request can ever address a swap as a
   * document.
   *
   * In the vault rather than in the browser (lanph3re's call): a phone
   * that dies mid-annotation is then recoverable at the desk, which is
   * what a vault of plain files is for.
   */
  const swapOf = (id: string): string => {
    const at = id.lastIndexOf('/');
    const folder = at < 0 ? '' : id.slice(0, at);
    const name = at < 0 ? id : id.slice(at + 1);
    return resolve(dir, folder, `.${name}${ext}.swp`);
  };

  /** The pending copy and when it was parked, or nothing. */
  const readSwap = (id: string): { draft: string; draftAt: string } | null => {
    const path = swapOf(id);
    try {
      const stat = statSync(path);
      return { draft: readFileSync(path, 'utf-8'), draftAt: stat.mtime.toISOString() };
    } catch {
      return null;
    }
  };

  const dropSwap = (id: string): void => {
    try {
      rmSync(swapOf(id));
    } catch {
      /* nothing parked — the common case */
    }
  };

  // Chapter counts and names parsed per file and cached by mtime, the same
  // pattern as the games list cache — a listing must not re-read every
  // study body.
  const chapterCache = new Map<string, { mtimeMs: number; info: { count: number; names: string[] } }>();

  const chapterInfoCached = (path: string, mtimeMs: number): { count: number; names: string[] } => {
    const hit = chapterCache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.info;
    const info = chapterInfo(readFileSync(path, 'utf-8'));
    chapterCache.set(path, { mtimeMs, info });
    return info;
  };

  // The same cache, for everything a note's card shows beyond its stat.
  // Only the head of the file is read — a listing must never depend on how
  // long the longest note is.
  const previewCache = new Map<string, { mtimeMs: number; preview: DocPreview }>();

  const previewCached = (path: string, mtimeMs: number): DocPreview => {
    const hit = previewCache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.preview;
    let preview: DocPreview = { excerpt: null, fen: null };
    try {
      const fd = openSync(path, 'r');
      try {
        const buf = Buffer.alloc(PREVIEW_BYTES);
        const read = readSync(fd, buf, 0, PREVIEW_BYTES, 0);
        // A multi-byte character cut in half at the end of the window
        // becomes a replacement char; dropping the last line loses nothing
        // a first sentence needs.
        const head = buf.subarray(0, read).toString('utf-8');
        // A study is PGN: no prose to excerpt, but its first chapter IS a
        // game, so it gets a board the same way a note's fence does.
        preview =
          ext === '.md'
            ? readPreview(head)
            : { excerpt: null, fen: firstChapterFen(head, read), ...pgnAliases(head) };
      } finally {
        closeSync(fd);
      }
    } catch {
      /* unreadable between readdir and here — the card just has no preview */
    }
    previewCache.set(path, { mtimeMs, preview });
    return preview;
  };

  /**
   * Which documents are bookmarked, as plain JSON beside them.
   *
   * The same shape the games shelf already uses: the vault holds the
   * answer, so a bookmark survives a browser, a device and a reinstall.
   * The leading dot keeps it out of the way of somebody looking at the
   * folder in a file manager, and it is not a `.md` so it is never listed
   * as a note.
   */
  const marksPath = resolve(dir, '.bookmarks.json');
  /**
   * These were pins until they became bookmarks, and the file they were
   * kept in was `.pins.json`. Read it when the new one is absent so that
   * nobody's marks vanish in an update; the next toggle writes the new
   * name and the old file stops being consulted.
   */
  const legacyPath = resolve(dir, '.pins.json');
  const readMarks = (): string[] => {
    for (const path of [marksPath, legacyPath]) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { ids?: string[] };
        if (Array.isArray(parsed.ids)) return parsed.ids;
      } catch {
        /* next */
      }
    }
    return [];
  };

  const writeMarks = (ids: string[]): void => {
    writeAtomic(marksPath, `${JSON.stringify({ ids }, null, 2)}\n`);
  };

  /**
   * Follow a bookmarked document through a rename, or drop it on a delete.
   *
   * Without this a bookmark is a name, not a thing: renaming a bookmarked
   * note silently lost the mark, and deleting one left an id in the file
   * that would re-mark whatever was next created under that name.
   */
  const remark = (from: string, to: string | null): void => {
    const ids = readMarks();
    const at = ids.indexOf(from);
    if (at < 0) return;
    if (to === null) ids.splice(at, 1);
    else ids[at] = to;
    writeMarks(ids);
  };

  api.get(`/${base}/bookmarks`, (c) => c.json({ ids: readMarks() }));

  api.post(`/${base}/bookmarks/toggle`, async (c) => {
    const body = await c.req.json<{ id?: string }>().catch(() => null);
    const id = body?.id?.trim();
    if (!id || !validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const ids = readMarks();
    const at = ids.indexOf(id);
    const bookmarked = at < 0;
    if (bookmarked) ids.unshift(id);
    else ids.splice(at, 1);
    // Atomic, like every other vault write: a crash mid-write must not
    // leave a truncated file that reads as "nothing is bookmarked".
    writeMarks(ids);
    return c.json({ id, bookmarked });
  });

  api.get(`/${base}`, (c) => {
    const entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' });
    // A directory whose name ends in the document extension (e.g. a folder
    // literally called "Foo.pgn") must not be read as a document — statSync
    // it once and treat only real files as studies. A missing entry (removed
    // between readdir and stat by the fs watcher) is simply skipped.
    const stated: { file: string; isFile: boolean; isDir: boolean; size: number; mtime: Date }[] = [];
    for (const file of entries) {
      try {
        const s = statSync(resolve(dir, file));
        stated.push({ file, isFile: s.isFile(), isDir: s.isDirectory(), size: s.size, mtime: s.mtime });
      } catch {
        /* removed between readdir and stat by the fs watcher — skip */
      }
    }
    const studies = stated
      .filter(({ file, isFile }) => isFile && file.endsWith(ext))
      .map(({ file, size, mtime }) => {
        const path = resolve(dir, file);
        const preview = previewCached(path, mtime.getTime());
        const info = ext === '.pgn' ? chapterInfoCached(path, mtime.getTime()) : null;
        return {
          // Ids always use forward slashes, whatever the OS separator is.
          id: file.slice(0, -ext.length).split(sep).join('/'),
          chapters: info ? info.count : 1,
          ...(info && info.names.length > 0 ? { chapterNames: info.names } : {}),
          bytes: size,
          updatedAt: mtime.toISOString(),
          ...preview,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Folders listed explicitly so empty ones still show as collections.
    const folders = stated
      .filter(({ isDir }) => isDir)
      .map(({ file }) => file.split(sep).join('/'))
      .sort();
    return c.json({ studies, folders });
  });

  api.post(`/${base}/folders`, async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => null);
    const name = body?.name?.trim();
    if (!name || !validId(name)) return c.json({ error: 'invalid folder name' }, 400);
    mkdirSync(resolve(dir, name), { recursive: true });
    return c.json({ folder: name });
  });

  // Rename and move are the same operation: the id is the path. Renames of
  // whole folders drag their studies along because they are real directories.
  api.post(`/${base}/move`, async (c) => {
    const body = await c.req.json<{ from?: string; to?: string }>().catch(() => null);
    const from = body?.from?.trim();
    const to = body?.to?.trim();
    if (!from || !to || !validId(from) || !validId(to)) {
      return c.json({ error: 'invalid study id' }, 400);
    }
    if (!existsSync(pathOf(from))) return c.json({ error: 'no such study' }, 404);
    if (existsSync(pathOf(to))) return c.json({ error: 'a study with that name exists' }, 409);
    mkdirSync(resolve(pathOf(to), '..'), { recursive: true });
    // renameRetrying: a study being moved is one somebody just had open,
    // and on Windows a reader still holding it makes the rename throw a
    // transient EPERM (atomic.ts). Uncaught here, so that would 500 a
    // rename that was about to succeed.
    renameRetrying(pathOf(from), pathOf(to));
    // The parked copy follows the document. Renaming while changes are
    // pending is ordinary — the title is the first thing people fix — and
    // a swap left at the old name would be orphaned there, unreachable and
    // unrecoverable.
    try {
      // renameRetrying inside the swallow, not despite it: the catch is
      // here to absorb "nothing parked" (ENOENT, which is not transient
      // and still throws at once), and it would absorb a transient EPERM
      // just as quietly — leaving the parked copy orphaned at the old
      // name, which is exactly what this block exists to prevent.
      renameRetrying(swapOf(from), swapOf(to));
    } catch {
      /* nothing parked — the common case */
    }
    remark(from, to);
    hooks.onMoved?.(from, to);
    return c.json({ moved: to });
  });

  api.post(`/${base}/folders/move`, async (c) => {
    const body = await c.req.json<{ from?: string; to?: string }>().catch(() => null);
    const from = body?.from?.trim();
    const to = body?.to?.trim();
    if (!from || !to || !validId(from) || !validId(to)) {
      return c.json({ error: 'invalid folder name' }, 400);
    }
    const fromPath = resolve(dir, from);
    if (!existsSync(fromPath) || !statSync(fromPath).isDirectory()) {
      return c.json({ error: 'no such folder' }, 404);
    }
    const toPath = resolve(dir, to);
    if (existsSync(toPath)) return c.json({ error: 'a folder with that name exists' }, 409);
    mkdirSync(resolve(toPath, '..'), { recursive: true });
    // A directory, which atomic.ts singles out as MORE exposed than a
    // file: anything holding one study inside it open holds the folder.
    renameRetrying(fromPath, toPath);
    // The documents inside went with the directory, so their marks must too.
    const ids = readMarks();
    const moved = ids.map((id) => (id.startsWith(`${from}/`) ? `${to}${id.slice(from.length)}` : id));
    if (moved.some((id, at) => id !== ids[at])) writeMarks(moved);
    hooks.onFolderMoved?.(from, to);
    return c.json({ moved: to });
  });

  api.delete(`/${base}/folders/:name{.+}`, (c) => {
    const name = c.req.param('name');
    if (!validId(name)) return c.json({ error: 'invalid folder name' }, 400);
    const path = resolve(dir, name);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return c.json({ error: 'no such folder' }, 404);
    }
    // Never delete studies by side effect: a folder must be emptied first.
    // Parked copies do not count towards "not empty" — they belong to
    // documents, and a folder holding nothing but the swap of a document
    // that was deleted mid-crash looks empty and must behave that way, or
    // it can never be removed from inside the app.
    const left = readdirSync(path);
    if (left.some((f) => !f.endsWith('.swp'))) {
      return c.json({ error: 'folder is not empty, move or delete its studies first' }, 409);
    }
    for (const orphan of left) rmSync(resolve(path, orphan));
    rmdirSync(path);
    return c.json({ deleted: name });
  });

  // `{.+}` lets the id contain slashes: folders are part of the id.
  api.get(`/${base}/:id{.+}`, (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const path = pathOf(id);
    if (!existsSync(path)) return c.json({ error: 'no such study' }, 404);
    const pgn = readFileSync(path, 'utf-8');
    const swap = readSwap(id);
    // A swap identical to the file is one whose delete did not land —
    // there is nothing to recover from it, and offering it would be
    // asking a question with one answer. Drop it and say nothing.
    if (swap && swap.draft === pgn) {
      dropSwap(id);
      return c.json({ id, pgn });
    }
    return c.json({ id, pgn, ...(swap ?? {}) });
  });

  api.post(`/${base}`, async (c) => {
    const body = await c.req.json<{ name?: string; pgn?: string }>().catch(() => null);
    const name = body?.name?.trim();
    if (!name || !validId(name)) {
      return c.json(
        { error: 'study name must be letters, digits, spaces, _ . - (use / for a folder)' },
        400,
      );
    }
    if (typeof body?.pgn === "string" && Buffer.byteLength(body.pgn) > MAX_PGN_BYTES) {
      return c.json({ error: 'study too large' }, 413);
    }
    const path = pathOf(name);
    if (existsSync(path)) return c.json({ error: 'a study with that name exists' }, 409);
    mkdirSync(resolve(path, '..'), { recursive: true });
    const title = name.split('/').at(-1)!;
    // Optional initial content — the import path (e.g. a Lichess study
    // export). The client validates it parses; the server only caps size.
    // A fresh study is one empty chapter; a fresh note is a heading.
    writeFileSync(
      path,
      body?.pgn?.trim()
        ? body.pgn
        : ext === '.md'
          ? `# ${title}\n\n`
          : `[Event "${title}: Chapter 1"]\n[ChapterName "Chapter 1"]\n[Result "*"]\n\n*\n`,
    );
    return c.json({ id: name });
  });

  /**
   * `?draft=1` parks the body beside the document instead of saving it.
   *
   * A query parameter rather than its own route, because `:id{.+}` is
   * greedy: `/studies/foo/draft` would match it with the id `foo/draft`,
   * and a sibling route would have to win a fight with the document a
   * user could legitimately have called that.
   */
  const isDraft = (c: { req: { query: (k: string) => string | undefined } }): boolean =>
    c.req.query('draft') === '1';

  api.put(`/${base}/:id{.+}`, async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const body = await c.req.json<{ pgn?: string }>().catch(() => null);
    if (typeof body?.pgn !== 'string') return c.json({ error: 'missing pgn' }, 400);
    if (Buffer.byteLength(body.pgn) > MAX_PGN_BYTES) return c.json({ error: "study too large" }, 413);
    if (!existsSync(pathOf(id))) return c.json({ error: 'no such study' }, 404);

    if (isDraft(c)) {
      writeAtomic(swapOf(id), body.pgn);
      return c.json({ parked: id, bytes: body.pgn.length });
    }
    writeAtomic(pathOf(id), body.pgn);
    // The save IS the answer to whatever was parked; a swap that outlived
    // it would offer to restore an older version of what was just written.
    dropSwap(id);
    return c.json({ saved: id, bytes: body.pgn.length });
  });

  api.delete(`/${base}/:id{.+}`, (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'invalid study id' }, 400);
    // Discarding: the document stays, only the parked copy goes.
    if (isDraft(c)) {
      dropSwap(id);
      return c.json({ discarded: id });
    }
    const path = pathOf(id);
    if (!existsSync(path)) return c.json({ error: 'no such study' }, 404);
    rmSync(path);
    dropSwap(id);
    remark(id, null);
    return c.json({ deleted: id });
  });

  return api;
}
