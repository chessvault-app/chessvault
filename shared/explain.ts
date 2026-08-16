import { attacks, between, pawnAttacks, ray } from 'chessops/attacks';
import type { Board } from 'chessops/board';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { SquareSet } from 'chessops/squareSet';
import type { Color, Move, Piece, Role, Square } from 'chessops/types';
import { makeSquare, opposite, parseUci, squareFile, squareRank } from 'chessops/util';

/**
 * Deterministic reading of an engine line: what happens in it (plan
 * gestures) and what the tactic is (motif tags). No search, no model, no
 * judgment — a pure function of (fen, moves), so the same line always
 * reads the same and every claim is checkable by replaying the line.
 *
 * This deliberately explains WHAT, never WHY. "Why" needs counter-factual
 * searches (the probes in web/src/engine/probe.ts); conflating the two
 * would put guesses in a module whose value is that it cannot guess.
 *
 * The horizons below exist because a PV's tail is less searched than its
 * head — the last plies of a reported line are barely verified, so facts
 * found there are not worth reporting with the same confidence.
 */

/** Plies of a line worth reading for tactics — beyond this the tail is noise. */
const MOTIF_HORIZON = 12;
/** Plies worth reading for plan gestures; slower ideas need more room. */
const PLAN_HORIZON = 16;
/** Absolute cap on replay, so a corrupt 200-ply line cannot stall a render. */
const REPLAY_CAP = 24;

const VALUE: Record<Role, number> = {
  pawn: 1,
  knight: 3,
  bishop: 3,
  rook: 5,
  queen: 9,
  king: 99,
};

const FILES = 'abcdefgh';

// ---------------------------------------------------------------------------
// Replay

interface Step {
  /** 0-based ply within the line; even plies belong to the side to move. */
  ply: number;
  move: Move & { from: Square; to: Square };
  san: string;
  piece: Piece;
  /** What the move captured, if anything (en passant resolved). */
  captured?: Piece;
  /** Board before the move, for attack-set comparisons. */
  boardBefore: Board;
  /** Board after the move. */
  boardAfter: Board;
  /** True when the position after the move is checkmate. */
  mates: boolean;
}

interface Replay {
  mover: Color;
  steps: Step[];
  /** Board at the start of the line. */
  startBoard: Board;
  /** Board after the last replayed ply. */
  endBoard: Board;
}

/**
 * Replay a UCI line from a FEN, stopping at the first illegal move — a
 * truncated reading beats an exception in a render path (same contract as
 * formatPv). Returns null when the FEN itself does not parse.
 */
function replayLine(fen: string, uciMoves: string[]): Replay | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const position = Chess.fromSetup(setup.unwrap());
  if (position.isErr) return null;
  const pos = position.unwrap();

  const mover = pos.turn;
  const startBoard = pos.board.clone();
  const steps: Step[] = [];

  for (const [ply, uci] of uciMoves.slice(0, REPLAY_CAP).entries()) {
    const move = parseUci(uci);
    if (!move || !('from' in move) || !pos.isLegal(move)) break;

    const piece = pos.board.get(move.from);
    if (!piece) break;
    let captured = pos.board.get(move.to);
    // En passant: the captured pawn is beside the destination, not on it.
    if (!captured && piece.role === 'pawn' && move.to === pos.epSquare) {
      captured = { color: opposite(piece.color), role: 'pawn' };
    }

    const boardBefore = pos.board.clone();
    const san = makeSanAndPlay(pos, move);
    steps.push({
      ply,
      move,
      san,
      piece,
      ...(captured ? { captured } : {}),
      boardBefore,
      boardAfter: pos.board.clone(),
      mates: pos.isCheckmate(),
    });
  }

  return { mover, steps, startBoard, endBoard: pos.board.clone() };
}

// ---------------------------------------------------------------------------
// Board helpers

/** Squares of `by`'s pieces that attack `sq` on this board. */
function attackersOf(sq: Square, by: Color, board: Board, occupied: SquareSet): SquareSet {
  let out = SquareSet.empty();
  for (const s of board[by]) {
    const piece = board.get(s);
    if (piece && attacks(piece, s, occupied).has(sq)) out = out.with(s);
  }
  return out;
}

/** Lowest piece value among the attackers in `set`, or Infinity. */
function cheapestOf(set: SquareSet, board: Board): number {
  let cheapest = Infinity;
  for (const s of set) {
    const piece = board.get(s);
    if (piece) cheapest = Math.min(cheapest, VALUE[piece.role]);
  }
  return cheapest;
}

