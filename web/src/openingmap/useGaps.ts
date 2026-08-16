import { useEffect, useMemo, useState } from 'react';
import { fenKey } from '@/repertoire/drill';
import { fetchField, fetchFieldBatch, ONLINE_SOURCE, type FieldMove } from '@/repertoire/field';
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
/**
 * Lanes against a LOCAL field, which is a database on the same machine
 * or the far end of a fast link rather than somebody's public API. Four
 * left a big map waiting on round trips it had no reason to take one at
 * a time; the online source keeps its own much lower number below.
 */
const CONCURRENCY = 8;
/** When a fetch failed, so a band that hit a rate limit RECOVERS: the
    failure is never written into the answer cache — an empty answer
    cached on a 429 blanked that band's statistics for the whole
    session — only remembered here long enough not to hammer. */
const failedAt = new Map<string, number>();
const RETRY_MS = 30_000;
/**
 * Requests already out, so one position is never asked twice at once.
 * It matters because progress is published while the queue is still
 * draining: each publish re-runs the effect over what is left, and
 * without this every position still in flight would be asked again.
 */
const inflight = new Map<string, Promise<FieldMove[]>>();

/** The cache key: source, band, which side's games, and the position. */
const keyFor = (
  source: string,
  ratings: string,
  fen: string,
  side: 'white' | 'black' | undefined,
): string => `${source}
${ratings}
${side ?? ''}
${fenKey(fen)}`;

/**
 * One position's field, through the same session cache the gap check
 * fills — selecting a node the gap check already asked about costs
 * nothing. Failures answer empty for THIS call but are not cached.
 * `side` matters to the own-games source alone (whose games count) and
 * is part of the key, so a white map and a black map never share rows.
 */
/** Put a batched answer into the cache the single-position path reads,
    so a panel opening on a position the sweep already covered costs
    nothing and asks nobody. */
export function cacheField(
  source: string,
  ratings: string,
  fen: string,
  side: 'white' | 'black' | undefined,
  moves: FieldMove[],
): void {
  cache.set(keyFor(source, ratings, fen, side), moves);
}

