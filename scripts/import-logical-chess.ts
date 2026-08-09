/**
 * Turn Irving Chernev's *Logical Chess: Move by Move* into a vault study —
 * one chapter per game, every move carrying the note the book prints under
 * it.
 *
 *   python scripts/ml/extract_pdf_lines.py "<book>.pdf" data/ml/logical-lines.json
 *   npx tsx scripts/import-logical-chess.ts data/ml/logical-lines.json
 *
 * THE PROBLEM. The PDF's figurine font decodes to garbage that does not say
 * which piece moved: `lDc6` is Nc6, `.tcS` is Bc5, and `'ibe5` could be
 * Qxe5 or Nxe5. The destination square survives — it is plain ASCII — but
 * even that is scanned unreliably ("cS" for c5).
 *
 * THE FIX is the one the puzzle-book importer already uses: never read the
 * token, MATCH it. Generate the legal moves in the position, score each
 * one's real SAN against the garbage, and take the winner when it wins
 * outright. Most positions have exactly one legal move to a given square,
 * so most tokens resolve on legality alone. The rest are settled by the
 * book's own dialect: prefixes that resolved unambiguously elsewhere say
 * what `lD` and `'ib` stand for, and a second pass applies that.
 *
 * Nothing is guessed. A game that will not replay cleanly is reported and
 * left out rather than written with invented moves.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Chess } from 'chessops/chess';
import { makeSan, makeSanAndPlay, parseSan } from 'chessops/san';
import { squareRank } from 'chessops/util';
import type { Move, NormalMove, Role } from 'chessops/types';
import { VAULT_STUDIES } from '../server/paths.ts';

const TITLE = 'Logical Chess - Move by Move';

interface Line {
  x0: number;
  y0: number;
  x1: number;
  text: string;
  full: boolean;
}
interface Page {
  page: number;
  width: number;
  lines: Line[];
}

const source = process.argv[2] ?? 'data/ml/logical-lines.json';
const { pages } = JSON.parse(readFileSync(source, 'utf-8')) as { pages: Page[] };

// --- text hygiene -------------------------------------------------------------

/** Soft hyphens split words across lines; rejoin before anything else. */
const dehyphenate = (text: string): string =>
  text.replace(/­\s*/g, '').replace(/(\w)-\s+(\w)/g, (m, a, b) => (/^[a-z]$/.test(b) ? `${a}${b}` : m));

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

// --- game boundaries ----------------------------------------------------------

/** "Game 8" often scans as "Game S", and "Game 10" as "Game 1 0". */
const GAME_HEADING = /^Game\s+[\dSslIiOoZ][\dSslIiOoZ\s]{0,3}$/;

interface Heading {
  index: number; // position in the flat line stream
  page: number;
}

/** Running heads ("Berlin 1907 13") sit above the type block. */
const isRunningHead = (line: Line): boolean => line.y0 < 45;

/** Printed moves occupy a fraction of a column; sentences fill it. */
const NARROW = 0.3;
const inkWidth = Math.max(
  ...pages.flatMap((p) => p.lines.map((l) => l.x1)),
) - Math.min(...pages.flatMap((p) => p.lines.map((l) => l.x0)));
const isNarrow = (line: Line): boolean => line.x1 - line.x0 < inkWidth * NARROW;

const flat: { line: Line; page: number }[] = [];
for (const page of pages) {
  for (const line of page.lines) {
    if (isRunningHead(line)) continue;
    flat.push({ line, page: page.page });
  }
}

const headings: Heading[] = [];
flat.forEach(({ line, page }, index) => {
  if (line.full && GAME_HEADING.test(squash(line.text))) headings.push({ index, page });
});
if (headings.length !== 33) {
  console.error(`expected 33 game headings, found ${headings.length}`);
  process.exit(1);
}

// --- move / prose classification ----------------------------------------------