/**
 * Can `by` remove the piece worth `value` standing on `sq` without losing
 * material — capture it with anything cheaper or equal, or with anything
 * at all when it is undefended? Pins and zwischenzugs are invisible to
 * this reading, so it errs toward yes; callers use it to withhold a
 * claim, never to make one.
 */
function removable(sq: Square, value: number, by: Color, board: Board, occupied: SquareSet): boolean {
  const capturers = attackersOf(sq, by, board, occupied);
  if (capturers.isEmpty()) return false;
  if (attackersOf(sq, opposite(by), board, occupied).isEmpty()) return true;
  return cheapestOf(capturers, board) <= value;
}

/** How many enemy pieces `piece`, standing on `sq`, profitably attacks:
    the king, anything worth more than itself, or an undefended piece. */
function profitableTargets(
  piece: Piece,
  sq: Square,
  enemy: Color,
  board: Board,
  occupied: SquareSet,
): number {
  let targets = 0;
  for (const s of attacks(piece, sq, occupied).intersect(board[enemy])) {
    const victim = board.get(s);
    if (!victim) continue;
    const defended = attackersOf(s, enemy, board, occupied).nonEmpty();
    if (
      victim.role === 'king' ||
      VALUE[victim.role] > VALUE[piece.role] ||
      (!defended && VALUE[victim.role] >= 3)
    ) {
      targets++;
    }
  }
  return targets;
}

/** Is `color`'s pawn on `sq` passed — no enemy pawn ahead on its or adjacent files? */
function isPassed(sq: Square, color: Color, board: Board): boolean {
  const file = squareFile(sq);
  const rank = squareRank(sq);
  for (const p of board.pieces(opposite(color), 'pawn')) {
    if (Math.abs(squareFile(p) - file) > 1) continue;
    const ahead = color === 'white' ? squareRank(p) > rank : squareRank(p) < rank;
    if (ahead) return false;
  }
  return true;
}

/** Material sum for one side, kings excluded. */
function materialOf(board: Board, color: Color): number {
  let sum = 0;
  for (const s of board[color]) {
    const piece = board.get(s);
    if (piece && piece.role !== 'king') sum += VALUE[piece.role];
  }
  return sum;
}

/** Mover-POV material balance of a board, relative to nothing. */
function balance(board: Board, mover: Color): number {
  return materialOf(board, mover) - materialOf(board, opposite(mover));
}

/** Does `far` lie on the ray from `origin` through `near`, beyond `near`? */
function onRayBeyond(origin: Square, near: Square, far: Square): boolean {
  return ray(origin, near).has(far) && between(origin, far).has(near);
}

// ---------------------------------------------------------------------------
// Motifs

export type MotifType =
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'discovered'
  | 'backRankMate'
  | 'trapped'
  | 'promotion';

export interface MotifTag {
  type: MotifType;
  /** 0-based ply of the line where the motif appears. */
  ply: number;
  /** Piece it reads most naturally by (the forking knight, the pinned piece). */
  piece?: Role;
  /** Square it happens on. */
  square?: string;
}

export interface SacrificeTag {
  /** `sham` recovers the material (or mates) inside the line; `real` never does. */
  kind: 'sham' | 'real';
  /** Pawns of material given at the deepest point. */
  amount: number;
  /**
   * 0-based ply of the MOVER's move that gave the material. The ledger is
   * read after the opponent's reply — that is what makes it a sacrifice
   * rather than bookkeeping — but the reply is not the move anyone wants
   * pointed at, so it is the mover's move before it that is recorded.
   */
  ply: number;
}

export interface LineTags {
  motif?: MotifTag;
  sacrifice?: SacrificeTag;
}

/** Priority when several motifs appear — one chip, the most telling one. */
const MOTIF_PRIORITY: MotifType[] = [
  'backRankMate',
  'fork',
  'discovered',
  'skewer',
  'pin',
  'trapped',
  'promotion',
];

/**
 * Tag the mover's tactics in a line. Only the mover's moves are read: the
 * line belongs to the side to move, and "the opponent could fork you in
 * this variation" is a different feature (the threat probe).
 */