export async function fieldMovesFor(
  source: string,
  ratings: string,
  fen: string,
  side?: 'white' | 'black',
): Promise<FieldMove[]> {
  const key = `${source}\n${ratings}\n${side ?? ''}\n${fenKey(fen)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) return [];
  const running = inflight.get(key);
  if (running) return running;
  const answer = (async (): Promise<FieldMove[]> => {
    try {
      const moves = await fetchField(source, ratings, fen, side);
      cache.set(key, moves);
      failedAt.delete(key);
      return moves;
    } catch {
      failedAt.set(key, Date.now());
      return [];
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, answer);
  return answer;
}

export function useGaps(
  map: OpeningMap | null,
  resolved: ResolvedMap | null,
  coverage: ReadonlyMap<string, NodeCoverage> | undefined,
  source: string,
  ratings: string,
): {
  gaps: ReadonlyMap<string, NodeGaps>;
  /** Per node: how often its move gets played at the parent, 0..1 —
      what the canvas scales the dots by. */
  shares: ReadonlyMap<string, number>;
} {
  const [version, bump] = useState(0);
  // Own-games rows depend on whose games count; every other source
  // ignores it, and a constant key part is harmless there.
  const side = map?.color;
  const keyOf = (fen: string): string => `${source}\n${ratings}\n${side ?? ''}\n${fenKey(fen)}`;

  // Every charted position: gap questions apply only where the opponent
  // moves, but move shares (node sizing) need the parent field at every
  // node, so the whole map is asked for once.
  const wanted = useMemo(() => {
    if (!map || !resolved || !source) return [];
    const out: { id: string; fen: string; ply: number }[] = [];
    for (const [id, facts] of resolved.nodes) {
      if (facts.fen) out.push({ id, fen: facts.fen, ply: facts.ply });
    }
    // Shallowest first. `resolved.nodes` is in pre-order, so asking in
    // its order buries the whole queue in the first branch before the
    // second one is touched at all — on a 398-node map that is seconds
    // of the map sitting uncoloured while a single deep line fills in.
    // Depth order answers the big dots near the root first, which are
    // the ones the eye is on and the ones every line runs through.
    out.sort((a, b) => a.ply - b.ply);
    return out;
  }, [map, resolved, source]);

  const missing = useMemo(
    () =>
      wanted.filter(({ fen }) => {
        const key = keyOf(fen);
        // Neither answered nor recently refused — a failed key waits out
        // its backoff instead of spinning the effect in a retry loop.
        return !cache.has(key) && Date.now() - (failedAt.get(key) ?? 0) >= RETRY_MS;
      }),
    // Deliberately NOT keyed on `version`. Publishing progress used to
    // recompute this, which re-ran the effect, which cancelled the sweep
    // and started a fresh one over what was left — so a 398-position map
    // took 13 batches to do 7 batches' work. The RETURN memo below still
    // watches `version`, which is what actually has to see new answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wanted, source, ratings, side],
  );

  useEffect(() => {
    if (missing.length === 0) return;
    let live = true;
    const queue = [...missing];
    /**
     * Publish as answers land, not only when the last one does.
     *
     * Answers go into a module cache and the render reads them from
     * there, so the only thing that makes them APPEAR is this bump. It
     * used to fire once, after every position in the map had been
     * answered: quick enough to pass unnoticed on a 95-node map, and on
     * a 398-node one it leaves every dot uncoloured until the whole
     * queue drains. The idle animation was hiding it by re-rendering the
     * scene sixty times a second, which read the cache afresh each time;
     * stopping that on big maps took the cover off the bug.
     */
    let done = 0;
    let published = Date.now();
    const publish = (): void => {
      done = 0;
      published = Date.now();
      bump((n) => n + 1);
    };
    /**
     * Where the source can answer many positions at once, take that.
     *
     * The queue is hundreds long on a real map, and a browser runs about
     * six requests at a time to one origin however many the caller
     * starts — so the one-at-a-time loop below was spending seconds on
     * round trips for a database that answers each position in well
     * under a millisecond. Measured on the real one: 280k games, 8.3M
     * plies, 0.0 ms a lookup.
     *
     * In chunks rather than one giant request, so the first colours land
     * while the rest is still in the air, on the same publish cadence.
     */
    const sweep = async (): Promise<void> => {
      // 128, because the server answers 64 positions in 9-13ms and the
      // round trip costs more than the query does. Four requests for a
      // 398-node map.
      const BATCH = 128;
      let first = true;
      // What a batch left unanswered. The online source's batch route
      // answers only from its disk cache, so a miss is unanswered, not
      // empty — caching it as empty would blank that dot's statistics
      // for the whole session. These go to the single-position lanes,
      // which are what fill the cache the next sweep answers from.
      const unanswered: typeof queue = [];
      while (live && queue.length > 0) {
        const chunk = queue.splice(0, BATCH);
        let answers: Map<string, FieldMove[]> | null = null;
        try {
          answers = await fetchFieldBatch(
            source,
            chunk.map((n) => n.fen),
            ratings,
            side,
          );
        } catch {
          // A batch that fails hands its chunk to the single-position
          // path, which has its own caching and its own backoff.
          answers = null;
        }
        if (!answers) {
          queue.unshift(...chunk);
          return;
        }
        for (const item of chunk) {
          const moves = answers.get(item.fen);
          if (moves) cacheField(source, ratings, item.fen, side, moves);
          else unanswered.push(item);
        }
        // Every publish re-renders the whole scene, and on a 398-node
        // map that is three thousand SVG elements — measured from the
        // server's own log, the batches were arriving about one per
        // SECOND while each took 13ms to answer, which is the render
        // between them and nothing else. So: once immediately, because
        // the first chunk is the shallowest and most visible positions
        // and the map should colour at once, then sparingly — and never
        // for a chunk that answered nothing at all.
        if (live && answers.size > 0 && (first || Date.now() - published > 1000)) {
          first = false;
          publish();
        }
      }
      queue.push(...unanswered);
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        const next = queue.shift();
        if (!next || !live) return;
        // fieldMovesFor caches, and answers empty on an unreachable
        // field — a shrug, not an error banner.
        await fieldMovesFor(source, ratings, next.fen, side);
        done += 1;
        if (live && (done >= 12 || Date.now() - published > 500)) publish();
      }
    };
    // The Lichess proxy rate-limits; two lanes make a burst of thirty
    // positions a polite queue instead of a 429 shower.
    const lanes = source === ONLINE_SOURCE ? 2 : CONCURRENCY;
    void sweep()
      .then(() => Promise.all(Array.from({ length: lanes }, worker)))
      .then(() => {
        if (live) bump((n) => n + 1);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, source, ratings, side]);

  return useMemo(() => {
    const gaps = new Map<string, NodeGaps>();
    const shares = new Map<string, number>();
    if (!map || !resolved || !source) return { gaps, shares };
    for (const { id, fen } of wanted) {
      const moves = cache.get(keyOf(fen));
      if (!moves) continue;
      const turn = fen.split(' ')[1] === 'w' ? 'white' : 'black';
      if (turn !== map.color) {
        const node = resolved.nodes.get(id)!.mapNode;
        const met = new Set<string>();
        for (const child of node.children) if (child.san) met.add(child.san);
        for (const san of coverage?.get(id)?.preparedMoves ?? []) met.add(san);
        gaps.set(id, computeGaps(moves, met));
      }
      // Each child's share of the games here — its weight on the canvas.
      const games = moves.reduce((sum, m) => sum + m.total, 0);
      if (games > 0) {
        for (const child of resolved.nodes.get(id)!.mapNode.children) {
          if (!child.san) continue;
          const played = moves.find((m) => m.san === child.san);
          shares.set(child.id, (played?.total ?? 0) / games);
        }
      }
    }
    return { gaps, shares };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolved, coverage, wanted, source, ratings, version]);
}
