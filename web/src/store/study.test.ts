import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chaptersToPgn } from '@shared/pgn';
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

/**
 * What reached the server, split by what it means.
 *
 * A park is a PUT too — `?draft=1` — so the two have to be told apart, or
 * "nothing was written" cannot be asserted at all: the crash net would
 * satisfy it by accident.
 */
let puts: { url: string; pgn: string }[] = [];
let parks: { url: string; pgn: string }[] = [];
let posts: string[] = [];
/** Swap deletes, which is what discarding and dismissing a recovery do. */
let parkDeletes: string[] = [];
/** Handed back by the next GET, as a vault holding a swap file would. */
let serverDraft: { draft: string; draftAt: string } | null = null;

const isPark = (url: string): boolean => url.includes('draft=1');

function mockServer(): void {
  puts = [];
  parks = [];
  posts = [];
  parkDeletes = [];
  serverDraft = null;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'PUT') {
        const entry = { url, pgn: JSON.parse(String(init!.body)).pgn as string };
        (isPark(url) ? parks : puts).push(entry);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (method === 'DELETE') {
        if (isPark(url)) {
          parkDeletes.push(url);
          // The vault really loses it, so a later GET stops offering it.
          // Without this the mock could not tell deleting the swap from
          // leaving it parked, and a test for the difference passed either
          // way.
          serverDraft = null;
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      if (method === 'POST') {
        posts.push(url);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ pgn: PGN, ...(serverDraft ?? {}) }), { status: 200 }),
      );
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

describe('the crash net', () => {
  it('parks the pending copy a few seconds after an edit', async () => {
    playAMove();
    // Not immediately: it is a net, not a save, and nobody is waiting.
    await vi.advanceTimersByTimeAsync(1500);
    expect(parks).toEqual([]);

    await vi.advanceTimersByTimeAsync(3000);
    expect(parks).toHaveLength(1);
    expect(parks[0]!.pgn).toContain('d4');
    // Still nothing written to the document itself.
    expect(puts).toEqual([]);
    expect(useStudy.getState().saveState).toBe('dirty');
  });

  it('parks once for a flurry, not once per move', async () => {
    playAMove();
    await vi.advanceTimersByTimeAsync(1000);
    useAnalysis.getState().playSan('d5');
    await vi.advanceTimersByTimeAsync(1000);
    useAnalysis.getState().playSan('c4');
    await vi.advanceTimersByTimeAsync(5000);
    expect(parks).toHaveLength(1);
    expect(parks[0]!.pgn).toContain('c4');
  });

  it('does not park after a save has resolved the buffer', async () => {
    playAMove();
    await useStudy.getState().save();
    await vi.advanceTimersByTimeAsync(10_000);
    // The server drops the swap when the save lands; a park firing after
    // it would re-park work that is already on disk.
    expect(parks).toEqual([]);
  });

  it('drops what is parked when the changes are discarded', async () => {
    playAMove();
    await vi.advanceTimersByTimeAsync(5000);
    expect(parks).toHaveLength(1);

    useStudy.getState().discard();
    await vi.advanceTimersByTimeAsync(0);
    expect(parkDeletes).toHaveLength(1);
  });

  it('parks nothing while closing', async () => {
    playAMove();
    await useStudy.getState().close();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(parks).toEqual([]);
  });
});

describe('recovery', () => {
  const DRAFT = '[Event "t: Chapter 1"]\n[ChapterName "Chapter 1"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *\n';

  beforeEach(async () => {
    await useStudy.getState().close();
    serverDraft = { draft: DRAFT, draftAt: '2026-08-15T09:00:00.000Z' };
    await useStudy.getState().open('t');
  });

  it('offers what a dead session left behind, and applies nothing', async () => {
    const { recovery, saveState } = useStudy.getState();
    expect(recovery?.pgn).toContain('Nf3');
    expect(recovery?.at).toBe('2026-08-15T09:00:00.000Z');
    // The document opens showing what is ON DISK. Taking the draft
    // silently would be the same unasked-for write this change removed.
    expect(saveState).toBe('saved');
    const { tree } = useAnalysis.getState();
    expect(getNode(tree, tree.rootId).children).toHaveLength(1);
    expect(useStudy.getState().chapters[0]!.tree).toBeDefined();
  });

  it('brings the work back as PENDING when taken', async () => {
    useStudy.getState().recover();
    const s = useStudy.getState();
    expect(s.recovery).toBeNull();
    // It never reached the document, so pressing Save is still what puts
    // it there — and discarding still goes back to the vault's copy.
    expect(s.saveState).toBe('dirty');
    expect(s.savedPgn).not.toContain('Nf3');
    expect(chaptersToPgn(s.chapters)).toContain('Nf3');
  });

  it('deletes the swap when the offer is declined', async () => {
    await useStudy.getState().dismissRecovery();
    expect(useStudy.getState().recovery).toBeNull();
    expect(parkDeletes).toHaveLength(1);
  });

  it('keeps the swap when the offer is closed rather than answered', async () => {
    // Escape, the X, the scrim and the drag all land here. Closing a
    // window is not an answer, and this is the one window whose
    // destructive answer cannot be undone.
    useStudy.getState().deferRecovery();
    expect(useStudy.getState().recovery).toBeNull();
    expect(parkDeletes).toEqual([]);
  });

  it('offers the swap again after it was closed unanswered', async () => {
    useStudy.getState().deferRecovery();
    await useStudy.getState().close();
    await useStudy.getState().open('t');
    expect(useStudy.getState().recovery?.pgn).toContain('Nf3');
  });

  it('asks nothing when the vault holds no swap', async () => {
    await useStudy.getState().close();
    serverDraft = null;
    await useStudy.getState().open('t');
    expect(useStudy.getState().recovery).toBeNull();
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
