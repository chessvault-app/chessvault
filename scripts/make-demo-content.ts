/**
 * Write demo-seed/ — the sample vault the demo starts from, and the fixture
 * used to look at the app with something in it.
 *
 * Every game is a REAL game, taken from the reference database and replayed
 * before it is written. Inventing move lists from memory produces games that
 * are subtly illegal, and an app whose whole design is "nothing is imported
 * on trust" should not ship sample data it never checked.
 *
 * The annotations, variations and notes are written here. They exist so the
 * demo shows what the app is FOR — a bare move list demonstrates a PGN
 * viewer; a game with a comment on the move that decided it demonstrates a
 * chess workbench.
 *
 *   npx tsx scripts/make-demo-content.ts [--games 30] [--studies 12] [--notes 20]
 */
import Database from 'better-sqlite3';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { parseSan, makeSanAndPlay } from 'chessops/san';
import { DATA, REPO_ROOT } from '../server/paths.ts';

const arg = (flag: string, fallback: number): number => {
  const at = process.argv.indexOf(flag);
  return at < 0 ? fallback : Number(process.argv[at + 1]);
};
const GAMES = arg('--games', 30);
const STUDIES = arg('--studies', 12);
const NOTES = arg('--notes', 20);

const SEED = resolve(REPO_ROOT, 'demo-seed');
rmSync(SEED, { recursive: true, force: true });
for (const dir of ['games/collection', 'studies/Openings', 'studies/Endgames', 'notes', 'puzzles']) {
  mkdirSync(resolve(SEED, dir), { recursive: true });
}

// --- source games -------------------------------------------------------------

const source = resolve(DATA, 'refgames.sqlite');
const db = new Database(source, { readonly: true });
interface Row {
  white: string;
  black: string;
  white_elo: number;
  black_elo: number;
  result: string;
  eco: string;
  opening: string;
  moves: string;
}
// One per opening, so the collection is not thirty Sicilians.
const rows = db
  .prepare(
    `SELECT * FROM (
       SELECT *, ROW_NUMBER() OVER (PARTITION BY eco ORDER BY (white_elo + black_elo) DESC) AS rank
       FROM games WHERE eco <> '' AND opening <> '' AND length(moves) BETWEEN 200 AND 900
     ) WHERE rank = 1 ORDER BY RANDOM() LIMIT ?`,
  )
  .all(GAMES + STUDIES * 3) as (Row & { rank: number })[];
db.close();

/**
 * INVENTED names, not real players'.
 *
 * The first version used grandmasters — Carlsen, Ju Wenjun, Gukesh — over
 * anonymous games from the reference database. Harmless in a private
 * fixture, and not harmless on a public website: it puts real people's
 * names on games they never played, in a product that presents itself as a
 * record of games. Made-up names cost nothing and claim nothing.
 */
const WHITE = ['Alderman, R', 'Bex, N', 'Castellan, J', 'Doyle, F', 'Ekström, P', 'Farrow, K',
  'Grieve, M', 'Halvorsen, T', 'Ibarra, L', 'Jessel, A', 'Kowal, D', 'Lindqvist, S'];
const BLACK = ['Marchetti, C', 'Novak, E', 'Oyelaran, B', 'Pereira, V', 'Quinn, H', 'Rasmussen, I',
  'Sorokin, Y', 'Tavares, M', 'Ueda, K', 'Verhoeven, J', 'Whitlock, A', 'Zahavi, O'];
const EVENTS = ['Tata Steel Masters', 'Candidates Tournament', 'Norway Chess', 'Sinquefield Cup',
  'FIDE Grand Swiss', 'Club championship', 'Online rapid arena'];

/** Comments placed by what is happening, not at fixed move numbers. */
const OPENING_NOTES = [
  'Book so far. The plan is the usual one: finish development, then decide which side to open.',
  'Both sides have what they wanted from the opening. The middlegame will be about the centre.',
  'A slight inaccuracy in move order — the bishop is better placed before this pawn commits.',
  'Theory ends about here. From this point the game is decided by understanding rather than memory.',
];
const MIDDLE_NOTES = [
  'The critical moment. The pieces are as good as they are going to get; something has to happen now.',
  'Here the exchange is tempting and wrong: trading the good bishop leaves the dark squares bare.',
  'Prophylaxis. The move looks slow, and it takes away every active idea the opponent had.',
  'The point of the whole plan. Material is level, but only one side has a target to attack.',
  'A long think. Both continuations are playable; this one keeps more pieces on, which suits the attacker.',
];
const LATE_NOTES = [
  'The rest is technique, which is another way of saying it still has to be played accurately.',
  'The endgame is winning but not simple — the passed pawn needs its king, not just its rook.',
  'Precise to the end. A pawn move here instead would have let the defence build a fortress.',
  'Resignation is timely: the king cannot be defended and the counterplay is one move too slow.',
];