export function tagLine(fen: string, uciMoves: string[]): LineTags {
  const replay = replayLine(fen, uciMoves);
  if (!replay) return {};

  const found: MotifTag[] = [];
  const enemy = opposite(replay.mover);

  for (const step of replay.steps) {
    if (step.ply >= MOTIF_HORIZON) break;
    if (step.piece.color !== replay.mover) continue;

    const board = step.boardAfter;
    const occupied = board.occupied;
    const to = step.move.to;
    const enemyKing = board.pieces(enemy, 'king').first();

    // What now stands on `to` — the promoted piece when the move promoted.
    const landed: Role = 'promotion' in step.move && step.move.promotion ? step.move.promotion : step.piece.role;
    const landedPiece: Piece = { color: step.piece.color, role: landed };
    /**
     * Every motif below hangs off the moved piece holding its square. If
     * the opponent can remove it without losing material, the geometry is
     * an offer, not a tactic — found live: a pawn "forking" two minors
     * either of which could simply take it, and a bishop "pinning" a
     * bishop that could resolve everything by trading itself off. A
     * mating move has no reply, so it is exempt.
     */
    const safe = step.mates || !removable(to, VALUE[landed], enemy, board, occupied);

    if (safe && 'promotion' in step.move && step.move.promotion) {
      found.push({ type: 'promotion', ply: step.ply, square: makeSquare(to) });
    }

    // Back-rank mate: the line ends the game with a rook or queen landing
    // on the mated king's own rank.
    if (
      step.mates &&
      (step.piece.role === 'rook' || step.piece.role === 'queen') &&
      enemyKing !== undefined &&
      squareRank(to) === squareRank(enemyKing) &&
      squareRank(enemyKing) === (enemy === 'white' ? 0 : 7)
    ) {
      found.push({
        type: 'backRankMate',
        ply: step.ply,
        piece: step.piece.role,
        square: makeSquare(to),
      });
    }

    // Fork: the moved piece attacks two or more pieces it profitably
    // targets — the king, anything worth more than itself, or an
    // undefended piece. Only from a square it can hold (`safe`): a "fork"
    // the opponent answers by taking the forker never threatened anything.
    if (safe && profitableTargets(landedPiece, to, enemy, board, occupied) >= 2) {
      found.push({ type: 'fork', ply: step.ply, piece: landed, square: makeSquare(to) });
    }

    // Pins and skewers: the moved slider lines up two enemy pieces — with
    // the front one removed it hits the back one along the same ray. Which
    // motif it is depends on which of the two is worth more. Gated on
    // `safe`, which subsumes the old front-takes-undefended-slider guard
    // (Qxd8+ Kxd8 is a trade, not a tactic — found live on the opening
    // mainline) and also drops the even-trade cases: a bishop "pinning" a
    // bishop is a pin the front piece dissolves by taking (found live).
    if (safe && (step.piece.role === 'bishop' || step.piece.role === 'rook' || step.piece.role === 'queen')) {
      for (const frontSq of attacks(step.piece, to, occupied).intersect(board[enemy])) {
        const front = board.get(frontSq);
        if (!front) continue;
        const behind = attacks(step.piece, to, occupied.without(frontSq))
          .intersect(board[enemy])
          .without(frontSq);
        for (const backSq of behind) {
          if (!onRayBeyond(to, frontSq, backSq)) continue;
          const back = board.get(backSq);
          if (!back) continue;
          if (back.role === 'king' && front.role !== 'king') {
            // The front piece cannot legally leave the ray: an absolute
            // pin. Pinned pawns are everyday furniture, so only pieces get
            // the tag — and only when the pin is winning the piece, not
            // merely holding it. Found live: every ...Bb4-on-Nc3 line in
            // the corpus wore the chip for a knight the b-pawn was
            // defending, which is an opening, not a tactic.
            const guards = attackersOf(frontSq, enemy, board, occupied);
            const pressure = attackersOf(frontSq, replay.mover, board, occupied);
            if (
              VALUE[front.role] >= 3 &&
              (guards.isEmpty() ||
                cheapestOf(pressure, board) < VALUE[front.role] ||
                pressure.size() > guards.size())
            ) {
              found.push({ type: 'pin', ply: step.ply, piece: front.role, square: makeSquare(frontSq) });
            }
          } else if (
            // A skewer needs the FRONT piece forced to move (a king, or
            // worth more than the attacking slider), something behind
            // worth collecting once it does — and the collection to be a
            // gain: an even, defended trade at the end of the ray is a
            // shuffle, not a skewer.
            (front.role === 'king' || VALUE[front.role] > VALUE[step.piece.role]) &&
            VALUE[back.role] >= 3 &&
            (front.role === 'king' || VALUE[front.role] > VALUE[back.role]) &&
            (VALUE[back.role] > VALUE[step.piece.role] ||
              attackersOf(backSq, enemy, board, occupied).isEmpty())
          ) {
            found.push({ type: 'skewer', ply: step.ply, piece: step.piece.role, square: makeSquare(to) });
          }
        }
      }
    }

    // Discovered attack: another of the mover's sliders now hits the king
    // or a major piece along a ray that passes through the vacated square.
    for (const s of board[replay.mover]) {
      if (s === to) continue;
      const slider = board.get(s);
      if (!slider || (slider.role !== 'bishop' && slider.role !== 'rook' && slider.role !== 'queen')) {
        continue;
      }
      const gained = attacks(slider, s, occupied).diff(attacks(slider, s, step.boardBefore.occupied));
      for (const targetSq of gained.intersect(board[enemy])) {
        const victim = board.get(targetSq);
        if (!victim) continue;
        if (!onRayBeyond(s, step.move.from, targetSq)) continue;
        // The revealed slider itself must hold its square: a discovery
        // answered by taking the slider at no cost revealed nothing.
        if (removable(s, VALUE[slider.role], enemy, board, occupied)) continue;
        if (victim.role === 'king') {
          // A discovered check earns the chip only when the moved piece
          // spends the tempo on something — a capture, a mate, or a
          // threat of its own. A bare discovered check is a spite check.
          if (step.mates || step.captured || profitableTargets(landedPiece, to, enemy, board, occupied) >= 1) {
            found.push({ type: 'discovered', ply: step.ply, piece: slider.role, square: makeSquare(s) });
          }
        } else if (
          VALUE[victim.role] >= 5 &&
          // And the revealed attack must cash: a defended piece worth no
          // more than the slider hitting it is not being won.
          (VALUE[victim.role] > VALUE[slider.role] ||
            attackersOf(targetSq, enemy, board, occupied).isEmpty())
        ) {
          found.push({ type: 'discovered', ply: step.ply, piece: slider.role, square: makeSquare(s) });
        }
      }
    }

    // Trapped piece: an attacked enemy piece whose every flight square is
    // covered by something cheaper. Strict on purpose — a wrong chip is
    // worse than a missing one, so cornered pieces only (few flights).
    for (const s of board[enemy]) {
      const victim = board.get(s);
      if (!victim || victim.role === 'king' || VALUE[victim.role] < 3) continue;
      const hunters = attackersOf(s, replay.mover, board, occupied);
      if (hunters.isEmpty()) continue;
      const worthHunting =
        cheapestOf(hunters, board) < VALUE[victim.role] ||
        attackersOf(s, enemy, board, occupied).isEmpty();
      if (!worthHunting) continue;
      // A hunter that can itself be profitably captured breaks the trap —
      // found live: 5.Nxc6 "trapped" the queen that ...dxc6 was about to
      // solve. Escaping is not the only way out of a hunt.
      let breakable = false;
      for (const h of hunters) {
        const hunter = board.get(h);
        if (!hunter) continue;
        const counter = attackersOf(h, enemy, board, occupied);
        if (cheapestOf(counter, board) <= VALUE[hunter.role]) breakable = true;
      }
      if (breakable) continue;

      const flights = attacks(victim, s, occupied).diff(board[enemy]);
      if (flights.size() > 6) continue;
      let escapes = 0;
      for (const f of flights) {
        const cover = attackersOf(f, replay.mover, board, occupied.without(s));
        if (cheapestOf(cover, board) >= VALUE[victim.role]) escapes++;
      }
      if (escapes === 0) {
        found.push({ type: 'trapped', ply: step.ply, piece: victim.role, square: makeSquare(s) });
      }
    }
  }

  const motif = pickMotif(found);
  const sacrifice = findSacrifice(replay);
  return { ...(motif ? { motif } : {}), ...(sacrifice ? { sacrifice } : {}) };
}

