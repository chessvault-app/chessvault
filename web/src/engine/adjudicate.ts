import type { Color } from 'chessops/types';
import { defaultFlavor, StockfishEngine, supportsThreads } from './StockfishEngine';
import { terminalScore } from './terminal';
import { toWhitePov } from './uci';

/**
 * One-position engine adjudication for book puzzles: "is the position
 * after this off-book move still decisively won for the mover?" Uses a
 * single lazy shared worker; calls are serialised (the driver runs one
 * search at a time anyway).
 */

const DEPTH = 16;
/** Winning by at least this much (white-POV centipawns) counts as decisive. */
const DECISIVE_CP = 250;

let engine: StockfishEngine | null = null;
let resolveUpdate: ((score: { cp?: number; mate?: number }, turn: Color) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

function ensureEngine(): StockfishEngine {
  engine ??= new StockfishEngine(
    defaultFlavor(),
    {
      threads: supportsThreads()
        ? Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 2))
        : 1,
      hashMb: 32,
      multiPv: 1,
    },
    (update) => {
      if (!update.finished) return;
      const top = update.lines[0];
      const turn: Color = update.fen.split(' ')[1] === 'b' ? 'black' : 'white';
      resolveUpdate?.(top ? { cp: top.cp, mate: top.mate } : {}, turn);
    },
    () => resolveUpdate?.({}, 'white'),
  );
  return engine;
}

async function evaluate(fen: string): Promise<{ cp?: number; mate?: number }> {
  // Terminal positions produce no engine lines at all — score them by rule
  // before ever asking the engine (see engine/terminal.ts).
  const settled = terminalScore(fen);
  if (settled) return settled;

  const run = queue.then(
    () =>
      new Promise<{ cp?: number; mate?: number }>((resolve) => {
        resolveUpdate = (score, turn) => resolve(toWhitePov(score, turn));
        void ensureEngine().analyse(fen, DEPTH);
      }),
  );
  queue = run.catch(() => undefined);
  return run;
}

/**
 * True when `fenAfterMove` is decisively winning for `mover` — a forced
 * mate for them, or a big material/positional edge. Terminal positions
 * (no engine line) resolve by the mate-against-side-to-move rule.
 */
export async function movePasses(fenAfterMove: string, mover: Color): Promise<boolean> {
  const whitePov = await evaluate(fenAfterMove);
  if (whitePov.mate !== undefined) {
    return mover === 'white' ? whitePov.mate > 0 : whitePov.mate < 0;
  }
  if (whitePov.cp === undefined) return false;
  return mover === 'white' ? whitePov.cp >= DECISIVE_CP : whitePov.cp <= -DECISIVE_CP;
}

/** White-POV evaluation, exposed for the entry-time verifier. */
export async function evaluateWhitePov(fen: string): Promise<{ cp?: number; mate?: number }> {
  return evaluate(fen);
}

/**
 * Free the worker's memory once nothing on screen adjudicates — every
 * other engine has this exit (the interactive one on its switch, the
 * probe on the overlay, the review in its finally); this one had none,
 * so the first engine verdict kept a worker alive for the whole session.
 * A caller still awaiting the dead worker is resolved with an empty
 * score rather than left hanging; callers that release on unmount bail
 * on their own alive-check before the empty score can be misread.
 */
export function releaseAdjudicator(): void {
  engine?.terminate();
  engine = null;
  resolveUpdate?.({}, 'white');
  resolveUpdate = null;
}
