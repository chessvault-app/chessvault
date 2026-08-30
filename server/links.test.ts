import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linksApi } from './links.ts';

describe('links api', () => {
  let root: string;
  let notes: string;
  let studies: string;
  let games: string;
  let app: Hono;

  const note = (id: string, body: string): void => {
    const at = id.lastIndexOf('/');
    if (at > 0) mkdirSync(join(notes, id.slice(0, at)), { recursive: true });
    writeFileSync(join(notes, `${id}.md`), body);
  };

  const backlinks = async (section: string, id: string): Promise<{ from: string; context: string }[]> => {
    const res = await app.request(`/api/links/${section}/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    return (await res.json()).mentions;
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'links-api-'));
    notes = join(root, 'notes');
    studies = join(root, 'studies');
    games = join(root, 'games');
    for (const d of [notes, studies, games]) mkdirSync(d, { recursive: true });

    writeFileSync(join(studies, 'Najdorf.pgn'), '*');
    writeFileSync(join(games, 'Kasparov vs Topalov.pgn'), '*');

    note('Blunders', 'The rook lift shows up in [[Kasparov vs Topalov]] again.');
    note('Prep', 'Study [[Najdorf]] before the weekend.');
    note('Plain', 'No links here at all.');

    app = new Hono().route('/api', linksApi(notes, studies, games));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports the note that mentions a game', async () => {
    const mentions = await backlinks('games', 'Kasparov vs Topalov');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.from).toBe('Blunders');
  });

  it('carries the sentence the mention sits in', async () => {
    const [mention] = await backlinks('games', 'Kasparov vs Topalov');
    expect(mention!.context).toBe('The rook lift shows up in Kasparov vs Topalov again.');
  });

  it('reports the note that mentions a study', async () => {
    const mentions = await backlinks('studies', 'Najdorf');
    expect(mentions.map((m) => m.from)).toEqual(['Prep']);
  });

  it('gives an empty list for a document nothing points at', async () => {
    expect(await backlinks('notes', 'Plain')).toEqual([]);
  });

  it('gives an empty list for a document that does not exist', async () => {
    expect(await backlinks('games', 'No Such Game')).toEqual([]);
  });

  it('picks up a note added after the first request', async () => {
    // The index is cached, so this is really a test of the invalidation.
    expect(await backlinks('studies', 'Najdorf')).toHaveLength(1);
    note('Second', 'Also see [[Najdorf]].');
    const after = await backlinks('studies', 'Najdorf');
    expect(after.map((m) => m.from).sort()).toEqual(['Prep', 'Second']);
  });

  it('drops a mention when its note is edited to remove the link', async () => {
    note('Second', 'Nothing here now.');
    const after = await backlinks('studies', 'Najdorf');
    expect(after.map((m) => m.from)).toEqual(['Prep']);
  });

  it('drops a mention when its note is deleted', async () => {
    note('Temp', 'A link to [[Najdorf]].');
    expect(await backlinks('studies', 'Najdorf')).toHaveLength(2);
    unlinkSync(join(notes, 'Temp.md'));
    expect(await backlinks('studies', 'Najdorf')).toHaveLength(1);
  });

  it('resolves a link written as a bare last segment', async () => {
    mkdirSync(join(studies, 'openings'), { recursive: true });
    writeFileSync(join(studies, 'openings', 'Dragon.pgn'), '*');
    note('Tail', 'See [[Dragon]] for the setup.');
    const mentions = await backlinks('studies', 'openings/Dragon');
    expect(mentions.map((m) => m.from)).toEqual(['Tail']);
  });

  it('does not report a note as its own backlink', async () => {
    note('Selfish', 'This note links to [[Selfish]] on purpose.');
    expect(await backlinks('notes', 'Selfish')).toEqual([]);
  });

  it('lists every mention when one note links the same target twice', async () => {
    note('Twice', 'First [[Najdorf]] and then [[Najdorf]] again.');
    const mentions = await backlinks('studies', 'Najdorf');
    expect(mentions.filter((m) => m.from === 'Twice')).toHaveLength(2);
  });

  it('finds a link written inside a folder note', async () => {
    note('deep/Nested', 'Buried link to [[Najdorf]].');
    const mentions = await backlinks('studies', 'Najdorf');
    expect(mentions.map((m) => m.from)).toContain('deep/Nested');
  });

  it('refuses an unknown section rather than answering for it', async () => {
    const res = await app.request('/api/links/books/Anything');
    expect(res.status).toBe(404);
  });
});