function pickMotif(found: MotifTag[]): MotifTag | undefined {
  let best: MotifTag | undefined;
  for (const tag of found) {
    if (!best) {
      best = tag;
      continue;
    }
    const a = MOTIF_PRIORITY.indexOf(tag.type);
    const b = MOTIF_PRIORITY.indexOf(best.type);
    if (a < b || (a === b && tag.ply < best.ply)) best = tag;
  }
  return best;
}

/**
 * Sacrifice: the mover's material balance (relative to the start of the
 * line, measured after each opponent reply — a piece en prise for half a
 * move is bookkeeping, not a sacrifice) dips by two pawns or more and
 * STAYS down across consecutive measurements, then either recovers
 * inside the line (sham — a combination) or never does (real — the
 * compensation is positional and the material is not coming back).
 *
 * Two hard-won rules, both from watching it mislabel ordinary openings:
 * the ledger runs over the WHOLE replay, because cutting at the motif
 * horizon mid-exchange manufactured a phantom sacrifice out of a delayed
 * recapture; and a single-measurement dip does not count — when the
 * opponent captures first in a trade the balance is briefly down with
 * nothing sacrificed by anyone. The one exception is a dip straight into
 * mate, which has no second measurement to persist across.
 */
function findSacrifice(replay: Replay): SacrificeTag | undefined {
  const start = balance(replay.startBoard, replay.mover);

  const measured: { ply: number; moverPly: number; delta: number }[] = [];
  let moverPly = 0;
  for (const step of replay.steps) {
    if (step.piece.color === replay.mover) {
      moverPly = step.ply;
      continue;
    }
    measured.push({
      ply: step.ply,
      moverPly,
      delta: balance(step.boardAfter, replay.mover) - start,
    });
  }
  if (measured.length === 0) return undefined;

  let deepest = 0;
  let deepestPly = 0;
  let persistentAt = -1;
  for (let i = 0; i < measured.length; i++) {
    const m = measured[i]!;
    if (m.delta < deepest) {
      deepest = m.delta;
      deepestPly = m.moverPly;
    }
    if (
      persistentAt < 0 &&
      m.ply < MOTIF_HORIZON && // the sacrifice itself must be in the trusted head
      m.delta <= -2 &&
      measured[i + 1] !== undefined &&
      measured[i + 1]!.delta <= -2
    ) {
      persistentAt = i;
    }
  }

  const last = replay.steps.at(-1);
  const mates = last !== undefined && last.mates && last.piece.color === replay.mover;
  const dipIntoMate = mates && measured.at(-1)!.delta <= -2;
  if (persistentAt < 0 && !dipIntoMate) return undefined;

  const recovered =
    persistentAt >= 0 && measured.some((m, i) => i > persistentAt + 1 && m.delta >= -0.5);
  return { kind: recovered || mates ? 'sham' : 'real', amount: -deepest, ply: deepestPly };
}

