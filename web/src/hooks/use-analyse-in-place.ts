import { Cpu, Info, ListOrdered } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MoveTree, NodeId } from '@shared/types';
import { usePaneSwipe } from '@/hooks/use-pane-swipe';
import { t } from '@/lib/i18n';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';

/** The phone's three panes: the trainer's own, the moves, the engine. */
export type TrainerPane = 'info' | 'moves' | 'engine';

/**
 * Analysing in place: when the exercise is over, the page stays, the
 * board becomes the analysis board and the engine comes on.
 *
 * Three trainers do this — the puzzle trainer, the book trainer and the
 * repertoire drill — and each carried the same forty lines: the
 * `analysing` flag, the phone's pane and the pane it can actually show,
 * the engine switched off on the way out (unmount included), the pane
 * list and the swipe that turns it. The decisions that live here were
 * each made once and copied three times:
 *
 *  - a finished exercise analyses itself; there is no Analyse button;
 *  - the phone STAYS on the trainer's own pane, because that is where the
 *    verdict is written, and swapping it for the engine at the moment the
 *    exercise resolves answers a question with a different one
 *    (lanph3re's call); the engine tab is one tap away and a choice;
 *  - leaving the finished state undoes all of it, engine included: an
 *    evaluation on screen while the next one is being solved IS the next
 *    one's answer;
 *  - the engine pane exists only once the answer is in, so a phone left
 *    on it when the next one starts falls back to the trainer's pane
 *    rather than facing an empty column.
 *
 * `done` is the finished phase; `ready` says the seed can be built (the
 * puzzle is loaded); `engineOn` is whether the engine should run while
 * analysing (a desktop that docks its engine only once asked keeps it
 * off until then); `onLeave` is the caller's own reset on the way out.
 */
export function useAnalyseInPlace({
  wide,
  infoLabel,
  done,
  ready = true,
  seed,
  engineOn = true,
  swipeEnabled = true,
  onLeave,
}: {
  wide: boolean;
  /** What the trainer's own pane is called on the phone's strip. */
  infoLabel: string;
  done: boolean;
  ready?: boolean;
  /** The line as played, loaded into the analysis store on entry. */
  seed: () => { tree: MoveTree; cursorId: NodeId; orientation: 'white' | 'black' };
  engineOn?: boolean;
  swipeEnabled?: boolean;
  onLeave?: () => void;
}): {
  analysing: boolean;
  pane: TrainerPane;
  setPane: (pane: TrainerPane) => void;
  shownPane: TrainerPane;
  panes: { id: TrainerPane; label: string; icon: typeof Info }[];
  paneSwipe: ReturnType<typeof usePaneSwipe<TrainerPane>>;
} {
  const [analysing, setAnalysing] = useState(false);
  const [pane, setPane] = useState<TrainerPane>('info');
  const shownPane = !analysing && pane === 'engine' ? 'info' : pane;
  const analysingRef = useRef(false);
  analysingRef.current = analysing;
  useEffect(
    () => () => {
      if (analysingRef.current) useEngine.getState().setEnabled(false);
    },
    [],
  );

  useEffect(() => {
    if (done && ready && !analysing) {
      useAnalysis.setState({
        ...seed(),
        pendingPromotion: null,
        loadError: null,
        gameHeaders: null,
      });
      setAnalysing(true);
    }
    if (!done && analysing) {
      setAnalysing(false);
      setPane('info');
      onLeave?.();
      useEngine.getState().setEnabled(false);
    }
    // seed() and onLeave close over the caller's current state; the guards
    // above are what keep this from re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, ready, analysing]);

  // Whether the engine is on follows what is showing it: on for as long
  // as the caller says so while analysing, and off with everything else
  // above on the way out.
  useEffect(() => {
    if (analysing) useEngine.getState().setEnabled(engineOn);
  }, [analysing, engineOn]);

  // One list, read by the strip and by the swipe that turns it: the two
  // are the same row, and an array written twice is an order that drifts.
  const panes = [
    { id: 'info' as const, label: infoLabel, icon: Info },
    { id: 'moves' as const, label: t('Moves'), icon: ListOrdered },
    // The engine is what an exercise is FOR — offered when the answer
    // is in, not while it is being looked for.
    ...(analysing ? [{ id: 'engine' as const, label: 'Engine', icon: Cpu }] : []),
  ];
  // Swipe the column sideways to turn to the next pane — the strip's own
  // page turn, made where the thumb already is. Only where the panes ARE
  // a row: a wide layout stands them all in the column at once.
  const paneSwipe = usePaneSwipe<TrainerPane>({
    panes,
    value: shownPane,
    onChange: setPane,
    enabled: !wide && swipeEnabled,
  });

  return { analysing, pane, setPane, shownPane, panes, paneSwipe };
}
