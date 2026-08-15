import { AlertTriangle, Database, HelpCircle, Settings2, Thermometer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { summarisePlan, tagLine } from '@shared/explain';
import { getNode } from '@shared/tree';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useExplain } from '@/store/explain';
import { Button } from '@/ui/Button';
import { PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { SideDot } from '@/ui/SideDot';
import { Switch } from '@/ui/Switch';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { ExplainCard } from './ExplainCard.tsx';
import { motifChips, planText } from './explainText.ts';
import { formatPv, type PvPly } from './pv.ts';
import { PvMoves } from './PvMoves.tsx';
import { PvPeek, usePvPeek } from './PvPeek.tsx';
import { moverChances } from './review.ts';
import { lookupTablebase, tablebaseEligible, tbVerdict, type TbResult } from './tablebase.ts';
import { formatScore, formatWdl, toWhitePov, wdlToWhitePov, type PvLine } from './uci.ts';
import { t } from '@/lib/i18n';

/**
 * The engine, panel-less: a slim strip (label, depth, settings, switch)
 * that expands into eval + lines when enabled. Docked at the top of the
 * Moves panel in every view — merged rather than a separate panel (lanph3re's
 * call: "looks more natural"), which also means an idle engine costs one
 * row instead of a whole pane.
 */
export function EngineBlock({ className }: { className?: string }) {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const playLine = useAnalysis((s) => s.playLine);
  const orientation = useAnalysis((s) => s.orientation);

  const enabled = useEngine((s) => s.enabled);
  const toggle = useEngine((s) => s.toggle);
  const lines = useEngine((s) => s.lines);
  const resultFen = useEngine((s) => s.resultFen);
  const finished = useEngine((s) => s.finished);
  const error = useEngine((s) => s.error);
  const analyse = useEngine((s) => s.analyse);
  const [showSettings, setShowSettings] = useState(false);

  const heatOn = useExplain((s) => s.heatOn);
  const heatUnsupported = useExplain((s) => s.heatUnsupported);
  const toggleHeat = useExplain((s) => s.toggleHeat);
  const cardOpen = useExplain((s) => s.cardOpen);
  const toggleCard = useExplain((s) => s.toggleCard);

  const node = getNode(tree, cursorId);
  const turn: 'white' | 'black' = node.fen.split(' ')[1] === 'b' ? 'black' : 'white';

  // Re-analyse whenever the position changes, or the engine is switched on.
  useEffect(() => {
    analyse(node.fen);
  }, [node.fen, enabled, analyse]);

  // Exact endgame verdicts, fetched only when a tablebase can answer at
  // all (≤7 men, no castling). Silent on failure: the row is an
  // enhancement, not something the pane may error over.
  const [tablebase, setTablebase] = useState<TbResult | null>(null);
  useEffect(() => {
    setTablebase(null);
    if (!enabled || !tablebaseEligible(node.fen)) return;
    let stale = false;
    void lookupTablebase(node.fen).then((r) => {
      if (!stale) setTablebase(r);
    });
    return () => {
      stale = true;
    };
  }, [node.fen, enabled]);
  const tablebaseText = tablebase ? tbVerdict(tablebase, turn) : null;

  // SPA leak guard: navigating away unmounts this block but nothing else
  // would halt an in-flight `go` — Stockfish would keep burning threads
  // with no UI attached. Stop the search; the worker stays warm and the
  // analyse effect above resumes it on remount.
  useEffect(() => () => useEngine.getState().stop(), []);

  // Hover previews of the lines. Desktop only: with a thumb there is no
  // hovering to preview with, so nothing is even wired up — the plies stay
  // clickable, which is the half of this that works on any device.
  const finePointer = useMediaQuery('(pointer: fine)');
  const { peek, show, hide, close } = usePvPeek(finePointer);
  // A new position replaces every line wholesale, so the ply the card was
  // anchored to no longer exists. No grace period for that one.
  useEffect(() => close(), [node.fen, close]);

  // Only trust results that belong to the position on screen.
  const fresh = resultFen === node.fen;
  const visibleLines = fresh ? lines : [];
  const top = visibleLines[0];
  const score = top ? toWhitePov({ cp: top.cp, mate: top.mate }, turn) : null;

  /**
   * Sharpness: the winning-chances gap between the best and second-best
   * move. Free exactly when two lines are already being searched — it is
   * never worth silently raising MultiPV for, so with one line it simply
   * doesn't exist. Depth-gated to keep the chip from flickering on the
   * shallow first iterations.
   */
  const sharpness = useMemo(() => {
    if (visibleLines.length < 2) return null;
    const [a, b] = visibleLines as [PvLine, PvLine];
    if (a.depth < 10 || b.depth < 10) return null;
    const best = moverChances(toWhitePov({ cp: a.cp, mate: a.mate }, turn), turn);
    const second = moverChances(toWhitePov({ cp: b.cp, mate: b.mate }, turn), turn);
    // A lost position has no critical move — every road goes downhill.
    if (best < 0.15) return null;
    const gap = best - second;
    if (gap < 0.15) return null;
    return { onlyMove: gap >= 0.3, best: Math.round(best * 100), second: Math.round(second * 100) };
  }, [visibleLines, turn]);

  /**
   * The top line's plan, one phrase list under the lines. Depth-gated
   * like the sharpness chip: a plan read off a depth-6 iteration would
   * change three times a second. Keyed on the PV STRING for the same
   * reason PvRow's memo is — parseInfo allocates a fresh moves array per
   * info line.
   */
  const topPvKey = top && top.depth >= 12 ? top.moves.join(' ') : '';
  const plan = useMemo(
    () => (topPvKey ? summarisePlan(node.fen, topPvKey.split(' ')) : null),
    [node.fen, topPvKey],
  );
  const planLine = plan ? planText(plan) : null;
  // "Neither side can make progress" belongs to nobody; every other plan
  // is the side to move's and must say so (lanph3re's report: whose plan
  // this was wasn't readable off the line).
  const planQuiet = plan?.gestures[0]?.type === 'quiet';

  return (
    // The identical header the standalone Engine panel had — the merge
    // must not change how the headers look (lanph3re's call), only remove the
    // extra panel chrome between engine and moves.
    <div className={cn('shrink-0', className)}>
      <PanelHeader
        title={
          <span className="flex items-baseline gap-2">
            {t('Engine')}
            {/* The evaluation lives HERE now, not on a bar row of its
                own: the number is the answer, the board's vertical bar
                already draws the picture, and a second bar inside the
                panel bought nothing for the row it cost (lanph3re's
                call). */}
            {enabled && top && score && (
              <>
                <span
                  className={cn(
                    'font-mono text-xs font-semibold normal-case tabular-nums tracking-normal',
                    (score.mate ?? score.cp ?? 0) >= 0 ? 'text-good' : 'text-bad',
                  )}
                >
                  {formatScore(score)}
                </span>
                <span className="text-subtle font-mono normal-case tracking-normal">
                  {t('depth')} {top.depth}
                  {top.selDepth ? `/${top.selDepth}` : ''}
                  {finished ? '' : '…'}
                </span>
                {/* The practical reading of the number: how the engine's own
                    model says this converts to results at its full strength.
                    White POV like the score, so the two never disagree in
                    sign. */}
                {top.wdl && (
                  <span
                    className="text-subtle font-mono text-[10px] normal-case tabular-nums tracking-normal"
                    title={t('White wins · draw · Black wins, in per cent — the engine’s own estimate at full strength.')}
                  >
                    {formatWdl(wdlToWhitePov(top.wdl, turn))}
                  </span>
                )}
                {/* Appears only at genuine forks in the road, so it can
                    afford to be loud when it does. */}
                {sharpness && (
                  <span
                    className="bg-nag-mistake/15 text-nag-mistake rounded px-1.5 py-px text-[10px] font-semibold normal-case tracking-normal"
                    title={t(
                      'The best move keeps {best}% winning chances for the side to move; the second best only {second}%.',
                      { best: sharpness.best, second: sharpness.second },
                    )}
                  >
                    {sharpness.onlyMove ? t('Only move') : t('Critical')}
                  </span>
                )}
              </>
            )}
          </span>
        }
        actions={
          <>
            {/* The Why card: threat + last-move probes, on demand. */}
            <Button
              variant="ghost"
              size="icon-sm"
              active={cardOpen}
              onClick={toggleCard}
              title={t('Explain this position')}
            >
              <HelpCircle className="size-3.5" />
            </Button>
            {/* Board overlay of NNUE piece values. Hidden outright once an
                engine build proves it cannot answer — a control that can
                never do anything is worse than none. */}
            {!heatUnsupported && (
              <Button
                variant="ghost"
                size="icon-sm"
                active={heatOn}
                onClick={toggleHeat}
                title={t('Piece values on the board')}
              >
                <Thermometer className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              active={showSettings}
              onClick={() => setShowSettings((v) => !v)}
              title={t('Engine settings')}
            >
              <Settings2 className="size-3.5" />
            </Button>
            <Switch
              checked={enabled}
              onToggle={toggle}
              label={t('Engine on/off')}
              title={enabled ? t('Turn the engine off') : t('Turn the engine on')}
            />
          </>
        }
      />

      {/* A window, not a drawer inside the panel. Opening it in place
          pushed the eval bar and the three PV lines down the screen — the
          reader loses the thing they were reading in order to change how
          it is computed. On a phone the window is a bottom sheet. */}
      {/* Not gated on the engine being ON. Half of what is in here — the
          lines to show, the memory to give it — is what somebody decides
          BEFORE turning it on, and a settings button that opens nothing
          until you have started the thing it configures is a button that
          looks broken. */}
      {showSettings && (
        <Modal title="Engine settings" icon={Settings2} onClose={() => setShowSettings(false)}>
          <EngineSettings />
        </Modal>
      )}

      {enabled && error && (
        <p className="text-bad flex items-start gap-1.5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {enabled && !error && (
        <>
          {/* A proof outranks an estimate, so it stands above the lines. */}
          {tablebaseText && (
            <p
              className="text-muted flex items-center gap-1.5 px-3 pt-1.5 text-xs"
              title={t('Exact endgame verdict from the Syzygy tablebases — proven, not evaluated.')}
            >
              <Database className="text-primary size-3.5 shrink-0" />
              {tablebaseText}
            </p>
          )}
          {/* Alternating tint down the lines, full-bleed like the game
              lists' stripe — as inset rounded pills the one tinted row
              read as a selection, not as zebra (lanph3re's report). On
              the li, not the button, so hover still paints over it. */}
          <ul className="flex max-h-44 min-h-0 flex-col overflow-y-auto py-1 max-lg:max-h-none [&>li:nth-child(even)]:bg-fg/[0.035]">
            {visibleLines.length === 0 ? (
              <li className="text-subtle px-3 py-1 text-xs">{t('Thinking…')}</li>
            ) : (
              visibleLines.map((line) => (
                <PvRow
                  key={line.multipv}
                  line={line}
                  turn={turn}
                  fen={node.fen}
                  onPlayLine={playLine}
                  onPeek={finePointer ? show : undefined}
                  onPeekEnd={finePointer ? hide : undefined}
                />
              ))
            )}
          </ul>
          {planLine && plan && (
            <p className="text-subtle flex items-baseline gap-1.5 px-3 pt-0.5 pb-1.5 text-xs">
              {!planQuiet && <SideDot side={plan.side} className="size-1.5 self-center" />}
              <span className="text-muted shrink-0 font-medium">
                {planQuiet
                  ? t('Plan:')
                  : plan.side === 'white'
                    ? t('White’s plan:')
                    : t('Black’s plan:')}
              </span>
              <span className="min-w-0">{planLine}</span>
            </p>
          )}
          <ExplainCard
            onPlayLine={playLine}
            onPeek={finePointer ? show : undefined}
            onPeekEnd={finePointer ? hide : undefined}
          />
        </>
      )}
      {/* Closes the expanded engine body so the Moves header below reads
          as its own section; when the engine is off the header's own
          bottom border already does the job. */}
      {enabled && <div className="border-line border-b" />}
      <PvPeek peek={peek} orientation={orientation} />
    </div>
  );
}

/** A single principal variation, rendered in SAN, clickable move by move. */
function PvRow({
  line,
  turn,
  fen,
  onPlayLine,
  onPeek,
  onPeekEnd,
}: {
  line: PvLine;
  turn: 'white' | 'black';
  fen: string;
  onPlayLine: (ucis: string[]) => boolean;
  onPeek?: (ply: PvPly, fen: string, anchor: HTMLElement) => void;
  onPeekEnd?: () => void;
}) {
  const score = toWhitePov({ cp: line.cp, mate: line.mate }, turn);

  // Replaying the line to get SAN is not free, and `info` updates arrive many
  // times a second — so memoise on the line's VALUE, not the array identity.
  // parseInfo allocates a fresh moves array per info line, which made the
  // old identity-keyed memo miss every single time.
  const pvKey = line.moves.join(' ');
  const pv = useMemo(() => formatPv(fen, pvKey ? pvKey.split(' ') : []), [fen, pvKey]);
  const advantage = score.mate ?? score.cp ?? 0;

  // What the tactic IS, when there is one: a chip per line, silent for
  // the overwhelming majority of quiet lines. Depth-gated for stability.
  const chips = useMemo(
    () => (line.depth >= 10 && pvKey ? motifChips(tagLine(fen, pvKey.split(' '))) : []),
    [fen, pvKey, line.depth],
  );

  return (
    <li>
      {/* A div, not a button: the plies inside are the buttons now, and
          nesting them in one would be invalid. The hover tint stays HERE
          rather than moving up to the li, because the zebra stripe is set
          on the li by a parent selector that would outrank it. */}
      {/* No `title` any more. It existed because the row truncated and hid
          the rest of the line — which hovering now shows in full, and the
          global title tooltip would have opened over the preview board. */}
      <div
        className={cn(
          'group hover:bg-surface-2 flex w-full items-baseline gap-2 px-3 py-1 text-left',
          'transition-colors duration-100',
        )}
      >
        <span
          className={cn(
            'w-[3.25rem] shrink-0 font-mono text-xs font-semibold tabular-nums',
            advantage >= 0 ? 'text-good' : 'text-bad',
          )}
        >
          {formatScore(score)}
        </span>
        {chips.map((chip) => (
          <span
            key={chip}
            // A motif always belongs to the side to move in the line; the
            // swatch says whose it is without spending a word on it.
            title={
              turn === 'white'
                ? t('A tactic for White in this line')
                : t('A tactic for Black in this line')
            }
            className="bg-primary-soft text-primary inline-flex shrink-0 items-center gap-1 rounded px-1 py-px text-[9px] font-semibold"
          >
            <SideDot side={turn} className="size-1.5 rounded-[2px]" />
            {chip}
          </span>
        ))}
        {/* One line at rest so three lines cost three rows; the row being
            read opens up to put every ply within reach. Hover-expansion is
            fine-pointer only — a tapped :hover sticks, and a row that
            grew under the thumb would shove the next one away. */}
        <PvMoves
          plies={pv.plies}
          text={pv.text}
          fen={fen}
          onPlayLine={onPlayLine}
          onPeek={onPeek}
          onPeekEnd={onPeekEnd}
          className={cn(
            'min-w-0 flex-1 truncate',
            'group-focus-within:whitespace-normal pointer-fine:group-hover:whitespace-normal',
          )}
        />
      </div>
    </li>
  );
}

function EngineSettings() {
  const threads = useEngine((s) => s.threads);
  const hashMb = useEngine((s) => s.hashMb);
  const multiPv = useEngine((s) => s.multiPv);
  const depth = useEngine((s) => s.depth);
  const threadsAvailable = useEngine((s) => s.threadsAvailable);
  const setOption = useEngine((s) => s.setOption);

  const maxThreads = Math.max(1, navigator.hardwareConcurrency || 4);

  return (
    <div className="border-line bg-surface-inset grid gap-3 border-b px-3 py-3">
      <Slider
        label={t('Threads')}
        value={threads}
        min={1}
        max={maxThreads}
        disabled={!threadsAvailable}
        hint={threadsAvailable ? `of ${maxThreads} cores` : 'unavailable in this context'}
        onChange={(v) => setOption({ threads: v })}
      />
      <Slider
        label={t('Lines')}
        value={multiPv}
        min={1}
        max={6}
        onChange={(v) => setOption({ multiPv: v })}
      />
      <Slider
        label={t('Depth')}
        value={depth}
        min={10}
        max={40}
        onChange={(v) => setOption({ depth: v })}
      />
      <Slider
        label={t('Hash')}
        value={hashMb}
        min={16}
        max={1024}
        step={16}
        hint="MB"
        onChange={(v) => setOption({ hashMb: v })}
      />
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={cn('grid gap-1', disabled && 'opacity-50')}>
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-fg font-mono tabular-nums">
          {value}
          {hint ? <span className="text-subtle ml-1 font-sans">{hint}</span> : null}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-primary h-1 w-full cursor-pointer"
      />
    </label>
  );
}
