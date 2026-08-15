import { useEffect, useMemo, useState } from 'react';
import { pgnToChapters } from '@shared/pgn';
import type { Chapter } from '@shared/types';
import { api } from '@/lib/api';
import { collectStudyTags, computeCoverage, scopedChapters, type NodeCoverage } from './coverage';
import type { MapTag, OpeningMap, ResolvedMap } from './model';

/**
 * The live half of coverage: fetch what the map's tags point at, then let
 * the pure half say what is prepared.
 *
 * Only tagged studies are ever fetched, each parsed once and kept for the
 * session, keyed by the listing's updatedAt so an edited study re-parses
 * on the next visit. A tag whose study is not in the listing any more is
 * reported as missing rather than dropped — a vanished study is
 * information, and the panel shows it as a broken reference.
 */

const parsed = new Map<string, { stamp: string; chapters: Chapter[] }>();

/**
 * The already-fetched chapters the given tags put in scope, each with the
 * study it came from — what a map-wide drill hands to the trainer. Only
 * studies the coverage pass has loaded appear; on a map whose coverage is
 * showing, that is all of them.
 */
export function scopedEntries(tags: MapTag[]): { study: string; chapter: Chapter }[] {
  const seen = new Set<Chapter>();
  const out: { study: string; chapter: Chapter }[] = [];
  for (const tag of tags) {
    if (tag.kind !== 'study') continue;
    const studies = new Map([[tag.id, parsed.get(tag.id)?.chapters ?? []]]);
    for (const chapter of scopedChapters([tag], studies)) {
      if (!seen.has(chapter)) {
        seen.add(chapter);
        out.push({ study: tag.id, chapter });
      }
    }
  }
  return out;
}

export function useCoverage(
  map: OpeningMap | null,
  resolved: ResolvedMap | null,
): {
  /** Undefined until the map has study tags — nothing to compare against. */
  coverage: ReadonlyMap<string, NodeCoverage> | undefined;
  /** Study ids tagged somewhere on the map but unloadable from the vault. */
  missing: ReadonlySet<string>;
} {
  const [version, bump] = useState(0);
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const tags = useMemo(() => (map ? collectStudyTags(map) : []), [map]);
  const ids = useMemo(() => [...new Set(tags.map((t) => t.id))].sort(), [tags]);
  const idsKey = ids.join('\n');

  useEffect(() => {
    if (ids.length === 0) {
      setMissing(new Set());
      return;
    }
    let live = true;
    void (async () => {
      const listing = await api<{ studies: { id: string; updatedAt: string }[] }>('/api/studies');
      const stamps = new Map(listing.studies.map((s) => [s.id, s.updatedAt]));
      const gone = new Set<string>();
      await Promise.all(
        ids.map(async (id) => {
          const stamp = stamps.get(id);
          if (stamp === undefined) {
            gone.add(id);
            parsed.delete(id);
            return;
          }
          if (parsed.get(id)?.stamp === stamp) return;
          try {
            const { pgn } = await api<{ pgn: string }>(`/api/studies/${encodeURIComponent(id)}`);
            parsed.set(id, { stamp, chapters: pgnToChapters(pgn) });
          } catch {
            gone.add(id);
          }
        }),
      );
      if (live) {
        setMissing(gone);
        bump((n) => n + 1);
      }
    })().catch(() => {});
    return () => {
      live = false;
    };
    // Keyed on the tagged ids; the listing is re-read when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const coverage = useMemo(() => {
    if (!map || !resolved || tags.length === 0) return undefined;
    const studies = new Map([...parsed].map(([id, hit]) => [id, hit.chapters]));
    return computeCoverage(resolved, scopedChapters(tags, studies));
    // `version` stands in for the module cache's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolved, tags, version]);

  return { coverage, missing };
}
