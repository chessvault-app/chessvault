import { Hono } from 'hono';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { VAULT_STUDIES } from './paths.ts';
import { validId } from '../shared/vaultNames.ts';
import { tagsFromFrontMatter, tagsFromPgnText } from '../shared/tags.ts';
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

/** Count chapters without parsing: every game carries an Event header. */
function countChapters(pgn: string): number {
  return pgn.match(/^\[Event /gm)?.length ?? (pgn.trim() ? 1 : 0);
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
  /** Front-matter tags, lower-cased and de-duplicated. */
  tags: string[];
  /** Where the note's first embedded board starts. */
  fen: string | null;
}

/** Split the head into its front matter (if any) and the body after it. */
function splitFrontMatter(head: string): { front: string; body: string[] } {
  const lines = head.split('\n');
  // Front matter is a BLOCK, not a rule, and only if it opens the file:
  // skipping just its `---` fences left "tags: endgame" standing there as
  // the note's first sentence.
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
    if (close > 0) {
      return { front: `${lines.slice(0, close + 1).join('\n')}\n`, body: lines.slice(close + 1) };
    }
  }
  return { front: '', body: lines };
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
export function readPreview(head: string): DocPreview {
  const { front, body } = splitFrontMatter(head);
  return {
    excerpt: firstProseLine(body),
    // Front matter only — an inline #hashtag is indistinguishable from a
    // markdown heading and from "#1 priority", and guessing wrong puts a
    // badge on a card the note never asked for.
    tags: tagsFromFrontMatter(front),
    fen: firstBoardFen(body),
  };
}

/**
 * Plain-file document CRUD over a directory. Mounted three times: `studies`
 * (vault/studies, .pgn), `games/docs` (the games collection, .pgn — an
 * annotated game is a one-chapter study), and `notes` (vault/notes, .md).
 */
export function studiesApi(dir: string = VAULT_STUDIES, base = 'studies', ext = '.pgn'): Hono {
  mkdirSync(dir, { recursive: true });
  const api = new Hono();
  const pathOf = (id: string): string => resolve(dir, `${id}${ext}`);

  // Chapter counts parsed per file and cached by mtime, the same pattern as
  // the games list cache — a listing must not re-read every study body.
  const chapterCache = new Map<string, { mtimeMs: number; chapters: number }>();

  const countChaptersCached = (path: string, mtimeMs: number): number => {
    const hit = chapterCache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.chapters;
    const chapters = countChapters(readFileSync(path, 'utf-8'));
    chapterCache.set(path, { mtimeMs, chapters });
    return chapters;
  };

  // The same cache, for everything a note's card shows beyond its stat.
  // Only the head of the file is read — a listing must never depend on how
  // long the longest note is.
  const previewCache = new Map<string, { mtimeMs: number; preview: DocPreview }>();

  const previewCached = (path: string, mtimeMs: number): DocPreview => {
    const hit = previewCache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.preview;
    let preview: DocPreview = { excerpt: null, tags: [], fen: null };
    try {
      const fd = openSync(path, 'r');
      try {
        const buf = Buffer.alloc(PREVIEW_BYTES);
        const read = readSync(fd, buf, 0, PREVIEW_BYTES, 0);
        // A multi-byte character cut in half at the end of the window
        // becomes a replacement char; dropping the last line loses nothing
        // a first sentence needs.
        const head = buf.subarray(0, read).toString('utf-8');
        // A study is PGN: no prose to excerpt, but its tags sit in a
        // header on the first chapter and that chapter IS a game, so it
        // gets a board the same way a note's fence does.
        preview =
          ext === '.md'
            ? readPreview(head)
            : { excerpt: null, tags: tagsFromPgnText(head), fen: firstChapterFen(head, read) };
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
   * Which documents are pinned, as plain JSON beside them.
   *
   * The same shape the games shelf already uses for its bookmarks: the
   * vault holds the answer, so a pin survives a browser, a device and a
   * reinstall. The leading dot keeps it out of the way of somebody looking
   * at the folder in a file manager, and it is not a `.md` so it is never
   * listed as a note.
   */
  const pinsPath = resolve(dir, '.pins.json');
  const readPins = (): string[] => {
    try {
      const parsed = JSON.parse(readFileSync(pinsPath, 'utf-8')) as { ids?: string[] };
      return Array.isArray(parsed.ids) ? parsed.ids : [];
    } catch {
      return [];
    }
  };

  const writePins = (ids: string[]): void => {
    const tmp = `${pinsPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ ids }, null, 2)}\n`);
    renameSync(tmp, pinsPath);
  };

  /**
   * Follow a pinned document through a rename, or drop it on a delete.
   *
   * Without this a pin is a name, not a thing: renaming a pinned note
   * silently unpinned it, and deleting one left an id in the file that
   * would re-pin whatever was next created under that name.
   */
  const repin = (from: string, to: string | null): void => {
    const ids = readPins();
    const at = ids.indexOf(from);
    if (at < 0) return;
    if (to === null) ids.splice(at, 1);
    else ids[at] = to;
    writePins(ids);
  };

  api.get(`/${base}/pins`, (c) => c.json({ ids: readPins() }));

  api.post(`/${base}/pins/toggle`, async (c) => {
    const body = await c.req.json<{ id?: string }>().catch(() => null);
    const id = body?.id?.trim();
    if (!id || !validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const ids = readPins();
    const at = ids.indexOf(id);
    const pinned = at < 0;
    if (pinned) ids.unshift(id);
    else ids.splice(at, 1);
    // Atomic, like every other vault write: a crash mid-write must not
    // leave a truncated file that reads as "nothing is pinned".
    writePins(ids);
    return c.json({ id, pinned });
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
        return {
          // Ids always use forward slashes, whatever the OS separator is.
          id: file.slice(0, -ext.length).split(sep).join('/'),
          chapters: ext === '.pgn' ? countChaptersCached(path, mtime.getTime()) : 1,
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
    if (!name || !validId(name)) return c.json({ error: 'invalid collection name' }, 400);
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
    renameSync(pathOf(from), pathOf(to));
    repin(from, to);
    return c.json({ moved: to });
  });

  api.post(`/${base}/folders/move`, async (c) => {
    const body = await c.req.json<{ from?: string; to?: string }>().catch(() => null);
    const from = body?.from?.trim();
    const to = body?.to?.trim();
    if (!from || !to || !validId(from) || !validId(to)) {
      return c.json({ error: 'invalid collection name' }, 400);
    }
    const fromPath = resolve(dir, from);
    if (!existsSync(fromPath) || !statSync(fromPath).isDirectory()) {
      return c.json({ error: 'no such collection' }, 404);
    }
    const toPath = resolve(dir, to);
    if (existsSync(toPath)) return c.json({ error: 'a collection with that name exists' }, 409);
    mkdirSync(resolve(toPath, '..'), { recursive: true });
    renameSync(fromPath, toPath);
    // The documents inside went with the directory, so their pins must too.
    const ids = readPins();
    const moved = ids.map((id) => (id.startsWith(`${from}/`) ? `${to}${id.slice(from.length)}` : id));
    if (moved.some((id, at) => id !== ids[at])) writePins(moved);
    return c.json({ moved: to });
  });

  api.delete(`/${base}/folders/:name{.+}`, (c) => {
    const name = c.req.param('name');
    if (!validId(name)) return c.json({ error: 'invalid collection name' }, 400);
    const path = resolve(dir, name);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return c.json({ error: 'no such collection' }, 404);
    }
    // Never delete studies by side effect: a folder must be emptied first.
    if (readdirSync(path).length > 0) {
      return c.json({ error: 'collection is not empty — move or delete its studies first' }, 409);
    }
    rmdirSync(path);
    return c.json({ deleted: name });
  });

  // `{.+}` lets the id contain slashes: folders are part of the id.
  api.get(`/${base}/:id{.+}`, (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const path = pathOf(id);
    if (!existsSync(path)) return c.json({ error: 'no such study' }, 404);
    return c.json({ id, pgn: readFileSync(path, 'utf-8') });
  });

  api.post(`/${base}`, async (c) => {
    const body = await c.req.json<{ name?: string; pgn?: string }>().catch(() => null);
    const name = body?.name?.trim();
    if (!name || !validId(name)) {
      return c.json(
        { error: 'study name must be letters, digits, spaces, _ . - (use / for a collection)' },
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

  api.put(`/${base}/:id{.+}`, async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const body = await c.req.json<{ pgn?: string }>().catch(() => null);
    if (typeof body?.pgn !== 'string') return c.json({ error: 'missing pgn' }, 400);
    if (Buffer.byteLength(body.pgn) > MAX_PGN_BYTES) return c.json({ error: "study too large" }, 413);
    if (!existsSync(pathOf(id))) return c.json({ error: 'no such study' }, 404);

    const path = pathOf(id);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, body.pgn);
    renameSync(tmp, path);
    return c.json({ saved: id, bytes: body.pgn.length });
  });

  api.delete(`/${base}/:id{.+}`, (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'invalid study id' }, 400);
    const path = pathOf(id);
    if (!existsSync(path)) return c.json({ error: 'no such study' }, 404);
    rmSync(path);
    repin(id, null);
    return c.json({ deleted: id });
  });

  return api;
}
