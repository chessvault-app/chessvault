import { create } from 'zustand';
import { classifyRefutation, nullMoveFen, type Refutation } from '@shared/explain';
import type { TracePiece } from '@/engine/evalTrace';
import { probeEvalTrace, probeSearch, releaseProbeWorker } from '@/engine/probe';
import { moverChances } from '@/engine/review';
import { toWhitePov } from '@/engine/uci';

/**
 * State for the explanation features: the piece-value heat map and the
 * Why card's probes. Plain data only — the probe worker lives in
 * engine/probe.ts, module-level, exactly like the interactive engine's
 * driver lives outside its store.
 *
 * Probe depths are deliberately below the interactive default: probes
 * answer QUALITATIVE questions ("what is the threat", "how does this
 * move fail"), which settle by these depths, and a card that fills in a
 * couple of seconds is worth more than a slightly deeper one that takes
 * ten. Both are constants in the open, cheap to retune.
 */
const THREAT_DEPTH = 12;
const WHY_NOT_DEPTH = 14;

// ---------------------------------------------------------------------------
// Heat map

interface HeatData {
  fen: string;
  pieces: Record<string, TracePiece>;
}

// ---------------------------------------------------------------------------
// Why card

export interface ThreatData {
  /** The null-move position the line starts from (for SAN rendering). */
  fen: string;
  moves: string[];
}

export interface WhyNotData {
  playedUci: string;
  bestUci: string;
  /** The played move IS the engine's choice. */
  agreement: boolean;
  /** Winning-chances drop 0..1, mover's point of view. */
  drop: number;
  /** Percentages for the tooltip: best / played, mover POV. */
  bestPercent: number;
  playedPercent: number;
  /** How it fails; null when agreement or the drop is negligible. */
  refutation: Refutation | null;
  /** The engine's reply line, playable from the CURRENT position. */
  replyMoves: string[];
}

export interface CardData {
  /** Position + played move this card belongs to. */
  key: string;
  threat: ThreatData | null;
  threatLoading: boolean;
  /** null when there is no last move to judge, or probes failed. */
  whyNot: WhyNotData | null;
  whyNotLoading: boolean;
}

const cardKeyOf = (fen: string, uci: string | undefined): string => `${fen}|${uci ?? ''}`;

/**
 * Finished cards, so revisiting a position reopens instantly. Analysis is
 * constant position-revisiting; without this every arrow key would
 * re-search. Small and session-only — probe results are cheap to remake.
 */
const cardCache = new Map<string, CardData>();
const CARD_CACHE_MAX = 48;

const rememberCard = (card: CardData): void => {
  if (card.threatLoading || card.whyNotLoading) return;
  cardCache.set(card.key, card);
  if (cardCache.size > CARD_CACHE_MAX) {
    const oldest = cardCache.keys().next().value;
    if (oldest !== undefined) cardCache.delete(oldest);
  }
};

interface ExplainState {
  /** The board overlay's toggle. Off by default; loud things must be asked for. */
  heatOn: boolean;
  heat: HeatData | null;
  /**
   * Set after the first trace comes back unparseable — the engine build
   * has no `eval` command, so the toggle hides rather than dangling a
   * feature that can never answer.
   */
  heatUnsupported: boolean;

  cardOpen: boolean;
  card: CardData | null;

  toggleHeat: () => void;
  /** Fetch the trace for a position if the overlay is on and lacks it. */
  ensureHeat: (fen: string) => void;

  toggleCard: () => void;
  /** Probe a position (and the move that reached it) for the open card. */
  ensureCard: (fen: string, playedUci: string | undefined, parentFen: string | undefined) => void;
}

/** FEN of the trace in flight, so a second render never double-asks. */
let heatRequested: string | null = null;
/** Card key in flight — late probe answers for other positions are dropped. */
let cardRequested: string | null = null;

const releaseIfIdle = (state: ExplainState): void => {
  if (!state.heatOn && !state.cardOpen) releaseProbeWorker();
};

