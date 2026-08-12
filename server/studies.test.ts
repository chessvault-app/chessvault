import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chaptersToPgn, pgnToChapters } from '../shared/pgn.ts';
import { sanitizeSegment, studiesApi, validId } from './studies.ts';

describe('studies api', () => {
  let dir: string;
  let app: Hono;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'studies-api-'));
    app = new Hono().route('/api', studiesApi(dir));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty', async () => {
    const { studies } = await (await app.request('/api/studies')).json();
    expect(studies).toEqual([]);
  });

  it('creates a study with one starter chapter', async () => {
    const res = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ruy Lopez' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'Ruy Lopez' });
    expect(existsSync(join(dir, 'Ruy Lopez.pgn'))).toBe(true);

    // The starter file must parse through the shared codec.
    const { pgn } = await (await app.request('/api/studies/Ruy%20Lopez')).json();
    const chapters = pgnToChapters(pgn);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.name).toBe('Chapter 1');
  });

  it('creates a study from imported PGN content (Lichess export shape)', async () => {
    const lichessExport = [
      '[Event "My Study: Chapter 1"]\n[Result "*"]\n\n1. e4 e5 { [%cal Ge2e4] } *',
      '[Event "My Study: Chapter 2"]\n[FEN "8/8/8/8/8/4K3/8/4k3 w - - 0 1"]\n[SetUp "1"]\n\n*',
    ].join('\n\n');
    const res = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Imported', pgn: lichessExport }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const stored = readFileSync(join(dir, 'Imported.pgn'), 'utf-8');
    expect(pgnToChapters(stored)).toHaveLength(2);
    // Later cases assert on the study count — leave the vault as found.
    await app.request('/api/studies/Imported', { method: 'DELETE' });
  });

  it('refuses duplicates and bad names', async () => {
    const post = (name: string) =>
      app.request('/api/studies', {
        method: 'POST',
        body: JSON.stringify({ name }),
        headers: { 'content-type': 'application/json' },
      });
    expect((await post('Ruy Lopez')).status).toBe(409);
    expect((await post('../evil')).status).toBe(400);
    expect((await post('.hidden')).status).toBe(400);
    expect((await post('')).status).toBe(400);
  });

  it('round-trips a save through the shared codec', async () => {
    const { pgn } = await (await app.request('/api/studies/Ruy%20Lopez')).json();
    const chapters = pgnToChapters(pgn);
    chapters[0]!.tree = pgnToChapters('[Event "x"]\n\n1. e4 e5 2. Nf3 {The point.} *')[0]!.tree;
    const body = chaptersToPgn(chapters);

    const res = await app.request('/api/studies/Ruy%20Lopez', {
      method: 'PUT',
      body: JSON.stringify({ pgn: body }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(dir, 'Ruy Lopez.pgn'), 'utf-8')).toBe(body);

    const { studies } = await (await app.request('/api/studies')).json();
    expect(studies).toHaveLength(1);
    expect(studies[0]).toMatchObject({ id: 'Ruy Lopez', chapters: 1 });
  });

  it('404s on missing studies and rejects traversal ids', async () => {
    expect((await app.request('/api/studies/nope')).status).toBe(404);
    expect((await app.request('/api/studies/..%2Fetc')).status).toBe(400);
    expect(
      (await app.request('/api/studies/nope', {
        method: 'PUT',
        body: JSON.stringify({ pgn: '*' }),
        headers: { 'content-type': 'application/json' },
      })).status,
    ).toBe(404);
  });

  it('accepts apostrophes and dashes, still rejects unsafe names', async () => {
    // Chess names need these; a study you cannot open is worse than one
    // with a plain name.
    const make = (name: string) =>
      app.request('/api/studies', {
        method: 'POST',
        body: JSON.stringify({ name }),
        headers: { 'content-type': 'application/json' },
      });
    expect((await make("London System - Black's Answer")).status).toBe(200);
    expect((await make('Reti — Move by Move')).status).toBe(200);
    expect((await app.request(`/api/studies/${encodeURIComponent("London System - Black's Answer")}`)).status).toBe(200);
    // Names people actually give things: Korean, accents, punctuation. The
    // rule used to start [A-Za-z0-9], so a Korean title could not be saved
    // at all and half of Lichess would not import.
    for (const good of ['시칠리안 방어', 'Ruy López', 'Tactics!', 'Endgame #1', '[Study] Openings']) {
      expect((await make(good)).status, good).toBe(200);
    }
    // Windows-illegal, device names, and traversal shapes stay out.
    for (const bad of ['a:b', 'a?b', 'a*b', 'a<b', 'a|b', '..', '.hidden', 'trailing.', 'CON', 'nul.pgn']) {
      expect((await make(bad)).status, bad).toBe(400);
    }
    // Surrounding whitespace is trimmed before validation, not rejected.
    expect((await make('  spaced  ')).status).toBe(200);
  });

  it('sanitises names that arrive from outside instead of refusing them', () => {
    // What an import gets: a title it did not choose. Colons cannot be a
    // filename, so they become spaces; everything else survives.
    expect(sanitizeSegment('Sicilian: Najdorf')).toBe('Sicilian Najdorf');
    expect(sanitizeSegment('시칠리안 방어')).toBe('시칠리안 방어');
    expect(sanitizeSegment('Ruy López')).toBe('Ruy López');
    expect(sanitizeSegment('  ..trailing.  ')).toBe('trailing');
    expect(sanitizeSegment('///', 'Study')).toBe('Study');
    expect(sanitizeSegment('CON')).toBe('CON_');
    // And whatever comes out is a name the vault will accept.
    for (const raw of ['Sicilian: Najdorf', '시칠리안 방어', '///', 'CON']) {
      expect(validId(sanitizeSegment(raw, 'Study')), raw).toBe(true);
    }
  });

  it('deletes a study', async () => {
    expect((await app.request('/api/studies/Ruy%20Lopez', { method: 'DELETE' })).status).toBe(200);
    expect(existsSync(join(dir, 'Ruy Lopez.pgn'))).toBe(false);
  });

  it('creates studies inside folders and lists them with slash ids', async () => {
    const res = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Openings/Caro-Kann' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(200);
    expect(existsSync(join(dir, 'Openings', 'Caro-Kann.pgn'))).toBe(true);

    const { studies } = await (await app.request('/api/studies')).json();
    expect(studies.map((s: { id: string }) => s.id)).toContain('Openings/Caro-Kann');

    const got = await app.request('/api/studies/Openings%2FCaro-Kann');
    expect(got.status).toBe(200);
    expect((await got.json()).id).toBe('Openings/Caro-Kann');

    // Traversal through folder segments must still be impossible.
    const evil = await app.request('/api/studies', {
      method: 'POST',
      body: JSON.stringify({ name: 'Openings/../../evil' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(evil.status).toBe(400);

    expect(
      (await app.request('/api/studies/Openings%2FCaro-Kann', { method: 'DELETE' })).status,
    ).toBe(200);
  });

  it('renames, moves between folders, renames folders, deletes empty folders', async () => {
    const post = (url: string, body: unknown) =>
      app.request(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });

    await post('/api/studies', { name: 'Scratch' });

    // Rename in place.
    expect((await post('/api/studies/move', { from: 'Scratch', to: 'King s Indian' })).status).toBe(200);
    expect(existsSync(join(dir, 'King s Indian.pgn'))).toBe(true);

    // Move into a folder (created implicitly).
    expect(
      (await post('/api/studies/move', { from: 'King s Indian', to: 'Repertoire/King s Indian' })).status,
    ).toBe(200);
    expect(existsSync(join(dir, 'Repertoire', 'King s Indian.pgn'))).toBe(true);

    // Rename the folder — the study inside moves with it.
    expect(
      (await post('/api/studies/folders/move', { from: 'Repertoire', to: 'Black Repertoire' })).status,
    ).toBe(200);
    expect(existsSync(join(dir, 'Black Repertoire', 'King s Indian.pgn'))).toBe(true);

    // A non-empty folder refuses deletion; emptied, it deletes.
    expect(
      (await app.request('/api/studies/folders/Black%20Repertoire', { method: 'DELETE' })).status,
    ).toBe(409);
    // Move the study out (to the root) rather than deleting it.
    expect(
      (await post('/api/studies/move', { from: 'Black Repertoire/King s Indian', to: 'King s Indian' })).status,
    ).toBe(200);
    expect(
      (await app.request('/api/studies/folders/Black%20Repertoire', { method: 'DELETE' })).status,
    ).toBe(200);
    expect(existsSync(join(dir, 'Black Repertoire'))).toBe(false);

    // Collisions and traversal refused.
    await post('/api/studies', { name: 'Other' });
    expect((await post('/api/studies/move', { from: 'Other', to: 'King s Indian' })).status).toBe(409);
    expect((await post('/api/studies/move', { from: 'Other', to: '../evil' })).status).toBe(400);

    await app.request('/api/studies/King%20s%20Indian', { method: 'DELETE' });
    await app.request('/api/studies/Other', { method: 'DELETE' });
  });
});

describe('notes list excerpts', () => {
  let dir: string;
  let app: Hono;

  const write = (name: string, body: string): void =>
    writeFileSync(join(dir, `${name}.md`), body, 'utf-8');
  const listed = async (): Promise<Record<string, string | null>> => {
    const { studies } = (await (await app.request('/api/notes')).json()) as {
      studies: { id: string; excerpt: string | null }[];
    };
    return Object.fromEntries(studies.map((s) => [s.id, s.excerpt]));
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'notes-api-'));
    app = new Hono().route('/api', studiesApi(dir, 'notes', '.md'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('takes the first line of prose, not the heading', async () => {
    write('Prep', '# Prep\n\nKnow the first ten moves of everything I play.\n');
    expect((await listed())['Prep']).toBe('Know the first ten moves of everything I play.');
  });

  it('strips list markers, emphasis and links', async () => {
    write('Drills', '# Drills\n\n- **Lucena** and [Philidor](https://x.test) until automatic\n');
    expect((await listed())['Drills']).toBe('Lucena and Philidor until automatic');
  });

  it('skips front matter, rules and fenced blocks', async () => {
    write('Fenced', '---\ntags: endgame\n---\n\n```\n8/8/8/8\n```\n\nAfter the fence.\n');
    expect((await listed())['Fenced']).toBe('After the fence.');
  });

  it('has none for a note that is only a heading', async () => {
    write('Bare', '# Bare\n\n');
    expect((await listed())['Bare']).toBeNull();
  });

  it('caps a long first line', async () => {
    write('Long', `# Long\n\n${'a'.repeat(400)}\n`);
    const excerpt = (await listed())['Long']!;
    expect(excerpt).toHaveLength(140);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('reads only the head of a file, so a huge note still lists', async () => {
    write('Huge', `# Huge\n\nThe opening line.\n${'padding padding padding\n'.repeat(5000)}`);
    expect((await listed())['Huge']).toBe('The opening line.');
  });

  it('re-reads when the file changes, and not otherwise', async () => {
    write('Edited', '# Edited\n\nBefore.\n');
    expect((await listed())['Edited']).toBe('Before.');
    // A same-millisecond rewrite would keep the cached mtime, so wait.
    await new Promise((done) => setTimeout(done, 20));
    write('Edited', '# Edited\n\nAfter.\n');
    expect((await listed())['Edited']).toBe('After.');
  });

  it('reads front-matter tags, inline or as a list', async () => {
    write('Inline', '---\ntags: Opening, Sicilian\n---\n\nBody.\n');
    write('Block', '---\ntitle: x\ntags:\n  - endgame\n  - "rook"\n---\n\nBody.\n');
    const tags = async (id: string): Promise<string[]> => {
      const { studies } = (await (await app.request('/api/notes')).json()) as {
        studies: { id: string; tags: string[] }[];
      };
      return studies.find((s) => s.id === id)!.tags;
    };
    expect(await tags('Inline')).toEqual(['opening', 'sicilian']);
    expect(await tags('Block')).toEqual(['endgame', 'rook']);
  });

  it('has no tags without front matter — a heading is not a hashtag', async () => {
    write('Hash', '# Hash\n\n#1 priority is not a tag.\n');
    const { studies } = (await (await app.request('/api/notes')).json()) as {
      studies: { id: string; tags: string[] }[];
    };
    expect(studies.find((s) => s.id === 'Hash')!.tags).toEqual([]);
  });

  it('takes the first board’s opening position off its fence', async () => {
    const custom = '4k3/8/8/8/8/8/8/4K2R w K - 0 1';
    write('Lucena', `# Lucena\n\n\`\`\`chess\n[FEN "${custom}"]\n[SetUp "1"]\n\n1. Rh8 *\n\`\`\`\n`);
    // No FEN header means the fence starts from the standard position.
    write('FromStart', '# Opening\n\n```chess\n1. e4 e5 *\n```\n');
    write('NoBoard', '# Plain\n\nJust words.\n');
    const { studies } = (await (await app.request('/api/notes')).json()) as {
      studies: { id: string; fen: string | null }[];
    };
    const fen = (id: string): string | null => studies.find((s) => s.id === id)!.fen;
    expect(fen('Lucena')).toBe(custom);
    expect(fen('FromStart')).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    expect(fen('NoBoard')).toBeNull();
  });

  it('pins are kept in the vault and follow a rename', async () => {
    write('Pinned', '# Pinned\n\nBody.\n');
    const toggle = async (id: string): Promise<Response> =>
      app.request('/api/notes/pins/toggle', {
        method: 'POST',
        body: JSON.stringify({ id }),
        headers: { 'content-type': 'application/json' },
      });
    const pins = async (): Promise<string[]> =>
      ((await (await app.request('/api/notes/pins')).json()) as { ids: string[] }).ids;

    expect(await pins()).toEqual([]);
    expect(((await (await toggle('Pinned')).json()) as { pinned: boolean }).pinned).toBe(true);
    expect(await pins()).toEqual(['Pinned']);

    // A rename must not silently unpin.
    await app.request('/api/notes/move', {
      method: 'POST',
      body: JSON.stringify({ from: 'Pinned', to: 'Renamed' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(await pins()).toEqual(['Renamed']);

    // Nor may a delete leave an id that re-pins the next note of that name.
    await app.request('/api/notes/Renamed', { method: 'DELETE' });
    expect(await pins()).toEqual([]);
  });

  it('the pins file is not itself listed as a note', async () => {
    const { studies } = (await (await app.request('/api/notes')).json()) as {
      studies: { id: string }[];
    };
    expect(studies.some((s) => s.id.includes('pins'))).toBe(false);
  });

  it('leaves study listings alone — a PGN header is not a preview', async () => {
    const pgnDir = mkdtempSync(join(tmpdir(), 'studies-excerpt-'));
    const pgnApp = new Hono().route('/api', studiesApi(pgnDir));
    writeFileSync(join(pgnDir, 'Game.pgn'), '[Event "x"]\n\n1. e4 *\n', 'utf-8');
    const { studies } = (await (await pgnApp.request('/api/studies')).json()) as {
      studies: { excerpt: string | null }[];
    };
    expect(studies[0]!.excerpt).toBeNull();
    rmSync(pgnDir, { recursive: true, force: true });
  });
});