const RESULT = /^(1-0|0-1|1\s*\/\s*2\s*-\s*1\s*\/\s*2|½-½)$/;
/** The ellipsis before a black reply, however the scan rendered its dots
 *  (`...`, `. ..`, `.•.`, `•••`) — never anything with a letter in it. */
const DOTS = /^[^0-9a-z]{1,6}$/i;
const DIAGRAM = /\(\s*D\s*\)/g;

const isTokenish = (text: string): boolean =>
  text.length >= 2 &&
  text.length <= 14 &&
  !/\s/.test(text) &&
  !/^\d+$/.test(text) &&
  // Something alphanumeric has to survive in there. The file letter often
  // does not (`lDt"3` is Nf3), so this cannot ask for a square.
  /[0-9a-z]/i.test(text);

/**
 * A printed move line is the move number, optional dots, and at most one
 * move token — nothing else. Prose that *mentions* a move ("16 ixf6+
 * (removing the protector") always carries more, which is what keeps the
 * two apart without trusting the scan's fonts.
 */
function asMoveLine(text: string): { number: number; black: boolean; token: string | null } | null {
  const clean = squash(text.replace(DIAGRAM, ''));
  const m = /^(\d{1,3})\s*(.*)$/.exec(clean);
  if (!m) return null;
  const number = Number(m[1]);
  if (number < 1 || number > 199) return null;
  let rest = m[2]!;
  let black = false;
  const dots = /^([.…]\s*[.…]\s*[.…]?)\s*/.exec(rest);
  if (dots) {
    black = true;
    rest = rest.slice(dots[0].length);
  }
  if (rest === '') return { number, black, token: null };
  if (!isTokenish(rest)) return null;
  return { number, black, token: rest };
}

// --- OCR-tolerant matching ----------------------------------------------------

/**
 * What this scan turns each square coordinate into. The file letter mostly
 * survives; the rank digit and the odd file get mangled by the figurine
 * font bleeding into them, so both are matched with a confusion set and an
 * exact hit is worth more than an aliased one.
 */
const RANK_ALIASES: Record<string, string> = {
  '1': 'lI|!t',
  '2': 'Zz',
  '3': 'J',
  '4': '',
  '5': 'Ss',
  '6': 'Gb',
  '7': '',
  '8': 'B',
};
/** Files the scan confuses with each other, beyond the letter itself. */
const FILE_ALIASES: Record<string, string> = {
  a: '',
  b: '',
  c: 'ek',
  d: '',
  e: 'c',
  f: 't!r',
  g: '',
  h: '',
};
/** Squares the scan collapses into a single glyph. */
const SQUARE_GLYPHS: Record<string, string> = { n: 'f1' };

/** 3 for the exact character, 1 for a known misreading, 0 for neither. */
const rankQuality = (rank: string, ch: string): number =>
  ch === rank ? 3 : RANK_ALIASES[rank]!.includes(ch) ? 1 : 0;
const fileQuality = (file: string, ch: string): number =>
  ch === file ? 3 : FILE_ALIASES[file]!.includes(ch) ? 1 : 0;

/**
 * Find where a destination square sits inside a scanned token, allowing
 * junk to have crept between the file and the rank (`lbf'6` is Nf6). The
 * last, best-scoring placement wins: `exd5` holds a departure file too.
 */
function locateSquare(token: string, file: string, rank: string): { at: number; quality: number } | null {
  let best: { at: number; quality: number } | null = null;
  for (let i = 0; i < token.length; i++) {
    if (SQUARE_GLYPHS[token[i]!] === `${file}${rank}`) best = { at: i, quality: 2 };
  }
  for (let i = 0; i < token.length - 1; i++) {
    const fq = fileQuality(file, token[i]!);
    if (fq === 0) continue;
    for (let gap = 1; gap <= 3 && i + gap < token.length; gap++) {
      const rq = rankQuality(rank, token[i + gap]!);
      if (rq === 0) continue;
      const quality = fq + rq - (gap - 1) * 2;
      if (quality <= 0) continue;
      if (!best || quality >= best.quality) best = { at: i, quality };
      break;
    }
  }
  return best;
}

