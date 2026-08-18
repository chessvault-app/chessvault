import { afterEach, describe, expect, it, vi } from 'vitest';

import { lookupTablebaseLines, tablebaseEligible } from './tablebase.ts';

describe('tablebaseEligible', () => {
  it('accepts 7 men or fewer without castling rights', () => {
    expect(tablebaseEligible('4k3/8/8/8/8/8/8/4KQ2 w - - 0 1')).toBe(true);
    expect(tablebaseEligible('4k3/pp6/8/8/8/8/PP6/4K3 w - - 0 1')).toBe(true);
  });

  it('refuses full boards and castling positions', () => {
    expect(tablebaseEligible('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBe(
      false,
    );
    // Few men but castling still possible: Syzygy has no such entry.
    expect(tablebaseEligible('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1')).toBe(false);
  });
});

/**
 * The module remembers answers for the life of the page, so every test
 * here uses a fen of its own — sharing one would mean the second test read
 * the first one's cache instead of its own stub.
 */
describe('lookupTablebaseLines', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ok = (lines: unknown): Response =>
    ({ ok: true, status: 200, json: async () => ({ lines }) }) as Response;

  it('returns the lines the server built', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([{ multipv: 1, depth: 15, mate: 8, moves: ['f1f6'] }]));
    vi.stubGlobal('fetch', fetchMock);

    const lines = await lookupTablebaseLines('4k3/8/8/8/8/8/8/4KQ2 w - - 0 1', 1);

    expect(lines).toHaveLength(1);
    expect(lines?.[0]?.mate).toBe(8);
  });

  it('remembers a 400: it will never become answerable', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const fen = '4k3/pppppppp/8/8/8/8/8/4K3 w - - 0 1';

    expect(await lookupTablebaseLines(fen, 1)).toEqual([]);
    expect(await lookupTablebaseLines(fen, 1)).toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('remembers an empty answer too: a draw is settled', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([]));
    vi.stubGlobal('fetch', fetchMock);
    const fen = '4k3/8/4K3/8/8/8/8/8 w - - 0 1';

    expect(await lookupTablebaseLines(fen, 1)).toEqual([]);
    expect(await lookupTablebaseLines(fen, 1)).toEqual([]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The offline fallback. An empty answer and no answer are different
   * facts: one means the engine's lines stand for good, the other only
   * means we could not ask yet.
   */
  it('does not remember a failure to reach the server', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const fen = '8/8/8/8/8/1k6/1p6/1K1R4 w - - 0 1';

    expect(await lookupTablebaseLines(fen, 1)).toBeNull();
    expect(await lookupTablebaseLines(fen, 1)).toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
