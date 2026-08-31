import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePgn, parseComment, walk, type PgnNodeData } from 'chessops/pgn';
import {
  chaptersToPgn,
  gameToTree,
  pgnToChapters,
  safeCommentText,
  studyNameFromPgn,
  treeToPgn,
} from './pgn.ts';
import { addSan, collectSubtree, createTree, getNode, updateNode } from './tree.ts';
import type { MoveTree } from './types.ts';

const fixture = readFileSync(
  fileURLToPath(new URL('./__fixtures__/lichess-study-4I4GynHK.pgn', import.meta.url)),
  'utf8',
);

/**
 * Structural fingerprint of a PGN, derived independently of our own tree code so
 * a bug in `gameToTree` can't hide by corrupting both sides of the comparison.
 */
interface Fingerprint {
  moves: number;
  variations: number;
  comments: number;
  shapes: number;
  nags: number;
  evals: number;
  sans: string[];
}

function fingerprint(pgn: string): Fingerprint {
  const ctx = { clone: () => ctx };
  const fp: Fingerprint = {
    moves: 0,
    variations: 0,
    comments: 0,
    shapes: 0,
    nags: 0,
    evals: 0,
    sans: [],
  };
  for (const game of parsePgn(pgn)) {
    walk(game.moves, ctx, (_c, data: PgnNodeData) => {
      fp.moves++;
      fp.sans.push(data.san);
      fp.nags += data.nags?.length ?? 0;
      for (const raw of [...(data.comments ?? []), ...(data.startingComments ?? [])]) {
        fp.comments++;
        const parsed = parseComment(raw);
        fp.shapes += parsed.shapes.length;
        if (parsed.evaluation) fp.evals++;
      }
    });
    const countBranches = (node: { children: unknown[] }): void => {
      if (node.children.length > 1) fp.variations += node.children.length - 1;
      for (const child of node.children) countBranches(child as { children: unknown[] });
    };
    countBranches(game.moves);
  }
  fp.sans.sort();
  return fp;
}