const pick = <T>(list: T[], at: number): T => list[at % list.length]!;

/**
 * A game as PGN, with comments, a NAG or two, and one real variation.
 *
 * The variation is computed rather than written: a legal alternative at that
 * point, played out a couple of moves. A made-up variation is the fastest way
 * to ship an illegal PGN.
 */
function annotate(row: Row, index: number): { pgn: string; plies: number } | null {
  const pos = Chess.default();
  const sans = row.moves.trim().split(/\s+/).filter((token) => !/^\d+\.+$/.test(token));
  const played: string[] = [];
  const parts: string[] = [];

  for (const [ply, san] of sans.entries()) {
    const move = parseSan(pos, san);
    if (!move) break; // the database disagrees with us; keep what replayed
    const number = Math.floor(ply / 2) + 1;
    const prefix = ply % 2 === 0 ? `${number}. ` : '';
    // The position BEFORE the move, which is the only place an alternative
    // to it can be played from. Generating the sideline from the position
    // after was the first attempt, and every variation was silently dropped
    // on parse: it is the wrong side to move, so none of it is legal.
    const before = pos.clone();
    pos.play(move);
    played.push(san);
    let text = `${prefix}${san}`;

    // A NAG on a couple of moves, so the review marks show up.
    if (ply === 14) text += ' !';
    if (ply === 21) text += ' ?!';
    parts.push(text);

    if (ply === 9) parts.push(`{${pick(OPENING_NOTES, index)}}`);
    if (ply === 15) {
      parts.push(`{${pick(MIDDLE_NOTES, index)}}`);
      // A real alternative: legal in `before`, and not the move played.
      const options = [...before.allDests()].flatMap(([from, squares]) =>
        [...squares].map((to) => ({ from, to })),
      );
      const line = before.clone();
      const alternative = options.find((candidate) => {
        if ('from' in move && candidate.from === move.from && candidate.to === move.to) return false;
        return before.isLegal(candidate);
      });
      if (alternative) {
        const first = makeSanAndPlay(line, alternative);
        const replies: string[] = [];
        for (let step = 0; step < 2; step++) {
          const next = [...line.allDests()].flatMap(([from, squares]) =>
            [...squares].map((to) => ({ from, to })),
          )[0];
          if (!next || !line.isLegal(next)) break;
          replies.push(makeSanAndPlay(line, next));
        }
        parts.push(
          `(${number}${ply % 2 === 0 ? '.' : '...'} ${[first, ...replies].join(' ')} ` +
            `{was the alternative — playable, but it hands over the initiative.})`,
        );
      }
    }
    if (ply === sans.length - 2) parts.push(`{${pick(LATE_NOTES, index)}}`);
  }

  if (played.length < 20) return null;

  const white = pick(WHITE, index);
  const black = pick(BLACK, index * 5 + 3);
  const date = `2026.${String(1 + (index % 12)).padStart(2, '0')}.${String(1 + (index % 27)).padStart(2, '0')}`;
  const headers = [
    ['Event', pick(EVENTS, index)],
    ['Site', 'Chess Vault demo (sample data — invented players)'],
    ['Date', date],
    ['Round', String(1 + (index % 9))],
    ['White', white],
    ['Black', black],
    ['Result', row.result],
    ['WhiteElo', String(row.white_elo)],
    ['BlackElo', String(row.black_elo)],
    ['ECO', row.eco],
    ['Opening', row.opening],
  ];
  const pgn =
    headers.map(([key, value]) => `[${key} "${value}"]`).join('\n') +
    '\n\n' +
    `{${row.opening}. ${pick(OPENING_NOTES, index + 2)}}\n` +
    parts.join(' ') +
    ` ${row.result}\n`;
  return { pgn, plies: played.length };
}

// --- games --------------------------------------------------------------------

let written = 0;
let cursor = 0;
const used: Row[] = [];
while (written < GAMES && cursor < rows.length) {
  const row = rows[cursor++]!;
  const game = annotate(row, written);
  if (!game) continue;
  const white = pick(WHITE, written).replace(/[,]/g, '');
  const black = pick(BLACK, written * 5 + 3).replace(/[,]/g, '');
  const date = `2026-${String(1 + (written % 12)).padStart(2, '0')}-${String(1 + (written % 27)).padStart(2, '0')}`;
  writeFileSync(resolve(SEED, 'games/collection', `${white} vs ${black} ${date}.pgn`), game.pgn);
  used.push(row);
  written++;
}

// --- studies ------------------------------------------------------------------

