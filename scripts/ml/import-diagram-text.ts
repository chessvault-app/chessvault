/**
 * Import a puzzle book whose diagrams are in the PDF's TEXT layer — without
 * reading a single pixel.
 *
 *   python scripts/ml/extract_1001_text.py "<book>.pdf" data/ml/<slug>-text.json
 *   npx tsx scripts/ml/import-diagram-text.ts --book scripts/ml/books/<slug>.json
 *
 * Scanned books need the whole measure/import pipeline: find the diagram on
 * the page, warp it, read it cell by cell with CellNet, and untangle
 * figurine garbage into moves. A book typeset in LaTeX with a diagram font
 * needs none of it, because the text layer already contains every position,
 * one character per square:
 *
 *     80Z0Z0skZ        f8 = s = black rook on a dark square
 *     7Z0Z0Z0Z0        g8 = k = black king on a light square
 *     60Z0Z0ZPZ        g6 = P = white pawn
 *     ...
 *
 * and every solution in plain algebraic ("1.Qh7m"). So the position is not
 * recognised, it is READ — exactly, with no model and no engine — and the
 * only thing left to check is that the printed solution is legal in it,
 * which chessops does. Nothing that fails that check is imported.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeBoardFen, makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import { REPO_ROOT, VAULT } from '../../server/paths.ts';

/**
 * Per-book facts live in scripts/ml/books/*.json, like every other book in
 * this pipeline. Nothing here knows which book it is reading.
 */
const bookAt = process.argv.indexOf('--book');
if (bookAt < 0) throw new Error('usage: import-diagram-text --book scripts/ml/books/<slug>.json');
const BOOK = {
  title: '',
  /** Text dump from extract_1001_text.py. */
  text: '',
  /** Heading that opens the answers chapter, as it appears in the text. */
  solutionsHeading: 'Solutions',
  /** Highest puzzle number the book prints. */
  maxNumber: 9999,
  /** Prefix of the repeated page header, to keep it out of the answers. */
  runningHead: '',
  ...(JSON.parse(readFileSync(process.argv[bookAt + 1]!, 'utf-8')) as object),
} as {
  title: string;
  text: string;
  solutionsHeading: string;
  maxNumber: number;
  runningHead: string;
};
BOOK.runningHead ||= BOOK.title.slice(0, 14);
if (!BOOK.title || !BOOK.text) throw new Error('book config needs a title and a text dump');

/**
 * The LaTeX chess diagram fonts (skak, chessfss and friends) give every
 * piece two glyphs, one for a light square and one for a dark one, so that
 * the board's checkering is part of the character stream. Empty squares are
 * `0` (light) and `Z` (dark). This is a property of the FONT, so it is the
 * same for every book typeset with it.
 */
const GLYPHS: Record<string, string> = {
  K: 'K', J: 'K', Q: 'Q', L: 'Q', R: 'R', S: 'R',
  B: 'B', A: 'B', N: 'N', M: 'N', P: 'P', O: 'P',
  k: 'k', j: 'k', q: 'q', l: 'q', r: 'r', s: 'r',
  b: 'b', a: 'b', n: 'n', m: 'n', p: 'p', o: 'p',
  '0': '', Z: '',
};

interface Page {
  page: number;
  text: string;
}

const { pages } = JSON.parse(readFileSync(resolve(REPO_ROOT, BOOK.text), 'utf-8')) as {
  pages: Page[];
};

// --- diagrams -----------------------------------------------------------------

const ROW = /^([1-8])([KJQLRSBANMPOkjqlrsbanmpo0Z]{8})$/;

interface Diagram {
  number: number;
  board: string;
  page: number;
}

