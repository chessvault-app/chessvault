import { Hono } from 'hono';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
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
  /** Solution origin tier; 'corrected' = entered or fixed by a human. */
  provenance?: string;
  /** The number the book prints beside this puzzle. */
  number?: number;
  /** Where in the book it came from, for the source pane. */
  evidence?: BookEvidence;
}

interface BookEvidence {
  /** Rendered page image in diagrams/, e.g. "page033.jpg". */
  page?: string;
  /** The diagram's place on that page, in page fractions. */
  rect?: { x: number; y: number; w: number; h: number };
  /** The answers page covering this puzzle's number. */
  solutionPage?: string;
}

/** The tiers a solution can arrive with, in descending confidence. */
const PROVENANCE = [
  'book-parsed',
  'corrected',
  'engine-corroborated',
  'engine-only',
  'engine-unverified',
] as const;

const IMAGE_FILE = /^[A-Za-z0-9._-]{1,64}\.(jpg|jpeg|png)$/;

/** An evidence block is only kept if every part of it is well formed. */
function cleanEvidence(raw: unknown): BookEvidence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { page, rect, solutionPage } = raw as BookEvidence;
  const out: BookEvidence = {};
  if (typeof page === 'string' && IMAGE_FILE.test(page)) out.page = page;
  if (typeof solutionPage === 'string' && IMAGE_FILE.test(solutionPage)) {
    out.solutionPage = solutionPage;
  }
  if (
    rect &&
    (['x', 'y', 'w', 'h'] as const).every((k) => typeof rect[k] === 'number' && rect[k] >= 0 && rect[k] <= 1)
  ) {
    out.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

  /**
   * puzzles.json is 500-600 KB per book and was re-read + re-parsed on the
   * shelf listing AND on every attempt POST (which only needs to know an
   * id exists). Both derive from file bytes, so an mtime key is exact —
   * the same pattern as the studies chapter cache. A missing file yields
   * mtime 0, which invalidates as soon as one appears.
   */
  const mtimeOf = (path: string): number => {
    try {
      return statSync(path).mtimeMs;
    } catch {
      return 0;
    }
  };
  const idsCache = new Map<string, { mtimeMs: number; ids: Set<string> }>();
  const puzzleIds = (slug: string): Set<string> => {
    const path = puzzlesPath(slug);
    const mtimeMs = mtimeOf(path);
    const hit = idsCache.get(slug);
    if (hit && hit.mtimeMs === mtimeMs) return hit.ids;
    const ids = new Set(readJson<BookPuzzle[]>(path, []).map((p) => p.id));
    idsCache.set(slug, { mtimeMs, ids });
    return ids;
  };
  const tallyCache = new Map<
    string,
    { puzzlesMs: number; progressMs: number; tally: { puzzles: number; solved: number; failed: number } }
  >();
  const bookTally = (slug: string): { puzzles: number; solved: number; failed: number } => {
    const puzzlesMs = mtimeOf(puzzlesPath(slug));
    const progressMs = mtimeOf(progressPath(slug));
    const hit = tallyCache.get(slug);
    if (hit && hit.puzzlesMs === puzzlesMs && hit.progressMs === progressMs) return hit.tally;
    const puzzles = readJson<BookPuzzle[]>(puzzlesPath(slug), []);
    const progress = readJson<Record<string, PuzzleProgress>>(progressPath(slug), {});
    let solved = 0;
    let failed = 0;
    for (const p of puzzles) {
      const last = progress[p.id]?.last;
      if (last === 'win') solved++;
      else if (last === 'loss') failed++;
    }
    const tally = { puzzles: puzzles.length, solved, failed };
    tallyCache.set(slug, { puzzlesMs, progressMs, tally });
    return tally;
  };

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
        const tally = bookTally(slug);
        return {
          slug,
          title: book.title ?? slug,
          createdAt: book.createdAt ?? null,
          puzzles: tally.puzzles,
          solved: tally.solved,
          failed: tally.failed,
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

  // Wipe every attempt on this book; the puzzles themselves stay put.
  api.delete('/puzzlebooks/:slug/progress', (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    rmSync(progressPath(slug), { force: true });
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
      /** An importer adding a puzzle it read out of the book itself. */
      number?: number;
      provenance?: string;
      evidence?: unknown;
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
    // An importer says which puzzle this is, how it knows the solution and
    // where in the book it came from; a human typing one in says none of
    // that, and lands at the top of the ladder because they read it.
    const number = Number.isInteger(body.number) && body.number! > 0 ? body.number : undefined;
    const provenance = PROVENANCE.includes(body.provenance as (typeof PROVENANCE)[number])
      ? body.provenance!
      : 'corrected';
    const evidence = cleanEvidence(body.evidence);
    // Numbered puzzles keep the importer's id, so a re-import updates a
    // puzzle in place and its progress survives — the same reason the
    // pipeline writes `n<number>`.
    const id = number === undefined ? `p${Date.now().toString(36)}` : `n${number}`;
    const at = puzzles.findIndex((p) => p.id === id);
    const puzzle: BookPuzzle = {
      id,
      fen: body.fen,
      uci: body.uci,
      san: body.san,
      ...(wildcards.length > 0 ? { wildcards } : {}),
      added: new Date().toISOString(),
      provenance,
      ...(number === undefined ? {} : { number }),
      ...(evidence ? { evidence } : {}),
    };
    if (at === -1) puzzles.push(puzzle);
    else puzzles[at] = puzzle;
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

  // Book cover, written by the in-app importer straight from the PDF's first
  // page — so a book gets a shelf thumbnail with no offline render step.
  api.put('/puzzlebooks/:slug/cover', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { image?: string };
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.image ?? '');
    if (!match) return c.json({ error: 'expected a jpeg/png data URL' }, 400);
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.length > 2_000_000) return c.json({ error: 'cover too large' }, 400);
    mkdirSync(diagramsDir(slug), { recursive: true });
    writeFileSync(resolve(diagramsDir(slug), 'cover.jpg'), bytes);
    return c.json({ ok: true });
  });

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
    // Diagram/evidence files are content-addressed (draft ids, page numbers),
    // so cache them hard — this was `no-store`, which re-fetched every
    // thumbnail on every view. cover.jpg can change on re-import, so it gets
    // a short TTL instead of immutable.
    const cache =
      file === 'cover.jpg'
        ? 'private, max-age=3600'
        : 'private, max-age=31536000, immutable';
    return c.body(new Uint8Array(readFileSync(path)), 200, {
      'content-type': file.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'cache-control': cache,
    });
  });

  api.post('/puzzlebooks/:slug/attempt', async (c) => {
    const slug = c.req.param('slug');
    if (!validBook(slug)) return c.json({ error: 'unknown book' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { id?: string; win?: boolean };
    if (typeof body.id !== 'string' || typeof body.win !== 'boolean') {
      return c.json({ error: 'expected { id, win }' }, 400);
    }
    if (!puzzleIds(slug).has(body.id)) return c.json({ error: 'unknown puzzle' }, 404);
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
