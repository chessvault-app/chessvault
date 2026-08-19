import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EvalBar } from '@/engine/EvalBar';
import { terminalScore } from '@/engine/terminal';
import { formatScore, toWhitePov } from '@/engine/uci';
import { useEngine } from '@/store/engine';
import { t } from '@/lib/i18n';

/**
 * The last verdict, kept outside the component.
 *
 * On a phone the panel this sits in is UNMOUNTED while the engine pane is
 * showing, so coming back from the engine built a fresh component with an
 * empty verdict and started a whole second search of a position that had
 * already been answered — for as many times as the reader looked at the
 * engine and came back. One entry, because there is only ever one
 * finished line on screen; it is keyed by the position, so it can never
 * answer for a different one.
 */
let lastVerdict: { fen: string; score: { cp?: number; mate?: number } } | null = null;

/**
 * How the line ended, and a way into the board.
 *
 * The trainer's job stops when the line leaves the database — the panel
 * has always SAID to go and analyse it, and then offered nothing to do
 * that with. So the button is back, at the one moment it means
 * something, and it carries the answer to the question you would open
 * the board to ask: how does this position actually stand.
 *
 * The engine is not switched on HERE, though it once was. The page turns
 * it on when the line ends, and a child's effect runs before its parent's
 * — so this component won the race every time, believed the engine was
 * its own, and duly switched it off again the moment its search returned
 * or the pane it lives in was swapped away. The engine went on and
 * straight back off at the end of every line. It waits for `enabled`
 * now, and never touches it.
 */
export function FinalAssessment({
  fen,
  children,
}: {
  fen: string;
  /** What else this ending offers, beside Analyse — one row of buttons. */
  children?: ReactNode;
}) {
  const enabled = useEngine((s) => s.enabled);
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
  const [verdict, setVerdict] = useState<{ cp?: number; mate?: number } | null>(
    () => (lastVerdict?.fen === fen ? lastVerdict.score : null),
  );

  /**
   * A line that ended in mate is already answered, and asking the engine
   * would never get an answer back.
   *
   * A terminal position produces no engine lines at all (see
   * engine/terminal.ts), and everything below waits for `lines[0]` — so a
   * drill or a spar that finished with checkmate sat on "Evaluating the
   * position…" for ever, with the engine this panel started still
   * running, and the only way out was to leave the page. Scored by rule
   * instead, and the engine is never asked: nothing about a finished game
   * needs searching.
   */
  const settled = useMemo(() => terminalScore(fen), [fen]);

  useEffect(() => {
    // Nothing to search: already answered, or answered by the rules. And
    // nothing to search WITH until the page has switched the engine on —
    // this re-runs when it does.
    if (verdict || settled || !enabled) return;
    analyse(fen);
  }, [enabled, fen, verdict, settled, analyse]);

  // One position, one search: take the answer at the end of it and keep
  // it. The engine is left alone — it belongs to the page, which wants it
  // on so the Engine pane and the analysis board have something to show,
  // and a finished search is not spinning anything anyway.
  useEffect(() => {
    if (verdict || !finished || resultFen !== fen) return;
    const best = lines[0];
    if (!best) return;
    const turn: 'white' | 'black' = fen.split(' ')[1] === 'b' ? 'black' : 'white';
    const score = toWhitePov({ cp: best.cp, mate: best.mate }, turn);
    lastVerdict = { fen, score };
    setVerdict(score);
  }, [finished, resultFen, fen, lines, verdict]);

  // Before the verdict is in, show the engine's running best guess.
  const live =
    resultFen === fen && lines[0]
      ? toWhitePov(
          { cp: lines[0].cp, mate: lines[0].mate },
          fen.split(' ')[1] === 'b' ? 'black' : 'white',
        )
      : null;
  const score = verdict ?? settled ?? live;

  // Nothing to say, and nobody coming to say it: the page starts the engine
  // on a desktop only, so on a phone this would otherwise hold an empty
  // number, an empty bar and "Evaluating the position…" for ever over a
  // search that was never going to run. Turning the engine on from the
  // Engine tab brings the assessment with it, since that is the state this
  // reads. A position settled by the rules (mate, stalemate) still scores:
  // it never needed the engine.
  if (!score && !enabled) return null;

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
          <span className="text-fg flex min-w-[3.75rem] items-center font-mono text-xl font-semibold tabular-nums">
            {score ? formatScore(score) : <Loader2 className="text-subtle size-4 animate-spin" />}
          </span>
          <EvalBar score={score} orientation="horizontal" className="flex-1" />
        </div>
        <p className="text-subtle min-h-[0.875rem] text-xs leading-none">
          {verdict || settled ? '' : t('Evaluating the position…')}
        </p>
      </div>
      {/* One row: analysing the line and whatever else this ending offers
          are the same kind of choice, and stacking them spent a whole row
          of a panel that is already tall on a phone. It wraps where the
          two do not fit side by side.

          No Analyse here any more: the line ending IS the handoff now, so
          the engine is already on and the moves panel already showing it.
          And with no children the row is not drawn at all — the
          repertoire now stands its ending's buttons on the panel's floor,
          and an empty flex row still spends one of the column's gaps. */}
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
