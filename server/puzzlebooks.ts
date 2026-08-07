import { Hono } from 'hono';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
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
  /** Ply indices where any legal move is accepted (defender don't-cares). */
  wildcards?: number[];
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
  const ocrPath = (slug: string): string => resolve(bookDir(slug), 'ocr.json');
  const draftsPath = (slug: string): string => resolve(bookDir(slug), 'drafts.json');
  const diagramsDir = (slug: string): string => resolve(bookDir(slug), 'diagrams');

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
          // Cover scan (diagrams/cover.jpg), written by the book importer.
          cover: existsSync(resolve(diagramsDir(slug), 'cover.jpg')),
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
      drafts: readJson<
        { id: string; image: string; fen: string | null; added: string }[]
      >(draftsPath(slug), []),
    });
  });

  api.post('/puzzlebooks/:slug/puzzles', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      fen?: string;
      uci?: string[];
      san?: string[];
      wildcards?: number[];
      /** Correcting an existing puzzle: swap it in place, keep its id
       *  (progress stays attached) and its book metadata. */
      replaceId?: string;
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
    const wildcards = (body.wildcards ?? []).filter(
      (n) => Number.isInteger(n) && n >= 0 && n < body.uci!.length,
    );
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    if (body.replaceId !== undefined) {
      const at = puzzles.findIndex((p) => p.id === body.replaceId);
      if (at === -1) return c.json({ error: 'unknown puzzle' }, 404);
      const previous = puzzles[at]! as BookPuzzle & Record<string, unknown>;
      const corrected = {
        ...previous, // number/evidence/etc survive the correction
        fen: body.fen,
        uci: body.uci,
        san: body.san,
        added: new Date().toISOString(),
        provenance: 'corrected',
      } as BookPuzzle;
      if (wildcards.length > 0) (corrected as { wildcards?: number[] }).wildcards = wildcards;
      else delete (corrected as { wildcards?: number[] }).wildcards;
      puzzles[at] = corrected;
      writeJson(puzzlesPath(slug), puzzles);
      return c.json({ puzzle: corrected });
    }
    const puzzle: BookPuzzle = {
      id: `p${Date.now().toString(36)}`,
      fen: body.fen,
      uci: body.uci,
      san: body.san,
      ...(wildcards.length > 0 ? { wildcards } : {}),
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

  // Diagram-OCR templates: what THIS book's printed pieces look like,
  // harvested from confirmed positions (see web/src/puzzles/ocr). Opaque
  // to the server beyond shape checks; the pixel math lives client-side.
  api.get('/puzzlebooks/:slug/ocr', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    return c.json(readJson<{ templates: unknown[] }>(ocrPath(slug), { templates: [] }));
  });

  api.put('/puzzlebooks/:slug/ocr', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { templates?: unknown };
    if (!Array.isArray(body.templates) || body.templates.length > 400) {
      return c.json({ error: 'expected { templates: [...] } (max 400)' }, 400);
    }
    const ok = body.templates.every((t) => {
      const template = t as { label?: unknown; feature?: unknown };
      return (
        typeof template.label === 'string' &&
        template.label.length <= 8 &&
        typeof template.feature === 'string' &&
        template.feature.length <= 512
      );
    });
    if (!ok) return c.json({ error: 'malformed template' }, 400);
    writeJson(ocrPath(slug), { templates: body.templates });
    return c.json({ ok: true, count: body.templates.length });
  });

  // Drafts: diagrams detected in an imported PDF, waiting for the user to
  // confirm the position and record the solution. Each keeps its cropped
  // board image so it can be eyeballed and re-read as the font improves.
  interface Draft {
    id: string;
    image: string;
    fen: string | null;
    added: string;
  }

  api.post('/puzzlebooks/:slug/drafts', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      drafts?: { image?: string; fen?: string | null }[];
    };
    if (!Array.isArray(body.drafts) || body.drafts.length === 0 || body.drafts.length > 500) {
      return c.json({ error: 'expected { drafts: [...] } (1..500)' }, 400);
    }
    const existing = readJson<Draft[]>(draftsPath(slug), []);
    mkdirSync(diagramsDir(slug), { recursive: true });
    const added: Draft[] = [];
    for (const [index, entry] of body.drafts.entries()) {
      const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(entry.image ?? '');
      if (!match) return c.json({ error: `draft ${index}: expected a jpeg/png data URL` }, 400);
      const bytes = Buffer.from(match[2]!, 'base64');
      if (bytes.length > 400_000) return c.json({ error: `draft ${index}: image too large` }, 400);
      const id = `d${Date.now().toString(36)}${index.toString(36)}`;
      const file = `${id}.${match[1] === 'png' ? 'png' : 'jpg'}`;
      writeFileSync(resolve(diagramsDir(slug), file), bytes);
      added.push({
        id,
        image: file,
        fen: typeof entry.fen === 'string' ? entry.fen : null,
        added: new Date().toISOString(),
      });
    }
    writeJson(draftsPath(slug), [...existing, ...added]);
    return c.json({ added: added.length });
  });

  // Bulk FEN updates after a client-side re-read of the stored diagrams.
  api.put('/puzzlebooks/:slug/drafts', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      updates?: { id?: string; fen?: string | null }[];
    };
    if (!Array.isArray(body.updates)) return c.json({ error: 'expected { updates: [...] }' }, 400);
    const drafts = readJson<Draft[]>(draftsPath(slug), []);
    for (const update of body.updates) {
      const draft = drafts.find((d) => d.id === update.id);
      if (draft) draft.fen = typeof update.fen === 'string' ? update.fen : null;
    }
    writeJson(draftsPath(slug), drafts);
    return c.json({ ok: true });
  });

  api.delete('/puzzlebooks/:slug/drafts/:id', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const drafts = readJson<Draft[]>(draftsPath(slug), []);
    const doomed = drafts.find((d) => d.id === c.req.param('id'));
    if (!doomed) return c.json({ error: 'unknown draft' }, 404);
    try {
      unlinkSync(resolve(diagramsDir(slug), doomed.image));
    } catch {
      // already gone
    }
    writeJson(
      draftsPath(slug),
      drafts.filter((d) => d.id !== doomed.id),
    );
    return c.json({ ok: true });
  });

  api.get('/puzzlebooks/:slug/diagrams/:file', (c) => {
    const slug = c.req.param('slug');
    const file = c.req.param('file');
    if (!validBook(slug) || !/^[A-Za-z0-9]+\.(jpg|png)$/.test(file)) {
      return c.json({ error: 'unknown diagram' }, 404);
    }
    const path = resolve(diagramsDir(slug), file);
    if (!existsSync(path)) return c.json({ error: 'unknown diagram' }, 404);
    return c.body(new Uint8Array(readFileSync(path)), 200, {
      'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'cache-control': 'no-store',
    });
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
