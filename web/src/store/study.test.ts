import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNode } from '@shared/tree';
import { useAnalysis } from './analysis';
import { usePrefs } from './prefs';
import { useStudy } from './study';

/**
 * What reaches the vault, and when.
 *
 * The rule this file exists to hold down: with autosave off, nothing is
 * written that nobody asked for. Everything else here — reading-mode
 * moves, the flip, discard, close — is a way of getting that wrong.
 */

const PGN = '[Event "t: Chapter 1"]\n[ChapterName "Chapter 1"]\n[Result "*"]\n\n1. e4 e5 *\n';

/** Every PUT this test made, in order. */
let puts: { url: string; pgn: string }[] = [];
let posts: string[] = [];

function mockServer(): void {
  puts = [];
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        puts.push({ url, pgn: JSON.parse(String(init!.body)).pgn as string });
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (method === 'POST') {
        posts.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ pgn: PGN }), { status: 200 }));
    }),
  );
}

/** Open a document the way the view does, and settle the load. */
async function openDoc(): Promise<void> {
  await useStudy.getState().open('t');
  expect(useStudy.getState().saveState).toBe('saved');
}

/** A move played on the board — the change everything else is measured against. */
function playAMove(): void {
  const { tree } = useAnalysis.getState();
  useAnalysis.setState({ cursorId: tree.rootId });
  expect(useAnalysis.getState().playSan('d4')).toBe(true);
}

beforeEach(async () => {
  vi.useFakeTimers();
  mockServer();
  usePrefs.setState({ autosave: false });
  await openDoc();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useStudy.setState({ openId: null, chapters: [], saveState: 'saved', savedPgn: '', editing: false });
});

describe('with autosave off', () => {
  it('holds an edit rather than writing it', async () => {
    playAMove();
    expect(useStudy.getState().saveState).toBe('dirty');
    // Well past the old 1500ms debounce.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(puts).toEqual([]);
    expect(useStudy.getState().saveState).toBe('dirty');
  });

  it('writes exactly once when asked', async () => {
    playAMove();
    await useStudy.getState().save();
    expect(puts).toHaveLength(1);
    expect(puts[0]!.pgn).toContain('d4');
    expect(useStudy.getState().saveState).toBe('saved');
  });

  it('counts a move made while reading', async () => {
    // The whole point: `editing` is a tools toggle now, not a write guard.
    expect(useStudy.getState().editing).toBe(false);
    playAMove();
    expect(useStudy.getState().saveState).toBe('dirty');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(puts).toEqual([]);
  });

  it('does not count a board flip', async () => {
    useAnalysis.setState({ orientation: 'black' });
    await vi.advanceTimersByTimeAsync(10_000);
    // Turning the board round to read from the other side is a reading
    // act: no badge, and no question on the way out.
    expect(useStudy.getState().saveState).toBe('saved');
    expect(puts).toEqual([]);
  });

  it('carries the flip along with a save that happens anyway', async () => {
    useAnalysis.setState({ orientation: 'black' });
    playAMove();
    await useStudy.getState().save();
    expect(puts[0]!.pgn).toContain('[Orientation "black"]');
  });

  it('writes nothing on the way out', async () => {
    playAMove();
    await useStudy.getState().close();
    // The leave guard has already asked and been answered by now; writing
    // here would write changes the reader may have declined.
    expect(puts).toEqual([]);
    expect(useStudy.getState().openId).toBeNull();
  });

  it('holds chapter edits too', async () => {
    useStudy.getState().addChapter();
    expect(useStudy.getState().saveState).toBe('dirty');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(puts).toEqual([]);
  });
});

describe('discard', () => {
  it('goes back to what the vault has', async () => {
    const before = useStudy.getState().savedPgn;
    playAMove();
    expect(useStudy.getState().saveState).toBe('dirty');

    useStudy.getState().discard();

    expect(useStudy.getState().saveState).toBe('saved');
    // The move is gone from the tree, not merely from the badge.
    const { tree } = useAnalysis.getState();
    const sans = getNode(tree, tree.rootId).children.map((id) => getNode(tree, id).san);
    expect(sans).toEqual(['e4']);
    expect(before).toBe(useStudy.getState().savedPgn);
  });

  it('discards a chapter that was added but never saved', async () => {
    useStudy.getState().addChapter();
    expect(useStudy.getState().chapters).toHaveLength(2);
    useStudy.getState().discard();
    expect(useStudy.getState().chapters).toHaveLength(1);
  });

  it('restores the last SAVED state, not the last loaded one', async () => {
    playAMove();
    await useStudy.getState().save();
    // A second edit on top of a saved one.
    const { tree } = useAnalysis.getState();
    useAnalysis.setState({ cursorId: tree.rootId });
    useAnalysis.getState().playSan('c4');
    useStudy.getState().discard();

    const after = useAnalysis.getState().tree;
    const sans = getNode(after, after.rootId).children.map((id) => getNode(after, id).san);
    // d4 was saved and survives; c4 was not and does not.
    expect(sans).toContain('d4');
    expect(sans).not.toContain('c4');
  });
});

describe('with autosave on', () => {
  beforeEach(() => {
    usePrefs.setState({ autosave: true });
  });

  it('still writes on the old debounce', async () => {
    playAMove();
    expect(useStudy.getState().saveState).toBe('dirty');
    await vi.advanceTimersByTimeAsync(1500);
    expect(puts).toHaveLength(1);
    expect(useStudy.getState().saveState).toBe('saved');
  });

  it('writes once for a flurry of edits', async () => {
    playAMove();
    await vi.advanceTimersByTimeAsync(500);
    useAnalysis.getState().playSan('d5');
    await vi.advanceTimersByTimeAsync(1500);
    expect(puts).toHaveLength(1);
  });
});

describe('renameOpen', () => {
  it('moves the file without writing the buffer', async () => {
    playAMove();
    const result = await useStudy.getState().renameOpen('renamed');

    expect(result.id).toBe('renamed');
    expect(posts).toHaveLength(1);
    // Renaming moves the FILE. The pending changes are still pending, now
    // against the new name.
    expect(puts).toEqual([]);
    expect(useStudy.getState().saveState).toBe('dirty');
    expect(useStudy.getState().openId).toBe('renamed');
  });

  it('sends the pending changes to the new name when they are saved', async () => {
    playAMove();
    await useStudy.getState().renameOpen('renamed');
    await useStudy.getState().save();
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toContain('renamed');
  });
});
