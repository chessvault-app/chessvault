import { Hono, type Context } from 'hono';
import { Chess } from 'chessops/chess';
import { makeFen, parseFen } from 'chessops/fen';
import { makeSanAndPlay } from 'chessops/san';
import { parseUci } from 'chessops/util';
import { mirrorMaterialSpec, parseMaterialSpec } from '../shared/scanMatch.ts';
import { DATA_TABLEBASE_CACHE } from './paths.ts';
import { cachedProbe, type TablebaseAnswer, type TablebaseProbe } from './tablebase.ts';
import { drawCandidates, drillable, type Rng } from './endgamePositions.ts';

/**
 * The endgame drill: a won ending, drawn at random, played out against
 * the tablebase's best defence.
 *
 * A puzzle has one answer; an ending has a technique, and the only
 * judge of technique that never guesses is the table. So the drill is
 * built on the same source the explorer's pane asks (server/tablebase.ts,
 * whichever of its three sources Settings has chosen) and on the same
 * cache: every position it draws or plays through is a fact kept for
 * good, and the explorer will find it there.
 *
 * Two routes carry a drill, and the verdict is never the client's:
 *
 *  - `draw` proposes random positions of a material class
 *    (server/endgamePositions.ts) and keeps the first the table calls a
 *    win for the side to move. That side is the solver's.
 *  - `move` grades one move by the table's own word for it. A move that
 *    keeps the category at `win` holds; anything else threw the win
 *    away, and the answer names the move that would have kept it. A
 *    held move gets the defender's reply, the move the table ranks
 *    best for a lost side: the one that takes longest to lose.
 *
 * Nothing is recorded. A drill is a thing to play when an ending is what
 * you feel like, not a record to tend (lanph3re's call), so there is no
 * attempt log and no progress to show.
 *
 * No source, no drill: with nothing to ask, the routes say so and name
 * the setting, and the page carries that to the person who can change
 * it. What they must never do is guess.
 */

/** How many random positions a draw is willing to ask about before
    giving up on the class. Most classes settle in a handful; a public
    server answers each in a fraction of a second. */
const DRAW_TRIES = 40;

/** Whether a move keeps the win. `maybe-win` is the server unsure only
    about the fifty-move rounding, which is not a mistake the solver
    made; `cursed-win` is a win the rule has already turned into a draw,
    and counts as thrown. */
export const holds = (category: TablebaseAnswer['category']): boolean =>
  category === 'win' || category === 'maybe-win';

/** The three ways a probe can fail to answer, each as the status and
    reason the page turns into a sentence and a way to Settings. */
const noSource = (c: Context) =>
  c.json(
    {
      error: 'No tablebase is answering. Choose a source under Settings, Tablebase.',
      reason: 'no-tablebase',
    },
    503,
  );
const noTable = (c: Context) =>
  c.json(
    {
      error:
        'The tablebase in use holds no tables for this many pieces. Point Settings, Tablebase at one that does.',
      reason: 'no-table',
    },
    503,
  );
const unreachable = (c: Context) =>
  c.json(
    {
      error: 'The tablebase is unreachable and this position is not cached',
      reason: 'unreachable',
      offline: true,
    },
    502,
  );

/**
 * @param prober how to reach the tablebase, per request so a source
 *   chosen in Settings takes effect at once; null means this deployment
 *   has none (the demo), and the drill says so.
 * @param random the dice, seeded by the tests.
 */
