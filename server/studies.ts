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

/**
 * Studies are plain multi-game PGN files in vault/studies/ — one game per
 * chapter, Lichess annotation syntax. The server never parses move text; the
 * shared codec runs in the client, and these routes only move bytes. Writes
 * are atomic (temp file + rename) because a study is user data: a crash
 * mid-write must never leave a truncated vault file.
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

/** How much of a note is read to find its first sentence. */
const EXCERPT_BYTES = 1024;

/**
 * A note's first line of prose, for the shelf.
 *
 * Skips the heading — that is the note's name, which the card already
 * shows — and anything that is punctuation rather than words: a rule, a
 * front-matter block, a bullet's dash, an embedded board. What is left is
 * the sentence somebody actually wrote, flattened to one line.
 */
function firstProseLine(head: string): string | null {
  const lines = head.split('\n');
  // YAML front matter is a BLOCK, not a rule: skipping only its `---`
  // fences left "tags: endgame" standing there as the note's first
  // sentence. It only counts as front matter if it opens the file.
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, at) => at > 0 && line.trim() === '---');
    if (close > 0) lines.splice(0, close + 1);
  }
  let inFence = false;
  for (const raw of lines) {
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

  // The same cache, for the line of a note the shelf shows under its name.
  // Only the head of the file is read — a listing must never depend on how
  // long the longest note is.
  const excerptCache = new Map<string, { mtimeMs: number; excerpt: string | null }>();

  const excerptCached = (path: string, mtimeMs: number): string | null => {
    const hit = excerptCache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) return hit.excerpt;
    let excerpt: string | null = null;
    try {
      const fd = openSync(path, 'r');
      try {
        const buf = Buffer.alloc(EXCERPT_BYTES);
        const read = readSync(fd, buf, 0, EXCERPT_BYTES, 0);
        // A multi-byte character cut in half at the end of the window
        // becomes a replacement char; dropping the last line loses nothing
        // a first sentence needs.
        excerpt = firstProseLine(buf.subarray(0, read).toString('utf-8'));
      } finally {
        closeSync(fd);
      }
    } catch {
      /* unreadable between readdir and here — the card just has no preview */
    }
    excerptCache.set(path, { mtimeMs, excerpt });
    return excerpt;
  };

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
        return {
          // Ids always use forward slashes, whatever the OS separator is.
          id: file.slice(0, -ext.length).split(sep).join('/'),
          chapters: ext === '.pgn' ? countChaptersCached(path, mtime.getTime()) : 1,
          bytes: size,
          updatedAt: mtime.toISOString(),
          // Markdown only: a PGN's "first line" is a header nobody wants
          // to read, and the study card has its chapter count instead.
          excerpt: ext === '.md' ? excerptCached(path, mtime.getTime()) : null,
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
    return c.json({ deleted: id });
  });

  return api;
}