function readDiagrams(): Diagram[] {
  const out: Diagram[] = [];
  for (const page of pages) {
    const lines = page.text.split('\n').map((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const label = /^(\d{1,4})$/.exec(lines[i]!);
      if (!label) continue;
      const ranks: string[] = [];
      for (let r = 0; r < 8; r++) {
        const row = ROW.exec(lines[i + 1 + r] ?? '');
        // Ranks print top down, 8 to 1 — anything else is not a diagram.
        if (!row || Number(row[1]) !== 8 - r) break;
        ranks.push(row[2]!);
      }
      if (ranks.length !== 8) continue;
      const board = ranks
        .map((rank) => {
          let fen = '';
          let empty = 0;
          for (const ch of rank) {
            const piece = GLYPHS[ch];
            if (piece === undefined) return null;
            if (piece === '') empty++;
            else {
              if (empty) fen += String(empty);
              empty = 0;
              fen += piece;
            }
          }
          return empty ? fen + String(empty) : fen;
        })
        .join('/');
      if (board.includes('null')) continue;
      out.push({ number: Number(label[1]), board, page: page.page });
      i += 8;
    }
  }
  return out;
}

// --- solutions ----------------------------------------------------------------

/**
 * The book writes captures with a capital X, mate with a trailing m, and
 * promotions without the `=`. Everything else is ordinary algebraic.
 */
function normaliseSan(token: string): string {
  return token
    .replace(/X/g, 'x')
    // Move-quality marks belong to the prose, not the move. The miniature
    // games annotate their finishes ("17.Nf6! KXf6 18.Nh5+!"), so leaving
    // these on made the SAN filter below throw the finish away — which is
    // exactly the part of those entries that is the puzzle.
    .replace(/[!?]+/g, '')
    .replace(/m$/, '#')
    .replace(/([a-h][18])([QRBN])/, '$1=$2')
    .replace(/0-0-0/, 'O-O-O')
    .replace(/0-0/, 'O-O');
}

/** What a move can look like once the book's spellings are normalised. */
const SAN = /^(O-O(-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?)[+#]?$/;

/** Game results print with any dash the typesetter felt like. */
const RESULT = /^(1[-–—]0|0[-–—]1|1\/2|½)/;

/** The book gives alternatives in brackets; only the main line is the answer. */
function stripVariations(text: string): string {
  let depth = 0;
  let out = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

interface Solution {
  /** The entry's own line — right for the thousands of short answers. */
  moves: string[];
  /** Everything up to the next entry — a miniature game runs on for lines. */
  full: string[];
  black: boolean;
  page: number;
}

function readSolutions(): Map<number, Solution> {
  const out = new Map<number, Solution>();
  const start = pages.findIndex((p) => p.text.includes(BOOK.solutionsHeading));
  if (start < 0) throw new Error(`no page contains the heading ${JSON.stringify(BOOK.solutionsHeading)}`);
  // A whole miniature game does not fit on one line, so an entry runs from
  // its own "<number> 1." anchor to the next one.
  // The running title, the section number and the page number repeat on
  // every page of the answers and belong to none of them.
  const isRunningHead = (text: string): boolean =>
    text.startsWith(BOOK.runningHead) || /^\d+(\.\d+)+\b/.test(text) || /^\d+$/.test(text);

  let open: { number: number; page: number; body: string[] } | null = null;
  const tokens = (body: string): string[] =>
    stripVariations(body)
      .split(/\s+/)
      .map((t) => t.replace(/^\d{1,3}\.(\.\.)?/, ''))
      .filter((t) => t && !RESULT.test(t))
      .map(normaliseSan)
      // Entries carry the players and the venue as well, and a solutions
      // page hands them over in whatever order it typeset them. Only
      // move-shaped tokens survive; the replay then decides the rest.
      .filter((t) => SAN.test(t));

  const close = (): void => {
    if (!open) return;
    const moves = tokens(open.body[0]!);
    const full = tokens(open.body.join(' '));
    if (moves.length > 0 && !out.has(open.number)) {
      out.set(open.number, {
        moves,
        full,
        black: /^1\s*\.\s*\.\s*\./.test(open.body[0]!),
        page: open.page,
      });
    }
    open = null;
  };

  for (const page of pages.slice(start)) {
    for (const line of page.text.split('\n')) {
      const text = line.trim();
      if (!text) continue;
      const anchor = /^(\d{1,4})\s+(1\s*\.\s*\S.*)$/.exec(text);
      if (anchor) {
        close();
        open = { number: Number(anchor[1]), page: page.page, body: [anchor[2]!] };
      } else if (open && !isRunningHead(text)) {
        // A line break can fall inside a move ("O-" / "O"), so a trailing
        // hyphen means the next line continues the same token.
        const last = open.body.length - 1;
        if (open.body[last]!.endsWith('-')) open.body[last] += text;
        else open.body.push(text);
      }
    }
    close(); // page headers must not join two entries across a page break
  }
  return out;
}

// --- match, replay, write -----------------------------------------------------

const diagrams = readDiagrams();
const solutions = readSolutions();
console.log(`${diagrams.length} diagrams, ${solutions.size} solutions read from the text layer`);

interface Puzzle {
  id: string;
  fen: string;
  uci: string[];
  san: string[];
  added: string;
  number: number;
  provenance: 'book-parsed';
  evidence?: { solutionPage: string };
}

interface Line {
  fen: string;
  uci: string[];
  san: string[];
  end: Chess;
}

/** Replay a line in a position, or null if any move is not legal there. */
function play(pos: Chess, moves: string[], from = makeFen(pos.toSetup())): Line | null {
  const uci: string[] = [];
  const san: string[] = [];
  for (const move of moves) {
    const parsed = parseSan(pos, move);
    if (!parsed) return null;
    uci.push(makeUci(parsed));
    san.push(makeSanAndPlay(pos, parsed));
  }
  return san.length > 0 ? { fen: from, uci, san, end: pos } : null;
}

/** Replay as much of a line as is legal, keeping whatever worked. */
function playLongest(pos: Chess, moves: string[], from = makeFen(pos.toSetup())): Line | null {
  const uci: string[] = [];
  const san: string[] = [];
  for (const move of moves) {
    const parsed = parseSan(pos, move);
    if (!parsed) break;
    uci.push(makeUci(parsed));
    san.push(makeSanAndPlay(pos, parsed));
  }
  return san.length > 0 ? { fen: from, uci, san, end: pos } : null;
}

/**
 * The last chapter is 600 miniature GAMES: the answer prints the whole game
 * from move one, while the diagram shows the position where the finish
 * begins. So replay the game from the start, find the printed position in
 * it, and the moves after that point are the puzzle — which also proves the
 * diagram and the game belong together.
 *
 * The tail is taken for as far as it stays legal rather than all-or-nothing.
 * Those entries print in two columns and the odd one runs into its
 * neighbour's text, so demanding the whole tail threw away games whose
 * position and finish were both perfectly readable. Every move kept is
 * still legality-checked; a short tail is a shorter puzzle, not a wrong one.
 */
function fromWholeGame(board: string, moves: string[]): Line | null {
  const pos = Chess.default();
  for (const [index, move] of moves.entries()) {
    const parsed = parseSan(pos, move);
    if (!parsed) return null;
    pos.play(parsed);
    if (makeBoardFen(pos.board) !== board) continue;
    return playLongest(pos.clone(), moves.slice(index + 1));
  }
  return null;
}

/**
 * Why an entry could not be used, for the run's own report. The answer is
 * always about the TEXT, never the position — the diagrams are exact.
 */
function whyNot(board: string, moves: string[]): string {
  const pos = Chess.default();
  let played = 0;
  let found = false;
  for (const move of moves) {
    const parsed = parseSan(pos, move);
    if (!parsed) break;
    pos.play(parsed);
    played++;
    if (makeBoardFen(pos.board) === board) found = true;
  }
  if (found) return 'the diagram is in the game text but nothing after it is legal';
  if (played === moves.length) return 'the game text stops before reaching the diagram';
  return 'the game text goes illegal before reaching the diagram';
}

/**
 * A printed diagram says nothing about castling rights, so positions are
 * built with none — but if the printed solution castles, the right plainly
 * existed. Grant only what the board itself still supports: king and rook
 * both untouched on their home squares.
 */
function castlingRights(board: string, moves: string[]): string {
  const wants = moves.some((m) => m.startsWith('O-O'));
  if (!wants) return '-';
  const setup = parseFen(`${board} w - - 0 1`);
  if (setup.isErr) return '-';
  const at = (square: string): string => {
    const files = 'abcdefgh';
    const file = files.indexOf(square[0]!);
    const rank = Number(square[1]) - 1;
    const piece = setup.unwrap().board.get(rank * 8 + file);
    if (!piece) return '';
    const letter = { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' }[piece.role];
    return piece.color === 'white' ? letter.toUpperCase() : letter;
  };
  let rights = '';
  if (at('e1') === 'K') {
    if (at('h1') === 'R') rights += 'K';
    if (at('a1') === 'R') rights += 'Q';
  }
  if (at('e8') === 'k') {
    if (at('h8') === 'r') rights += 'k';
    if (at('a8') === 'r') rights += 'q';
  }
  return rights || '-';
}

const added = new Date().toISOString();
const puzzles: Puzzle[] = [];
/**
 * This book writes no drafts. A draft exists so a human can re-read a
 * board the importer could not — but here every position is exact and it
 * is only some SOLUTIONS that fail to parse, which no amount of looking at
 * the diagram fixes. Those entries are reported instead, and a later run
 * of a better parser picks them up in place: ids are `n<number>`.
 */
const unresolved: number[] = [];
const reasons = new Map<string, number>();
const note = (why: string): void => {
  reasons.set(why, (reasons.get(why) ?? 0) + 1);
};

const seen = new Set<number>();
for (const diagram of diagrams) {
  if (seen.has(diagram.number)) continue;
  seen.add(diagram.number);
  const solution = solutions.get(diagram.number);
  const evidence = solution ? { solutionPage: `page${String(solution.page).padStart(4, '0')}.jpg` } : undefined;

  // Castling rights are not printed on a diagram, so claim none: a solution
  // that needs to castle will fail replay and be kept as a draft rather
  // than imported with rights nobody stated.
  const rights = solution ? castlingRights(diagram.board, solution.full) : '-';
  const fen = `${diagram.board} ${solution?.black ? 'b' : 'w'} ${rights} - 0 1`;
  const setup = parseFen(fen);
  if (setup.isErr) {
    note('unreadable position');
    continue;
  }
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) {
    note(`illegal position (${position.error.message})`);
    continue;
  }
  if (!solution) {
    note('no printed solution');
    unresolved.push(diagram.number);
    continue;
  }

  // Three readings, in order of how much they assume: the entry's own line
  // played in the printed position; the whole entry played there (answers
  // that wrap); and the whole entry played from the start of a game, with
  // the printed position located inside it (the miniature games).
  // `play` advances the position it is given, so each attempt gets its own.
  const printed = position.unwrap();
  // The other side to move, for entries whose "1." / "1..." disagrees with
  // the diagram. Only a line that replays is kept either way, so trying
  // both costs nothing and asserts nothing.
  const flipped = Chess.fromSetup(
    parseFen(`${diagram.board} ${solution.black ? 'w' : 'b'} ${rights} - 0 1`).unwrap(),
  );
  const line =
    play(printed.clone(), solution.moves, fen) ??
    play(printed.clone(), solution.full, fen) ??
    (flipped.isOk
      ? (play(flipped.unwrap().clone(), solution.moves, makeFen(flipped.unwrap().toSetup())) ??
        play(flipped.unwrap().clone(), solution.full, makeFen(flipped.unwrap().toSetup())))
      : null) ??
    fromWholeGame(diagram.board, solution.full);
  if (!line) {
    note(`solution does not replay — ${whyNot(diagram.board, solution.full)}`);
    unresolved.push(diagram.number);
    continue;
  }
  // A printed mate must really be mate — the strongest check available, and
  // most of this book is mates.
  if (line.san.at(-1)!.endsWith('#') && !line.end.isCheckmate()) {
    note('claimed mate is not mate');
    unresolved.push(diagram.number);
    continue;
  }
  puzzles.push({
    id: `n${diagram.number}`,
    fen: line.fen,
    uci: line.uci,
    san: line.san,
    added,
    number: diagram.number,
    provenance: 'book-parsed',
    ...(evidence ? { evidence } : {}),
  });
}

puzzles.sort((a, b) => a.number - b.number);
unresolved.sort((a, b) => a - b);

const dir = resolve(VAULT, 'puzzlebooks', BOOK.title);
mkdirSync(resolve(dir, 'diagrams'), { recursive: true });
const write = (name: string, value: unknown): void =>
  writeFileSync(resolve(dir, name), `${JSON.stringify(value, null, 1)}\n`);
write('puzzles.json', puzzles);
write('drafts.json', []);
write('book.json', { title: BOOK.title, createdAt: added });

console.log(`\nimported ${puzzles.length} of ${diagrams.length} puzzles -> ${dir}`);
if (unresolved.length > 0) {
  console.log(`  ${unresolved.length} left out; their numbers: ${unresolved.join(' ')}`);
}
for (const [why, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(5)}  ${why}`);
}
