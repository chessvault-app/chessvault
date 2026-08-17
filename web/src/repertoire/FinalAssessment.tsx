import { Loader2, Microscope } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EvalBar } from '@/engine/EvalBar';
import { formatScore, toWhitePov } from '@/engine/uci';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { t } from '@/lib/i18n';

/**
 * How the line ended, and a way into the board.
 *
 * The trainer's job stops when the line leaves the database — the panel
 * has always SAID to go and analyse it, and then offered nothing to do
 * that with. So the button is back, at the one moment it means
 * something, and it carries the answer to the question you would open
 * the board to ask: how does this position actually stand.
 *
 * The engine is switched on to answer it. That is a session switch, not
 * a stored preference — `enabled` is deliberately not persisted (see
 * store/engine.ts) — so this turns it on for the evaluation and leaves
 * it visibly on, rather than running something the app says is off.
 */
export function FinalAssessment({
  fen,
  onAnalyse,
  children,
}: {
  fen: string;
  onAnalyse: () => void;
  /** What else this ending offers, beside Analyse — one row of buttons. */
  children?: ReactNode;
}) {
  const enabled = useEngine((s) => s.enabled);
  const setEnabled = useEngine((s) => s.setEnabled);
  const analyse = useEngine((s) => s.analyse);
  const lines = useEngine((s) => s.lines);
  const resultFen = useEngine((s) => s.resultFen);
  const finished = useEngine((s) => s.finished);

  /**
   * The verdict, kept here rather than read from the engine.
   *
   * Switching the engine off frees its worker AND clears its results (see
   * store/engine.ts), so the number has to be taken out before the engine
   * goes — otherwise stopping it would erase the very thing it was
   * started for.
   */
  const [verdict, setVerdict] = useState<{ cp?: number; mate?: number } | null>(null);
  // Whether WE turned it on. An engine the reader had already running is
  // theirs, and stopping it because a sparring line ended would be this
  // page reaching outside itself.
  const startedByUs = useRef(false);

  useEffect(() => {
    if (verdict) return;
    if (!enabled) {
      startedByUs.current = true;
      setEnabled(true);
      return;
    }
    analyse(fen);
  }, [enabled, fen, verdict, analyse, setEnabled]);

  // One position, one search: take the answer at the end of it and stop.
  // It used to run on after the number appeared, which on a phone is a
  // fan spinning for a line that finished a minute ago.
  useEffect(() => {
    if (verdict || !finished || resultFen !== fen) return;
    const best = lines[0];
    if (!best) return;
    const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    setVerdict(toWhitePov({ cp: best.cp, mate: best.mate }, turn));
    if (startedByUs.current) setEnabled(false);
  }, [finished, resultFen, fen, lines, verdict, setEnabled]);

  // Leaving mid-search stops it too, for the same reason.
  useEffect(
    () => () => {
      if (startedByUs.current) useEngine.getState().setEnabled(false);
    },
    [],
  );

  // Before the verdict is in, show the engine's running best guess.
  const live =
    resultFen === fen && lines[0]
      ? toWhitePov(
          { cp: lines[0].cp, mate: lines[0].mate },
          fen.split(' ')[1] === 'b' ? 'black' : 'white',
        )
      : null;
  const score = verdict ?? live;

  return (
    <div className="flex flex-col gap-2">
      {/* The verdict is ONE block — the number, the bar and the line that
          says the search is still running — so it is spaced as one, and
          only the buttons under it get the panel's own gap. Spread over
          three equal gaps it read as three separate things with the
          button pushed a long way clear of the score it belongs to.

          The number's slot is held whether or not there is a number in it,
          and the bar is drawn empty rather than absent, so the answer
          lands in place instead of pushing the button down when it
          arrives. Starting an engine and searching a position takes long
          enough to look like nothing is happening — hence the spinner in
          the slot and a line that says so. */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-fg flex min-w-[3.75rem] items-center font-mono text-lg font-semibold tabular-nums">
            {score ? formatScore(score) : <Loader2 className="text-subtle size-4 animate-spin" />}
          </span>
          <EvalBar score={score} orientation="horizontal" className="flex-1" />
        </div>
        <p className="text-subtle min-h-[0.875rem] text-[0.6875rem] leading-none">
          {verdict ? '' : t('Evaluating the position…')}
        </p>
      </div>
      {/* One row: analysing the line and whatever else this ending offers
          are the same kind of choice, and stacking them spent a whole row
          of a panel that is already tall on a phone. It wraps where the
          two do not fit side by side. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={onAnalyse}>
          <Microscope className="size-3.5" />
          {t('Analyse on the board')}
        </Button>
        {children}
      </div>
    </div>
  );
}
