import { Hono } from 'hono';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';
import { VAULT_STUDIES } from './paths.ts';

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
// Parentheses are in the set because the games collection generates
// "White vs Black date (2)" names for duplicates — documents must be
// addressable under the names the app itself writes.
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9 ()_.-]*$/;
const MAX_DEPTH = 4;
const MAX_PGN_BYTES = 20 * 1024 * 1024;

function validId(id: string): boolean {
  const segments = id.split('/');
  return (
    segments.length <= MAX_DEPTH &&
    segments.every((s) => SEGMENT_RE.test(s) && !s.endsWith('.') && s.trim() === s)
  );
}

/** Count chapters without parsing: every game carries an Event header. */
function countChapters(pgn: string): number {
  return pgn.match(/^\[Event /gm)?.length ?? (pgn.trim() ? 1 : 0);
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

  api.get(`/${base}`, (c) => {
    const entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' });
    const studies = entries
      .filter((f) => f.endsWith(ext))
      .map((file) => {
        const path = resolve(dir, file);
        const stat = statSync(path);
        return {
          // Ids always use forward slashes, whatever the OS separator is.
          id: file.slice(0, -ext.length).split(sep).join('/'),
          chapters: ext === '.pgn' ? countChapters(readFileSync(path, 'utf-8')) : 1,
          bytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Folders listed explicitly so empty ones still show as collections.
    const folders = entries
      .filter((f) => statSync(resolve(dir, f)).isDirectory())
      .map((f) => f.split(sep).join('/'))
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
    const body = await c.req.json<{ name?: string }>().catch(() => null);
    const name = body?.name?.trim();
    if (!name || !validId(name)) {
      return c.json(
        { error: 'study name must be letters, digits, spaces, _ . - (use / for a collection)' },
        400,
      );
    }
    const path = pathOf(name);
    if (existsSync(path)) return c.json({ error: 'a study with that name exists' }, 409);
    mkdirSync(resolve(path, '..'), { recursive: true });
    const title = name.split('/').at(-1)!;
    // A fresh study is one empty chapter; a fresh note is a heading.
    writeFileSync(
      path,
      ext === '.md'
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
    if (body.pgn.length > MAX_PGN_BYTES) return c.json({ error: 'study too large' }, 413);
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
