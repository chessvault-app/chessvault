import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONTENT_CAP, NAME_CAP, rank, searchApi, searchIndex, type SearchEntry, type SearchResult } from './search.ts';

const entry = (
  section: SearchEntry['section'],
  id: string,
  parts: SearchEntry['parts'] = [],
  title = id,
): SearchEntry => ({ section, id, title, parts, mtimeMs: 1, size: 1 });

describe('rank', () => {
  const entries: SearchEntry[] = [
    entry('notes', 'Rook endings', [{ text: 'The Lucena position wins. Philidor draws.' }]),
    entry('notes', 'Openings/Sicilian', [{ text: 'A rook lift on the third rank is the plan.' }]),
    entry('studies', 'Najdorf', [
      { chapter: 0, text: 'The English attack.' },
      { chapter: 1, text: 'Here the rook goes to c8, and the rook on a1 waits.' },
    ]),
    entry('games', 'Kasparov vs Topalov', [{ chapter: 0, text: 'A rook sacrifice on d4.' }]),
    entry('books', 'b0', [], 'Rook endgames explained'),
    entry('notes', 'Plain', [{ text: 'Nothing about heavy pieces.' }]),
  ];

  it('lists every name and no text for an empty query', () => {
    const r = rank(entries, '   ');
    expect(r.names).toHaveLength(entries.length);
    expect(r.content).toEqual([]);
    // Studies, notes, games, books: the switcher's own order.
    expect(r.names.map((n) => n.section)).toEqual(['studies', 'notes', 'notes', 'notes', 'games', 'books']);
  });

  it('puts names that match ahead of text that matches', () => {
    const r = rank(entries, 'rook');
    expect(r.names.map((n) => n.title)).toEqual(['Rook endings', 'Rook endgames explained']);
    expect(r.content.map((c) => c.id)).not.toContain('Rook endings');
  });

  it('ranks a document by how often the words occur, then by where', () => {
    const r = rank(entries, 'rook');
    // Najdorf says it twice; the other two once, and the game says it sooner.
    expect(r.content.map((c) => c.id)).toEqual(['Najdorf', 'Kasparov vs Topalov', 'Openings/Sicilian']);
  });

  it('needs every word, in any order, anywhere in the text', () => {
    expect(rank(entries, 'draws lucena').content.map((c) => c.id)).toEqual(['Rook endings']);
    expect(rank(entries, 'lucena attack').content).toEqual([]);
  });

  it('matches without regard to case', () => {
    expect(rank(entries, 'LUCENA').content).toHaveLength(1);
    expect(rank(entries, 'najdorf').names[0]!.id).toBe('Najdorf');
  });

  it('cuts the snippet around the first word and marks it as written', () => {
    const [hit] = rank(entries, 'lucena').content;
    expect(hit!.snippet).toEqual({ before: 'The ', match: 'Lucena', after: ' position wins. Philidor draws.' });
  });

  it('says which chapter of a study the words sit in', () => {
    const [hit] = rank(entries, 'c8').content;
    expect(hit!.id).toBe('Najdorf');
    expect(hit!.chapter).toBe(1);
  });

  it('prefers the name the query starts', () => {
    const r = rank([entry('notes', 'A rook study'), entry('notes', 'Rook study')], 'rook');
    expect(r.names.map((n) => n.id)).toEqual(['Rook study', 'A rook study']);
  });

  it('caps both lists', () => {
    const many: SearchEntry[] = [];
    for (let i = 0; i < 80; i += 1) many.push(entry('notes', `Pawn ${i}`, [{ text: 'a knight' }]));
    for (let i = 0; i < 40; i += 1) many.push(entry('notes', `Note ${i}`, [{ text: 'the pawn' }]));
    const r = rank(many, 'pawn');
    expect(r.names).toHaveLength(NAME_CAP);
    expect(r.content).toHaveLength(CONTENT_CAP);
  });

  it('elides a long text on both sides of the match', () => {
    const long = `${'before '.repeat(40)}target ${'after '.repeat(40)}`.trim();
    const [hit] = rank([entry('notes', 'Long', [{ text: long }])], 'target').content;
    expect(hit!.snippet.before.startsWith('…')).toBe(true);
    expect(hit!.snippet.after.endsWith('…')).toBe(true);
    expect(hit!.snippet.match).toBe('target');
  });
});

