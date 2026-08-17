import { addSan, createTree, getNode } from '@shared/tree';
import type { Chapter, MoveTree, NodeId } from '@shared/types';
import { fenKey } from '@/lib/fen';

/**
 * The drill's pure half: what "in book" means over a study.
 *
 * The drill's position is not one study node but a SET of them — every
 * node in scope that holds the current position. Several exist when
 * chapters branch from a shared line (a whole-study drill starts with
 * every chapter's root), or when a transposition lands on a position
 * another chapter, or another move order, reached its own way. A move is
 * in book when any candidate prepares it, or when it transposes into a
 * position the scope holds anywhere; the expected moves are the union.
 * The stateful half — steering the field, recording, the session — lives
 * in RepertoireView; see docs/repertoire.md for the algorithm end to end.
 */

/** An uncovered field reply is worth a note (and a vault record) from
    this share of games — below it, oddballs would drown the panel. */
export const GAP_NOTE_SHARE = 0.05;

export const studyChild = (tree: MoveTree, id: NodeId, san: string): NodeId | null =>
  getNode(tree, id).children.find((c) => getNode(tree, c).san === san) ?? null;

/** SANs replayed down a tree from a node — a template's line, a recorded
    path — stopping at the first that will not play. Returns the grown
    tree and the tip the replay reached. */
export const replayLine = (
  tree: MoveTree,
  fromId: NodeId,
  sans: string[],
): { tree: MoveTree; tip: NodeId } => {
  let grown = tree;
  let tip = fromId;
  for (const san of sans) {
    const added = addSan(grown, tip, san);
    if (!added) break;
    grown = added.tree;
    tip = added.nodeId;
  }
  return { tree: grown, tip };
};

export interface DrillCand {
  /** Index into the drill's chapters array. */
  ci: number;
  nodeId: NodeId;
}

/** Every node of every chapter in scope, keyed by position — how a
    transposition or another chapter's line is recognised mid-drill. */
export const buildPosIndex = (chapters: Chapter[]): Map<string, DrillCand[]> => {
  const map = new Map<string, DrillCand[]>();
  chapters.forEach((chapter, ci) => {
    const stack = [chapter.tree.rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = getNode(chapter.tree, id);
      const key = fenKey(node.fen);
      const arr = map.get(key) ?? [];
      arr.push({ ci, nodeId: id });
      map.set(key, arr);
      stack.push(...node.children);
    }
  });
  return map;
};

/** The union of moves the candidates prepare, first-seen order. */
export const expectedSans = (chapters: Chapter[], cands: DrillCand[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cand of cands) {
    const tree = chapters[cand.ci]!.tree;
    for (const childId of getNode(tree, cand.nodeId).children) {
      const san = getNode(tree, childId).san;
      if (san && !seen.has(san)) {
        seen.add(san);
        out.push(san);
      }
    }
  }
  return out;
};

/** The candidates after a move: each one's matching child, plus every
    node in scope that already holds the resulting position. Empty means
    the move is out of book everywhere. */
export const advanceCands = (
  chapters: Chapter[],
  posIndex: Map<string, DrillCand[]>,
  cands: DrillCand[],
  san: string,
  resultKey: string,
): DrillCand[] => {
  const seen = new Set<string>();
  const out: DrillCand[] = [];
  const push = (c: DrillCand): void => {
    const k = `${c.ci}:${c.nodeId}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };
  for (const cand of cands) {
    const child = studyChild(chapters[cand.ci]!.tree, cand.nodeId, san);
    if (child) push({ ci: cand.ci, nodeId: child });
  }
  for (const hit of posIndex.get(resultKey) ?? []) push(hit);
  return out;
};

/**
 * The scope's trunk: the shared single-line lead-in every line plays
 * before the study first branches. Deviations past the trunk are inside
 * the study's own territory; deviations before it are only relevant
 * when they stay in the same opening (see openingFamily) — 1...c5 is
 * not a hole in a Ruy Lopez study, 3...Nf6 is (lanph3re's point).
 */
export const trunkOf = (
  chapters: Chapter[],
  posIndex: Map<string, DrillCand[]>,
  seed: DrillCand[],
  startFen: string,
): { ply: number; fen: string } => {
  let game = createTree(startFen);
  let tip = game.rootId;
  let cands = seed;
  let ply = 0;
  for (;;) {
    const exp = expectedSans(chapters, cands);
    if (exp.length !== 1) break;
    const added = addSan(game, tip, exp[0]!);
    if (!added) break;
    game = added.tree;
    tip = added.nodeId;
    cands = advanceCands(chapters, posIndex, cands, exp[0]!, fenKey(getNode(game, tip).fen));
    if (cands.length === 0) break;
    ply += 1;
  }
  return { ply, fen: getNode(game, tip).fen };
};

/** "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense". */
export const openingFamily = (name: string | null | undefined): string | null => {
  if (!name) return null;
  const family = name.split(':')[0]!.trim();
  return family || null;
};
