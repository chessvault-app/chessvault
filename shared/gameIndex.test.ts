import { describe, expect, it } from 'vitest';
import { PgnParser, type Game, type PgnNodeData } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { hashSetup } from './zobrist.ts';
import {
  MAX_PLY,
  indexGame,
  normaliseDate,
  pathUser,
  speedOf,
  userSideOf,
} from './gameIndex.ts';

const parse = (pgn: string): Game<PgnNodeData> => {
  let out: Game<PgnNodeData> | null = null;
  new PgnParser((game, err) => {
    if (!err && !out) out = game;
  }).parse(pgn);
  if (!out) throw new Error('no game parsed');
  return out;
};

const WHERE = { file: 'chesscom/me/2026-01.pgn', idx: 0, user: 'me' };

describe('speedOf', () => {
  it('counts the increment, the way lichess does', () => {
    // 3+2 is 180 + 80 = 260s, which is blitz — not bullet as "180" alone
    // would suggest. Getting this wrong misfiles every incremented game.
    expect(speedOf('180')).toBe('blitz');
    expect(speedOf('180+2')).toBe('blitz');
    expect(speedOf('60')).toBe('bullet');
    // 2+1 estimates to 160s, still under the 180 line — bullet.
    expect(speedOf('120+1')).toBe('bullet');
    expect(speedOf('120+2')).toBe('blitz');
    expect(speedOf('600')).toBe('rapid');
    expect(speedOf('1800')).toBe('classical');
    expect(speedOf('1/259200')).toBe('correspondence');
  });

  it('has no opinion when the PGN has none', () => {
    expect(speedOf(null)).toBeNull();
    expect(speedOf('-')).toBeNull();
    expect(speedOf('nonsense')).toBeNull();
  });
});

describe('normaliseDate', () => {
  it('accepts both PGN spellings and rejects the vague ones', () => {
    expect(normaliseDate('2026.08.11')).toBe('2026-08-11');
    expect(normaliseDate('2026-08-11')).toBe('2026-08-11');
    expect(normaliseDate('2026.??.??')).toBeNull();
    expect(normaliseDate(undefined)).toBeNull();
  });
});

describe('pathUser / userSideOf', () => {
  it('reads the player out of an archive path', () => {
    expect(pathUser('chesscom/me/2026-01.pgn')).toBe('me');
    expect(pathUser('lichess/Me/2026-01.pgn')).toBe('me');
    expect(pathUser('collection/some-game.pgn')).toBeNull();
  });

  it('prefers an explicit header over the path', () => {
    expect(userSideOf('a', 'b', 'black', 'a')).toBe('black');
    expect(userSideOf('Me', 'foe', undefined, 'me')).toBe('white');
    expect(userSideOf('foe', 'Me', undefined, 'me')).toBe('black');
    expect(userSideOf('a', 'b', undefined, 'me')).toBeNull();
    expect(userSideOf('a', 'b', undefined, null)).toBeNull();
  });
});

describe('indexGame', () => {
  it('keys each ply by the position BEFORE the move', () => {
    const indexed = indexGame(parse('1. e4 e5 2. Nf3 1-0'), WHERE)!;
    expect(indexed.plies.map((p) => p.uci)).toEqual(['e2e4', 'e7e5', 'g1f3']);

    // The first ply must hash the starting position, or a lookup at the
    // start would never find it. This is the contract the explorer relies
    // on and the one a book indexer shares.
    expect(indexed.plies[0]!.hash).toBe(hashSetup(Chess.default().toSetup()));

    const pos = Chess.default();
    pos.play(parseSan(pos, 'e4')!);
    expect(indexed.plies[1]!.hash).toBe(hashSetup(pos.toSetup()));
  });

  it('scores from white point of view', () => {
    expect(indexGame(parse('1. e4 1-0'), WHERE)!.score).toBe(1);
    expect(indexGame(parse('1. e4 0-1'), WHERE)!.score).toBe(-1);
    expect(indexGame(parse('1. e4 1/2-1/2'), WHERE)!.score).toBe(0);
  });

  it('refuses what would poison the position keys', () => {
    // No result to count.
    expect(indexGame(parse('1. e4 *'), WHERE)).toBeNull();
    // A set-up position: the same hash would mean a different game.
    expect(indexGame(parse('[FEN "8/8/8/8/8/8/8/K6k w - - 0 1"]\n\n*'), WHERE)).toBeNull();
    expect(indexGame(parse('[Variant "Crazyhouse"]\n\n1. e4 1-0'), WHERE)).toBeNull();
    // Nothing was played.
    expect(indexGame(parse('[Result "1-0"]\n\n1-0'), WHERE)).toBeNull();
  });

  it('keeps what replayed when a move is illegal', () => {
    const indexed = indexGame(parse('1. e4 e5 2. Qz9 1-0'), WHERE);
    expect(indexed?.plies.map((p) => p.uci)).toEqual(['e2e4', 'e7e5']);
  });

  it('stops at MAX_PLY', () => {
    const moves = Array.from({ length: 50 }, (_, i) =>
      i % 2 === 0 ? `${i / 2 + 1}. Nf3 Nf6 ${i / 2 + 1}. Ng1 Ng8` : '',
    ).join(' ');
    const indexed = indexGame(parse(`${moves} 1-0`), WHERE)!;
    expect(indexed.plies.length).toBe(MAX_PLY);
  });

  it('carries the metadata every filter reads', () => {
    const indexed = indexGame(
      parse(
        '[White "Me"]\n[Black "Foe"]\n[Result "1-0"]\n[UTCDate "2026.03.04"]\n[TimeControl "180+2"]\n[ECO "B10"]\n\n1. e4 c6 1-0',
      ),
      WHERE,
    )!;
    expect(indexed).toMatchObject({
      white: 'Me',
      black: 'Foe',
      score: 1,
      date: '2026-03-04',
      speed: 'blitz',
      eco: 'B10',
      userSide: 'white',
      file: 'chesscom/me/2026-01.pgn',
      idx: 0,
    });
  });
});
