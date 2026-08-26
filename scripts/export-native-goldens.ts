/**
 * Export golden fixtures for the native pipeline's parity tests.
 *
 *   npx tsx scripts/export-native-goldens.ts
 *
 * Writes native/tests/goldens.json and native/tests/parity.pgn. The JSON
 * holds the JS pipeline's OWN answers — zobrist keys, finalMen counts,
 * result/level codes, and full plies rows produced by the same replay
 * loop `indexPositions` runs — so the Rust port in native/ is proven
 * against the implementation it replaces, not against a re-derivation.
 * The PGN is a small corpus for whole-file parity: build + index it with
 * both pipelines and diff every table.
 *
 * Deterministic by construction (seeded self-play, fixed FEN list): two
 * runs of this script produce identical files, so regenerating after a
 * contract change shows exactly the rows that changed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { NormalMove, Role } from 'chessops/types';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import { REF_MAX_PLY, eloBucket, finalMen, resultCode } from '../server/refgamesIndex.ts';

const OUT_DIR = resolve(import.meta.dirname, '..', 'native', 'tests');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Deterministic PRNG — same splitmix64 as the zobrist tables, its own seed.

const MASK64 = (1n << 64n) - 1n;
const splitmix64 = (seed: bigint): (() => bigint) => {
  let state = seed & MASK64;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & MASK64;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
    return (z ^ (z >> 31n)) & MASK64;
  };
};
const rng = splitmix64(0x676f6c64656e73n); // 'goldens'
const randInt = (n: number): number => Number(rng() % BigInt(n));
const pick = <T>(items: readonly T[]): T => items[randInt(items.length)]!;

// ---------------------------------------------------------------------------
// FEN → key goldens. Every consumer hashes `pos.toSetup()` — the
// normalised setup, ep square kept only when the capture is actually
// legal — so the golden is parse → fromSetup → toSetup → hash.

const FENS: { fen: string; why: string }[] = [
  { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', why: 'startpos' },
  {
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    why: 'ep square written but no capturer — normalisation must drop it',
  },
  {
    fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    why: 'the same position without the ep field — must hash equal to the row above',
  },
  {
    fen: 'rnbqkbnr/pp2pppp/8/2ppP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
    why: 'legal en passant (exd6) — ep file IS hashed',
  },
  {
    fen: '8/8/8/8/1k1PpQ2/8/8/4K3 b - d3 0 1',
    why: 'ep capture would expose the king along the rank — illegal, ep dropped',
  },
  { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', why: 'all four castling rights' },
  { fen: 'r3k2r/8/8/8/8/8/8/R3K2R w Kq - 0 1', why: 'partial castling rights' },
  { fen: 'r3k2r/8/8/8/8/8/8/R3K2R b - - 0 1', why: 'no rights, black to move' },
  { fen: '8/2k5/8/8/8/8/2K3P1/8 w - - 0 1', why: 'sparse endgame' },
  {
    fen: 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 b - - 7 6',
    why: 'castled middlegame, black to move',
  },
];

const keyOf = (fen: string): bigint => {
  const setup = parseFen(fen).unwrap();
  const pos = Chess.fromSetup(setup).unwrap();
  return hashSetup(pos.toSetup());
};

const fens = FENS.map(({ fen, why }) => {
  const key = keyOf(fen);
  return { fen, why, key: key.toString(16), db: toDbKey(key).toString() };
});

// The anchor the zobrist unit tests pin — if this export drifts, fail
// here rather than shipping a wrong fixture.
if (fens[0]!.key !== 'a3179e4796df93c0') {
  throw new Error(`startpos key drifted: ${fens[0]!.key}`);
}
if (fens[1]!.key !== fens[2]!.key) {
  throw new Error('ep normalisation drifted: phantom ep square changed the key');
}

// ---------------------------------------------------------------------------
// Small pure-function goldens.

const results = ['1-0', '0-1', '1/2-1/2', '*', ''].map((result) => ({
  result,
  r: resultCode(result),
}));

const elos = (
  [
    [0, 0],
    [2431, 2210],
    [799, 801],
    [1600, 1600],
    [3050, 2900],
  ] as const
).map(([whiteElo, blackElo]) => ({ whiteElo, blackElo, eb: eloBucket(whiteElo, blackElo) }));

const menCases = [
  'e4 e5 Nf3 Nc6',
  'e4 d5 exd5 Qxd5 Nc3 Qd8',
  'e4 c5 e5 d5 exd6', // en passant: the captured pawn never sat on the target square
  'e4 xx', // a bogus token containing x still decrements — frozen behaviour
  'e4',
].map((moves) => {
  const men = finalMen(moves);
  return { moves, w: men.w, b: men.b };
});

// ---------------------------------------------------------------------------
// Game goldens: the exact rows `indexPositions` would write. Replayed
// from the SAN string through the same parseSan loop, keys before the
// move, stop at REF_MAX_PLY or the first SAN that fails to parse.

type GameGolden = {
  why: string;
  moves: string;
  result: string;
  whiteElo: number;
  blackElo: number;
  r: number;
  eb: number;
  plyCount: number;
  finalWmen: number;
  finalBmen: number;
  plies: { ply: number; pos: string; uci: string }[];
};

const replayGolden = (
  why: string,
  moves: string,
  result: string,
  whiteElo: number,
  blackElo: number,
): GameGolden => {
  const pos = Chess.default();
  const plies: GameGolden['plies'] = [];
  let ply = 0;
  for (const san of moves.split(' ')) {
    if (ply >= REF_MAX_PLY) break;
    const move = parseSan(pos, san);
    if (!move) break;
    plies.push({ ply, pos: toDbKey(hashSetup(pos.toSetup())).toString(), uci: makeUci(move) });
    pos.play(move);
    ply += 1;
  }
  const men = finalMen(moves);
  return {
    why,
    moves,
    result,
    whiteElo,
    blackElo,
    r: resultCode(result),
    eb: eloBucket(whiteElo, blackElo),
    plyCount: moves.split(' ').length,
    finalWmen: men.w,
    finalBmen: men.b,
    plies,
  };
};

/** All legal moves, promotions expanded — deterministic order. */
const legalMoves = (pos: Chess): NormalMove[] => {
  const out: NormalMove[] = [];
  for (const [from, dests] of pos.allDests()) {
    for (const to of dests) {
      const piece = pos.board.get(from);
      if (piece?.role === 'pawn' && (to >= 56 || to <= 7)) {
        for (const promotion of ['queen', 'knight', 'rook', 'bishop'] as Role[]) {
          out.push({ from, to, promotion });
        }
      } else {
        out.push({ from, to });
      }
    }
  }
  return out;
};

