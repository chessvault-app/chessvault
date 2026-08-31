import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkRenamer, linksApi } from './links.ts';

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

  it('rewrites a link when the document it names is renamed', () => {
    writeFileSync(join(studies, 'Slav.pgn'), '*');
    note('Follower', 'Study [[Slav]] tonight.');
    // The hook fires AFTER the move, so the file goes first.
    renameSync(join(studies, 'Slav.pgn'), join(studies, 'Semi-Slav.pgn'));
    linkRenamer(notes, studies, games).moved('Slav', 'Semi-Slav');
    expect(readFileSync(join(notes, 'Follower.md'), 'utf-8')).toBe('Study [[Semi-Slav]] tonight.');
  });

  it('leaves a link alone when the old name still resolves', () => {
    // Nothing actually moved. A renamer told about a move that did not
    // happen must not rewrite a link that still works.
    note('Bystander', 'Study [[Najdorf]] tonight.');
    linkRenamer(notes, studies, games).moved('Najdorf', 'Sicilian');
    expect(readFileSync(join(notes, 'Bystander.md'), 'utf-8')).toBe('Study [[Najdorf]] tonight.');
  });

  it('rewrites links after a folder is moved', () => {
    mkdirSync(join(studies, 'old'), { recursive: true });
    writeFileSync(join(studies, 'old', 'Line.pgn'), '*');
    note('FolderFollower', 'See [[old/Line]].');
    // Perform the move, then tell the renamer, as the route does.
    mkdirSync(join(studies, 'new'), { recursive: true });
    renameSync(join(studies, 'old', 'Line.pgn'), join(studies, 'new', 'Line.pgn'));
    linkRenamer(notes, studies, games).folderMoved('studies', 'old', 'new');
    expect(readFileSync(join(notes, 'FolderFollower.md'), 'utf-8')).toBe('See [[new/Line]].');
  });

  it('refuses an unknown section rather than answering for it', async () => {
    const res = await app.request('/api/links/books/Anything');
    expect(res.status).toBe(404);
  });
});

