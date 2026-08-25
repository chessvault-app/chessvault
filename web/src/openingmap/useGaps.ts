import { useEffect, useMemo, useRef, useState } from 'react';
import { fenKey } from '@/lib/fen';
import { fetchField, fetchFieldBatch, MY_GAMES_SOURCE, ONLINE_SOURCE, type FieldMove } from '@/repertoire/field';
import type { NodeCoverage } from './coverage';
import { computeGaps, type NodeGaps } from './gaps';
import { chaseFrontier } from './mainline';
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

/**
 * Forget what the own-games index said.
 *
 * Called when games are collected: the answer to "what do my games play
 * here" has just changed, and waiting out RETRY_MS to discover that is a
 * page telling you it has never heard of the games you just added.
 */
export function forgetMyGames(): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${MY_GAMES_SOURCE}
`)) cache.delete(key);
  }
  for (const key of [...failedAt.keys()]) {
    if (key.startsWith(`${MY_GAMES_SOURCE}
`)) failedAt.delete(key);
  }
}

/**
 * THE cache key: source, band, which side's games, the own-games
 * filters, and the position. One function for every reader and writer —
 * the sweep, the chase, cacheField and fieldMovesFor — because they
 * split once: fieldMovesFor grew a filters slot the others lacked, so
 * against the online source (whose answers all come through
 * fieldMovesFor rather than the batch route) the chase read a cache its
 * own answers never landed in. It asked for the same position forever;
 * once the answer WAS cached under the other key, the await resolved
 * synchronously and the worker became a hot loop of renders — the lit
 * mainline never drew, and the page froze.
 */
const keyFor = (
  source: string,
  ratings: string,
  fen: string,
  side: 'white' | 'black' | undefined,
  filters?: string,
): string => `${source}
${ratings}
${side ?? ''}
${filters ?? ''}
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
  /** Own-games filters, from myFilterQuery. Part of the key below: a
      different set of games is a different answer, not a cache hit. */
  filters?: string,
): Promise<FieldMove[]> {
  const key = keyFor(source, ratings, fen, side, filters);
  const hit = cache.get(key);
  if (hit) return hit;
  if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) return [];
  const running = inflight.get(key);
  if (running) return running;
  const answer = (async (): Promise<FieldMove[]> => {
    try {
      const moves = await fetchField(source, ratings, fen, side, filters);
      // An EMPTY answer is not kept. "Nothing here" is a statement about
      // the games that exist right now, and the ones that exist can be
      // added to while the page is open: collect a month, then ask the map
      // to grow, and the session's cache answered with the emptiness it
      // had learned before you had any games at all — for the rest of the
      // session, since nothing invalidated it. Empty is provisional and
      // re-asked after RETRY_MS, which is the same window a failure gets
      // and for the same reason.
      if (moves.length > 0) {
        cache.set(key, moves);
        failedAt.delete(key);
      } else {
        failedAt.set(key, Date.now());
      }
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
  /** Whatever the canvas is lighting a line down from — the selection,
      or every search hit. The sweep asks about those lines first. */
  focus: readonly string[],
): {
  gaps: ReadonlyMap<string, NodeGaps>;
  /** Per node: how often its move gets played at the parent, 0..1 —
      what the canvas scales the dots by. */
  shares: ReadonlyMap<string, number>;
  /** Whether every charted position has been answered (a failure counts —
      a backed-off key is as answered as it is going to get for a while).
      True with no source: nothing was asked. The view holds the canvas on
      this, so the map arrives coloured instead of colouring in place. */
  ready: boolean;
} {
  const [version, bump] = useState(0);
  // Own-games rows depend on whose games count; every other source
  // ignores it, and a constant key part is harmless there.
  const side = map?.color;
  const keyOf = (fen: string): string => keyFor(source, ratings, fen, side);

  // Through a ref, because a selection must not restart the sweep: the
  // effect below is keyed on what is still unanswered, and re-running it
  // whenever a dot is tapped would throw the lanes' progress away.
  const focusRef = useRef<readonly string[]>(focus);
  useEffect(() => {
    focusRef.current = focus;
  }, [focus]);

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

    /**
     * What to ask about next, and why the lit line is not last.
     *
     * The queue is the whole map shallowest-first, which is the right
     * order for colouring the picture and the wrong one for answering a
     * question. Picking a dot lights the line running down from it, and
     * every edge of that line waits on the position above it: in queue
     * order those positions sit one whole ply-level of the map apart, so
     * against the online source — one request per position, two lanes,
     * a third of a second each — the line grew an edge every several
     * seconds and finished last of all. The map is still swept; the
     * line just goes first, because it is the only part of the picture
     * somebody is waiting on.
     */
    const nextWanted = (): { fen: string; chased: boolean } | undefined => {
      const focused = focusRef.current;
      if (resolved && focused.length > 0) {
        const [target] = chaseFrontier(
          resolved.nodes,
          focused,
          (fen) => cache.get(keyOf(fen)),
          // Out already, or refused recently: this line is as fast as it
          // is going to be, and asking again would only take a lane off
          // another one.
          (fen) =>
            inflight.has(keyOf(fen)) || Date.now() - (failedAt.get(keyOf(fen)) ?? 0) < RETRY_MS,
        );
        // Left in the queue: it answers from the cache when its turn
        // comes, which costs a loop and no request.
        if (target) return { fen: target.fen, chased: true };
      }
      const next = queue.shift();
      return next && { fen: next.fen, chased: false };
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        const next = nextWanted();
        if (!next || !live) return;
        // fieldMovesFor caches, and answers empty on an unreachable
        // field — a shrug, not an error banner.
        await fieldMovesFor(source, ratings, next.fen, side);
        done += 1;
        // A chased answer is one edge of the lit line and the only thing
        // that draws it, so it is published on the spot rather than at
        // the sweep's pace — one render for one edge, which is what the
        // edge costs however it is timed.
        if (live && (next.chased || done >= 12 || Date.now() - published > 500)) publish();
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
    if (!map || !resolved || !source) return { gaps, shares, ready: true };
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
    // Answered or backed off — recomputed per publish (`version`), and
    // the sweep's completion bump always fires, so this settles even when
    // the throttled publishes skipped the last answers.
    const ready = wanted.every(({ fen }) => {
      const key = keyOf(fen);
      return cache.has(key) || Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS;
    });
    return { gaps, shares, ready };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, resolved, coverage, wanted, source, ratings, version]);
}