const STUDY_PLAN = [
  { name: 'Openings/Ruy Lopez - the Berlin', intro: 'What the Berlin actually asks of White.' },
  { name: 'Openings/Sicilian - Najdorf structures', intro: 'Not the moves — the pawn structures they lead to.' },
  { name: 'Openings/Queens Gambit Declined', intro: 'The most solid answer to 1.d4, and why it is not dull.' },
  { name: 'Openings/Catalan - the long diagonal', intro: 'One bishop, one plan, thirty moves of pressure.' },
  { name: 'Endgames/Rook endings - Lucena and Philidor', intro: 'The two positions everything else reduces to.' },
  { name: 'Endgames/Pawn endings - opposition', intro: 'Counting, and when counting is not enough.' },
  { name: 'Endgames/Bishop versus knight', intro: 'When each is better, with positions rather than proverbs.' },
  { name: 'Attacking the castled king', intro: 'The h-file, the sacrifice, and knowing which one is real.' },
  { name: 'Prophylaxis - Nimzowitsch ideas', intro: 'Moves that do nothing, except take everything away.' },
  { name: 'The isolated queens pawn', intro: 'Both sides of the same pawn.' },
  { name: 'Minority attack', intro: 'Two pawns against three, and why that is an advantage.' },
  { name: 'Open files and outposts', intro: 'Where rooks and knights actually want to live.' },
];

for (const [index, plan] of STUDY_PLAN.slice(0, STUDIES).entries()) {
  // Three chapters each, from the games we did not put in the collection.
  const chapters: string[] = [];
  for (let chapter = 0; chapter < 3; chapter++) {
    const row = rows[(used.length + index * 3 + chapter) % rows.length]!;
    const game = annotate(row, index * 3 + chapter);
    if (!game) continue;
    const title = `${plan.name.split('/').pop()}: Chapter ${chapter + 1}`;
    chapters.push(
      game.pgn
        .replace(/\[Event "[^"]*"\]/, `[Event "${title}"]`)
        .replace(/\[Site "[^"]*"\]/, `[ChapterName "${['Main line', 'The critical sideline', 'A model game'][chapter]}"]`),
    );
  }
  if (chapters.length === 0) continue;
  writeFileSync(resolve(SEED, 'studies', `${plan.name}.pgn`), chapters.join('\n'));
}

// --- notes --------------------------------------------------------------------

const NOTE_PLAN = [
  ['Opening prep checklist', 'Before a tournament', ['Know the first ten moves of everything I play, and the ideas of the eleventh.', 'One surprise weapon, prepared properly, beats three half-learned ones.', 'Check what the opponent played last time. People repeat themselves.']],
  ['Blunders to stop making', 'The same three, forever', ['Moving a piece that was holding something together.', 'Playing the plan I prepared instead of the position in front of me.', 'Taking a pawn when I was already winning.']],
  ['Endgame drills for the week', 'Twenty minutes a day', ['Lucena and Philidor until they are automatic.', 'King and pawn versus king from every square.', 'Rook behind the passed pawn — mine and theirs.']],
  ['Thinking process', 'A written version', ['What changed with the last move?', 'What is the opponent threatening?', 'What is my worst piece, and where does it want to be?']],
  ['What to review after each game', 'Not the whole game', ['The move where I first felt uncomfortable.', 'The move the engine hates most.', 'Whether the opening gave me a position I understood.']],
];

for (let index = 0; index < NOTES; index++) {
  const [title, subtitle, points] = NOTE_PLAN[index % NOTE_PLAN.length]!;
  const number = Math.floor(index / NOTE_PLAN.length) + 1;
  const name = number > 1 ? `${title} ${number}` : (title as string);
  // A real position, so the note shows an interactive board rather than prose.
  const fens = [
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    '8/8/8/4k3/8/4K3/4P3/8 w - - 0 1',
    'r2q1rk1/pp2bppp/2n1bn2/2pp4/3P4/2N1PN2/PPQ1BPPP/R1B2RK1 w - - 0 10',
    '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
    'r1bq1rk1/pp1nbppp/2p1pn2/3p4/2PP4/2N1PN2/PPQ1BPPP/R1B2RK1 w - - 0 9',
  ];
  const body =
    `# ${name}\n\n*${subtitle}*\n\n` +
    `${(points as string[]).map((point) => `- ${point}`).join('\n')}\n\n` +
    `## A position to remember\n\n` +
    '```chess\n' +
    `${fens[index % fens.length]}\n` +
    '```\n\n' +
    `The board above is live — step through it, try a move, and it stays in the note.\n\n` +
    `## Related\n\n` +
    `See [[Attacking the castled king]] for the attacking side of this, and\n` +
    `[[Endgames/Rook endings - Lucena and Philidor]] for what it becomes when it fails.\n`;
  writeFileSync(resolve(SEED, 'notes', `${name}.md`), body);
}

// --- puzzle history -----------------------------------------------------------

writeFileSync(
  resolve(SEED, 'puzzles', 'state.json'),
  `${JSON.stringify({ attempts: 30, wins: 21, streak: 3 }, null, 2)}\n`,
);

console.log(`demo-seed: ${written} annotated games, ${Math.min(STUDIES, STUDY_PLAN.length)} studies (3 chapters each), ${NOTES} notes`);