describe('unlinked mentions', () => {
  let root: string;
  let notes: string;
  let studies: string;
  let games: string;
  let app: Hono;

  const note = (id: string, body: string): void => writeFileSync(join(notes, `${id}.md`), body);

  const get = async (section: string, id: string) => {
    const res = await app.request(`/api/links/${section}/${encodeURIComponent(id)}`);
    return await res.json();
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'unlinked-'));
    notes = join(root, 'notes');
    studies = join(root, 'studies');
    games = join(root, 'games');
    for (const d of [notes, studies, games]) mkdirSync(d, { recursive: true });
    writeFileSync(join(studies, 'Najdorf.pgn'), '[Aliases "B90"]\n*');
    app = new Hono().route('/api', linksApi(notes, studies, games));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds a document named in prose without being linked', async () => {
    note('Prose', 'I keep losing the Najdorf as black.');
    const { unlinked } = await get('studies', 'Najdorf');
    expect(unlinked.map((m: { from: string }) => m.from)).toEqual(['Prose']);
  });

  it('does not report one that is already a link', async () => {
    note('Prose', 'See [[Najdorf]] for this.');
    expect((await get('studies', 'Najdorf')).unlinked).toEqual([]);
  });

  it('finds a mention of an alias', async () => {
    note('Prose', 'Straight into B90 territory.');
    const { unlinked } = await get('studies', 'Najdorf');
    expect(unlinked[0].target).toBe('B90');
  });

  it('does not report a note naming itself', async () => {
    note('Selfish', 'This note is about Selfish things.');
    expect((await get('notes', 'Selfish')).unlinked).toEqual([]);
  });

  it('links one mention, leaving the words the writer typed', async () => {
    note('Prose', 'I keep losing the Najdorf as black.');
    const { unlinked } = await get('studies', 'Najdorf');
    const hit = unlinked[0];
    const res = await app.request('/api/links/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: hit.from, at: hit.at, text: hit.target, target: 'Najdorf' }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(notes, 'Prose.md'), 'utf-8')).toBe(
      'I keep losing the [[Najdorf]] as black.',
    );
  });

  it('keeps the writer’s words when they differ from the target', async () => {
    note('Prose', 'Straight into B90 territory.');
    const { unlinked } = await get('studies', 'Najdorf');
    const hit = unlinked[0];
    await app.request('/api/links/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: hit.from, at: hit.at, text: hit.target, target: 'Najdorf' }),
    });
    expect(readFileSync(join(notes, 'Prose.md'), 'utf-8')).toBe(
      'Straight into [[Najdorf|B90]] territory.',
    );
  });

  it('refuses when the note has changed under the offset', async () => {
    note('Prose', 'I keep losing the Najdorf as black.');
    const { unlinked } = await get('studies', 'Najdorf');
    const hit = unlinked[0];
    note('Prose', 'Something else entirely now.');
    const res = await app.request('/api/links/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: hit.from, at: hit.at, text: hit.target, target: 'Najdorf' }),
    });
    expect(res.status).toBe(409);
    expect(readFileSync(join(notes, 'Prose.md'), 'utf-8')).toBe('Something else entirely now.');
  });

  it('refuses a request that names no note', async () => {
    const res = await app.request('/api/links/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ at: 0, text: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * A study or a game as the SOURCE of a link, not just its target.
 *
 * A PGN holds prose only inside its `{...}` comments, so this is as much
 * about what is NOT read — movetext, headers — as about what is.
 */
describe('links written in move comments', () => {
  let root: string;
  let notes: string;
  let studies: string;
  let games: string;
  let app: Hono;

  const study = (id: string, pgn: string): void => writeFileSync(join(studies, `${id}.pgn`), pgn);

  const get = async (section: string, id: string) => {
    const res = await app.request(`/api/links/${section}/${encodeURIComponent(id)}`);
    expect(res.status).toBe(200);
    return await res.json();
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'links-pgn-'));
    notes = join(root, 'notes');
    studies = join(root, 'studies');
    games = join(root, 'games');
    for (const d of [notes, studies, games]) mkdirSync(d, { recursive: true });

    writeFileSync(join(notes, 'Poisoned Pawn.md'), '# Poisoned Pawn\n');
    // Two chapters, so the reported chapter is not trivially zero.
    study(
      'Najdorf Files',
      [
        '[Event "Najdorf Files: Chapter 1"]',
        '[Result "*"]',
        '',
        '1. e4 c5 *',
        '',
        '[Event "Najdorf Files: Chapter 2"]',
        '[Result "*"]',
        '',
        '1. e4 { The point is [[Poisoned Pawn]] here. } c5 *',
        '',
      ].join('\n'),
    );
    app = new Hono().route('/api', linksApi(notes, studies, games));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('reports a study that links a note from a move comment', async () => {
    const { mentions } = await get('notes', 'Poisoned Pawn');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.from).toBe('Najdorf Files');
    expect(mentions[0]!.fromSection).toBe('studies');
  });

  it('says which chapter the comment was in', async () => {
    const { mentions } = await get('notes', 'Poisoned Pawn');
    expect(mentions[0]!.chapter).toBe(1);
  });

  it('reports an offset that still points at the link in the file', async () => {
    const { mentions } = await get('notes', 'Poisoned Pawn');
    const file = readFileSync(join(studies, 'Najdorf Files.pgn'), 'utf-8');
    expect(file.slice(mentions[0]!.at)).toMatch(/^\[\[Poisoned Pawn\]\]/);
  });

  /**
   * The reason a PGN is read by comment and not whole. Every move in the
   * file is a chance for a document named after one to match.
   */
  it('never finds an unlinked mention in movetext', async () => {
    writeFileSync(join(notes, 'e4.md'), '# e4\n');
    writeFileSync(join(notes, 'Najdorf Files.md'), '# Najdorf Files\n');
    const move = await get('notes', 'e4');
    expect(move.unlinked).toEqual([]);
    // And not in a header either, where the study's own name is written.
    const header = await get('notes', 'Najdorf Files');
    expect(header.unlinked).toEqual([]);
  });

  it('turns an unlinked mention in a comment into a link, in place', async () => {
    study(
      'Loose',
      ['[Event "Loose"]', '[Result "*"]', '', '1. e4 { Compare Poisoned Pawn. } *', ''].join('\n'),
    );
    const { unlinked } = await get('notes', 'Poisoned Pawn');
    const hit = unlinked.find((m: { from: string }) => m.from === 'Loose');
    expect(hit).toBeDefined();
    const res = await app.request('/api/links/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        section: 'studies',
        note: hit.from,
        at: hit.at,
        text: hit.target,
        target: 'Poisoned Pawn',
      }),
    });
    expect(res.status).toBe(200);
    expect(readFileSync(join(studies, 'Loose.pgn'), 'utf-8')).toContain(
      '1. e4 { Compare [[Poisoned Pawn]]. } *',
    );
  });

  it('rewrites a link inside a comment when its target is renamed', () => {
    study(
      'Renamed',
      ['[Event "Renamed"]', '[Result "*"]', '', '1. e4 { See [[Poisoned Pawn]]. } c5 *', ''].join(
        '\n',
      ),
    );
    renameSync(join(notes, 'Poisoned Pawn.md'), join(notes, 'Poisoned Pawn Variation.md'));
    linkRenamer(notes, studies, games).moved('Poisoned Pawn', 'Poisoned Pawn Variation');
    const file = readFileSync(join(studies, 'Renamed.pgn'), 'utf-8');
    expect(file).toContain('{ See [[Poisoned Pawn Variation]]. }');
    // The moves either side of the comment are untouched — the rewrite is
    // confined to the comment spans, never applied to the file at large.
    expect(file).toContain('1. e4 {');
    expect(file).toContain('} c5 *');
  });
});
