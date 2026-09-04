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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess, normalizeMove } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { NormalMove, Role } from 'chessops/types';
import { hashSetup, toDbKey } from '../shared/zobrist.ts';
import {
  canonicalMaterial,
  matchSignature,
  materialMenBounds,
  materialSatisfied,
  parseMaterialSpec,
} from '../shared/scanMatch.ts';
import {
  MOTIF_IDS,
  MOTIF_KIND,
  boardMotifSatisfied,
  canonicalMotif,
  parseMotifSpec,
} from '../shared/scanMotif.ts';
import { SCAN_PACK_META, SCAN_PACK_VERSION, encodeScanPack } from '../shared/scanPack.ts';
import { replayMotifHit } from '../server/refgamesScan.ts';
import { KEY_INDEX_META, KEY_INDEX_VERSION } from '../shared/keyIndex.ts';
import {
  KEY_INDEX_SCHEMA,
  PLIES_SCHEMA,
  REFGAMES_MOVE_COUNTS,
  REFGAMES_TOP_GAMES,
  REF_MAX_PLY,
  SCAN_PACK_SCHEMA,
  eloBucket,
  finalMen,
  resultCode,
} from '../server/refgamesIndex.ts';
import { REFGAMES_GAMES_SCHEMA, REFGAMES_INDEXES, REFGAMES_LOOKUPS } from '../scripts/lib/db-tuning.ts';
import { DEEP_SEARCH_CAP } from '../server/refgames.ts';

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
  /** The packed scan-index blob (shared/scanPack.ts), hex — pinned to
      the byte because whichever side scans reads what the other wrote. */
  pack: string;
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
    pack: Buffer.from(encodeScanPack(moves)).toString('hex'),
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

