import { create } from 'zustand';
import { getNode, mainlineFrom } from '@shared/tree';
import {
  defaultFlavor,
  StockfishEngine,
  supportsThreads,
  type SearchUpdate,
} from '@/engine/StockfishEngine';
import { judgeLine, summarise, type Score, type SideSummary } from '@/engine/review';
import { detectSacrifices } from '@/engine/sacrifice';
import { terminalScore } from '@/engine/terminal';
import { toWhitePov, winningChances } from '@/engine/uci';
import { isBookPosition, NAMED_PLIES } from '@/lib/opening';
import { useAnalysis } from './analysis';
import { useEngine } from './engine';

/**
 * Engine review of the current mainline: a dedicated single-purpose
 * Stockfish worker walks every position, moves are judged with the
 * lichess criteria (see engine/review.ts), quality NAGs are stamped into
 * the tree (persisted by the study autosave where one is running), and
 * per-side accuracy/ACPL land here for the summary strip.
 */

const REVIEW_DEPTH = 14;

export interface GraphPoint {
  /** Mainline node this position belongs to (root included, index 0). */
  id: string;
  /** White's winning chances 0..1, for the evaluation graph. */
  chances: number;
  /** Quality NAG the review stamped on the move reaching this position. */
  nag: number | null;
  /** The move reaching this position was book — theory, not judged. */
  book: boolean;
}

interface ReviewState {
  status: 'idle' | 'running' | 'done' | 'error';
  /** 0..1 while running. */
  progress: number;
  white: SideSummary | null;
  black: SideSummary | null;
  points: GraphPoint[] | null;
  error: string | null;

  run: () => Promise<void>;
  clear: () => void;
}

