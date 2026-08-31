import { makeFen } from 'chessops/fen';
import {
  ChildNode,
  Node as PgnNode,
  makeComment,
  makePgn,
  parseComment,
  parsePgn,
  startingPosition,
  type Game,
  type PgnNodeData,
} from 'chessops/pgn';
import { makeSanAndPlay, parseSan } from 'chessops/san';
import { makeUci } from 'chessops/util';
import type { Chess } from 'chessops/chess';
import type { Chapter, CommentShape, Headers, MoveNode, MoveTree, NodeEval, NodeId } from './types.ts';
import { createTree, getNode, INITIAL_FEN } from './tree.ts';

/**
 * PGN <-> MoveTree adapter.
 *
 * Built on `chessops/pgn`, which is Lichess's own codec — so annotations survive
 * a round-trip in exactly the form Lichess writes them: arrows as `[%cal]`,
 * circles as `[%csl]`, evaluations as `[%eval]`. That is what lets studies live
 * on disk as ordinary PGN with nothing lost.
 */

let chapterCounter = 0;
const nextChapterId = (): string => `c${(++chapterCounter).toString(36)}`;

let parsedNodeCounter = 0;
/** Counter rather than `Object.keys(nodes).length`, which would make parsing O(n²). */
const nextParsedId = (): NodeId => `q${(++parsedNodeCounter).toString(36)}`;

/**
 * Annotation commands nothing here reads, stripped from comment text.
 *
 * `parseComment` lifts out the four it knows — `[%eval]`, `[%clk]`, `[%cal]`,
 * `[%csl]` — and leaves every other `[%...]` sitting in the text. A chess.com
 * export carries `[%timestamp]` on every single move (and `[%c_effect]` on the
 * last), so without this an imported game shows that machinery as a comment on
 * every move.
 */
const UNREAD_COMMAND = /\[%[^\]]*\]/g;

/** Text of a comment once the commands nothing reads are removed. */
export function commentText(text: string): string {
  return text.replace(UNREAD_COMMAND, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The two shapes a typed comment cannot keep, rewritten so that it can.
 *
 * A brace comment has no escape in PGN — `}` simply ends it — so chessops'
 * `makePgn` DELETES every `}` on the way out. That is the right thing to do,
 * since the alternative is a comment breaking out into movetext; it is only
 * wrong about *when*, happening at save time, long after the writer stopped
 * looking at what they typed.
 *
 * `[%...]` is worse than deleted. `UNREAD_COMMAND` above strips the commands
 * nothing reads, and `parseComment` turns the four it does know into fields,
 * so prose reading `[%eval 9.9]` comes back as a +9.9 evaluation on the move
 * and `[%cal Ra1a8]` as an arrow nobody drew — measured, both.
 *
 * The editor therefore rewrites both AS THEY ARE TYPED, where the change is
 * visible and one keystroke old: `}` becomes `)`, and a single space breaks
 * the command shape while keeping every character. A lone `{` is left alone,
 * because it is not lost — with the `}` gone it round-trips intact.
 */
export function safeCommentText(text: string): string {
  return text.replace(/\}/g, ')').replace(/\[%/g, '[ %');
}

/** Split one chessops comment string into our structured fields. */
function splitComment(raw: string[] | undefined): {
  text?: string;
  shapes: CommentShape[];
  eval?: NodeEval;
  clock?: number;
} {
  if (!raw || raw.length === 0) return { shapes: [] };

  const texts: string[] = [];
  const shapes: CommentShape[] = [];
  let evaluation: NodeEval | undefined;
  let clock: number | undefined;

  for (const chunk of raw) {
    const parsed = parseComment(chunk);
    const text = commentText(parsed.text);
    if (text) texts.push(text);
    shapes.push(...parsed.shapes);
    if (parsed.clock !== undefined) clock = parsed.clock;
    if (parsed.evaluation) {
      evaluation =
        'pawns' in parsed.evaluation
          ? { cp: Math.round(parsed.evaluation.pawns * 100), depth: 0 }
          : { mate: parsed.evaluation.mate, depth: 0 };
    }
  }

  return {
    text: texts.length > 0 ? texts.join('\n') : undefined,
    shapes,
    ...(evaluation ? { eval: evaluation } : {}),
    ...(clock !== undefined ? { clock } : {}),
  };
}

/** Rebuild a single chessops comment string from our structured fields. */
function joinComment(node: MoveNode): string[] {
  const hasEval = node.eval && (node.eval.cp !== undefined || node.eval.mate !== undefined);
  if (!node.comment && node.shapes.length === 0 && !hasEval && node.clock === undefined) return [];

  const comment = makeComment({
    text: node.comment ?? '',
    shapes: node.shapes,
    ...(node.clock !== undefined ? { clock: node.clock } : {}),
    ...(hasEval
      ? {
          evaluation:
            node.eval!.mate !== undefined
              ? { mate: node.eval!.mate }
              : { pawns: node.eval!.cp! / 100 },
        }
      : {}),
  });
  // Trimmed: a comment carrying only a clock has an empty text field in
  // front of it, which `makeComment` renders as a leading space.
  const trimmed = comment.trim();
  return trimmed.length > 0 ? [trimmed] : [];
}

/** Convert one parsed PGN game into a `MoveTree`. */
export function gameToTree(game: Game<PgnNodeData>): MoveTree {
  const posResult = startingPosition(game.headers);
  if (posResult.isErr) {
    throw new Error(`unsupported starting position: ${posResult.error.message}`);
  }
  const start = posResult.unwrap() as Chess;
  const initialFen = makeFen(start.toSetup());
  const tree = createTree(initialFen);

  // Root-level comments live on the Game, not on `moves` — `Node` has no
  // `comments` field at all.
  const rootComment = splitComment(game.comments);
  if (rootComment.text || rootComment.shapes.length > 0) {
    const root = tree.nodes[tree.rootId]!;
    root.comment = rootComment.text;
    root.shapes = rootComment.shapes;
  }

  // Plain DFS where each frame is exactly one move to apply. Carrying a cloned
  // position per frame is what lets a variation resume from its branch point
  // without re-deriving the FEN from the start of the game.
  interface Frame {
    child: ChildNode<PgnNodeData>;
    parentId: NodeId;
    pos: Chess;
  }
  const stack: Frame[] = [];
  const push = (node: PgnNode<PgnNodeData>, parentId: NodeId, pos: Chess): void => {
    // Reversed so children[0] (the mainline) is popped and applied first.
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ child: node.children[i]!, parentId, pos: pos.clone() });
    }
  };
  push(game.moves, tree.rootId, start);

  while (stack.length > 0) {
    const { child, parentId, pos } = stack.pop()!;
    const applied = applyPgnChild(tree, parentId, pos, child);
    // Illegal SAN: skip this move and everything under it, but keep the rest of
    // the game. The chessops parser is deliberately lenient about legality.
    if (!applied) continue;
    push(child, applied.nodeId, applied.pos);
  }

  return tree;
}

