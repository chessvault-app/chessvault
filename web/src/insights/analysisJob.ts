import { create } from 'zustand';
import {
  defaultFlavor,
  StockfishEngine,
  supportsThreads,
  type SearchUpdate,
} from '@/engine/StockfishEngine';
import { judgeLine, type Score } from '@/engine/review';
import { detectSacrifices } from '@/engine/sacrifice';
import { terminalScore } from '@/engine/terminal';
import { toWhitePov } from '@/engine/uci';
import { api } from '@/lib/api';
import { isBookPosition, lookupMany, NAMED_PLIES } from '@/lib/opening';
import { useEngine } from '@/store/engine';
import { bookPrefix, buildRecord, lineOf } from './gamePass';

/**
 * The engine pass: every game of the owner's, judged move by move by a
 * Stockfish worker in this browser, the findings put back to the server
 * (server/myGamesAnalysis.ts) and summed on the Insights page.
 *
 * In the client, because the server has no engine and the app is
 * HTTP-API-only; a module-level store, because a pass is hours of work
 * on a big vault and must survive leaving the page. It does not survive
 * a reload, and does not need to: the server remembers every game
 * finished, and Resume asks it what is still owed.
 *
 * One game at a time, one position at a time, the way the analysis
 * board's review walks a game (store/review.ts) and with the same judge
 * (engine/review.ts), at a shallower fixed depth: the numbers are
 * compared with each other across hundreds of games, and one depth for
 * all of them matters more than a deep one for each. The tablebase is
 * not asked: a probe per ending position across a whole vault is a
 * burst at somebody else's server for a verdict that moves few games'
 * figures.
 */

/** The fixed search depth. Recorded with every game, so a later deeper
    pass is a Start over, never a mix. */
export const PASS_DEPTH = 12;

/** Games asked for per round trip: enough to keep the engine busy, few
    enough that a pause lands within a game or two of the button. */
const BATCH = 10;

export type PassStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

interface PassState {
  status: PassStatus;
  /** From the server: games with a record that fits, and games owed.
      `known` is false until the first answer, so a page gated on the
      pass does not draw its tables for the beat before it arrives. */
  known: boolean;
  analysed: number;
  total: number;
  /** This run's own count and clock, for the rate. */
  doneThisRun: number;
  startedAt: number | null;
  /** Milliseconds per game over this run, once one is done. */
  msPerGame: number | null;
  /** The game under the engine now, for the card's line. */
  current: { file: string; index: number } | null;
  error: string | null;

  /** Ask the server how far the pass is; cheap, called on mount. */
  refresh: () => Promise<void>;
  start: () => Promise<void>;
  pause: () => void;
  /** Forget every record and start again (a deeper pass, say). */
  startOver: () => Promise<void>;
}

interface Owed {
  file: string;
  index: number;
  side: 'white' | 'black';
  site: string | null;
  plies: number;
}

export const useAnalysisJob = create<PassState>()((set, get) => ({
  status: 'idle',
  known: false,
  analysed: 0,
  total: 0,
  doneThisRun: 0,
  startedAt: null,
  msPerGame: null,
  current: null,
  error: null,

  refresh: async () => {
    try {
      const status = await api<{ analysed: number; total: number }>('/api/mygames/analysis/status');
      set((s) => ({
        known: true,
        analysed: status.analysed,
        total: status.total,
        // A pass that finished stays "done" until something is owed again.
        status:
          s.status === 'done' && status.analysed < status.total ? 'idle' : s.status,
      }));
    } catch {
      // The card says what it knows; a failed count is not an error state.
    }
  },

  pause: () => {
    if (get().status === 'running') set({ status: 'paused' });
  },

  startOver: async () => {
    if (get().status === 'running') return;
    const status = await api<{ analysed: number; total: number }>('/api/mygames/analysis', {
      method: 'DELETE',
    });
    set({ analysed: status.analysed, total: status.total, status: 'idle', msPerGame: null });
    await get().start();
  },

  start: async () => {
    if (get().status === 'running') return;
    // The interactive engine is held for the run, as the review holds it:
    // on, not searching, so the two do not fight for cores.
    useEngine.getState().hold();
    set({
      status: 'running',
      doneThisRun: 0,
      startedAt: Date.now(),
      msPerGame: null,
      error: null,
    });

    let resolveUpdate: ((update: SearchUpdate) => void) | null = null;
    let rejectPly: ((error: Error) => void) | null = null;
    const engine = new StockfishEngine(
      defaultFlavor(),
      {
        // Two cores fewer than the machine has, at most four: the pass
        // runs while the app is used for other things.
        threads: supportsThreads()
          ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))
          : 1,
        hashMb: 64,
        multiPv: 1,
      },
      (update) => {
        if (update.finished) resolveUpdate?.(update);
      },
      (message) => {
        if (get().status === 'running') set({ status: 'error', error: message });
        rejectPly?.(new Error(message));
      },
    );
    const running = (): boolean => get().status === 'running';

    try {
      await get().refresh();
      for (;;) {
        if (!running()) return;
        const { games } = await api<{ games: Owed[] }>(
          `/api/mygames/analysis/queue?limit=${BATCH}`,
        );
        if (games.length === 0) {
          set({ status: 'done', current: null });
          await get().refresh();
          return;
        }
        for (const game of games) {
          if (!running()) return;
          set({ current: { file: game.file, index: game.index } });
          const { pgn } = await api<{ pgn: string }>(
            `/api/games/pgn?file=${encodeURIComponent(game.file)}&index=${game.index}`,
          );
          const line = lineOf(pgn);
          // A file that changed under the pass: skipped this round, and
          // the queue offers it again once the index has caught up.
          if (!line) continue;
          const { fens } = line;

          // The book prefix, warmed in one request rather than a lookup
          // per position; each answer is then a cache hit.
          const named = fens.slice(1, NAMED_PLIES + 1);
          await lookupMany(named);
          const reached = await Promise.all(named.map((fen) => isBookPosition(fen)));
          const bookPlies = bookPrefix(reached, NAMED_PLIES);

          const scores: Score[] = [];
          for (const fen of fens) {
            if (!running()) return;
            const update = await new Promise<SearchUpdate>((resolve, reject) => {
              resolveUpdate = resolve;
              rejectPly = reject;
              void engine.analyse(fen, PASS_DEPTH);
            });
            const top = update.lines[0];
            const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
            scores.push(
              top ? toWhitePov({ cp: top.cp, mate: top.mate }, turn) : (terminalScore(fen) ?? { cp: 0 }),
            );
          }
          if (!running()) return;

          const verdicts = judgeLine(scores, 'white', detectSacrifices(fens), bookPlies);
          const record = buildRecord({
            file: game.file,
            index: game.index,
            side: game.side,
            site: game.site,
            depth: PASS_DEPTH,
            fens,
            verdicts,
          });
          await api('/api/mygames/analysis', { method: 'PUT', json: record });
          const doneThisRun = get().doneThisRun + 1;
          const startedAt = get().startedAt ?? Date.now();
          set((s) => ({
            doneThisRun,
            analysed: s.analysed + 1,
            msPerGame: (Date.now() - startedAt) / doneThisRun,
          }));
        }
      }
    } catch (error) {
      if (get().status === 'running') {
        set({ status: 'error', error: (error as Error).message });
      }
    } finally {
      // A pause lands here too, once the ply in flight has answered; the
      // worker is not kept warm across a pause, since a pause may be a
      // day long.
      engine.terminate();
      useEngine.getState().release();
      set({ current: null });
    }
  },
}));
