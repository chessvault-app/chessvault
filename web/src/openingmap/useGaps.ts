import { useEffect, useMemo, useState } from 'react';
import { fenKey } from '@/repertoire/drill';
import { fetchField, type FieldMove } from '@/repertoire/field';
import type { NodeCoverage } from './coverage';
import { computeGaps, type NodeGaps } from './gaps';
import type { OpeningMap, ResolvedMap } from './model';

/**
 * Gap detection's live half: ask the chosen field about every position
 * where the opponent moves, and compare what it plays with what the map
 * charts and the studies prepare.
 *
 * Answers are cached for the session per (source, band, position) — the
 * field's statistics do not change under you — and fetched a few at a
 * time so a deep map does not fire fifty requests at once. Source '' is
 * off: the whole hook is inert and the map costs no traffic.
 */

const cache = new Map<string, FieldMove[]>();
const CONCURRENCY = 4;

export function useGaps(
  map: OpeningMap | null,
  resolved: ResolvedMap | null,
  coverage: ReadonlyMap<string, NodeCoverage> | undefined,
  source: string,
  ratings: string,
): ReadonlyMap<string, NodeGaps> {
  const [version, bump] = useState(0);

  // Positions where the opponent is to move — the only ones the gap
  // question applies to.
  const wanted = useMemo(() => {
    if (!map || !resolved || !source) return [];
    const out: { id: string; fen: string }[] = [];
    for (const [id, facts] of resolved.nodes) {
      if (!facts.fen) continue;
      const turn = facts.fen.split(' ')[1] === 'w' ? 'white' : 'black';
      if (turn !== map.color) out.push({ id, fen: facts.fen });
    }
    return out;
  }, [map, resolved, source]);

  const missing = useMemo(
    () => wanted.filter(({ fen }) => !cache.has(`${source}\n${ratings}\n${fenKey(fen)}`)),
    // `version` re-checks after a batch lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wanted, source, ratings, version],
  );

  useEffect(() => {
    if (missing.length === 0) return;
    let live = true;
    const queue = [...missing];
    const worker = async (): Promise<void> => {
      for (;;) {
        const next = queue.shift();
        if (!next || !live) return;
        const key = `${source}\n${ratings}\n${fenKey(next.fen)}`;
        if (cache.has(key)) continue;
        try {
          cache.set(key, await fetchField(source, ratings, next.fen));
        } catch {
          // An unreachable field is a shrug, not an error banner: the
          // node simply shows no gap information this session.
          cache.set(key, []);
        }
      }
    };
    void Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [missing, source, ratings]);

  return useMemo(() => {
    const out = new Map<string, NodeGaps>();
    if (!map || !resolved || !source) return out;
    for (const { id, fen } of wanted) {
      const moves = cache.get(`${source}\n${ratings}\n${fenKey(fen)}`);
      if (!moves) continue;
      const node = resolved.nodes.get(id)!.mapNode;
      const met = new Set<string>();
      for (const child of node.children) if (child.san) met.add(child.san);
      for (const san of coverage?.get(id)?.preparedMoves ?? []) met.add(san);
      out.set(id, computeGaps(moves, met));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolved, coverage, wanted, source, ratings, version]);
}
