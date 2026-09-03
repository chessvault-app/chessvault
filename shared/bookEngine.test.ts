import { describe, expect, it } from 'vitest';
import {
  defenderWildcards,
  engineTier,
  fullFen,
  lineFromPv,
  overlap,
  type EngineLine,
  type EngineSearch,
} from './bookEngine.ts';

/** White mates in one with Rxa6; the black rook is on b8, king a8. */
const MATE_IN_ONE = 'kr6/1p6/p7/4b3/8/8/1P4BP/R6K';

/** A search that answers by side to move, and counts what it was asked. */
function fake(answers: { w?: EngineLine | null; b?: EngineLine | null }): EngineSearch & {
  asked: string[];
} {
  const asked: string[] = [];
  const search = (fen: string): Promise<EngineLine | null> => {
    asked.push(fen);
    return Promise.resolve(answers[fen.split(' ')[1] as 'w' | 'b'] ?? null);
  };
  return Object.assign(search, { asked });
}

describe('fullFen', () => {
  it('gives a diagram the castling rights its home squares imply', () => {
    // What the reader's overlay hands the board: a bare `-` here made O-O
    // illegal in every line played from a book position.
    expect(fullFen('r3k2r/8/8/8/8/8/8/R3K2R', 'w')).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(fullFen('4k3/8/8/8/8/8/8/4K3', 'b')).toBe('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
  });
});

describe('engineTier', () => {
  it('corroborates when the engine lands where the book said', () => {
    const search = fake({ w: { cp: null, mate: 1, pv: ['a1a6'] } });
    return engineTier(
      { number: 7, placement: MATE_IN_ONE, side: 'w', squares: ['a6', 'b7'] },
      search,
    ).then((out) => {
      expect(out?.provenance).toBe('engine-corroborated');
      expect(out?.san).toEqual(['Rxa6#']);
      expect(out?.fen).toBe(`${MATE_IN_ONE} w - - 0 1`);
    });
  });

  it('is engine-only when nothing legible agrees with it', async () => {
    const search = fake({ w: { cp: null, mate: 1, pv: ['a1a6'] } });
    const out = await engineTier(
      // The scan read "g7" and "h6" out of this entry — neither is where
      // the engine goes, so the two readings do not corroborate.
      { number: 7, placement: MATE_IN_ONE, side: 'w', squares: ['g7', 'h6'] },
      search,
    );
    expect(out?.provenance).toBe('engine-only');
  });

  it('will not corroborate off a single square', async () => {
    const search = fake({ w: { cp: null, mate: 1, pv: ['a1a6'] } });
    const out = await engineTier(
      { number: 7, placement: MATE_IN_ONE, side: 'w', squares: ['a6'] },
      search,
    );
    expect(out?.provenance).toBe('engine-only');
  });

  it('imports a stated side with no decisive line as unverified', async () => {
    const search = fake({ w: { cp: 20, mate: null, pv: ['a1a2', 'b8c8'] } });
    const out = await engineTier(
      { number: 7, placement: MATE_IN_ONE, side: 'w', squares: [] },
      search,
    );
    expect(out?.provenance).toBe('engine-unverified');
    expect(out?.uci).toEqual(['a1a2', 'b8c8']);
    // And on the strength of ONE search: the badged tier reads the line out
    // of the search that decided it was not decisive, rather than asking
    // the same position the same question twice.
    expect(search.asked).toHaveLength(1);
  });

  it('leaves a draft when there is neither a side nor a verdict', async () => {
    const search = fake({ w: { cp: 20, mate: null, pv: ['a1a2'] }, b: { cp: 10, mate: null, pv: ['b8c8'] } });
    expect(await engineTier({ number: 7, placement: MATE_IN_ONE, squares: [] }, search)).toBeNull();
  });

  it('works the side out when only one of them is winning', async () => {
    const search = fake({
      w: { cp: null, mate: 1, pv: ['a1a6'] },
      b: { cp: -50, mate: null, pv: ['b8c8'] },
    });
    const out = await engineTier({ number: 7, placement: MATE_IN_ONE, squares: ['a6', 'b7'] }, search);
    expect(out?.fen.split(' ')[1]).toBe('w');
    expect(search.asked).toHaveLength(2); // both sides tried
  });

  it('refuses to pick a side when both look winning', async () => {
    // Two winning sides means the board was misread, not that there is a
    // choice to make — so nothing is imported.
    const search = fake({
      w: { cp: 400, mate: null, pv: ['a1a6'] },
      b: { cp: 500, mate: null, pv: ['b8c8'] },
    });
    expect(await engineTier({ number: 7, placement: MATE_IN_ONE, squares: [] }, search)).toBeNull();
  });

  it('takes the clearly better side when both are winning', async () => {
    const search = fake({
      w: { cp: 300, mate: null, pv: ['a1a6'] },
      b: { cp: 900, mate: null, pv: ['b8c8'] },
    });
    const out = await engineTier({ number: 7, placement: MATE_IN_ONE, squares: [] }, search);
    expect(out?.fen.split(' ')[1]).toBe('b');
  });

  it('never asks about a position that cannot exist', async () => {
    const search = fake({ w: { cp: null, mate: 1, pv: ['a1a6'] } });
    // Three kings a side: no legal position, so no search and no puzzle.
    const out = await engineTier({ number: 7, placement: 'kkk5/8/8/8/8/8/8/KKK5', side: 'w', squares: [] }, search);
    expect(out).toBeNull();
    expect(search.asked).toEqual([]);
  });

  it('drops a variation the position will not play', async () => {
    // Second move is illegal; the line keeps what replayed and stops.
    const search = fake({ w: { cp: 30, mate: null, pv: ['a1a2', 'h8h1'] } });
    const out = await engineTier({ number: 7, placement: MATE_IN_ONE, side: 'w', squares: [] }, search);
    expect(out?.uci).toEqual(['a1a2']);
  });

  it('marks the defender’s replies in a forced mate', async () => {
    // Mate in two: three plies, the middle one is the defender's.
    expect(defenderWildcards(3)).toEqual([1]);
    expect(defenderWildcards(1)).toEqual([]);
    expect(defenderWildcards(5)).toEqual([1, 3]);
  });
});

describe('overlap', () => {
  it('measures destinations, not moves', () => {
    expect(overlap(['a1a6', 'b8a6'], ['a6'])).toBe(1);
    expect(overlap(['a1a2', 'b7b6'], ['a6', 'g7'])).toBe(0);
    expect(overlap([], ['a6'])).toBe(0);
  });
});

describe('lineFromPv', () => {
  it('stops at mate rather than reading past it', () => {
    const line = lineFromPv(`${MATE_IN_ONE} w - - 0 1`, ['a1a6', 'b8b7'], 6);
    expect(line?.uci).toEqual(['a1a6']);
    expect(line?.san).toEqual(['Rxa6#']);
  });

  it('is nothing when the first move is already impossible', () => {
    expect(lineFromPv(`${MATE_IN_ONE} w - - 0 1`, ['h8h1'], 6)).toBeNull();
  });
});