function applyPgnChild(
  tree: MoveTree,
  parentId: NodeId,
  pos: Chess,
  child: ChildNode<PgnNodeData>,
): { nodeId: NodeId; pos: Chess } | undefined {
  const move = parseSan(pos, child.data.san);
  if (!move || !pos.isLegal(move)) return undefined;

  const next = pos.clone();
  const san = makeSanAndPlay(next, move);
  const parent = getNode(tree, parentId);

  const id = nextParsedId();
  const { text, shapes, eval: evaluation, clock } = splitComment(child.data.comments);
  const starting = splitComment(child.data.startingComments);

  const node: MoveNode = {
    id,
    parentId,
    san,
    uci: makeUci(move),
    fen: makeFen(next.toSetup()),
    ply: parent.ply + 1,
    children: [],
    nags: child.data.nags ? [...child.data.nags] : [],
    shapes,
    ...(text ? { comment: text } : {}),
    ...(starting.text ? { startingComment: starting.text } : {}),
    ...(evaluation ? { eval: evaluation } : {}),
    ...(clock !== undefined ? { clock } : {}),
  };

  tree.nodes[id] = node;
  parent.children.push(id);
  return { nodeId: id, pos: next };
}

/** Convert a `MoveTree` back into a chessops `Game`, ready for `makePgn`. */
function treeToGame(tree: MoveTree, headers: Headers): Game<PgnNodeData> {
  const root = new PgnNode<PgnNodeData>();
  const rootComments = joinComment(getNode(tree, tree.rootId));

  const build = (sourceId: NodeId, target: PgnNode<PgnNodeData>): void => {
    for (const childId of getNode(tree, sourceId).children) {
      const child = getNode(tree, childId);
      const data: PgnNodeData = { san: child.san! };
      if (child.nags.length > 0) data.nags = [...child.nags];
      const comments = joinComment(child);
      if (comments.length > 0) data.comments = comments;
      if (child.startingComment) data.startingComments = [child.startingComment];

      const pgnChild = new ChildNode<PgnNodeData>(data);
      target.children.push(pgnChild);
      build(childId, pgnChild);
    }
  };
  build(tree.rootId, root);

  const merged = new Map<string, string>(Object.entries(headers));
  // A non-standard start has to be recorded, or the PGN reads as a normal game.
  if (tree.initialFen !== INITIAL_FEN) {
    merged.set('FEN', tree.initialFen);
    merged.set('SetUp', '1');
  }

  return {
    headers: merged,
    moves: root,
    // Root annotations belong on the Game; makePgn emits these before move 1.
    ...(rootComments.length > 0 ? { comments: rootComments } : {}),
  };
}

