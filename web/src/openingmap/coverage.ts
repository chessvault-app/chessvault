import { getNode } from '@shared/tree';
import type { Chapter } from '@shared/types';
import {
  advanceCands,
  buildPosIndex,
  expectedSans,
  fenKey,
  type DrillCand,
} from '@/repertoire/drill';
import type { MapTag, OpeningMap, ResolvedMap } from './model';

/**
 * What the tagged studies actually prepare beneath each map node.
 *
 * All of a map's study tags are pooled into one position index: matching
 * is by position, so a study can never claim a branch its tree does not
 * contain, several studies tagged on one node merge into a union, and a
 * line reached by transposition counts once. Note tags are references for
 * the reader, never input here — only studies say what is prepared.
 */

export interface NodeCoverage {
  /** True when any tagged study holds this node's position. */
  covered: boolean;
  /** Union of continuations the studies prepare here, first-seen order. */
  preparedMoves: string[];
  /** Deepest prepared continuation beyond this node, in plies. */
  preparedPlies: number;
  /** Prepared end-of-line positions beneath this node. */
  lineCount: number;
  /** Positions here or beneath whose latest drill was a miss. */
  reviewCount: number;
  /** Positions here or beneath where a drill found the studies wanting. */
  gapCount: number;
}

/** The drill record's word on positions, keyed the drill's way (fenKey). */
export interface DrillMarks {
  review: ReadonlySet<string>;
  gaps: ReadonlySet<string>;
}

const NONE: NodeCoverage = {
  covered: false,
  preparedMoves: [],
  preparedPlies: 0,
  lineCount: 0,
  reviewCount: 0,
  gapCount: 0,
};

/** Every study tag on the map, deduplicated by document and chapter scope. */
export function collectStudyTags(map: OpeningMap): MapTag[] {
  const seen = new Set<string>();
  const out: MapTag[] = [];
  const stack = [map.root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    for (const tag of node.tags ?? []) {
      if (tag.kind !== 'study') continue;
      const key = `${tag.id}\n${tag.chapter ?? ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(tag);
      }
    }
    stack.push(...node.children);
  }
  return out;
}

/** A chapter tag covers the chapter itself and its sub-chapters. */
const inScope = (chapterName: string, tagChapter: string | undefined): boolean =>
  tagChapter === undefined ||
  chapterName === tagChapter ||
  chapterName.startsWith(`${tagChapter}/`);

/**
 * The chapters the map's tags put in scope, each at most once even when
 * overlapping tags (whole study + one chapter) both reach it.
 */
export function scopedChapters(
  tags: MapTag[],
  studies: ReadonlyMap<string, Chapter[]>,
): Chapter[] {
  const seen = new Set<Chapter>();
  const out: Chapter[] = [];
  for (const tag of tags) {
    for (const chapter of studies.get(tag.id) ?? []) {
      if (inScope(chapter.name, tag.chapter) && !seen.has(chapter)) {
        seen.add(chapter);
        out.push(chapter);
      }
    }
  }
  return out;
}

/**
 * The full-move number the union preparation reaches from a node — what
 * a user-set intended depth (also in full moves) is compared against.
 * A position after ply k belongs to move ceil(k/2).
 */
export const reachedMove = (ply: number, preparedPlies: number): number =>
  Math.ceil((ply + preparedPlies) / 2);

/** Past this, a "prepared line" is an imported game, not preparation. */
const MAX_WALK_PLIES = 60;

/**
 * Every position the map stands on: the charted nodes plus the whole
 * union subtree the tagged studies prepare, as full FENs. This is the
 * set a game is checked against to find where it left the book — a game
 * inside it is on prepared ground, the first move out is the deviation.
 */
export function collectPreparedFens(resolved: ResolvedMap, chapters: Chapter[]): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  for (const facts of resolved.nodes.values()) {
    if (facts.fen && !seen.has(fenKey(facts.fen))) {
      seen.add(fenKey(facts.fen));
      out.add(facts.fen);
    }
  }
  for (const chapter of chapters) {
    const stack = [chapter.tree.rootId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const node = getNode(chapter.tree, id);
      if (!seen.has(fenKey(node.fen))) {
        seen.add(fenKey(node.fen));
        out.add(node.fen);
      }
      stack.push(...node.children);
    }
  }
  return out;
}

/**
 * Coverage per map node, keyed by node id. Each node's stats walk the
 * union subtree from its own position, so a parent's numbers include
 * everything beneath its children — that is the point of an overview.
 */
export function computeCoverage(
  resolved: ResolvedMap,
  chapters: Chapter[],
  marks?: DrillMarks,
): Map<string, NodeCoverage> {
  const out = new Map<string, NodeCoverage>();
  if (chapters.length === 0) {
    for (const id of resolved.nodes.keys()) out.set(id, NONE);
    return out;
  }
  const posIndex = buildPosIndex(chapters);

  const fenOfChild = (cands: DrillCand[], san: string): string | null => {
    for (const cand of cands) {
      const tree = chapters[cand.ci]!.tree;
      for (const childId of getNode(tree, cand.nodeId).children) {
        const child = getNode(tree, childId);
        if (child.san === san) return child.fen;
      }
    }
    return null;
  };

  for (const [id, node] of resolved.nodes) {
    if (node.fen === null) {
      out.set(id, NONE);
      continue;
    }
    const startKey = fenKey(node.fen);
    const startCands = posIndex.get(startKey) ?? [];
    if (startCands.length === 0) {
      out.set(id, NONE);
      continue;
    }

    const visited = new Set([startKey]);
    let frontier: { cands: DrillCand[]; ply: number }[] = [{ cands: startCands, ply: 0 }];
    let preparedPlies = 0;
    let lineCount = 0;
    // The drill record's marks, counted over the same walk: a parent's
    // numbers include everything beneath it, like the rest of coverage.
    let reviewCount = marks?.review.has(startKey) ? 1 : 0;
    let gapCount = marks?.gaps.has(startKey) ? 1 : 0;
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const { cands, ply } of frontier) {
        const moves = expectedSans(chapters, cands);
        if (moves.length === 0 || ply >= MAX_WALK_PLIES) {
          lineCount += 1;
          continue;
        }
        for (const san of moves) {
          const fen = fenOfChild(cands, san);
          if (!fen) continue;
          const key = fenKey(fen);
          // A transposition back into a walked position ends the line
          // here instead of looping; its continuations were counted when
          // the position was first reached.
          if (visited.has(key)) continue;
          visited.add(key);
          if (marks?.review.has(key)) reviewCount += 1;
          if (marks?.gaps.has(key)) gapCount += 1;
          preparedPlies = Math.max(preparedPlies, ply + 1);
          next.push({ cands: advanceCands(chapters, posIndex, cands, san, key), ply: ply + 1 });
        }
      }
      frontier = next;
    }
    out.set(id, {
      covered: true,
      preparedMoves: expectedSans(chapters, startCands),
      preparedPlies,
      lineCount,
      reviewCount,
      gapCount,
    });
  }
  return out;
}