// ---------------------------------------------------------------------------
// Plan gestures

export type Gesture =
  | { type: 'trade'; role: Role; colour?: 'dark' | 'light'; ply: number }
  | { type: 'winMaterial'; amount: number; ply: number }
  | { type: 'break'; square: string; ply: number }
  | { type: 'maneuver'; piece: Role; to: string; ply: number }
  | { type: 'plant'; piece: Role; square: string; ply: number }
  | { type: 'openFile'; file: string; rook: boolean; ply: number }
  | { type: 'passer'; file: string; ply: number }
  | { type: 'storm'; wing: 'kingside' | 'queenside'; ply: number }
  | { type: 'castle'; wing: 'kingside' | 'queenside'; ply: number }
  | { type: 'kingWalk'; to: string; ply: number }
  | { type: 'simplify'; ply: number }
  | { type: 'quiet'; ply: number };

export interface PlanSummary {
  side: Color;
  /** At most three gestures, in the order they happen in the line. */
  gestures: Gesture[];
}

/**
 * Weight of each gesture type when choosing what to mention. Structural,
 * permanent facts outrank piece placement; placement outranks routine
 * moves. Heuristic, in the open, and cheap to retune.
 */
const WEIGHT: Record<Gesture['type'], number> = {
  break: 5,
  passer: 5,
  winMaterial: 4.5,
  storm: 4.5,
  plant: 4,
  simplify: 4,
  openFile: 3.5,
  kingWalk: 3,
  trade: 2.5,
  maneuver: 2.5,
  castle: 1.5,
  quiet: 0,
};

/**
 * Read a line's plan: up to three gestures for the side to move, in
 * chronological order. Returns null when there is nothing worth saying —
 * the line is too short, or tactics dominate (a combination is the motif
 * tagger's story, not a plan).
 */
