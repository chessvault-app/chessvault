/**
 * The tiers below the book's own word.
 *
 * A puzzle whose printed solution replayed is `book-parsed` and needs
 * nothing here. What is left is a position the scan read but whose answer
 * it could not follow — a mangled figurine, a line that fails on the
 * board as read. Those are not drafts by default: the position itself is
 * usually fine, and an engine can say what the answer is.
 *
 * Nothing is taken on trust. Every line returned here is replayed move by
 * move from the FEN that will be stored, so an illegal position or an
 * unplayable variation produces nothing rather than a guess, and each tier
 * says exactly how much is known:
 *
 *   engine-corroborated  the engine's line is decisive AND lands on the
 *                        squares the book's own answer named — two
 *                        independent readings agreeing
 *   engine-only          decisive, but nothing legible to check it against
 *   engine-unverified    a legal position and a stated side, no decisive
 *                        line: imported badged, because a position worth
 *                        looking at is worth keeping
 *
 * The engine itself is a parameter. This module has no worker, no network
 * and no files in it, so the browser import and the offline pipeline can
 * run the identical decision and the tests can run it with a fake.
 */
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { castlingRights } from './bookImport.ts';

/** What one search comes back with; null when the engine had no answer. */
export interface EngineLine {
  /** Centipawns for the side to move, or null when the score is a mate. */
  cp: number | null;
  /** Mate in N for the side to move (negative = being mated). */
  mate: number | null;
  /** Principal variation, in UCI. */
  pv: string[];
}

/** Search one position for a fixed time. */
export type EngineSearch = (fen: string, moveMs: number) => Promise<EngineLine | null>;

/** A board that was read, whose printed answer was not followed. */
export interface EngineCandidate {
  number: number;
  /** The placement field of the FEN — the board as it was read. */
  placement: string;
  /** The side the book's text implies, when any of it could be read. */
  side?: 'w' | 'b';
  /**
   * Destination squares the printed answer names. A scan that turns the
   * piece letters to soup still leaves "g7" and "b5" behind, and those
   * are what the engine's line gets checked against.
   */
  squares: string[];
  /** The page's stated goal, e.g. 2 for a "Mate in two" chapter. */
  mateIn?: number;
}

export interface EnginePuzzle {
  number: number;
  fen: string;
  uci: string[];
  san: string[];
  /** Defender replies, which a solver is not asked to guess. */
  wildcards?: number[];
  provenance: 'engine-corroborated' | 'engine-only' | 'engine-unverified';
}

/** Winning by this much, for the side to move, counts as decisive. */
const DECISIVE_CP = 250;
/**
 * How much better one side's search must be than the other's before an
 * unstated side is decided by it. Both sides "winning" means the board is
 * read wrongly or the position is a mess; only a clear gap settles it.
 */
const SIDE_MARGIN = 300;
/** Longest line kept when the engine found an edge rather than a mate. */
const MAX_PLIES = 6;

export function fullFen(placement: string, side: 'w' | 'b'): string {
  return `${placement} ${side} ${castlingRights(placement)} - 0 1`;
}

export function positionOf(fen: string): Chess | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const pos = Chess.fromSetup(setup.unwrap());
  return pos.isErr ? null : pos.unwrap();
}

/**
 * A UCI variation as a real line: replayed from the position, trimmed to
 * `plies`, stopped at mate. Anything the position will not accept ends the
 * line rather than being written down.
 */
export function lineFromPv(
  fen: string,
  pv: string[],
  plies: number,
): { uci: string[]; san: string[] } | null {
  const pos = positionOf(fen);
  if (!pos) return null;
  const uci: string[] = [];
  const san: string[] = [];
  for (const move of pv.slice(0, plies)) {
    const parsed = parseUci(move);
    if (!parsed || !pos.isLegal(parsed)) break;
    san.push(makeSanAndPlay(pos, parsed));
    uci.push(move);
    if (pos.isCheckmate()) break;
  }
  return uci.length > 0 ? { uci, san } : null;
}

