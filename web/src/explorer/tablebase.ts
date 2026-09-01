import { useCallback, useEffect, useState } from 'react';
import { parseFen } from 'chessops/fen';
import { api, ApiError } from '@/lib/api';
import { isDemo } from '@/lib/demo';
import { t } from '@/lib/i18n';

/**
 * The explorer's second answer: what the position IS, where the pieces
 * are few enough for that to be a fact rather than an estimate.
 *
 * The server does the probing and the caching (server/tablebase.ts);
 * this is the part that decides when to ask, and remembers for the
 * session so that walking back and forth through an ending does not
 * re-ask for every position on the way.
 */

/** Mirrors the server's contract. Kept here rather than imported from
    the server, exactly as the explorer's own move type is: the web build
    does not reach into server/. */
export type Category =
  | 'win'
  | 'cursed-win'
  | 'maybe-win'
  | 'draw'
  | 'blessed-loss'
  | 'maybe-loss'
  | 'loss'
  | 'unknown';

export interface TablebaseMove {
  uci: string;
  san: string;
  /** The verdict for whoever plays this move — the server has already
      turned it round from the point of view upstream reports. */
  category: Category;
  dtz: number | null;
  dtm: number | null;
  zeroing: boolean;
  checkmate: boolean;
  stalemate: boolean;
}

export interface TablebaseAnswer {
  /** Which server answered — `lichess`, or the host of this vault's own.
      Worth showing, quietly, because a vault CAN be pointed at its own
      tables (Settings > Tablebase) and then "who says so" has more than
      one answer. */
  source?: string;
  category: Category;
  dtz: number | null;
  dtm: number | null;
  checkmate: boolean;
  stalemate: boolean;
  moves: TablebaseMove[];
}

/** Syzygy's ceiling, and the server's. */
export const MAX_PIECES = 7;

/**
 * Whether asking is worth a request at all.
 *
 * The same two rules the server applies, applied first so the common
 * case — a middlegame, which is most positions — costs nothing. Castling
 * rights are disqualifying because the tables are built without them.
 */
export function inTablebaseRange(fen: string): boolean {
  try {
    const setup = parseFen(fen).unwrap();
    return setup.board.occupied.size() <= MAX_PIECES && setup.castlingRights.isEmpty();
  } catch {
    return false;
  }
}

/** Answers already had this session, keyed by FEN. Null is a remembered
    "no table holds this", which is as much an answer as the others. */
const seen = new Map<string, TablebaseAnswer | null>();

/**
 * Drop what this tab remembers, for Settings' "forget cached answers".
 *
 * Without it the button is half true: the server's cache would be empty
 * and the pane would go on showing the verdicts it had already been
 * told, for every position visited since the tab opened. Exported and
 * called from the settings card, exactly as forgetLichessToken is.
 */
export function forgetTablebaseAnswers(): void {
  seen.clear();
}

/**
 * One position, answered or not — the plain-async half of the hook.
 *
 * Exported because the engine review asks the same question of every
 * endgame position on the mainline, and it must ask it through the same
 * memo: reviewing a rook ending and then walking it on the board should
 * cost one round trip per position, not two. Null means no table covers
 * it; it THROWS when the source could not be reached, so a caller can
 * tell "no answer" from "no connection" — the review stops asking on the
 * first failure rather than spending thirty round trips learning that
 * the network is down.
 */
export async function probeTablebase(
  fen: string,
  signal?: AbortSignal,
): Promise<TablebaseAnswer | null> {
  if (seen.has(fen)) return seen.get(fen) ?? null;
  if (!inTablebaseRange(fen)) return null;
  const body = await api<{ available?: boolean } & Partial<TablebaseAnswer>>(
    `/api/tablebase?fen=${encodeURIComponent(fen)}`,
    { signal },
  );
  const answer = body.available ? (body as TablebaseAnswer) : null;
  seen.set(fen, answer);
  return answer;
}

interface Probe {
  answer: TablebaseAnswer | null;
  loading: boolean;
  /** An amber one-liner; the section says it and stays out of the way. */
  error: string | null;
  retry: () => void;
}

const IDLE: Probe = { answer: null, loading: false, error: null, retry: () => {} };

/**
 * Probe the position on screen, `enabled` permitting.
 *
 * Debounced by the same 120 ms the explorer's own lookup uses: holding
 * an arrow key down walks through a dozen positions nobody is reading,
 * and each of those is a request to somebody else's server.
 */
export function useTablebase(fen: string, enabled: boolean): Probe {
  const asked = enabled && !isDemo() && inTablebaseRange(fen);
  const [state, setState] = useState<Omit<Probe, 'retry'>>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!asked) {
      setState(IDLE);
      return;
    }
    if (seen.has(fen)) {
      setState({ answer: seen.get(fen) ?? null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        setState({ answer: null, loading: true, error: null });
        try {
          const answer = await probeTablebase(fen, controller.signal);
          if (!controller.signal.aborted) setState({ answer, loading: false, error: null });
        } catch (error) {
          // A superseded request is not a failure — the same rule the
          // explorer store keeps, and for the same reason: api() folds an
          // abort into status 0, so only the signal can tell them apart.
          if (controller.signal.aborted) return;
          // An outage is said in the reader's own language: the server's
          // sentence for it is English, and being on a train is not the
          // moment to be told so in a second language. Anything else —
          // a fault, which this route has no other kind of — keeps the
          // server's own words, as every pane in the app does.
          const offline = !(error instanceof ApiError) || error.offline || error.status === 0;
          setState({
            answer: null,
            loading: false,
            error: offline
              ? t('The tablebase is out of reach, and this position is not cached.')
              : (error as ApiError).message,
          });
        }
      })();
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [fen, asked, attempt]);

  return { ...state, retry };
}

/** What the verdict is called, from the point of view of whoever it
    belongs to. The fifty-move pair are named for what they DO — a win
    that the rule draws is not a win, and saying so is the whole reason
    those two categories are carried through rather than flattened. */
export function categoryLabel(category: Category): string {
  switch (category) {
    case 'win':
      return t('Win');
    case 'cursed-win':
      return t('Win, drawn by the fifty-move rule');
    case 'maybe-win':
      return t('Win, unless the fifty-move rule intervenes');
    case 'draw':
      return t('Draw');
    case 'blessed-loss':
      return t('Loss, drawn by the fifty-move rule');
    case 'maybe-loss':
      return t('Loss, unless the fifty-move rule saves it');
    case 'loss':
      return t('Loss');
    default:
      return t('Unknown');
  }
}

/** Short enough for a chip in a table row. */
export function categoryChip(category: Category): string {
  switch (category) {
    case 'win':
      return t('Win');
    case 'cursed-win':
      return t('Cursed win');
    case 'maybe-win':
      return t('Probably win');
    case 'draw':
      return t('Draw');
    case 'blessed-loss':
      return t('Blessed loss');
    case 'maybe-loss':
      return t('Probably loss');
    case 'loss':
      return t('Loss');
    default:
      return t('Unknown');
  }
}

export type Tone = 'good' | 'bad' | 'neutral';

/** Which of the three colours a verdict wears. The fifty-move pair are
    neutral, because their outcome is the draw, not the win or the loss
    the table would otherwise report. */
export function categoryTone(category: Category): Tone {
  switch (category) {
    case 'win':
      return 'good';
    case 'loss':
      return 'bad';
    default:
      return 'neutral';
  }
}
