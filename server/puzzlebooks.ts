import { Hono } from 'hono';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { VAULT } from './paths.ts';

/**
 * Book puzzles — positions transcribed from paper books (lanph3re's v1: manual
 * board entry; OCR later). Vault data, one directory per book:
 *
 *   vault/puzzlebooks/<slug>/book.json      { title, createdAt }
 *   vault/puzzlebooks/<slug>/puzzles.json   [{ id, fen, uci[], san[], added }]
 *   vault/puzzlebooks/<slug>/progress.json  { [id]: { tries, wins, last, at } }
 *
 * Unlike the lichess trainer, solutions here demand BOTH sides' moves.
 */

const BOOKS_DIR = resolve(VAULT, 'puzzlebooks');
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;

interface BookPuzzle {
  id: string;
  fen: string;
  uci: string[];
  san: string[];
  added: string;
}

interface PuzzleProgress {
  tries: number;
  wins: number;
  last: 'win' | 'loss';
  at: string;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function puzzleBooksApi(dir: string = BOOKS_DIR): Hono {
  const bookDir = (slug: string): string => resolve(dir, slug);
  const puzzlesPath = (slug: string): string => resolve(bookDir(slug), 'puzzles.json');
  const progressPath = (slug: string): string => resolve(bookDir(slug), 'progress.json');

  const validBook = (slug: string): boolean =>
    SLUG_RE.test(slug) && existsSync(resolve(bookDir(slug), 'book.json'));

  const api = new Hono();

  api.get('/puzzlebooks', (c) => {
    if (!existsSync(dir)) return c.json({ books: [] });
    const books = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const slug = e.name;
        const book = readJson<{ title?: string; createdAt?: string }>(
          resolve(bookDir(slug), 'book.json'),
          {},
        );
        const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
        const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
        const solved = puzzles.filter((p) => progress[p.id]?.last === 'win').length;
        const failed = puzzles.filter((p) => progress[p.id]?.last === 'loss').length;
        return {
          slug,
          title: book.title ?? slug,
          createdAt: book.createdAt ?? null,
          puzzles: puzzles.length,
          solved,
          failed,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
    return c.json({ books });
  });

  api.post('/puzzlebooks', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    const title = body.title?.trim();
    if (!title) return c.json({ error: 'a book needs a title' }, 400);
    const slug = title.replace(/[^A-Za-z0-9 _.-]/g, '').trim();
    if (!SLUG_RE.test(slug)) return c.json({ error: 'that title cannot become a folder name' }, 400);
    if (existsSync(bookDir(slug))) return c.json({ error: 'a book with that name exists' }, 409);
    mkdirSync(bookDir(slug), { recursive: true });
    writeJson(resolve(bookDir(slug), 'book.json'), { title, createdAt: new Date().toISOString() });
    writeJson(puzzlesPath(slug), []);
    return c.json({ slug });
  });

  api.delete('/puzzlebooks/:slug', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    rmSync(bookDir(slug), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  api.get('/puzzlebooks/:slug', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const book = readJson<{ title?: string }>(resolve(bookDir(slug), 'book.json'), {});
    return c.json({
      slug,
      title: book.title ?? slug,
      puzzles: readJson<BookPuzzle[]>(puzzlesPath(slug), []),
      progress: readJson<Record<string, PuzzleProgress>>(progressPath(slug), {}),
    });
  });

  api.post('/puzzlebooks/:slug/puzzles', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      fen?: string;
      uci?: string[];
      san?: string[];
    };
    if (
      typeof body.fen !== 'string' ||
      !Array.isArray(body.uci) ||
      !Array.isArray(body.san) ||
      body.uci.length === 0 ||
      body.uci.length !== body.san.length
    ) {
      return c.json({ error: 'expected { fen, uci[], san[] } with a non-empty solution' }, 400);
    }
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    const puzzle: BookPuzzle = {
      id: `p${Date.now().toString(36)}`,
      fen: body.fen,
      uci: body.uci,
      san: body.san,
      added: new Date().toISOString(),
    };
    puzzles.push(puzzle);
    writeJson(puzzlesPath(slug), puzzles);
    return c.json({ puzzle });
  });

  api.delete('/puzzlebooks/:slug/puzzles/:id', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    const next = puzzles.filter((p) => p.id !== c.req.param('id'));
    if (next.length === puzzles.length) return c.json({ error: 'unknown puzzle' }, 404);
    writeJson(puzzlesPath(slug), next);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    delete progress[c.req.param('id')];
    writeJson(progressPath(slug), progress);
    return c.json({ ok: true });
  });

  api.post('/puzzlebooks/:slug/attempt', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; win?: boolean };
    if (typeof body.id !== 'string' || typeof body.win !== 'boolean') {
      return c.json({ error: 'expected { id, win }' }, 400);
    }
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    if (!puzzles.some((p) => p.id === body.id)) return c.json({ error: 'unknown puzzle' }, 404);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    const prev = progress[body.id];
    progress[body.id] = {
      tries: (prev?.tries ?? 0) + 1,
      wins: (prev?.wins ?? 0) + (body.win ? 1 : 0),
      last: body.win ? 'win' : 'loss',
      at: new Date().toISOString(),
    };
    writeJson(progressPath(slug), progress);
    return c.json({ progress: progress[body.id] });
  });

  return api;
}