// The motif corpus, AFTER the self-play so the rows above keep their
// seeded draws (an insertion earlier would re-roll every later Elo and
// turn an additive change into a 54-row diff): self-play may never
// castle to opposite wings or leave an isolani standing, so the motif
// replay's positive answers come from these. Their plies are pinned in
// server/refgamesScan.test.ts.
const MOTIF_CORPUS: { why: string; moves: string; result: string }[] = [
  {
    why: 'opposite-side castling, white O-O at ply 6 and black O-O-O at ply 13',
    moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 O-O d6 d3 Bg4 Nc3 Qd7 Be3 O-O-O a4 Nf6',
    result: '1-0',
  },
  {
    why: 'a king walk forfeits the rights — the motif replay stops early',
    moves: 'e4 e5 Ke2 Nf6 Ke1 Bc5 Nf3 O-O d3 d6 Nc3 Bg4',
    result: '0-1',
  },
  {
    why: 'a Tarrasch isolani arising at ply 19 and resolving at ply 22',
    moves: 'd4 d5 c4 e6 Nc3 c5 cxd5 exd5 Nf3 Nc6 g3 Nf6 Bg2 Be7 O-O O-O Bg5 cxd4 Nxd4 h6 Nxc6 bxc6',
    result: '1/2-1/2',
  },
  {
    why: 'an exchange French leaving white an isolani from ply 8 to the end',
    moves: 'e4 e6 d4 d5 exd5 exd5 c4 dxc4 Bxc4 Nf6 Nf3 Be7 O-O O-O Nc3 Nc6 Re1 Bg4',
    result: '1-0',
  },
  {
    why: 'the Greek gift, 7.Bxh7+ at ply 12',
    moves: 'e4 e6 d4 d5 Nc3 Nf6 Bd3 Be7 Nf3 O-O e5 Nfd7 Bxh7+ Kxh7 Ng5+ Kg8 Qh5',
    result: '1-0',
  },
  {
    why: "Black's Greek gift, 8...Bxh2+ at ply 15",
    moves: 'd4 d5 Nf3 Nf6 e3 e6 Bd3 Bd6 O-O O-O Nbd2 Nbd7 c4 dxc4 Nxc4 Bxh2+ Nxh2 Ng4',
    result: '0-1',
  },
  {
    why: 'Bxh7 without check (the king on f8) is no gift',
    moves: 'e4 e6 d4 d5 Nc3 Nf6 Bd3 Be7 Nf3 Kf8 e5 Nfd7 Bxh7 g6',
    result: '1/2-1/2',
  },
  {
    why: "rooks on the seventh: Black's at ply 8, White's at ply 9",
    moves: 'h4 a5 Rh3 Ra6 Ra3 Rb6 Rxa5 Rxb2 Ra7',
    result: '1/2-1/2',
  },
  {
    why: 'passed pawns for both, doubled for both, in eight plies',
    moves: 'a4 h5 a5 h4 a6 h3 axb7 hxg2',
    result: '1/2-1/2',
  },
  {
    why: 'double fianchettos on both sides',
    moves: 'Nf3 Nf6 g3 g6 Bg2 Bg7 b3 b6 Bb2 Bb7',
    result: '1/2-1/2',
  },
  {
    why: 'the Sveshnikov knight on its d5 outpost at ply 15',
    moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 e5 Nb5 d6 N1c3 a6 Na3 b5 Nd5',
    result: '1-0',
  },
  {
    why: "the Exchange Ruy doubling Black's c-pawns at ply 8",
    moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6',
    result: '1/2-1/2',
  },
];
for (const { why, moves, result } of MOTIF_CORPUS) {
  const golden = replayGolden(why, moves, result, 1000 + randInt(2000), 1000 + randInt(2000));
  if (golden.plies.length !== moves.split(' ').length) {
    throw new Error(`motif corpus game did not replay whole: ${moves}`);
  }
  games.push(golden);
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

// parity-extra.pgn — a second corpus for append parity: build parity.pgn,
// append this, and the result must diff clean against the same sequence
// run by the other pipeline (and against a fresh build of both files).
// Generated after parity.pgn so adding it changed no earlier bytes.
const extraGames: string[] = [];
for (const golden of games.slice(30, 42)) {
  extraGames.push(pgnGame(parityHeaders(golden.result, parityIndex), golden.moves, golden.result));
}

// ---------------------------------------------------------------------------
// Relaxation-ladder signatures and material predicates — pins for
// native/src/scan_match.rs against shared/scanMatch.ts, over the same
// FEN spread the key goldens use. The canonical strings below are ALSO
// the exact argv the server hands the binary, so the Rust parse is
// proven against real input, not a re-derivation.

const boardOf = (fen: string) => parseFen(fen).unwrap().board;

const signatures = FENS.map(({ fen, why }) => ({
  fen,
  why,
  pawns: matchSignature(boardOf(fen), 'pawns'),
  files: matchSignature(boardOf(fen), 'files'),
  material: matchSignature(boardOf(fen), 'material'),
  structure: matchSignature(boardOf(fen), 'structure'),
}));

const MATERIAL_SPECS: { why: string; raw: string }[] = [
  {
    why: 'pure rook ending',
    raw: '{"white":{"r":[1,1],"n":[0,0],"b":[0,0],"q":[0,0]},"black":{"r":[1,1],"n":[0,0],"b":[0,0],"q":[0,0]}}',
  },
  { why: 'queens still on, equal', raw: '{"white":{"q":[1,9]},"diff":{"q":[0,0]}}' },
  {
    why: 'minor-for-rook imbalance',
    raw: '{"diff":{"minor":[1,10],"major":[-10,-1]},"stable":4}',
  },
  {
    why: 'every field constrained at once',
    raw: '{"white":{"p":[0,8],"n":[0,2],"b":[1,2],"r":[0,2],"q":[0,1]},"black":{"p":[2,8],"n":[0,2],"b":[0,2],"r":[1,2],"q":[0,1]},"diff":{"p":[-3,3],"n":[-1,1],"b":[-1,1],"r":[0,0],"q":[0,0],"minor":[-2,2],"major":[-1,1]},"stable":2}',
  },
  { why: 'sparse endgame pawn floor', raw: '{"white":{"p":[1,1],"q":[0,0],"r":[0,0],"n":[0,0],"b":[0,0]}}' },
];

const materialSpecs = MATERIAL_SPECS.map(({ why, raw }) => {
  const spec = parseMaterialSpec(raw);
  if (!spec) throw new Error(`golden material spec did not parse: ${raw}`);
  return {
    why,
    canonical: canonicalMaterial(spec),
    bounds: materialMenBounds(spec),
    cases: FENS.map(({ fen }) => ({ fen, satisfied: materialSatisfied(boardOf(fen), spec) })),
  };
});
// Fixtures that never both answer are fixtures testing nothing.
if (!materialSpecs.some((s) => s.cases.some((c) => c.satisfied) && s.cases.some((c) => !c.satisfied))) {
  throw new Error('no material spec splits the FEN set — the predicate goldens are inert');
}

// The canned motifs — pins for native/src/scan_motif.rs (the IQP
// predicate, over the key FENs plus IQP positions of both colours) and
// for deep.rs's find_motif_hit (every game above, the handcrafted
// motif corpus included, per spec). The canonical strings are the
// exact argv the server hands the binary.
const MOTIF_FENS = [
  ...FENS.map(({ fen }) => fen),
  'r1bq1rk1/pp2bppp/2n2n2/8/3P4/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1', // white IQP
  'r1bq1rk1/pp3ppp/2n2n2/3p4/8/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1', // black IQP
  'r1bq1rk1/pp3ppp/2n2n2/3p4/3P4/2N2N2/PP3PPP/R1BQ1RK1 w - - 0 1', // symmetrical isolanis
  'r1bq1rk1/pp2bppp/2n2n2/8/3P4/2P2N2/P4PPP/R1BQ1RK1 w - - 0 1', // d4 with c3 beside it
  '8/5k2/8/3b4/8/2B5/5K2/8 w - - 0 1', // opposite bishops, c3 against d5
  '8/5k2/8/2b5/8/2B5/5K2/8 w - - 0 1', // same-coloured bishops
  'r7/5k2/8/3b4/8/2B5/5K2/8 w - - 0 1', // a rook spoils the bishop ending
  '6k1/R7/8/8/8/8/r7/6K1 w - - 0 1', // both rooks on their seventh
  '6k1/r7/8/8/8/8/8/6K1 w - - 0 1', // a black rook on White's seventh
  '4k3/8/8/3P4/4p3/8/8/4K3 w - - 0 1', // white passed, black not
  '4k3/8/3p4/3P4/8/8/8/4K3 w - - 0 1', // blocked, neither passed
  '4k3/8/8/3N4/2P5/8/8/4K3 w - - 0 1', // a supported outpost on d5
  '4k3/2p5/8/3N4/2P5/8/8/4K3 w - - 0 1', // the c-pawn could chase it
  '4k3/8/8/8/3N4/2P5/8/4K3 w - - 0 1', // too far back for an outpost
  '4k3/6b1/6p1/8/8/6P1/6B1/4K3 w - - 0 1', // fianchettos both sides
  '4k3/8/8/8/8/8/6B1/4K3 w - - 0 1', // the bishop without its pawn
  '4k3/3p4/3p4/8/3P4/3P4/8/4K3 w - - 0 1', // doubled pawns both sides
];
// One spec per motif, plus the sided and held shapes the UI sends.
const MOTIF_SPECS: { why: string; raw: string }[] = [
  ...MOTIF_IDS.map((id) => ({ why: `${id}, either side, any moment`, raw: JSON.stringify({ id }) })),
  { why: "white's IQP held four moves", raw: '{"id":"iqp","side":"white","stable":8}' },
  { why: "black's IQP held three plies", raw: '{"id":"iqp","side":"black","stable":3}' },
  { why: "black's Greek gift", raw: '{"id":"greek-gift","side":"black"}' },
  { why: "white's passed pawn held two plies", raw: '{"id":"passed-pawn","side":"white","stable":2}' },
  { why: "black's rook on the seventh", raw: '{"id":"rook-on-seventh","side":"black"}' },
  { why: 'opposite-side castling, the game going on three plies', raw: '{"id":"opposite-castling","stable":3}' },
];
const motifSpecs = MOTIF_SPECS.map(({ why, raw }) => {
  const spec = parseMotifSpec(raw);
  if (!spec) throw new Error(`golden motif spec did not parse: ${raw}`);
  return {
    why,
    canonical: canonicalMotif(spec),
    // The board predicate per position, for the board kinds; the
    // castling and move kinds have no per-position truth to pin.
    cases:
      MOTIF_KIND[spec.id] === 'board'
        ? MOTIF_FENS.map((fen) => ({
            fen,
            satisfied: boardMotifSatisfied(boardOf(fen), spec.id, spec.side),
          }))
        : [],
    hits: games.map((game) => replayMotifHit(game.moves, spec)),
  };
});
for (const spec of motifSpecs) {
  // Fixtures that never both answer are fixtures testing nothing: a
  // board motif must split the FEN set, and every motif must split the
  // game set — except the opposite-bishops ending, which no hand-written
  // opening reaches in thirty plies; its FEN cases carry the positive
  // side, and its all-null hits still hold the replay to the same
  // answer.
  const hitsSplit = spec.hits.some((h) => h !== null) && spec.hits.some((h) => h === null);
  const casesSplit = spec.cases.some((c) => c.satisfied) && spec.cases.some((c) => !c.satisfied);
  if (spec.cases.length > 0 && !casesSplit) {
    throw new Error(`motif spec "${spec.why}" never splits the FEN set — its predicate goldens are inert`);
  }
  if (!hitsSplit && !spec.why.startsWith('opposite-bishops')) {
    throw new Error(`motif spec "${spec.why}" never splits the game set — its replay goldens are inert`);
  }
}

// ---------------------------------------------------------------------------

// The text the two pipelines share by copying, not by computing: the
// SQL every table is created with, and the constants both sides carry
// as literals. `native/src/sql.rs` mirrors the strings by hand and the
// whole-file diff cannot see an index or a lookup table it lacks — that
// is how it fell behind db-tuning.ts twice — so the Rust tests compare
// each constant to the text here, whitespace collapsed. Each key names
// the Rust constant it is held against.
const sql = {
  /** sql::GAMES_SCHEMA */
  gamesSchema: REFGAMES_GAMES_SCHEMA,
  /** sql::PLIES_TABLE followed by sql::PLIES_INDEX — the TS side keeps
      them in one string, the Rust side runs the index after the fill. */
  pliesSchema: PLIES_SCHEMA,
  /** sql::SCAN_PACK_TABLE */
  scanPackSchema: SCAN_PACK_SCHEMA,
  /** sql::KEY_INDEX_TABLE */
  keyIndexSchema: KEY_INDEX_SCHEMA,
  /** sql::MOVE_COUNTS — MOVE_COUNT_MIN_GAMES is interpolated, so it
      rides along. */
  moveCounts: REFGAMES_MOVE_COUNTS,
  /** sql::TOP_GAMES_TABLE followed by sql::TOP_GAMES_INDEX —
      TOP_GAMES_MIN_GAMES is interpolated, so it rides along. */
  topGames: REFGAMES_TOP_GAMES,
  /** sql::REFGAMES_INDEXES */
  refgamesIndexes: REFGAMES_INDEXES,
  /** sql::REFGAMES_LOOKUPS */
  refgamesLookups: REFGAMES_LOOKUPS,
};
const constants = {
  scanPackVersion: SCAN_PACK_VERSION,
  scanPackMeta: SCAN_PACK_META,
  keyIndexVersion: KEY_INDEX_VERSION,
  keyIndexMeta: KEY_INDEX_META,
  deepSearchCap: DEEP_SEARCH_CAP,
};

const goldens = {
  schema: 5,
  generator: 'scripts/export-native-goldens.ts',
  refMaxPly: REF_MAX_PLY,
  fens,
  results,
  elos,
  finalMen: menCases,
  games,
  signatures,
  materialSpecs,
  motifSpecs,
  /** Every motif id, so the crate's SUPPORTED_SCAN is held to this list
      — a motif added here without its `motif:<id>` token there would
      silently stay on the JS path forever. */
  motifIds: [...MOTIF_IDS],
  sql,
  constants,
};

/**
 * Write a fixture and say what moved. Regenerating records the JS side's
 * CURRENT behaviour, so a run that changes a committed fixture is a
 * behaviour change on the JS side — one to be named in the commit, not
 * discovered in its diff — and a run that changes nothing is the proof
 * that a refactor was neutral. Per top-level section for the JSON, so
 * the report says WHICH contract moved (keys, packs, SQL…) rather than
 * that a 400 KB file differs somewhere.
 */
function writeReporting(name: string, next: string): void {
  const path = resolve(OUT_DIR, name);
  const previous = existsSync(path) ? readFileSync(path, 'utf-8') : null;
  writeFileSync(path, next);
  if (previous === null) {
    console.log(`  ${name}: new`);
    return;
  }
  if (previous === next) {
    console.log(`  ${name}: unchanged`);
    return;
  }
  if (!name.endsWith('.json')) {
    console.log(`  ${name}: CHANGED`);
    return;
  }
  const before = JSON.parse(previous) as Record<string, unknown>;
  const after = JSON.parse(next) as Record<string, unknown>;
  const moved: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      const differing = b.filter((entry, i) => JSON.stringify(entry) !== JSON.stringify(a[i])).length;
      moved.push(`${key} (${differing + Math.max(0, a.length - b.length)} of ${b.length} entries)`);
    } else if (a === undefined) {
      moved.push(`${key} (new)`);
    } else if (b === undefined) {
      moved.push(`${key} (removed)`);
    } else {
      moved.push(key);
    }
  }
  console.log(`  ${name}: CHANGED — ${moved.join(', ')}`);
}

const totalPlies = games.reduce((n, g) => n + g.plies.length, 0);
console.log(
  `goldens: ${fens.length} fens, ${games.length} games (${totalPlies} plies), ` +
    `${menCases.length} finalMen cases, ${Object.keys(sql).length} SQL texts → native/tests/`,
);
writeReporting('goldens.json', `${JSON.stringify(goldens, null, 1)}\n`);
writeReporting('parity.pgn', `${pgnGames.join('\n')}`);
writeReporting('parity-extra.pgn', `${extraGames.join('\n')}`);
console.log(
  'A changed fixture is a JS-side behaviour change; it proves nothing about the Rust side\n' +
    'until `npm run test:native` and `npm run fuzz:parity` pass against it.',
);
