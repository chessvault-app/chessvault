import { describe, expect, it } from 'vitest';
import { Chess } from 'chessops/chess';
import { makeFen } from 'chessops/fen';
import { parseSan } from 'chessops/san';
import { detectSacrifices } from './sacrifice';

/** The positions a game visits, from the start position through `sans`. */
const fensOf = (sans: string[]): string[] => {
  const pos = Chess.default();
  const fens = [makeFen(pos.toSetup())];
  for (const san of sans) {
    const move = parseSan(pos, san);
    if (!move) throw new Error(`illegal san in fixture: ${san}`);
    pos.play(move);
    fens.push(makeFen(pos.toSetup()));
  }
  return fens;
};

describe('sacrifice detection (position-based)', () => {
  it('does not blame a quiet move for the opponent grabbing a defended piece', () => {
    // 4.Qxf6?? grabs a knight that g7 recaptures. The old game-record
    // counting saw "down a knight two plies after 3...Nc6" and flagged
    // the DEVELOPING move as a sacrifice; the capture ladder sees the
    // recapture and clears it. Qxf6 itself IS flagged — a queen left
    // takeable for a knight is offered material; that it was a blunder
    // rather than a brilliancy is the engine's call, not this one's.
    const flags = detectSacrifices(
      fensOf(['e4', 'e5', 'Bc4', 'Nf6', 'Qf3', 'Nc6', 'Qxf6', 'gxf6']),
    );
    expect(flags).toEqual([false, false, false, false, false, false, true, false]);
  });

  it('sees an offer whether or not the opponent takes it', () => {
    // 3.Qxh7?? leaves the queen to Rxh7. Black declines with 3...Nf6 —
    // the old counting saw no material change and missed the offer
    // entirely. The flag reads the position, not the reply.
    const flags = detectSacrifices(fensOf(['e4', 'e5', 'Qh5', 'Nc6', 'Qxh7', 'Nf6']));
    expect(flags[4]).toBe(true);
    expect(flags.filter(Boolean)).toHaveLength(1);
  });

  it('never flags even trades', () => {
    const flags = detectSacrifices(
      fensOf(['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nxd4', 'Qxd4']),
    );
    expect(flags).toEqual(Array(9).fill(false));
  });

  it("flags Légal's queen offer once, on the move that makes it", () => {
    // 5.Nxe5 walks away from the queen (Bxd1 is on) for a mating attack.
    // The material search cannot see the mate — it is not supposed to;
    // it reports the queen genuinely offered, and the engine's verdict on
    // the move supplies the soundness. The plies AFTER it leave the queen
    // just as takeable, and the null-move guard keeps them from being
    // counted as fresh sacrifices every turn it stays en prise.
    const flags = detectSacrifices(
      fensOf(['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Nc6', 'Nxc6']),
    );
    expect(flags[8]).toBe(true); // Nxe5
    expect(flags[9]).toBe(false); // Nc6 — queen was already hanging
    expect(flags[10]).toBe(false); // Nxc6 — still not a new offer
    expect(flags.filter(Boolean)).toHaveLength(1);
  });

  it('yields nothing rather than guessing on unreadable positions', () => {
    expect(detectSacrifices(['not a fen', 'also not a fen'])).toEqual([false]);
  });
});