/** Serialise a single tree to PGN text. */
export function treeToPgn(tree: MoveTree, headers: Headers = {}): string {
  return makePgn(treeToGame(tree, headers));
}

/**
 * Where one game's mainline ends up, as a FEN — or null if it cannot be
 * replayed (a variant, an unreadable start, an illegal move).
 *
 * This is what a thumbnail of a game should show. The position a board
 * OPENS at is the standard start for almost every game ever recorded, so
 * a shelf of those thumbnails is a shelf of identical pictures; the
 * position it ends at is the one the note or the study is about.
 *
 * Deliberately not a MoveTree: a listing calls this once per document and
 * needs one FEN, not a navigable game.
 */
export function mainlineEndFen(pgn: string): string | null {
  const game = parsePgn(pgn)[0];
  if (!game) return null;
  const start = startingPosition(game.headers);
  if (start.isErr) return null;
  const pos = start.unwrap();
  for (const data of game.moves.mainline()) {
    const move = parseSan(pos, data.san);
    // A move that will not parse means the rest is not this game — stop
    // where it was still true rather than guessing past it.
    if (!move) break;
    pos.play(move);
  }
  return makeFen(pos.toSetup());
}

/**
 * The study's own name, as carried by a PGN that came from one.
 *
 * Lichess says it outright: every chapter of an export is tagged
 * `[StudyName "…"]` beside its `[ChapterName "…"]`, so the name is
 * sitting in the text that was just pasted and asking for it again is
 * asking someone to copy it from the tab they exported it in.
 *
 * `[Event "Study name: Chapter name"]` is the fallback, because that is
 * the one line an export keeps when it has been through something else —
 * a database, a chess GUI, a paste that dropped the non-standard tags.
 * Everything but Event, Site, Date, Round, White, Black and Result is an
 * extension, and StudyName is Lichess's.
 *
 * Read with a regex rather than by parsing: this runs on every keystroke
 * in the PGN box, and an export can be a megabyte of moves whose headers
 * are the only part that matters here.
 *
 * Returns null unless the text agrees with itself — every game naming the
 * same study, or one game with nothing to disagree with it. A file of
 * unrelated games has no study name in it, and a wrong guess in a field
 * that is about to be a filename is worse than an empty one.
 */
export function studyNameFromPgn(pgn: string): string | null {
  const agreed = (values: string[]): string | null => {
    const [first] = values;
    if (!first || first === '?' || !values.every((v) => v === first)) return null;
    return first;
  };

  const stated = [...pgn.matchAll(/^\[StudyName\s+"([^"]*)"\]/gm)].map((m) => m[1]!.trim());
  if (stated.length > 0) return agreed(stated);

  // "Study: Chapter" — anything before the FIRST colon is the study, since
  // a chapter name may carry colons of its own.
  const events = [...pgn.matchAll(/^\[Event\s+"([^"]*)"\]/gm)].map((m) => {
    const value = m[1]!.trim();
    const at = value.indexOf(':');
    return (at === -1 ? value : value.slice(0, at)).trim();
  });
  return events.length > 0 ? agreed(events) : null;
}

/** Parse PGN text into chapters — one per game, as Lichess studies export. */
export function pgnToChapters(pgn: string): Chapter[] {
  return parsePgn(pgn).map((game, index) => {
    const headers = Object.fromEntries(game.headers);
    const name =
      headers['ChapterName'] ??
      headers['Event'] ??
      headers['Opening'] ??
      `Chapter ${index + 1}`;
    return { id: nextChapterId(), name, tree: gameToTree(game), headers };
  });
}

/** Serialise chapters back to a single multi-game PGN file. */
export function chaptersToPgn(chapters: Chapter[]): string {
  return chapters.map((c) => treeToPgn(c.tree, c.headers)).join('\n');
}