const selfPlay = (targetPlies: number): { moves: string; result: string } => {
  const pos = Chess.default();
  const sans: string[] = [];
  for (let ply = 0; ply < targetPlies; ply += 1) {
    const moves = legalMoves(pos);
    if (moves.length === 0) break;
    sans.push(makeSanAndPlay(pos, normalizeMove(pos, pick(moves))));
  }
  const outcome = pos.outcome();
  const result = outcome
    ? outcome.winner === 'white'
      ? '1-0'
      : outcome.winner === 'black'
        ? '0-1'
        : '1/2-1/2'
    : pick(['1-0', '0-1', '1/2-1/2']);
  return { moves: sans.join(' '), result };
};

const games: GameGolden[] = [];

const HANDCRAFTED: { why: string; moves: string; result: string; fullReplay: boolean }[] = [
  {
    why: 'en passant capture at ply 4 — the position before it hashes an ep file',
    moves: 'e4 c5 e5 d5 exd6',
    result: '1-0',
    fullReplay: true,
  },
  {
    why: 'kingside castling both sides',
    moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 Qe2 O-O',
    result: '1/2-1/2',
    fullReplay: true,
  },
  {
    why: 'queenside castling both sides',
    moves: 'd4 d5 Nc3 Nc6 Bf4 Bf5 Qd2 Qd7 O-O-O O-O-O',
    result: '0-1',
    fullReplay: true,
  },
  {
    why: 'capture-promotion to a queen',
    moves: 'e4 d5 exd5 c6 dxc6 Nf6 cxb7 Nbd7 bxa8=Q',
    result: '1-0',
    fullReplay: true,
  },
  {
    why: 'underpromotion to a knight',
    moves: 'e4 d5 exd5 c6 dxc6 Nf6 cxb7 Nbd7 bxa8=N',
    result: '1-0',
    fullReplay: true,
  },
  {
    why: 'SAN stops parsing at ply 2 — the plies that did replay are kept',
    moves: 'e4 e5 Zz9 d4 d5',
    result: '1-0',
    fullReplay: false,
  },
];

for (const { why, moves, result, fullReplay } of HANDCRAFTED) {
  const golden = replayGolden(why, moves, result, 1000 + randInt(2000), 1000 + randInt(2000));
  const wanted = fullReplay ? Math.min(moves.split(' ').length, REF_MAX_PLY) : 2;
  if (golden.plies.length !== wanted) {
    throw new Error(`handcrafted game replayed ${golden.plies.length} plies, wanted ${wanted}: ${moves}`);
  }
  games.push(golden);
}

for (let i = 0; i < 50; i += 1) {
  // A spread of lengths either side of REF_MAX_PLY, some far past it.
  const target = 8 + randInt(100);
  const { moves, result } = selfPlay(target);
  if (moves.split(' ').length < 2) continue;
  games.push(
    replayGolden(`self-play ${i}`, moves, result, 600 + randInt(2600), 600 + randInt(2600)),
  );
}

if (!games.some((g) => g.plyCount > REF_MAX_PLY)) {
  throw new Error('no game exceeds REF_MAX_PLY — the cap is untested');
}

