import { describe, expect, it } from 'vitest';
import { repairBoard, type CellCandidates } from './bookRepair.ts';

/** Labels in the classifier's order; index 0 is an empty square. */
const LABELS = ['1', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k'];

/** A cell the classifier is sure about. */
const sure = (label: string): CellCandidates => {
  const probs = new Float32Array(LABELS.length);
  probs[LABELS.indexOf(label)] = 0.99;
  return { probs, top: LABELS.indexOf(label), votes: new Map() };
};

/** A cell it got wrong: `label` won, but shifted re-reads said `truth`. */
const shaky = (label: string, truth: string): CellCandidates => {
  const probs = new Float32Array(LABELS.length);
  probs[LABELS.indexOf(label)] = 0.55;
  probs[LABELS.indexOf(truth)] = 0.4;
  return {
    probs,
    top: LABELS.indexOf(label),
    votes: new Map([[LABELS.indexOf(truth), 3]]),
  };
};

const board = (edits: Record<number, CellCandidates> = {}): CellCandidates[] =>
  [...Array(64).keys()].map((at) => edits[at] ?? sure('1'));

describe('repairBoard', () => {
  it('finds the one changed cell that makes the line replay', () => {
    // Only the board carrying a knight on square 9 replays.
    const cells = board({ 9: shaky('1', 'N') });
    const out = repairBoard(cells, LABELS, (labels) =>
      labels[9] === 'N' ? { placement: 'with-knight', side: 'w', sans: ['Nf3'] } : null,
    );
    expect(out.repaired?.placement).toBe('with-knight');
    expect(out.repaired?.edits).toBe(1);
    expect(out.ambiguous).toHaveLength(0);
  });

  it('leaves the board alone when nothing replays', () => {
    const out = repairBoard(board({ 9: shaky('1', 'N') }), LABELS, () => null);
    expect(out.repaired).toBeNull();
    expect(out.ambiguous).toHaveLength(0);
  });

  it('refuses a repair when two different positions both replay', () => {
    // Two unrelated cells each produce a working — but different — board,
    // and neither is supported by a shifted re-read. Guessing between them
    // would be inventing a position, so it declines.
    const cells = board();
    const out = repairBoard(cells, LABELS, (labels) => {
      if (labels[20] === 'P') return { placement: 'pawn-board', side: 'w', sans: ['a4'] };
      if (labels[40] === 'N') return { placement: 'knight-board', side: 'w', sans: ['Nf3'] };
      return null;
    });
    expect(out.repaired).toBeNull();
    expect(out.ambiguous.length).toBeGreaterThan(1);
  });

  it('breaks a tie only when the shifted re-reads back one side', () => {
    // Same two-way tie, except the augmented reads voted for the queen.
    const cells = board({ 20: shaky('1', 'Q') });
    const out = repairBoard(cells, LABELS, (labels) => {
      if (labels[20] === 'Q') return { placement: 'queen-board', side: 'w', sans: ['Qa1'] };
      if (labels[40] === 'N') return { placement: 'knight-board', side: 'w', sans: ['Nf3'] };
      return null;
    });
    expect(out.repaired?.placement).toBe('queen-board');
  });

  it('two positions that are really the same position count once', () => {
    // Different edits, identical resulting board: one claim, not a tie.
    const out = repairBoard(board(), LABELS, (labels) =>
      labels[20] === 'P' || labels[40] === 'P'
        ? { placement: 'same-board', side: 'w', sans: ['a4'] }
        : null,
    );
    expect(out.repaired?.placement).toBe('same-board');
  });

  it('reaches a two-cell repair only when no single cell works', () => {
    const cells = board({ 9: shaky('1', 'N'), 33: shaky('1', 'R') });
    const out = repairBoard(cells, LABELS, (labels) =>
      labels[9] === 'N' && labels[33] === 'R'
        ? { placement: 'both', side: 'b', sans: ['Nf3', 'Ra1'] }
        : null,
    );
    expect(out.repaired?.placement).toBe('both');
    expect(out.repaired?.edits).toBe(2);
  });

  it('stops at the depth it is given', () => {
    // A board needing two changes is found at depth 2 and not at depth 1.
    const cells = board({ 9: shaky('1', 'N'), 33: shaky('1', 'R') });
    const replay = (labels: string[]) =>
      labels[9] === 'N' && labels[33] === 'R'
        ? { placement: 'both', side: 'w' as const, sans: ['Nf3'] }
        : null;
    expect(repairBoard(cells, LABELS, replay, { maxEdits: 1 }).repaired).toBeNull();
    expect(repairBoard(cells, LABELS, replay, { maxEdits: 2 }).repaired?.placement).toBe('both');
  });

  it('a one-cell fix is still found at depth 1', () => {
    const out = repairBoard(board({ 9: shaky('1', 'N') }), LABELS, (labels) =>
      labels[9] === 'N' ? { placement: 'one', side: 'w', sans: ['Nf3'] } : null,
      { maxEdits: 1 },
    );
    expect(out.repaired?.edits).toBe(1);
  });

  it('declines anything that is not a whole board', () => {
    expect(repairBoard([sure('1')], LABELS, () => null).repaired).toBeNull();
  });
});