describe('search index', () => {
  let root: string;
  let notes: string;
  let studies: string;
  let games: string;
  let books: string;
  let puzzleBooks: string;
  let file: string;
  let app: Hono;

  const search = async (q: string): Promise<SearchResult> => {
    const res = await app.request(`/api/search?q=${encodeURIComponent(q)}`);
    expect(res.status).toBe(200);
    return (await res.json()) as SearchResult;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'search-api-'));
    notes = join(root, 'notes');
    studies = join(root, 'studies');
    games = join(root, 'games');
    books = join(root, 'books');
    puzzleBooks = join(root, 'puzzlebooks');
    file = join(root, 'data', 'search-index.json');
    for (const d of [notes, join(notes, 'Openings'), studies, games, join(books, 'b1'), join(puzzleBooks, 'p1')]) {
      mkdirSync(d, { recursive: true });
    }
    writeFileSync(
      join(notes, 'Rook endings.md'),
      '---\naliases: Rooks\n---\n# Rook endings\n\nThe **Lucena** position wins.\n\n```chess\n1. e4 {a movetext comment} e5\n```\n',
    );
    writeFileSync(join(notes, 'Openings', 'Sicilian.md'), 'Play [[Najdorf]] with a rook lift.\n');
    writeFileSync(
      join(studies, 'Najdorf.pgn'),
      '[Event "One"]\n\n1. e4 {The English attack [%eval 0.3]} c5 *\n\n[Event "Two"]\n\n1. d4 {The rook goes to c8} d5 *\n',
    );
    writeFileSync(join(games, 'Kasparov vs Topalov.pgn'), '[Event "Wijk"]\n\n1. e4 {A rook sacrifice} d6 *\n');
    writeFileSync(join(books, 'b1', 'book.json'), JSON.stringify({ title: 'Rook endgames explained', name: 'x.pdf' }));
    writeFileSync(join(puzzleBooks, 'p1', 'book.json'), JSON.stringify({ title: 'Combinations' }));
    app = new Hono().route('/api', searchApi({ notes, studies, games, books, puzzleBooks }, file));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('answers names and text over every kind of document', async () => {
    const r = await search('rook');
    expect(r.names.map((n) => `${n.section}:${n.title}`)).toEqual([
      'notes:Rook endings',
      'books:Rook endgames explained',
    ]);
    expect(r.content.map((c) => `${c.section}:${c.id}`).sort()).toEqual([
      'games:Kasparov vs Topalov',
      'notes:Openings/Sicilian',
      'studies:Najdorf',
    ]);
  });

  it('reads a note as words: no front matter, no heading marks, no board moves', async () => {
    expect((await search('aliases')).content).toEqual([]);
    expect((await search('movetext')).content).toEqual([]);
    const [hit] = (await search('lucena')).content;
    expect(hit!.snippet).toEqual({ before: 'Rook endings The ', match: 'Lucena', after: ' position wins.' });
  });

  it('reads a PGN as its comments, without commands, and names the chapter', async () => {
    expect((await search('eval')).content).toEqual([]);
    const [hit] = (await search('c8')).content;
    expect(hit).toMatchObject({ section: 'studies', id: 'Najdorf', chapter: 1 });
    expect((await search('e4')).content).toEqual([]);
  });

  it('lists a puzzle book by its title', async () => {
    expect((await search('combin')).names).toEqual([{ section: 'puzzlebooks', id: 'p1', title: 'Combinations' }]);
  });

  it('writes the index beside the other derived data and reads it back', () => {
    expect(existsSync(file)).toBe(true);
    const stored = JSON.parse(readFileSync(file, 'utf-8')) as { version: number; entries: SearchEntry[] };
    expect(stored.version).toBe(1);
    expect(stored.entries.map((e) => e.id).sort()).toEqual(
      ['Kasparov vs Topalov', 'Najdorf', 'Openings/Sicilian', 'Rook endings', 'b1', 'p1'].sort(),
    );
    // A second index over the same file starts from what was stored.
    const again = searchIndex({ notes, studies, games, books, puzzleBooks }, file);
    expect(again.search('lucena').content).toHaveLength(1);
  });

  it('follows an edit by mtime, a deletion by absence', async () => {
    const path = join(notes, 'Rook endings.md');
    writeFileSync(path, 'Now about the Philidor draw.\n');
    // Same second as the original write on a coarse filesystem: move it.
    const later = new Date(Date.now() + 5000);
    utimesSync(path, later, later);
    expect((await search('philidor')).content.map((c) => c.id)).toEqual(['Rook endings']);
    expect((await search('lucena')).content).toEqual([]);
    unlinkSync(path);
    expect((await search('philidor')).content).toEqual([]);
    expect((await search('rook')).names.map((n) => n.section)).toEqual(['books']);
  });

  it('lists every name for an empty query', async () => {
    const r = await search('');
    expect(r.content).toEqual([]);
    expect(r.names.length).toBe(5);
  });
});