export const useExplain = create<ExplainState>()((set, get) => ({
  heatOn: false,
  heat: null,
  heatUnsupported: false,
  cardOpen: false,
  card: null,

  toggleHeat: () => {
    const on = !get().heatOn;
    set({ heatOn: on, ...(on ? {} : { heat: null }) });
    if (!on) {
      heatRequested = null;
      // The worker is real memory (WASM heap); idle features give it back.
      releaseIfIdle(get());
    }
  },

  ensureHeat: (fen) => {
    if (!get().heatOn || get().heatUnsupported) return;
    if (get().heat?.fen === fen || heatRequested === fen) return;
    heatRequested = fen;
    void probeEvalTrace(fen).then((trace) => {
      // Only the answer to the newest question counts.
      if (heatRequested !== fen || !get().heatOn) return;
      heatRequested = null;
      if (!trace) {
        set({ heatUnsupported: true, heatOn: false, heat: null });
        releaseIfIdle(get());
        return;
      }
      set({ heat: { fen, pieces: trace.pieces } });
    });
  },

  toggleCard: () => {
    const open = !get().cardOpen;
    set({ cardOpen: open, ...(open ? {} : { card: null }) });
    if (!open) {
      cardRequested = null;
      releaseIfIdle(get());
    }
  },

  ensureCard: (fen, playedUci, parentFen) => {
    if (!get().cardOpen) return;
    const key = cardKeyOf(fen, playedUci);
    if (get().card?.key === key || cardRequested === key) return;

    const cached = cardCache.get(key);
    if (cached) {
      cardRequested = null;
      set({ card: cached });
      return;
    }

    cardRequested = key;
    const patch = (partial: Partial<CardData>): void => {
      if (cardRequested !== key || !get().cardOpen) return;
      const current = get().card;
      if (!current || current.key !== key) return;
      const next = { ...current, ...partial };
      set({ card: next });
      rememberCard(next);
    };

    set({
      card: {
        key,
        threat: null,
        threatLoading: true,
        whyNot: null,
        whyNotLoading: playedUci !== undefined && parentFen !== undefined,
      },
    });

    // --- the threat: what the opponent does if the mover passes ----------
    const flipped = nullMoveFen(fen);
    if (!flipped) {
      patch({ threatLoading: false });
    } else {
      void probeSearch(flipped, THREAT_DEPTH).then((lines) => {
        const top = lines[0];
        patch({
          threatLoading: false,
          threat: top && top.moves.length > 0 ? { fen: flipped, moves: top.moves.slice(0, 8) } : null,
        });
      });
    }

    // --- the played move: how it compares with the best, and how it fails
    if (playedUci !== undefined && parentFen !== undefined) {
      const parentTurn: 'white' | 'black' = parentFen.split(' ')[1] === 'b' ? 'black' : 'white';
      void Promise.all([
        probeSearch(parentFen, WHY_NOT_DEPTH),
        probeSearch(parentFen, WHY_NOT_DEPTH, [playedUci]),
      ]).then(([bestLines, playedLines]) => {
        const best = bestLines[0];
        const played = playedLines[0];
        if (!best || !played || best.moves.length === 0) {
          patch({ whyNotLoading: false });
          return;
        }
        const bestChances = moverChances(toWhitePov({ cp: best.cp, mate: best.mate }, parentTurn), parentTurn);
        const playedChances = moverChances(
          toWhitePov({ cp: played.cp, mate: played.mate }, parentTurn),
          parentTurn,
        );
        const agreement = best.moves[0] === playedUci;
        const drop = Math.max(0, bestChances - playedChances);
        // Negative mate from the mover's view = the played move runs into it.
        const mateIn = played.mate !== undefined && played.mate < 0 ? played.mate : undefined;
        const refutation =
          !agreement && drop >= 0.05
            ? classifyRefutation(parentFen, playedUci, played.moves.slice(1), mateIn)
            : null;
        patch({
          whyNotLoading: false,
          whyNot: {
            playedUci,
            bestUci: best.moves[0]!,
            agreement,
            drop,
            bestPercent: Math.round(bestChances * 100),
            playedPercent: Math.round(playedChances * 100),
            refutation,
            replyMoves: played.moves.slice(1, 9),
          },
        });
      });
    }
  },
}));
