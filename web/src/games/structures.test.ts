import { describe, expect, it } from 'vitest';
import { parseFen } from 'chessops/fen';
import { matchSignature } from '@shared/scanMatch';
import MOTIFS from './motifs.json';
import STRUCTURES from './structures.json';

/**
 * The named pawn structures are curated facts: a wrong sketch silently
 * returns wrong games, the failure class the whole scan is guarded
 * against, so each one is pinned here — its shape (pawns only, both
 * sides, no kings, the relaxed rungs' legitimate kingless target) and
 * the structure signature it hunts by. A signature that moves here is
 * a preset that changed meaning, to be named in the commit.
 */
describe('named pawn structures', () => {
  it('names each entry once across both preset files', () => {
    const ids = [...MOTIFS.map((m) => m.id), ...STRUCTURES.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is a pawns-only, kingless sketch with pawns on both sides', () => {
    for (const { id, fen } of STRUCTURES) {
      const setup = parseFen(fen);
      expect(setup.isOk, id).toBe(true);
      const board = setup.unwrap().board;
      expect(board.occupied.equals(board.pawn), `${id}: pieces in the sketch`).toBe(true);
      expect(board.king.isEmpty(), id).toBe(true);
      expect(board.pawn.intersect(board.white).size(), id).toBeGreaterThan(0);
      expect(board.pawn.intersect(board.black).size(), id).toBeGreaterThan(0);
    }
  });

  it('pins the structure signature each preset hunts by', () => {
    const signatures = Object.fromEntries(
      STRUCTURES.map(({ id, fen }) => [id, matchSignature(parseFen(fen).unwrap().board, 'structure')]),
    );
    expect(signatures).toEqual({
      carlsbad: 's:8.9.13.14.15.20.27/35.42.48.49.53.54.55',
      'french-advance': 's:8.9.13.14.15.18.27.36/34.35.44.48.49.53.54.55',
      'kid-closed': 's:8.9.13.14.15.26.28.35/36.43.46.48.49.50.53.55',
      maroczy: 's:8.9.13.14.15.26.28/46.48.49.51.52.53.55',
      hedgehog: 's:8.13.15.17.22.26.28/40.41.43.44.53.54.55',
      stonewall: 's:8.9.12.13.15.22.26.27/35.37.42.44.48.49.54.55',
    });
  });
});