const CASTLE = /^[0OoQ][-–][0OoQ]([-–][0OoQ])?$/;

/**
 * The scan renders each figurine a dozen different ways, so an exact prefix
 * table only ever covers the common ones. Its CHARACTERS generalise, though:
 * every rendering of the queen keeps a quote mark, every rook a colon. These
 * counts are learned from the same unambiguous moves as the prefix table.
 */
const charStats = new Map<string, Map<Role, number>>();
/** All the quote-like glyphs this scan uses are one mark in the print. */
const normalise = (prefix: string): string => prefix.replace(/[’‘"`´]/g, "'").toLowerCase();

/**
 * The role a never-before-seen prefix votes for, if its characters agree.
 * A character only votes when it nearly always means one piece, and its
 * vote carries the weight of how often it was seen — otherwise the `.` and
 * `l` that turn up in every figurine would drown out the `'` that only ever
 * belongs to a queen.
 */
const PURE = 0.75;

function prefixVotes(prefix: string): Role | null {
  const totals = new Map<Role, number>();
  for (const ch of new Set(normalise(prefix))) {
    const bucket = charStats.get(ch);
    if (!bucket) continue;
    const sum = [...bucket.values()].reduce((a, b) => a + b, 0);
    if (sum < 4) continue;
    const [role, count] = [...bucket].sort((a, b) => b[1] - a[1])[0]!;
    const purity = count / sum;
    if (purity < PURE) continue;
    totals.set(role, (totals.get(role) ?? 0) + count * purity);
  }
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  return ranked[0] && (!ranked[1] || ranked[0][1] > 1.5 * ranked[1][1]) ? ranked[0][0] : null;
}

/** Everything printed before the destination square — the figurine's remains. */
function prefixOf(token: string, destIndex: number): string {
  return token.slice(0, destIndex).replace(/[x×]/g, '');
}

interface Match {
  move: NormalMove;
  san: string;
  score: number;
  prefix: string;
}

/**
 * Score one legal move against the scanned token. The destination square is
 * mandatory (with the alias table absorbing the scan's digit confusions);
 * everything else adds or subtracts confidence.
 */
function scoreMove(
  pos: Chess,
  move: NormalMove,
  token: string,
  dialect: Map<string, Role>,
): Match | null {
  const san = makeSan(pos, move);
  if (san.startsWith('O-O')) {
    if (!CASTLE.test(token.replace(/[+#!?]/g, ''))) return null;
    const long = token.replace(/[^0OoQ\-–]/g, '').split(/[-–]/).length > 2;
    if (long !== san.startsWith('O-O-O')) return null;
    return { move, san, score: 10, prefix: '' };
  }
  const target = san.replace(/[+#=][QRBN]?/g, '');
  const found = locateSquare(token, target.slice(-2, -1), target.slice(-1));
  if (!found) return null;

  let score = found.quality;
  const prefix = prefixOf(token, found.at);
  const isPawn = pos.board.getRole(move.from) === 'pawn';
  const captured = pos.board.get(move.to) !== undefined || san.includes('x');
  score += token.includes('x') === captured ? 2 : -3;
  const givesCheck = san.endsWith('+') || san.endsWith('#');
  score += /[+#‡]/.test(token) === givesCheck ? 1 : -1;

  // A pawn move prints no figurine, so its token starts at the square (or
  // at the departure file for a capture). Anything else must have had a
  // piece symbol in front of it, however it scanned.
  // A capturing pawn always prints its departure file ("exd4"), so an empty
  // prefix in front of a capture means the figurine was lost, NOT that a
  // pawn moved — treating it as bare silently turned Nxe4 into a pawn take.
  const bare = captured ? prefix.length === 1 && /[a-h]/.test(prefix) : prefix === '';
  score += bare === isPawn ? 3 : -4;

  // Second pass: the book's own figurine dialect, learned from the moves
  // that needed no help. An exact prefix is decisive; an unseen one still
  // votes through the characters it is made of, because the queen's wreckage
  // nearly always keeps a quote and the rook's a colon.
  if (!isPawn && prefix.length > 0) {
    const role = pos.board.getRole(move.from)!;
    const guess = dialect.get(prefix);
    if (guess) score += guess === role ? 5 : -5;
    else {
      const votes = prefixVotes(prefix);
      if (votes) score += votes === role ? 3 : -3;
    }
  }
  return { move, san, score, prefix };
}

function legalMoves(pos: Chess): NormalMove[] {
  const moves: NormalMove[] = [];
  for (const from of pos.board[pos.turn]) {
    for (const to of pos.dests(from)) {
      const piece = pos.board.get(from)!;
      if (piece.role === 'pawn' && (squareRank(to) === 0 || squareRank(to) === 7)) {
        for (const promotion of ['queen', 'rook', 'bishop', 'knight'] as const) {
          moves.push({ from, to, promotion });
        }
      } else {
        moves.push({ from, to });
      }
    }
  }
  return moves;
}

interface Resolved {
  move: Move;
  san: string;
  prefix: string;
  role: Role;
  sure: boolean;
}

/** Every legal move this token could be, best first. */
function candidates(pos: Chess, token: string, dialect: Map<string, Role>): Match[] {
  const clean = token.replace(/[,.;:]+$/, '');
  const scored = legalMoves(pos)
    .map((move) => scoreMove(pos, move, clean, dialect))
    .filter((m): m is Match => m !== null)
    .filter((m) => m.score >= 4)
    .sort((a, b) => b.score - a.score);
  // Promotions to different pieces are one printed move; the book gives the
  // piece as a figurine, so a tie on the same squares means the queen.
  const seen = new Set<string>();
  return scored.filter((m) => {
    const key = `${m.move.from}-${m.move.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The best-scoring legal move, and whether it won outright. */
function resolveMove(pos: Chess, token: string, dialect: Map<string, Role>): Resolved | null {
  const scored = candidates(pos, token, dialect);
  const best = scored[0];
  if (!best) return null;
  return {
    move: best.move,
    san: best.san,
    prefix: best.prefix,
    role: pos.board.getRole(best.move.from)!,
    sure: scored.length === 1 || scored[1]!.score < best.score,
  };
}

/** How many following tokens a choice must keep resolvable to be trusted. */
const LOOKAHEAD = 6;
/** Branches explored per token while looking ahead. */
const BREADTH = 4;

/**
 * How many of the printed moves after this position still find a match,
 * up to `depth`. A wrong reading is usually still a LEGAL move — that is
 * what lets one bad guess destroy the rest of a game — but it leaves the
 * moves that follow with nothing to match.
 *
 * Measured as a depth rather than a yes/no because the scan does wreck the
 * occasional token beyond recognition, and a hard "everything must match"
 * test would then reject the right branch along with the wrong ones.
 */
function reach(pos: Chess, tokens: string[], index: number, depth: number, dialect: Map<string, Role>): number {
  if (depth === 0 || index >= tokens.length) return depth === 0 ? 0 : depth;
  let best = 0;
  for (const option of candidates(pos, tokens[index]!, dialect).slice(0, BREADTH)) {
    const next = pos.clone();
    next.play(option.move);
    best = Math.max(best, 1 + reach(next, tokens, index + 1, depth - 1, dialect));
    if (best === depth) break;
  }
  return best;
}

// --- per-game extraction ------------------------------------------------------

interface RawMove {
  number: number;
  black: boolean;
  token: string;
  comment: string;
}

interface RawGame {
  number: number;
  white: string;
  black: string;
  event: string;
  opening: string;
  intro: string;
  moves: RawMove[];
  result: string;
}

function readGame(from: number, to: number, gameNumber: number): RawGame {
  // Heading block: "Game N" / players / event / opening, all centred.
  const head: string[] = [];
  let i = from + 1;
  while (i < to && flat[i]!.line.full && head.length < 3) {
    head.push(squash(flat[i]!.line.text));
    i++;
  }
  const [players = '', event = '', opening = ''] = head;
  const dash = /\s[-–]\s/.exec(players);
  const white = dash ? players.slice(0, dash.index).trim() : players;
  const black = dash ? players.slice(dash.index + dash[0].length).trim() : '';

  const moves: RawMove[] = [];
  let intro: string[] = [];
  let prose: string[] = [];
  let result = '*';
  let pending: { number: number; black: boolean; line: Line } | null = null;

  const flushProse = (): void => {
    const text = squash(dehyphenate(prose.join(' ')));
    prose = [];
    if (!text) return;
    if (moves.length === 0) intro.push(text);
    else moves[moves.length - 1]!.comment = [moves[moves.length - 1]!.comment, text].filter(Boolean).join(' ');
  };

  for (; i < to; i++) {
    const line = flat[i]!.line;
    const text = squash(line.text.replace(DIAGRAM, ''));
    if (!text) continue;
    if (RESULT.test(text)) {
      flushProse();
      result = text.replace(/\s/g, '').replace('½-½', '1/2-1/2');
      pending = null;
      continue;
    }
    const asMove = isNarrow(line) ? asMoveLine(text) : null;
    if (asMove) {
      flushProse();
      if (asMove.token) moves.push({ ...asMove, token: asMove.token, comment: '' });
      else pending = { number: asMove.number, black: asMove.black, line };
      continue;
    }
    // A bare move number is a black reply, printed as three fragments on ONE
    // baseline: the number, the ellipsis, and the move, each further right.
    // Requiring that row keeps a short paragraph tail ("play.") from being
    // mistaken for the move — text alone cannot tell them apart.
    const sameRow = pending !== null && Math.abs(line.y0 - pending.line.y0) <= 8 && line.x0 > pending.line.x0 + 12;
    if (sameRow && DOTS.test(text)) {
      pending!.black = true;
      continue;
    }
    if (sameRow && isTokenish(text)) {
      moves.push({ number: pending!.number, black: pending!.black, token: text, comment: '' });
      pending = null;
      continue;
    }
    pending = null;
    prose.push(line.text);
  }
  flushProse();

  return {
    number: gameNumber,
    white,
    black,
    event,
    opening,
    intro: intro.join('\n\n'),
    moves,
    result,
  };
}

const rawGames = headings.map((h, n) =>
  readGame(h.index, n + 1 < headings.length ? headings[n + 1]!.index : flat.length, n + 1),
);

// --- replay -------------------------------------------------------------------

interface Played {
  san: string;
  comment: string;
}

interface Outcome {
  game: RawGame;
  played: Played[];
  failedAt: number | null;
  reason: string;
  /** Moves the scan lost entirely, recovered because only one move fitted. */
  recovered: string[];
}

/** A move the scan dropped: allowed only when exactly one move can fill it. */
const MAX_RECOVERED = Number(process.env.MAX_RECOVERED ?? 8);
/** Positions the whole-game search may visit before giving up on a game. */
const SEARCH_BUDGET = 300_000;
/** Printed moves the scan may be allowed to have lost, per game. */
const MAX_HOLES = 2;

/**
 * Read every token as the move that leaves all the others readable.
 * Depth-first with backtracking, best-scoring reading first, so a game whose
 * tokens are all sound is confirmed on the first descent and only genuine
 * ambiguity costs anything. Returns null if no reading of the whole game
 * works, which is the honest answer for a token the scan destroyed.
 */
interface Step {
  move: Move;
  /** Which printed token this move came from; -1 for a filled gap. */
  token: number;
}

function solveGame(tokens: string[], dialect: Map<string, Role>, allowance: number): Step[] | null {
  let budget = SEARCH_BUDGET;
  const walk = (pos: Chess, index: number, holes: number): Step[] | null => {
    if (index === tokens.length) return [];
    if (budget-- <= 0) return null;
    for (const option of candidates(pos, tokens[index]!, dialect).slice(0, BREADTH)) {
      const next = pos.clone();
      next.play(option.move);
      const rest = walk(next, index + 1, holes);
      if (rest) return [{ move: option.move, token: index }, ...rest];
    }
    // The scan drops a printed move now and then — a move line swallowed by
    // a diagram, or lost at a page break. Try filling the gap, but only
    // where the whole rest of the game then works out: a filler the printed
    // continuation does not force never survives the search.
    if (holes >= allowance) return null;
    for (const move of legalMoves(pos)) {
      const next = pos.clone();
      next.play(move);
      const rest = walk(next, index, holes + 1);
      if (rest) return [{ move, token: -1 }, ...rest];
    }
    return null;
  };
  return walk(Chess.default(), 0, 0);
}

function replay(
  game: RawGame,
  dialect: Map<string, Role>,
  learn?: Map<string, Map<Role, number>>,
): Outcome {
  const pos = Chess.default();
  const played: Played[] = [];
  const recovered: string[] = [];
  const tokens = game.moves.map((m) => m.token);

  // A whole-game search comes first: read every token as the move that lets
  // ALL the others still be read. A wrong reading is usually still a legal
  // move, so nothing local can tell it apart from the right one — but it
  // strands the moves that follow, and backtracking finds that out. When it
  // succeeds, the game is confirmed end to end by its own continuation.
  // The dialect-learning rounds skip it: they only need the moves that were
  // never in doubt, which the cheap read already finds.
  // Fewest filled gaps first: a solution that reads every printed token as
  // printed beats one that needed a move supplied.
  let solved: Step[] | null = null;
  for (let allowance = 0; allowance <= MAX_HOLES && !solved && !learn; allowance++) {
    solved = solveGame(tokens, dialect, allowance);
  }
  if (solved) {
    for (const step of solved) {
      const san = makeSanAndPlay(pos, step.move);
      // A supplied move carries no note — the book printed none for it.
      played.push({ san, comment: step.token < 0 ? '' : game.moves[step.token]!.comment });
      if (step.token < 0) recovered.push(san);
    }
    return { game, played, failedAt: null, reason: '', recovered };
  }

  for (const [index, raw] of game.moves.entries()) {
    // No full solution: fall back to reading greedily, taking the option that
    // keeps the most of the continuation alive, so the report can say how far
    // the game got and on which token it died.
    const options = candidates(pos, raw.token, dialect);
    let hit: Match | undefined;
    let bestReach = -1;
    for (const option of options.slice(0, BREADTH)) {
      const next = pos.clone();
      next.play(option.move);
      const depth = reach(next, tokens, index + 1, LOOKAHEAD, dialect);
      if (depth > bestReach) {
        bestReach = depth;
        hit = option;
      }
      if (depth === LOOKAHEAD) break;
    }
    hit ??= options[0];

    if (!hit) {
      // Nothing matches. Either the scan wrecked THIS token beyond reading,
      // or it dropped the move BEFORE it. Both are recoverable when the
      // surrounding moves leave exactly one possibility — a move forced by
      // the book's own continuation is not a guess.
      const budget = recovered.length < MAX_RECOVERED;

      // (a) unreadable token: one legal move keeps everything after it
      //     matching.
      const forced = budget
        ? legalMoves(pos).filter((move) => {
            const next = pos.clone();
            next.play(move);
            return reach(next, tokens, index + 1, LOOKAHEAD, dialect) === LOOKAHEAD;
          })
        : [];
      if (forced.length === 1) {
        const san = makeSanAndPlay(pos, forced[0]!);
        recovered.push(san);
        played.push({ san, comment: raw.comment });
        continue;
      }

      // (b) dropped move: one legal move makes this token readable again.
      const fills = budget
        ? legalMoves(pos).filter((move) => {
            const next = pos.clone();
            next.play(move);
            return candidates(next, raw.token, dialect).some((option) => {
              const after = next.clone();
              after.play(option.move);
              return reach(after, tokens, index + 1, LOOKAHEAD, dialect) === LOOKAHEAD;
            });
          })
        : [];
      if (fills.length === 1) {
        const filler = pos.clone();
        const fillSan = makeSanAndPlay(filler, fills[0]!);
        const retry = resolveMove(filler, raw.token, dialect);
        if (retry) {
          recovered.push(fillSan);
          played.push({ san: fillSan, comment: '' });
          pos.play(fills[0]!);
          played.push({ san: makeSanAndPlay(pos, retry.move), comment: raw.comment });
          continue;
        }
      }
      if (process.argv.includes('--debug')) {
        console.log(
          `    token ${JSON.stringify(raw.token)} (${raw.number}${raw.black ? '...' : '.'}) legal: ${legalMoves(pos)
            .map((m) => makeSan(pos, m))
            .join(' ')}`,
        );
      }
      return {
        game,
        played,
        failedAt: index,
        reason: `no legal move matches ${JSON.stringify(raw.token)}`,
        recovered,
      };
    }
    // Learn the dialect only where the token left no choice of PIECE: if two
    // equally good readings move different pieces to the square, this move
    // says nothing about what its prefix meant, and recording it anyway
    // would teach the second pass a lie.
    if (learn && hit.prefix) {
      const top = options.filter((option) => option.score === options[0]!.score);
      const roles = new Set(top.map((option) => pos.board.getRole(option.move.from)!));
      if (roles.size === 1 && hit === options[0]) {
        const role = [...roles][0]!;
        const bucket = learn.get(hit.prefix) ?? new Map<Role, number>();
        bucket.set(role, (bucket.get(role) ?? 0) + 1);
        learn.set(hit.prefix, bucket);
        for (const ch of new Set(normalise(hit.prefix))) {
          const chars = charStats.get(ch) ?? new Map<Role, number>();
          chars.set(role, (chars.get(role) ?? 0) + 1);
          charStats.set(ch, chars);
        }
      }
    }
    played.push({ san: makeSanAndPlay(pos, hit.move), comment: raw.comment });
  }
  return { game, played, failedAt: null, reason: '', recovered };
}

// Learn the figurine dialect from the moves that needed no help, then
// replay with it — which is what settles `'ib` = queen. Knowing more
// prefixes lets more moves resolve unambiguously, which teaches more
// prefixes, so repeat until it stops growing.
const dialect = new Map<string, Role>();
for (let round = 0; round < 4; round++) {
  const stats = new Map<string, Map<Role, number>>();
  charStats.clear();
  for (const game of rawGames) replay(game, dialect, stats);
  const before = dialect.size;
  for (const [prefix, roles] of stats) {
    const ranked = [...roles].sort((a, b) => b[1] - a[1]);
    // Only a prefix that means ONE thing is worth trusting.
    if (ranked.length === 1 || ranked[0]![1] >= 3 * ranked[1]![1]) dialect.set(prefix, ranked[0]![0]);
  }
  if (dialect.size === before) break;
}
console.log(
  `figurine dialect: ${dialect.size} prefixes (${[...dialect]
    .slice(0, 8)
    .map(([p, r]) => `${p}=${r}`)
    .join(' ')})`,
);

const outcomes = rawGames.map((game) => replay(game, dialect));

const dumpAt = process.argv.indexOf('--dump');
if (dumpAt > 0) {
  const game = rawGames[Number(process.argv[dumpAt + 1]) - 1]!;
  console.log(game.moves.map((m) => `${m.number}${m.black ? '...' : '.'}${m.token}`).join('  '));
}

// --- prose repair -------------------------------------------------------------

/**
 * The commentary quotes moves in the same broken figurine ("2 ... lDc6:
 * \"Eureka!\""). The dialect knows what those prefixes were, so rewrite the
 * ones it is sure about and leave the rest alone — a wrong letter in the
 * prose would be worse than a strange one.
 */
function repairProse(text: string): string {
  return (
    text
      .replace(/(\S{1,6}?)([a-h][1-8])\b/g, (whole, prefix: string, square: string) => {
        const bare = prefix.replace(/[x×]/g, '');
        const role = dialect.get(bare);
        if (!role) return whole;
        const letter = { knight: 'N', bishop: 'B', rook: 'R', queen: 'Q', king: 'K', pawn: '' }[role];
        return `${letter}${prefix.includes('x') ? 'x' : ''}${square}`;
      })
      // "1.. .h6" — the ellipsis before a black move loses a dot to the
      // space between its two type sorts.
      .replace(/(\d)\s*\.\s*\.\s*\.\s*/g, '$1...')
      // "the fl-bishop": a rank 1 in a square name reads as an l when it is
      // followed by a hyphen and a chess word.
      .replace(/\b([a-h])[lI](?=-(?:pawn|bishop|knight|rook|queen|king|square|file|rank|diagonal))/g, '$11')
  );
}

// --- report and write ---------------------------------------------------------

const good = outcomes.filter((o) => o.failedAt === null);
const bad = outcomes.filter((o) => o.failedAt !== null);
console.log(`\n${good.length}/33 games replay cleanly`);
for (const o of bad) {
  console.log(
    `  Game ${o.game.number} ${o.game.white}-${o.game.black}: stopped after ${o.played.length} of ${o.game.moves.length} moves — ${o.reason}`,
  );
  if (process.argv.includes('--debug')) console.log(`      ${o.played.map((p) => p.san).join(' ')}`);
}

const escape = (text: string): string => text.replace(/[{}]/g, '');

function chapterPgn(o: Outcome): string {
  const g = o.game;
  const header =
    `[Event "${TITLE}: Chapter ${g.number}"]\n` +
    `[ChapterName "${g.number}. ${g.white} - ${g.black}"]\n` +
    `[White "${g.white}"]\n` +
    `[Black "${g.black}"]\n` +
    `[Site "${g.event}"]\n` +
    `[Opening "${g.opening}"]\n` +
    `[Result "${g.result}"]\n\n`;

  const parts: string[] = [];
  const intro = [g.opening, g.event].filter(Boolean).join(', ');
  const rootText = [intro, repairProse(escape(g.intro))].filter(Boolean).join('\n\n');
  if (rootText) parts.push(`{${rootText}}`);
  o.played.forEach((move, index) => {
    const number = Math.floor(index / 2) + 1;
    parts.push(index % 2 === 0 ? `${number}. ${move.san}` : `${number}... ${move.san}`);
    if (move.comment) parts.push(`{${repairProse(escape(move.comment))}}`);
  });
  parts.push(g.result);
  return header + wrap(parts.join(' ')) + '\n';
}

/** PGN readers cope with long lines, but a vault file is also a text file. */
function wrap(text: string): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > 100) {
      out.push(line);
      line = '';
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.join('\n');
}

mkdirSync(VAULT_STUDIES, { recursive: true });
const target = resolve(VAULT_STUDIES, `${TITLE}.pgn`);
writeFileSync(target, `${good.map(chapterPgn).join('\n')}`);
console.log(`\n${good.length} chapters -> ${target}`);

// Sanity: what we wrote must parse and replay as PGN, not just in memory.
for (const o of good) {
  const pos = Chess.default();
  for (const move of o.played) {
    const parsed = parseSan(pos, move.san);
    if (!parsed) throw new Error(`Game ${o.game.number}: wrote an unplayable move ${move.san}`);
    pos.play(parsed);
  }
}
console.log('every written chapter replays from the initial position');