export function summarisePlan(fen: string, uciMoves: string[]): PlanSummary | null {
  const replay = replayLine(fen, uciMoves);
  if (!replay || replay.steps.length < 6) return null;

  const start = balance(replay.startBoard, replay.mover);
  const endDelta = balance(replay.endBoard, replay.mover) - start;
  // Tactics dominate: this is a combination, not a plan.
  if (endDelta >= 3 || replay.steps.some((s) => s.mates)) return null;

  const gestures: Gesture[] = [];
  const enemy = opposite(replay.mover);
  const enemyKingStart = replay.startBoard.pieces(enemy, 'king').first();

  // --- capture pairing → trades / simplification -------------------------
  interface Chain {
    square: Square;
    firstPly: number;
    lastPly: number;
    /** Mover-POV value flow: + for enemy material captured. */
    net: number;
    roles: Role[];
    /** Square colours of captured bishops, for the colour-complex phrase. */
    bishopColours: ('dark' | 'light')[];
  }
  const chains: Chain[] = [];
  for (const step of replay.steps.slice(0, PLAN_HORIZON)) {
    if (!step.captured) continue;
    const gain = (step.piece.color === replay.mover ? 1 : -1) * VALUE[step.captured.role];
    const colours: ('dark' | 'light')[] =
      step.captured.role === 'bishop'
        ? [(squareFile(step.move.to) + squareRank(step.move.to)) % 2 === 0 ? 'dark' : 'light']
        : [];
    const open = chains.find((c) => c.square === step.move.to && step.ply - c.lastPly <= 2);
    if (open) {
      open.net += gain;
      open.lastPly = step.ply;
      open.roles.push(step.captured.role);
      open.bishopColours.push(...colours);
    } else {
      chains.push({
        square: step.move.to,
        firstPly: step.ply,
        lastPly: step.ply,
        net: gain,
        roles: [step.captured.role],
        bishopColours: colours,
      });
    }
  }

  let trades = 0;
  for (const chain of chains) {
    if (Math.abs(chain.net) <= 1 && chain.roles.length >= 2) {
      trades++;
      const top = chain.roles.reduce((a, b) => (VALUE[a] >= VALUE[b] ? a : b));
      if (top !== 'pawn') {
        const colour =
          top === 'bishop' && new Set(chain.bishopColours).size === 1
            ? chain.bishopColours[0]
            : undefined;
        gestures.push({ type: 'trade', role: top, ...(colour ? { colour } : {}), ply: chain.firstPly });
      }
    }
  }
  if (endDelta === 2) {
    gestures.push({ type: 'winMaterial', amount: endDelta, ply: chains[0]?.firstPly ?? 0 });
  }
  // Ahead already and trading pieces off: converting, which deserves its
  // own word instead of two "trade the ..." entries.
  if (start >= 2 && trades >= 2) {
    gestures.push({ type: 'simplify', ply: chains[0]?.firstPly ?? 0 });
  }

  // --- per-step reading ---------------------------------------------------
  const breakFiles = new Set<number>();
  // Storms exist only against a king that has committed to a wing: found
  // live reading 1.e4/2.d4 as a "kingside storm" against a king still on
  // e8. Central kings get no storm, and only the wing's own three files
  // count, only once a pawn actually crosses into the enemy half.
  const kingFile = enemyKingStart !== undefined ? squareFile(enemyKingStart) : null;
  const stormWing =
    kingFile === null
      ? null
      : kingFile >= 5
        ? { wing: 'kingside' as const, files: [5, 6, 7] }
        : kingFile <= 2
          ? { wing: 'queenside' as const, files: [0, 1, 2] }
          : null;
  const stormFiles = new Set<number>();
  let stormFirstPly = 0;
  let kingSteps = 0;
  let kingLast: Square | undefined;
  let kingFirstPly = 0;
  const kingStart = replay.startBoard.pieces(replay.mover, 'king').first();
  /** Piece journeys, keyed by the square the piece stood on at line start. */
  const journeys = new Map<Square, { piece: Role; to: Square; count: number; firstPly: number }>();
  const origin = new Map<Square, Square>();

  for (const step of replay.steps.slice(0, PLAN_HORIZON)) {
    if (step.piece.color !== replay.mover) continue;
    const { move, piece } = step;

    if (piece.role === 'pawn') {
      const file = squareFile(move.to);
      // A break: the pawn takes an enemy pawn, or steps where one could
      // take it — either way it forces the structural question. (The two
      // "who attacks whom" sets are the same squares by reflection.)
      const tension = pawnAttacks(replay.mover, move.to)
        .intersect(step.boardAfter.pieces(enemy, 'pawn'))
        .nonEmpty();
      if (!breakFiles.has(file) && (step.captured?.role === 'pawn' || tension)) {
        breakFiles.add(file);
        gestures.push({ type: 'break', square: makeSquare(move.to), ply: step.ply });
      }
      if (stormWing !== null && stormWing.files.includes(file)) {
        const crossed =
          replay.mover === 'white' ? squareRank(move.to) >= 3 : squareRank(move.to) <= 4;
        if (crossed) {
          if (stormFiles.size === 0) stormFirstPly = step.ply;
          stormFiles.add(file);
        }
      }
      continue;
    }

    if (piece.role === 'king') {
      if (step.san === 'O-O' || step.san === 'O-O-O') {
        gestures.push({
          type: 'castle',
          wing: step.san === 'O-O' ? 'kingside' : 'queenside',
          ply: step.ply,
        });
      } else {
        if (kingSteps === 0) kingFirstPly = step.ply;
        kingSteps++;
        kingLast = move.to;
      }
      continue;
    }

    // Follow each piece through its hops so Nf3–e1–d3 reads as one journey.
    const from = origin.get(move.from) ?? move.from;
    origin.delete(move.from);
    origin.set(move.to, from);
    const journey = journeys.get(from);
    if (journey) {
      journey.to = move.to;
      journey.count++;
    } else {
      journeys.set(from, { piece: piece.role, to: move.to, count: 1, firstPly: step.ply });
    }
  }

  for (const [journeyFrom, journey] of journeys.entries()) {
    const standing = replay.endBoard.get(journey.to);
    const survives = standing?.role === journey.piece && standing.color === replay.mover;
    if (!survives) continue;
    // Back where it started is a shuffle, not a journey.
    if (journey.to === journeyFrom) continue;

    // A maneuver: two or more moves to reach somewhere it stays.
    if (journey.count >= 2) {
      gestures.push({
        type: 'maneuver',
        piece: journey.piece,
        to: makeSquare(journey.to),
        ply: journey.firstPly,
      });
    }

    // A plant: a minor lands on a pawn-guarded square in the enemy half
    // that no enemy pawn can ever evict it from.
    if (journey.piece !== 'knight' && journey.piece !== 'bishop') continue;
    const sq = journey.to;
    const rank = squareRank(sq);
    const inEnemyHalf = replay.mover === 'white' ? rank >= 4 : rank <= 3;
    if (!inEnemyHalf) continue;
    // A mover pawn guards `sq` iff it stands where an ENEMY pawn on `sq`
    // would attack — the reflection trick again.
    const guarded = pawnAttacks(enemy, sq)
      .intersect(replay.endBoard.pieces(replay.mover, 'pawn'))
      .nonEmpty();
    if (!guarded) continue;
    let evictable = false;
    for (const p of replay.endBoard.pieces(enemy, 'pawn')) {
      if (Math.abs(squareFile(p) - squareFile(sq)) !== 1) continue;
      const inFront = replay.mover === 'white' ? squareRank(p) > rank : squareRank(p) < rank;
      if (inFront) evictable = true;
    }
    if (!evictable) {
      gestures.push({ type: 'plant', piece: journey.piece, square: makeSquare(sq), ply: journey.firstPly });
    }
  }

  // Open files: pawns of both sides at the start, none at the end.
  // Credited with the rook when one of the mover's ends there.
  for (let file = 0; file < 8; file++) {
    const fileSet = SquareSet.fromFile(file);
    const hadOwn = replay.startBoard.pieces(replay.mover, 'pawn').intersect(fileSet).nonEmpty();
    const hadEnemy = replay.startBoard.pieces(enemy, 'pawn').intersect(fileSet).nonEmpty();
    const emptyNow = replay.endBoard.pawn.intersect(fileSet).isEmpty();
    if (hadOwn && hadEnemy && emptyNow) {
      const rook = replay.endBoard.pieces(replay.mover, 'rook').intersect(fileSet).nonEmpty();
      const ply =
        replay.steps.find((s) => s.captured?.role === 'pawn' && squareFile(s.move.to) === file)?.ply ?? 0;
      gestures.push({ type: 'openFile', file: FILES[file]!, rook, ply });
    }
  }

  // Passed pawns: created by the line, or an existing one pushed two ranks.
  for (const p of replay.endBoard.pieces(replay.mover, 'pawn')) {
    if (!isPassed(p, replay.mover, replay.endBoard)) continue;
    const file = squareFile(p);
    const fileSet = SquareSet.fromFile(file);
    const before = replay.startBoard.pieces(replay.mover, 'pawn').intersect(fileSet).first();
    const wasPassed = before !== undefined && isPassed(before, replay.mover, replay.startBoard);
    const advanced = before !== undefined && Math.abs(squareRank(p) - squareRank(before)) >= 2;
    if (!wasPassed || advanced) {
      const ply =
        replay.steps.find(
          (s) => s.piece.color === replay.mover && s.piece.role === 'pawn' && squareFile(s.move.to) === file,
        )?.ply ?? 0;
      gestures.push({ type: 'passer', file: FILES[file]!, ply });
      break; // one passer story per line is plenty
    }
  }

  if (stormFiles.size >= 2 && stormWing !== null) {
    gestures.push({ type: 'storm', wing: stormWing.wing, ply: stormFirstPly });
  }
  // A king WALK goes somewhere: two-plus steps ending at least two squares
  // from home. Without the distance test a king shuffling on the spot read
  // as a march, which also broke the quiet detection below.
  if (kingSteps >= 2 && kingLast !== undefined && kingStart !== undefined) {
    const distance = Math.max(
      Math.abs(squareFile(kingLast) - squareFile(kingStart)),
      Math.abs(squareRank(kingLast) - squareRank(kingStart)),
    );
    if (distance >= 2) {
      gestures.push({ type: 'kingWalk', to: makeSquare(kingLast), ply: kingFirstPly });
    }
  }

  // Nothing moved the position at all: that IS the reading — but only
  // under real quiet, no captures and no pawn moves by either side.
  if (gestures.length === 0) {
    const anyPawnOrCapture = replay.steps.some((s) => s.captured || s.piece.role === 'pawn');
    if (!anyPawnOrCapture) return { side: replay.mover, gestures: [{ type: 'quiet', ply: 0 }] };
    return null;
  }

  // Score (type weight, decayed toward the tail — the head of a PV is the
  // verified part), pick the top three, then tell them in line order.
  const scored = gestures
    .map((g) => ({ g, score: WEIGHT[g.type] / (1 + g.ply / 10) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.g)
    .sort((a, b) => a.ply - b.ply);

  return { side: replay.mover, gestures: scored };
}

// ---------------------------------------------------------------------------
// Refutation classification (for the why-not probe)

export type Refutation =
  | { kind: 'mate'; movesUntil: number }
  | { kind: 'material'; amount: number }
  | { kind: 'positional' };

/**
 * Classify HOW a move fails, given the engine's reply line: it runs into
 * mate, it loses material by the end of the line, or nothing concrete
 * shows — which is the honest definition of "positionally worse". The
 * chances delta is the caller's to report; this only names the mechanism.
 * The END of the line is what the engine believes sticks; a dip along the
 * way may just be the middle of an exchange.
 */
export function classifyRefutation(
  fenBeforeMove: string,
  moveUci: string,
  replyPv: string[],
  mateIn?: number,
): Refutation {
  if (mateIn !== undefined) return { kind: 'mate', movesUntil: Math.abs(mateIn) };

  const replay = replayLine(fenBeforeMove, [moveUci, ...replyPv]);
  const last = replay?.steps.at(-1);
  if (!replay || !last) return { kind: 'positional' };

  const delta = balance(last.boardAfter, replay.mover) - balance(replay.startBoard, replay.mover);
  if (delta <= -2) return { kind: 'material', amount: -delta };
  return { kind: 'positional' };
}

// ---------------------------------------------------------------------------
// Null-move FEN (for the threat probe)

/**
 * The FEN with the side to move flipped and en passant cleared — "what if
 * the mover passed". Returns null when passing is not a legal thing to ask
 * (the mover is in check, or the FEN is broken): a null move in check is
 * not prophylaxis, it is losing the king.
 */
export function nullMoveFen(fen: string): string | null {
  const setup = parseFen(fen);
  if (setup.isErr) return null;
  const parsed = setup.unwrap();
  const position = Chess.fromSetup(parsed);
  if (position.isErr) return null;
  if (position.unwrap().isCheck()) return null;

  parsed.turn = opposite(parsed.turn);
  parsed.epSquare = undefined;
  // Re-validate: with the turn flipped the old mover's king must not be
  // capturable, and chessops is the arbiter of that.
  if (Chess.fromSetup(parsed).isErr) return null;

  const fields = fen.split(' ');
  fields[1] = parsed.turn === 'white' ? 'w' : 'b';
  fields[3] = '-';
  return fields.join(' ');
}