export const useReview = create<ReviewState>()((set, get) => ({
  status: 'idle',
  progress: 0,
  white: null,
  black: null,
  points: null,
  error: null,

  clear: () =>
    set({ status: 'idle', progress: 0, white: null, black: null, points: null, error: null }),

  run: async () => {
    if (get().status === 'running') return;
    const analysis = useAnalysis.getState();
    const { tree } = analysis;
    const line = mainlineFrom(tree, tree.rootId);
    if (line.length === 0) return;

    // The interactive engine would fight the review worker for cores.
    const interactive = useEngine.getState();
    if (interactive.enabled) interactive.setEnabled(false);

    set({ status: 'running', progress: 0, white: null, black: null, error: null });

    let resolveUpdate: ((update: SearchUpdate) => void) | null = null;
    let rejectPly: ((error: Error) => void) | null = null;
    const engine = new StockfishEngine(
      defaultFlavor(),
      {
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
        // The driver's handshake timeout can fire long after a completed
        // run tears the worker down — never let a late error overwrite a
        // finished review.
        if (get().status === 'running') set({ status: 'error', error: message });
        // A ply awaiting `bestmove` from a dead worker would wait forever —
        // and with it the `finally` below that frees the worker. Fail the
        // wait instead; rejecting an already-settled ply is a no-op.
        rejectPly?.(new Error(message));
      },
    );

    try {
      const ids = [tree.rootId, ...line];
      const fens = ids.map((id) => getNode(tree, id).fen);

      // The opening-book prefix, the way lichess and chess.com mean it:
      // a move is book while the POSITION it reaches is in the opening
      // catalogue (so transpositions count), and only while every move
      // before it was book too — once out, never back in. Walked before
      // the engine starts; each hit is one cached /api/opening lookup and
      // the walk stops at the first miss. A game from a set-up position
      // misses immediately and has no book phase, and if the catalogue is
      // unreachable the lookups all miss — the review just judges from
      // move one, which is what it did before it knew about books.
      let bookPlies = 0;
      while (bookPlies < line.length && bookPlies < NAMED_PLIES) {
        if (!(await isBookPosition(fens[bookPlies + 1]!))) break;
        bookPlies += 1;
      }
      if (get().status !== 'running') return;

      const scores: Score[] = [];
      for (let i = 0; i < ids.length; i++) {
        const fen = fens[i]!;
        const update = await new Promise<SearchUpdate>((resolve, reject) => {
          resolveUpdate = resolve;
          rejectPly = reject;
          void engine.analyse(fen, REVIEW_DEPTH);
        });
        if (get().status !== 'running') return; // cleared or errored mid-run

        const top = update.lines[0];
        const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
        if (top) {
          scores.push(toWhitePov({ cp: top.cp, mate: top.mate }, turn));
        } else {
          // No line means the position is finished — score it by rule (see
          // engine/terminal.ts), or the mating move itself reads as a
          // blunder. A draw is the answer for anything else that got here.
          scores.push(terminalScore(fen) ?? { cp: 0 });
        }
        set({ progress: (i + 1) / ids.length });
      }

      const rootTurn: 'white' | 'black' =
        getNode(tree, tree.rootId).fen.split(' ')[1] === 'b' ? 'black' : 'white';
      // Sacrifice detection for brilliancies: material genuinely offered
      // in the position the move created, settled by a capture-only
      // search — not what the opponent happened to take (see
      // engine/sacrifice.ts for why that was wrong twice over).
      const sacrifices = detectSacrifices(fens);
      const verdicts = judgeLine(scores, rootTurn, sacrifices, bookPlies);

      // The review owns quality NAGs (1..6) on the mainline, like lichess
      // server analysis: judged moves get theirs, unjudged moves lose any
      // stale one. Positional NAGs and variations are untouched.
      // ONE tree commit, not one per judged move: setNags copies the whole
      // node record each call, so a 200-ply review was 200 copies of a
      // 200-key map (and 200 store writes, each waking the autosave).
      const current = useAnalysis.getState();
      const nodes = { ...current.tree.nodes };
      for (const verdict of verdicts) {
        const id = line[verdict.ply]!;
        const node = nodes[id];
        if (!node) continue;
        const rest = node.nags.filter((n) => n < 1 || n > 6);
        nodes[id] = { ...node, nags: verdict.nag === null ? rest : [...rest, verdict.nag] };
      }
      useAnalysis.setState({ tree: { ...current.tree, nodes } });

      set({
        status: 'done',
        progress: 1,
        white: summarise(verdicts, 'white'),
        black: summarise(verdicts, 'black'),
        points: ids.map((id, i) => ({
          id,
          chances: winningChances(scores[i]!),
          nag: i === 0 ? null : verdicts[i - 1]!.nag,
          book: i > 0 && verdicts[i - 1]!.book,
        })),
      });
    } catch (error) {
      // Not when the run was cleared: an abort stays quiet even if the
      // rejected ply lands after it.
      if (get().status !== 'idle') set({ status: 'error', error: (error as Error).message });
    } finally {
      engine.terminate();
    }
  },
}));

/**
 * A review belongs to the tree it judged, and dies with it.
 *
 * Node ids are process-unique (shared/tree's counter never reuses one),
 * so a REPLACED tree — another game opened over the handoff path, a
 * reset, a study loaded into the same store — carries a new root id and
 * every point the graph holds dangles: the strip kept drawing a stale
 * graph whose clicks silently did nothing, because the scrub's
 * does-this-node-still-exist guard failed on every single point
 * (lanph3re's repro: review a game, leave, come back with another).
 * An EDITED tree keeps its root and keeps its review — deleting moves
 * invalidates points one by one, which that same guard already tolerates.
 *
 * Watched here at the store rather than cleared at every call site that
 * swaps a tree: the Board page's handoff mount deliberately skips its
 * reset, which is exactly how one such site was forgotten. Clearing
 * mid-run also aborts the run — the loop checks status every ply.
 */
let reviewedRoot = useAnalysis.getState().tree.rootId;
useAnalysis.subscribe((state) => {
  if (state.tree.rootId === reviewedRoot) return;
  reviewedRoot = state.tree.rootId;
  if (useReview.getState().status !== 'idle') useReview.getState().clear();
});