describe('PGN codec round-trip', () => {
  it('parses the fixture into chapters with real content', () => {
    const chapters = pgnToChapters(fixture);
    expect(chapters).toHaveLength(13);
    // Every chapter should have actual moves, not just headers.
    for (const chapter of chapters) {
      expect(collectSubtree(chapter.tree, chapter.tree.rootId).length).toBeGreaterThan(1);
      expect(chapter.name).toBeTruthy();
    }
  });

  it('preserves structure through tree -> PGN -> tree', () => {
    const before = fingerprint(fixture);
    // Guard against a vacuous pass: if the fixture ever parsed to nothing, the
    // equality below would trivially hold. Thresholds sit just under the
    // measured values (419 moves / 37 variations / 36 comments).
    expect(before.moves).toBeGreaterThan(400);
    expect(before.variations).toBeGreaterThan(30);
    expect(before.comments).toBeGreaterThan(30);
    // This fixture carries no shapes, NAGs or evals — those are covered by the
    // synthetic study below, which is why both tests exist.

    const after = fingerprint(chaptersToPgn(pgnToChapters(fixture)));
    expect(after).toEqual(before);
  });

  it('is idempotent: a second save is byte-identical', () => {
    // The property that actually protects the vault — repeatedly opening and
    // saving a study must never drift.
    const once = chaptersToPgn(pgnToChapters(fixture));
    const twice = chaptersToPgn(pgnToChapters(once));
    expect(twice).toBe(once);
  });

  it('preserves arrows, circles, evals and NAGs on a synthetic study', () => {
    let tree: MoveTree = createTree();
    let cursor = tree.rootId;
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
      const result = addSan(tree, cursor, san);
      expect(result, `${san} should be legal`).toBeDefined();
      tree = result!.tree;
      cursor = result!.nodeId;
    }

    // Annotate the last move the way the study UI will.
    tree = updateNode(tree, cursor, {
      comment: 'Morphy Defence — the main line.',
      nags: [1],
      shapes: [
        { color: 'green', from: 33, to: 42 },
        { color: 'red', from: 27, to: 27 },
      ],
      eval: { cp: 35, depth: 24 },
    });

    // Add a variation off the previous move so branching is exercised too.
    const parentOfLast = getNode(tree, cursor).parentId!;
    const variation = addSan(tree, parentOfLast, 'Nf6');
    expect(variation).toBeDefined();
    tree = updateNode(variation!.tree, variation!.nodeId, {
      comment: 'Berlin Defence.',
      nags: [5],
    });

    const pgn = treeToPgn(tree, { Event: 'Synthetic' });

    // Assert the on-disk form is Lichess's own syntax, not a private encoding.
    expect(pgn).toContain('[%cal Gb5c6]');
    expect(pgn).toContain('[%csl Rd4]');
    expect(pgn).toContain('[%eval 0.35]');
    expect(pgn).toContain('$1');
    expect(pgn).toContain('Nf6');

    // And that it survives a reload.
    const reloaded = pgnToChapters(pgn)[0]!;
    const annotated = collectSubtree(reloaded.tree, reloaded.tree.rootId)
      .map((id) => getNode(reloaded.tree, id))
      .find((n) => n.san === 'a6');

    expect(annotated).toBeDefined();
    expect(annotated!.comment).toBe('Morphy Defence — the main line.');
    expect(annotated!.nags).toEqual([1]);
    expect(annotated!.shapes).toHaveLength(2);
    expect(annotated!.eval?.cp).toBe(35);
  });

  it('keeps a custom starting position', () => {
    const fen = '4k3/8/8/8/8/8/8/R3K3 w Q - 0 1';
    let tree = createTree(fen);
    const played = addSan(tree, tree.rootId, 'Ra8');
    expect(played).toBeDefined();
    tree = played!.tree;

    const pgn = treeToPgn(tree, {});
    expect(pgn).toContain('[FEN "4k3/8/8/8/8/8/8/R3K3 w Q - 0 1"]');
    expect(pgn).toContain('[SetUp "1"]');

    const reloaded = pgnToChapters(pgn)[0]!;
    expect(reloaded.tree.initialFen).toBe(fen);
  });

  it('reads variations that begin immediately at the first move', () => {
    // A branch at ply 1 is the case my first DFS attempt silently dropped.
    const pgn = '1. e4 (1. d4 d5 2. c4) e5 2. Nf3 *';
    const tree = gameToTree(parsePgn(pgn)[0]!);
    const sans = collectSubtree(tree, tree.rootId)
      .map((id) => getNode(tree, id).san)
      .filter(Boolean);
    expect(sans).toContain('e4');
    expect(sans).toContain('d4');
    expect(sans).toContain('d5');
    expect(sans).toContain('c4');
    expect(getNode(tree, tree.rootId).children).toHaveLength(2);
  });

  it('skips an illegal move without discarding the rest of the game', () => {
    const tree = gameToTree(parsePgn('1. e4 e5 2. Qxf7 Nf6 3. Nf3 *')[0]!);
    const sans = collectSubtree(tree, tree.rootId)
      .map((id) => getNode(tree, id).san)
      .filter(Boolean);
    expect(sans).toEqual(['e4', 'e5']);
  });

  it('round-trips %clk clocks losslessly (chess.com imports carry them)', () => {
    const pgn = '1. e4 {[%clk 0:09:58.1]} e5 {[%clk 0:09:55] good} 2. Nf3 *';
    const tree = gameToTree(parsePgn(pgn)[0]!);
    const ids = collectSubtree(tree, tree.rootId);
    const e4 = getNode(tree, ids[1]!);
    const e5 = getNode(tree, ids[2]!);
    expect(e4.clock).toBeCloseTo(598.1);
    expect(e5.clock).toBe(595);
    expect(e5.comment).toBe('good');

    const out = treeToPgn(tree, {});
    expect(out).toContain('[%clk 0:09:58.1]');
    expect(out).toContain('[%clk 0:09:55]');
    // Idempotence: a second round-trip must not drift.
    expect(treeToPgn(gameToTree(parsePgn(out)[0]!), {})).toBe(out);
  });

  it('drops the annotation commands nothing reads (chess.com timestamps)', () => {
    const pgn =
      '1. e4 {[%clk 0:09:59.1][%timestamp 9]} e5 {[%clk 0:09:57.5] sharp [%timestamp 25]} ' +
      '2. Nf3 {[%c_effect g6;square;g6;type;Winner;animated;true]} *';
    const tree = gameToTree(parsePgn(pgn)[0]!);
    const ids = collectSubtree(tree, tree.rootId);
    const [e4, e5, nf3] = [1, 2, 3].map((i) => getNode(tree, ids[i]!));
    expect(e4!.comment).toBeUndefined();
    expect(e5!.comment).toBe('sharp');
    expect(nf3!.comment).toBeUndefined();
    // The clocks beside them still survive.
    expect(e4!.clock).toBeCloseTo(599.1);

    const out = treeToPgn(tree, {});
    expect(out).not.toContain('timestamp');
    expect(out).not.toContain('c_effect');
  });
});

/**
 * What a writer types into the annotation box, and what comes back.
 *
 * Two characters used to be eaten between the box and the file, silently
 * and in different ways: `makePgn` deletes `}` because a brace comment has
 * no escape, and `[%...]` is either stripped as an unread command or —
 * worse — READ, so prose becomes an evaluation or an arrow. Both are now
 * rewritten as they are typed, and this is the proof that what survives
 * the rewrite survives the file too.
 */
