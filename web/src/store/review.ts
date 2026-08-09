import { create } from 'zustand';
import { Chess } from 'chessops/chess';
import { parseFen } from 'chessops/fen';
import { getNode, mainlineFrom } from '@shared/tree';
import {
  defaultFlavor,
  StockfishEngine,
  supportsThreads,
  type SearchUpdate,
} from '@/engine/StockfishEngine';
import { judgeLine, summarise, type Score, type SideSummary } from '@/engine/review';
import { toWhitePov, winningChances } from '@/engine/uci';
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
      },
    );

    try {
      const ids = [tree.rootId, ...line];
      const scores: Score[] = [];
      for (let i = 0; i < ids.length; i++) {
        const fen = getNode(tree, ids[i]!).fen;
        const update = await new Promise<SearchUpdate>((resolve) => {
          resolveUpdate = resolve;
          void engine.analyse(fen, REVIEW_DEPTH);
        });
        if (get().status !== 'running') return; // cleared or errored mid-run

        const top = update.lines[0];
        const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
        if (top) {
          scores.push(toWhitePov({ cp: top.cp, mate: top.mate }, turn));
        } else {
          // Terminal position: checkmate scores as mate AGAINST the side
          // to move; stalemate (or any other dead end) is a draw. Without
          // this, the mating move itself would read as a blunder.
          const pos = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
          scores.push(
            pos.isCheckmate() ? { mate: turn === 'white' ? -1 : 1 } : { cp: 0 },
          );
        }
        set({ progress: (i + 1) / ids.length });
      }

      const rootTurn: 'white' | 'black' =
        getNode(tree, tree.rootId).fen.split(' ')[1] === 'b' ? 'black' : 'white';
      // Sacrifice detection for brilliancies: the mover's material after
      // the OPPONENT'S reply, compared with before the move — a piece
      // given and instantly regained is no sacrifice.
      const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
      const balance = (fen: string, side: 'white' | 'black'): number => {
        let bal = 0;
        for (const ch of fen.split(' ')[0]!) {
          const v = VALUE[ch.toLowerCase()];
          if (!v) continue;
          bal += (ch === ch.toUpperCase()) === (side === 'white') ? v : -v;
        }
        return bal;
      };
      // ids is [root, ...line], so this is one lookup per node, not two walks.
      const fens = ids.map((id) => getNode(tree, id).fen);
      const sacrifices = line.map((_, i) => {
        const mover: 'white' | 'black' =
          i % 2 === 0 ? rootTurn : rootTurn === 'white' ? 'black' : 'white';
        const settled = fens[Math.min(i + 2, fens.length - 1)]!;
        return balance(settled, mover) <= balance(fens[i]!, mover) - 2;
      });
      const verdicts = judgeLine(scores, rootTurn, sacrifices);

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
        })),
      });
    } catch (error) {
      set({ status: 'error', error: (error as Error).message });
    } finally {
      engine.terminate();
    }
  },
}));
