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
      'giuoco-pianissimo': 's:8.9.13.14.15.18.19.28/36.43.48.49.50.53.54.55',
      'closed-ruy-lopez': 's:8.9.11.13.14.18.23.28/33.36.40.43.50.53.54.55',
      'exchange-ruy-lopez': 's:8.9.10.11.13.14.15.28/36.40.42.49.50.53.54.55',
      'philidor': 's:8.9.10.13.14.15.27.28/36.43.48.49.50.53.54.55',
      'symmetrical-d-pawns': 's:8.9.10.13.14.15.27/35.48.49.50.53.54.55',
      'open-sicilian': 's:8.9.10.13.14.15.28/48.49.51.52.53.54.55',
      'scheveningen': 's:8.9.10.13.14.15.28/40.43.44.49.53.54.55',
      'najdorf': 's:8.9.10.13.14.15.28/36.40.43.49.53.54.55',
      'dragon': 's:8.9.10.13.14.15.28/43.46.48.49.52.53.55',
      'sveshnikov': 's:8.9.10.13.14.15.28/36.43.48.49.53.54.55',
      'maroczy': 's:8.9.13.14.15.26.28/46.48.49.51.52.53.55',
      'hedgehog': 's:8.13.15.17.22.26.28/40.41.43.44.53.54.55',
      'french-advance': 's:8.9.13.14.15.18.27.36/34.35.44.48.49.53.54.55',
      'winawer': 's:10.13.14.15.16.18.27.36/34.35.44.48.49.53.54.55',
      'caro-kann': 's:8.9.10.13.14.15.27/42.48.49.52.53.54.55',
      'advance-caro-kann': 's:8.9.10.13.14.15.27.36/35.42.44.48.49.53.54.55',
      'pirc': 's:8.9.10.13.14.15.27.28/43.46.48.49.50.52.53.55',
      'qgd': 's:8.9.13.14.15.20.26.27/35.44.48.49.50.53.54.55',
      'carlsbad': 's:8.9.13.14.15.20.27/35.42.48.49.53.54.55',
      'slav': 's:8.9.12.13.14.15.26.27/35.42.48.49.52.53.54.55',
      'semi-slav': 's:8.9.13.14.15.20.26.27/35.42.44.48.49.53.54.55',
      'catalan': 's:8.9.12.13.15.22.26.27/35.44.48.49.50.53.54.55',
      'london': 's:8.9.13.14.15.18.20.27/34.35.44.48.49.53.54.55',
      'stonewall': 's:8.9.12.13.15.22.26.27/35.37.42.44.48.49.54.55',
      'leningrad-dutch': 's:8.9.12.13.15.22.26.27/37.43.46.48.49.50.52.55',
      'nimzo-doubled': 's:12.13.14.15.16.18.26.27/44.48.49.50.51.53.54.55',
      'grunfeld-exchange': 's:8.13.14.15.18.27.28/46.48.49.50.52.53.55',
      'kid-closed': 's:8.9.13.14.15.26.28.35/36.43.46.48.49.50.53.55',
      'modern-benoni': 's:8.9.13.14.15.28.35/34.43.48.49.53.54.55',
    });
  });
});