export function endgameDrillApi(
  prober: (() => TablebaseProbe | null) | null = null,
  cacheDir: string = DATA_TABLEBASE_CACHE,
  random: Rng = Math.random,
): Hono {
  const api = new Hono();

  api.get('/endgames/draw', async (c) => {
    const spec = parseMaterialSpec(c.req.query('spec') ?? '');
    if (!spec) return c.json({ error: 'missing or malformed ?spec=' }, 400);
    if (!drillable(spec)) {
      return c.json(
        {
          error: 'This material needs more than seven pieces, which no table holds',
          reason: 'too-many',
        },
        400,
      );
    }
    const source = prober?.();
    if (!source) return noSource(c);
    // A preset is written from White's side ("Rook and pawns vs rook"
    // gives White the pawns); the drill is not, so half the draws turn
    // the spec round and Black gets to be the side with the pawns.
    const oriented = random() < 0.5 ? spec : mirrorMaterialSpec(spec);
    let probed = 0;
    let held = 0;
    for (const fen of drawCandidates(oriented, DRAW_TRIES, random)) {
      let answer: TablebaseAnswer | null;
      try {
        answer = await cachedProbe(cacheDir, source, fen);
      } catch {
        return unreachable(c);
      }
      probed += 1;
      if (!answer) continue;
      held += 1;
      // A win, and one with something to find: a position already
      // mated or stalemated has no move, and one whose best move mates
      // at once is a puzzle, not an ending.
      if (answer.category !== 'win' || answer.checkmate || answer.stalemate) continue;
      if (answer.moves[0]?.checkmate) continue;
      return c.json({
        fen,
        side: fen.split(' ')[1] === 'b' ? 'black' : 'white',
        source: source.source,
        dtz: answer.dtz,
        dtm: answer.dtm,
      });
    }
    if (probed > 0 && held === 0) return noTable(c);
    return c.json(
      {
        error: 'No winning position of this material turned up. Try again.',
        reason: 'none-found',
      },
      404,
    );
  });

  api.post('/endgames/move', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { fen?: unknown; uci?: unknown };
    if (typeof body.fen !== 'string' || typeof body.uci !== 'string') {
      return c.json({ error: 'expected { fen, uci }' }, 400);
    }
    const setup = parseFen(body.fen);
    const parsed = setup.isOk ? Chess.fromSetup(setup.value) : null;
    const move = parseUci(body.uci);
    if (!parsed || parsed.isErr || !move || !parsed.value.isLegal(move)) {
      return c.json({ error: 'that move is not legal in that position' }, 400);
    }
    const source = prober?.();
    if (!source) return noSource(c);

    let before: TablebaseAnswer | null;
    try {
      before = await cachedProbe(cacheDir, source, body.fen);
    } catch {
      return unreachable(c);
    }
    if (!before) return noTable(c);
    const graded = before.moves.find((m) => m.uci === body.uci);
    if (!graded) return noTable(c);

    const pos = parsed.value;
    const san = makeSanAndPlay(pos, move);
    const after = makeFen(pos.toSetup());
    if (pos.isCheckmate()) return c.json({ verdict: 'won', san, fen: after });
    if (!holds(graded.category)) {
      // Best first is how the server ranks them (rankMoves): the
      // shortest win, or where none is left, the move that was.
      const best = before.moves[0]!;
      return c.json({
        verdict: 'threw',
        san,
        fen: after,
        category: graded.category,
        best: { uci: best.uci, san: best.san },
      });
    }

    let reply: TablebaseAnswer | null;
    try {
      reply = await cachedProbe(cacheDir, source, after);
    } catch {
      return unreachable(c);
    }
    // The defender's best is the first move the table ranks for a lost
    // side: the one that takes longest to lose.
    const chosen = reply?.moves[0];
    if (!reply || !chosen) return noTable(c);
    const replyMove = parseUci(chosen.uci);
    if (!replyMove || !pos.isLegal(replyMove)) return noTable(c);
    const replySan = makeSanAndPlay(pos, replyMove);
    return c.json({
      verdict: 'held',
      san,
      reply: { uci: chosen.uci, san: replySan },
      fen: makeFen(pos.toSetup()),
      // How far the solver now has to go, where the small tables know
      // it as a mate distance; null otherwise. A distance, not a score.
      dtm: chosen.dtm,
    });
  });

  return api;
}
