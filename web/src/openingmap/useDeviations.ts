import { useEffect, useMemo, useState } from 'react';
import { parseFen } from 'chessops/fen';
import { hashSetup } from '@shared/zobrist';
import { api } from '@/lib/api';
import { collectPreparedFens, collectStudyTags } from './coverage';
import type { OpeningMap, ResolvedMap } from './model';
import { scopedEntries } from './useCoverage';

/**
 * Which of your games left the map's prepared ground, delivered to the
 * node it happened at. Fetched once per map (the prepared set is hashed
 * with the book scheme and handed to the games index) and grouped by
 * position, so the panel of any charted node can say "these games left
 * here, playing this" — the actionable unit, next to the button that
 * charts the very move that left.
 */

export interface Deviation {
  file: string;
  idx: number;
  white: string;
  black: string;
  result: string;
  date: string | null;
  ply: number;
  sans: string[];
  key: string;
  userDeviated: boolean;
}

export function useDeviations(
  map: OpeningMap | null,
  resolved: ResolvedMap | null,
): ReadonlyMap<string, Deviation[]> {
  const [all, setAll] = useState<Deviation[]>([]);

  useEffect(() => {
    if (!map || !resolved) return;
    let live = true;
    void (async () => {
      const chapters = scopedEntries(collectStudyTags(map)).map((e) => e.chapter);
      const keys = [...collectPreparedFens(resolved, chapters)].flatMap((fen) => {
        const setup = parseFen(fen);
        return setup.isErr ? [] : [hashSetup(setup.value).toString(16)];
      });
      if (keys.length === 0) return;
      try {
        const body = await api<{ deviations: Deviation[] }>('/api/mygames/deviations', {
          method: 'POST',
          json: { keys, side: map.color, limit: 300 },
        });
        if (live) setAll(body.deviations);
      } catch {
        // No games index is a quiet panel, not an error.
        if (live) setAll([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [map, resolved]);

  return useMemo(() => {
    const out = new Map<string, Deviation[]>();
    if (!resolved || all.length === 0) return out;
    const nodeByKey = new Map<string, string>();
    for (const [id, facts] of resolved.nodes) {
      if (!facts.fen) continue;
      const setup = parseFen(facts.fen);
      if (!setup.isErr) nodeByKey.set(hashSetup(setup.value).toString(16), id);
    }
    for (const d of all) {
      const nodeId = nodeByKey.get(d.key);
      if (!nodeId) continue;
      const arr = out.get(nodeId) ?? [];
      arr.push(d);
      out.set(nodeId, arr);
    }
    return out;
  }, [resolved, all]);
}