// ---------------------------------------------------------------------------
// parity.pgn — a corpus for whole-file diffing. Includes every header
// shape the build filter cares about: variant games, FEN games, unknown
// results and sub-2-ply games (all skipped), missing Elos (0), UTCDate
// vs Date vs neither, and one exact duplicate pair (a fresh build keeps
// both; only append dedups).

const pgnGames: string[] = [];
const wrapMovetext = (sans: string[], result: string): string => {
  const tokens: string[] = [];
  sans.forEach((san, i) => {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(san);
  });
  tokens.push(result);
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line.length + token.length + 1 > 80) {
      lines.push(line);
      line = token;
    } else {
      line = line === '' ? token : `${line} ${token}`;
    }
  }
  lines.push(line);
  return lines.join('\n');
};

const pgnGame = (headers: [string, string][], moves: string, result: string): string =>
  `${headers.map(([k, v]) => `[${k} "${v}"]`).join('\n')}\n\n${wrapMovetext(
    moves === '' ? [] : moves.split(' '),
    result,
  )}\n`;

const ECOS = ['B20', 'C50', 'D02', 'A40', 'E60'];
const OPENINGS = ['Sicilian Defense', 'Italian Game', 'London System', 'Queen Pawn Game', 'King Indian'];
let parityIndex = 0;
const parityHeaders = (result: string, shape: number): [string, string][] => {
  parityIndex += 1;
  const headers: [string, string][] = [
    ['Event', shape % 3 === 0 ? `Parity Cup ${parityIndex}` : 'Casual game'],
    ['White', shape % 4 === 0 ? `Müller, K ${parityIndex}` : `White${parityIndex}`],
    ['Black', `Black${parityIndex}`],
    ['Result', result],
  ];
  if (shape % 5 !== 0) headers.push(['WhiteElo', String(800 + ((parityIndex * 137) % 2200))]);
  if (shape % 7 !== 0) headers.push(['BlackElo', String(800 + ((parityIndex * 251) % 2200))]);
  if (shape % 3 === 0) headers.push(['UTCDate', `2025.0${1 + (parityIndex % 9)}.1${parityIndex % 10}`]);
  else if (shape % 3 === 1) headers.push(['Date', `2024.1${parityIndex % 2}.0${1 + (parityIndex % 9)}`]);
  if (shape % 2 === 0) {
    headers.push(['ECO', ECOS[parityIndex % ECOS.length]!]);
    headers.push(['Opening', OPENINGS[parityIndex % OPENINGS.length]!]);
  }
  if (shape % 6 === 0) headers.push(['Variant', 'Standard']);
  return headers;
};

for (const golden of games.slice(0, 30)) {
  pgnGames.push(pgnGame(parityHeaders(golden.result, parityIndex), golden.moves, golden.result));
}
// The duplicate pair: repeat the first parity game verbatim.
pgnGames.push(pgnGames[0]!);
// Skipped shapes — present so both pipelines must agree on what is NOT a game.
pgnGames.push(
  pgnGame(
    [
      ['Event', 'Atomic arena'],
      ['White', 'VariantW'],
      ['Black', 'VariantB'],
      ['Result', '1-0'],
      ['Variant', 'Atomic'],
    ],
    'e4 e5',
    '1-0',
  ),
  pgnGame(
    [
      ['Event', 'From a position'],
      ['White', 'FenW'],
      ['Black', 'FenB'],
      ['Result', '0-1'],
      ['FEN', '8/2k5/8/8/8/8/2K3P1/8 w - - 0 1'],
      ['SetUp', '1'],
    ],
    'g4 Kd6',
    '0-1',
  ),
  pgnGame(
    [
      ['Event', 'Abandoned'],
      ['White', 'StarW'],
      ['Black', 'StarB'],
      ['Result', '*'],
    ],
    'e4 e5 Nf3',
    '*',
  ),
  pgnGame(
    [
      ['Event', 'One ply'],
      ['White', 'ShortW'],
      ['Black', 'ShortB'],
      ['Result', '1-0'],
    ],
    'e4',
    '1-0',
  ),
);

// ---------------------------------------------------------------------------

const goldens = {
  schema: 1,
  generator: 'scripts/export-native-goldens.ts',
  refMaxPly: REF_MAX_PLY,
  fens,
  results,
  elos,
  finalMen: menCases,
  games,
};

writeFileSync(resolve(OUT_DIR, 'goldens.json'), `${JSON.stringify(goldens, null, 1)}\n`);
writeFileSync(resolve(OUT_DIR, 'parity.pgn'), `${pgnGames.join('\n')}`);

const totalPlies = games.reduce((n, g) => n + g.plies.length, 0);
console.log(
  `goldens: ${fens.length} fens, ${games.length} games (${totalPlies} plies), ` +
    `${menCases.length} finalMen cases → native/tests/goldens.json`,
);
console.log(`parity corpus: ${pgnGames.length} PGN games → native/tests/parity.pgn`);
