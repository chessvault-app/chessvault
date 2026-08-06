import { Hono } from 'hono';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { VAULT_STUDIES } from './paths.ts';

/**
 * Studies are plain multi-game PGN files in vault/studies/ — one game per
 * chapter, Lichess annotation syntax. The server never parses move text; the
 * shared codec runs in the client, and these routes only move bytes. Writes
 * are atomic (temp file + rename) because a study is user data: a crash
 * mid-write must never leave a truncated vault file.
 */

/** File names: no separators, no leading dot — the id IS the file name. */
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const MAX_PGN_BYTES = 20 * 1024 * 1024;

/** Count chapters without parsing: every game carries an Event header. */
function countChapters(pgn: string): number {
  return pgn.match(/^\[Event /gm)?.length ?? (pgn.trim() ? 1 : 0);
}

export function studiesApi(dir: string = VAULT_STUDIES): Hono {
  mkdirSync(dir, { recursive: true });
  const api = new Hono();
  const pathOf = (id: string): string => resolve(dir, `${id}.pgn`);

  api.get('/studies', (c) => {
    const studies = readdirSync(dir)
      .filter((f) => f.endsWith('.pgn'))
      .map((file) => {
        const path = resolve(dir, file);
        const stat = statSync(path);
        return {
          id: file.slice(0, -'.pgn'.length),
          chapters: countChapters(readFileSync(path, 'utf-8')),
          bytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return c.json({ studies });
  });

  api.get('/studies/:id', (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return c.json({ error: 'invalid study id' }, 400);
    const path = pathOf(id);
    if (!existsSync(path)) return c.json({ error: 'no such study' }, 404);
    return c.json({ id, pgn: readFileSync(path, 'utf-8') });
  });

  api.post('/studies', async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => null);
    const name = body?.name?.trim();
    if (!name || !ID_RE.test(name)) {
      return c.json({ error: 'study name must be letters, digits, spaces, _ . -' }, 400);
    }
    const path = pathOf(name);
    if (existsSync(path)) return c.json({ error: 'a study with that name exists' }, 409);
    // A fresh study is one empty chapter from the start position.
    writeFileSync(path, `[Event "${name}: Chapter 1"]\n[ChapterName "Chapter 1"]\n[Result "*"]\n\n*\n`);
    return c.json({ id: name });
  });

  api.put('/studies/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return c.json({ error: 'invalid study id' }, 400);
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

  api.delete('/studies/:id', (c) => {
    const id = c.req.param('id');
    if (!ID_RE.test(id)) return c.json({ error: 'invalid study id' }, 400);
    const path = pathOf(id);
    if (!existsSync(path)) return c.json({ error: 'no such study' }, 404);
    rmSync(path);
    return c.json({ deleted: id });
  });

  return api;
}