/** The defender's moves in a forced line: every second ply but the last. */
export function defenderWildcards(count: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < count - 1; i += 2) out.push(i);
  return out;
}

/** How much of a line lands on squares the book's answer named. */
export function overlap(uci: string[], squares: string[]): number {
  const dests = new Set(uci.map((move) => move.slice(2, 4)));
  if (dests.size === 0) return 0;
  let hit = 0;
  for (const dest of dests) if (squares.includes(dest)) hit++;
  return hit / dests.size;
}

const decisive = (line: EngineLine | null): boolean =>
  !!line && ((line.mate !== null && line.mate > 0) || (line.cp !== null && line.cp >= DECISIVE_CP));

/** How well a decisive line scores, for comparing the two sides. */
const margin = (line: EngineLine): number =>
  line.mate !== null ? 100_000 - line.mate : (line.cp ?? 0);

/**
 * One candidate, one verdict. Null means nothing could be established and
 * the board should go on being a draft.
 */
export async function engineTier(
  candidate: EngineCandidate,
  search: EngineSearch,
): Promise<EnginePuzzle | null> {
  const { number, placement, squares } = candidate;
  const goal = candidate.mateIn ?? 0;

  const trySide = async (side: 'w' | 'b'): Promise<(EngineLine & { side: 'w' | 'b' }) | null> => {
    const fen = fullFen(placement, side);
    if (!positionOf(fen)) return null;
    // A stated mate gets a little longer: mate-in-N is trivial inside this
    // budget, and the mate score is what decides the tier.
    const line = await search(fen, goal > 0 ? 800 : 500);
    return line ? { ...line, side } : null;
  };

  let solved: (EngineLine & { side: 'w' | 'b' }) | null = null;
  /**
   * The stated side's search, kept rather than dropped. The unverified
   * tier below used to search this same position a second time to get a
   * line out of it — the identical fen for the identical budget, when the
   * answer was already in hand. Every board that ends up badged cost two
   * searches to say what one had said.
   */
  let stated: (EngineLine & { side: 'w' | 'b' }) | null = null;
  if (candidate.side) {
    stated = await trySide(candidate.side);
    if (decisive(stated)) solved = stated;
  } else {
    // No side to go on: the position has to say which one it is, and it
    // only counts if one side is decisively better than the other.
    const white = await trySide('w');
    const black = await trySide('b');
    const whiteOk = decisive(white);
    const blackOk = decisive(black);
    if (whiteOk && !blackOk) solved = white;
    else if (blackOk && !whiteOk) solved = black;
    else if (whiteOk && blackOk) {
      if (Math.abs(margin(white!) - margin(black!)) >= SIDE_MARGIN) {
        solved = margin(white!) > margin(black!) ? white : black;
      }
    }
  }

  // Nothing decisive, but the position is legal and the book said whose
  // move it is: import it badged rather than dropping what was read.
  if (!solved && candidate.side && stated) {
    const fen = fullFen(placement, candidate.side);
    const line = lineFromPv(fen, stated.pv, MAX_PLIES);
    if (line) {
      return { number, fen, uci: line.uci, san: line.san, provenance: 'engine-unverified' };
    }
  }
  if (!solved) return null;

  const fen = fullFen(placement, solved.side);
  const isMate = solved.mate !== null && solved.mate > 0;
  const plies = isMate ? solved.mate! * 2 - 1 : Math.min(solved.pv.length, MAX_PLIES);
  const line = lineFromPv(fen, solved.pv, Math.max(plies, 1));
  if (!line) return null;

  // Two squares is the least that can corroborate anything; below that a
  // single coincidence would be enough to promote a tier.
  const corroborated = squares.length >= 2 && overlap(line.uci, squares) >= 0.5;
  const wildcards = isMate ? defenderWildcards(line.uci.length) : [];
  return {
    number,
    fen,
    uci: line.uci,
    san: line.san,
    ...(wildcards.length > 0 ? { wildcards } : {}),
    provenance: corroborated ? 'engine-corroborated' : 'engine-only',
  };
}