describe('safeCommentText', () => {
  /** Comment in, comment out, through the real codec. */
  function roundTrip(comment: string): { text?: string; shapes: number; hasEval: boolean } {
    const start = createTree();
    const added = addSan(start, start.rootId, 'e4')!;
    const tree = updateNode(added.tree, added.nodeId, { comment });
    const back = pgnToChapters(treeToPgn(tree, { Event: 'x' }))[0]!.tree;
    const node = getNode(back, getNode(back, back.rootId).children[0]!);
    return { text: node.comment, shapes: node.shapes.length, hasEval: node.eval !== undefined };
  }

  it('leaves a comment that was never at risk exactly as it was', () => {
    const plain = 'The rook belongs behind the pawn — see chapter 3 (Lucena).';
    expect(safeCommentText(plain)).toBe(plain);
    expect(roundTrip(plain).text).toBe(plain);
  });

  it('rewrites the brace that makePgn would otherwise delete', () => {
    // Unrewritten this reaches the file as "{ Bad  here }" and reads back
    // as "Bad here" — the character gone and the double space with it.
    expect(roundTrip('Bad } here').text).toBe('Bad here');
    expect(safeCommentText('Bad } here')).toBe('Bad ) here');
    expect(roundTrip(safeCommentText('Bad } here')).text).toBe('Bad ) here');
  });

  it('rewrites a typed command that would otherwise become data', () => {
    // The failure this exists for: prose is not analysis. Unrewritten, the
    // text is gone and the move carries a +9.9 nobody assessed.
    const evaluation = roundTrip('[%eval 9.9] surely winning');
    expect(evaluation.text).toBe('surely winning');
    expect(evaluation.hasEval).toBe(true);

    const safe = roundTrip(safeCommentText('[%eval 9.9] surely winning'));
    expect(safe.text).toBe('[ %eval 9.9] surely winning');
    expect(safe.hasEval).toBe(false);
  });

  it('rewrites a typed shape command, which would otherwise draw an arrow', () => {
    expect(roundTrip('[%cal Ra1a8] the open file').shapes).toBe(1);
    const safe = roundTrip(safeCommentText('[%cal Ra1a8] the open file'));
    expect(safe.text).toBe('[ %cal Ra1a8] the open file');
    expect(safe.shapes).toBe(0);
  });

  it('leaves a lone { alone, because it is not lost', () => {
    // Measured: chessops reads to the first `}`, and there is no longer one
    // to find, so an opening brace is just a character both ways.
    expect(safeCommentText('a { b')).toBe('a { b');
    expect(roundTrip('a { b').text).toBe('a { b');
  });

  it('is idempotent — retyping in a box that already holds a rewrite', () => {
    // The handler runs over the WHOLE box on every keystroke, so a rewrite
    // from the previous one must not be rewritten again into `[  %`.
    const once = safeCommentText('} and [%clk 0:01:00]');
    expect(safeCommentText(once)).toBe(once);
  });

  it('keeps the real commands our own writer emits', () => {
    // The rewrite belongs to what is TYPED. Shapes and evaluations still
    // reach the file as commands, because joinComment builds those.
    const start = createTree();
    const added = addSan(start, start.rootId, 'e4')!;
    const tree = updateNode(added.tree, added.nodeId, {
      comment: safeCommentText('winning'),
      eval: { cp: 990, depth: 20 },
      shapes: [{ color: 'red', from: 0, to: 56 }],
    });
    const back = pgnToChapters(treeToPgn(tree, { Event: 'x' }))[0]!.tree;
    const node = getNode(back, getNode(back, back.rootId).children[0]!);
    expect(node.comment).toBe('winning');
    expect(node.eval?.cp).toBe(990);
    expect(node.shapes).toHaveLength(1);
  });
});

/**
 * The title an import window can fill in for itself. A wrong guess lands
 * in a field that becomes a filename, so disagreement means no answer.
 */
describe('studyNameFromPgn', () => {
  it('reads the StudyName tag a Lichess export puts on every chapter', () => {
    // The real export carries [StudyName] beside [ChapterName]; Event is
    // "<study>: <chapter>", and both agree.
    expect(fixture).toContain('[StudyName "Lucas Opening Homework - Ruy Lopez"]');
    expect(studyNameFromPgn(fixture)).toBe('Lucas Opening Homework - Ruy Lopez');
  });

  it('prefers the tag to the Event line when they disagree', () => {
    // A chapter whose own name contains ": " splits an Event wrongly; the
    // tag is what the study is actually called.
    const pgn = `[Event "Endgames: rook: Lucena"]
[StudyName "Endgames: rook"]
[ChapterName "Lucena"]

1. e4 *
`;
    expect(studyNameFromPgn(pgn)).toBe('Endgames: rook');
  });

  it('falls back to the Event line, splitting on the first colon', () => {
    const pgn = `[Event "Endgames: rook: Lucena"]

1. e4 *

[Event "Endgames: rook: Philidor"]

1. e4 *
`;
    expect(studyNameFromPgn(pgn)).toBe('Endgames');
  });

  it('names a single game by its event', () => {
    expect(studyNameFromPgn('[Event "Tal memorial"]\n\n1. e4 *\n')).toBe('Tal memorial');
  });

  it('says nothing when the games disagree, or say nothing themselves', () => {
    const mixed = `[Event "One"]

1. e4 *

[Event "Two"]

1. e4 *
`;
    expect(studyNameFromPgn(mixed)).toBeNull();
    expect(studyNameFromPgn('[Event "?"]\n\n1. e4 *\n')).toBeNull();
    expect(studyNameFromPgn('1. e4 e5 *\n')).toBeNull();
  });
});
