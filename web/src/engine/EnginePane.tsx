import { AlertTriangle, ChevronDown, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getNode } from '@shared/tree';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/components/ui/button';
import { PanelHeader } from '@/components/panel';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Slider as UiSlider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/lib/media';
import { formatPv, type PvPly } from './pv.ts';
import { PvMoves } from './PvMoves.tsx';
import { PvPeek, usePvPeek } from './PvPeek.tsx';
import { CurrentLine } from '@/analysis/CurrentLine';
import { terminalScore } from './terminal.ts';
import { formatScore, toWhitePov, type PvLine } from './uci.ts';
import { t } from '@/lib/i18n';

/**
 * The engine, panel-less: a slim strip (label, depth, settings, switch)
 * that expands into eval + lines when enabled. Docked at the top of the
 * Moves panel in every view — merged rather than a separate panel (lanph3re's
 * call: "looks more natural"), which also means an idle engine costs one
 * row instead of a whole pane.
 */
export function EngineBlock({
  standalone = false,
  className,
}: {
  /**
   * This block IS the pane, rather than being docked above a move list.
   *
   * Two things follow, and both are about the move list that is not
   * there. It fills the pane and scrolls its own lines, instead of
   * sizing to its content and being clipped by the panel around it — with
   * the variations wrapping on a phone, three of them are taller than the
   * pane and the third was simply unreachable. And it shows the line you
   * are on underneath them, because the only other place to read that is
   * a tab away.
   */
  standalone?: boolean;
  className?: string;
}) {
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

  const node = getNode(tree, cursorId);
  const turn: 'white' | 'black' = node.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  /**
   * A finished position has no lines to wait for, and this pane was
   * waiting anyway.
   *
   * Stockfish answers a mated board with `bestmove (none)` and one PV-less
   * `info` line, which parseInfo drops for carrying no variation — so the
   * search ENDS with zero lines, and an empty list that reads "Thinking…"
   * reads it for ever. terminal.ts has said this in its own comment since
   * it was written; only the eval bar was listening.
   */
  const terminal = useMemo(() => terminalScore(node.fen), [node.fen]);

  // Re-analyse whenever the position changes, or the engine is switched on.
  useEffect(() => {
    analyse(node.fen);
  }, [node.fen, enabled, analyse]);

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

  return (
    // The identical header the standalone Engine panel had — the merge
    // must not change how the headers look (lanph3re's call), only remove the
    // extra panel chrome between engine and moves.
    <div
      className={cn(
        standalone ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0',
        className,
      )}
    >
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
                {/* Not green/red. Those mean outcome — solved/failed,
                    won/lost — and an evaluation is a continuous quantity,
                    so a dead-drawn +0.33 was painted the same green as a
                    solved puzzle and -0.01 the same red as a blunder and
                    a delete button. The sign already says which way it
                    goes, and the board's vertical bar draws the picture
                    in the eval colours, which is the vocabulary that
                    means this. */}
                <span className="text-foreground font-mono text-sm font-semibold normal-case tabular-nums tracking-normal">
                  {formatScore(score)}
                </span>
                <span className="text-muted-foreground font-mono normal-case tracking-normal">
                  {t('depth')} {top.depth}
                  {top.selDepth ? `/${top.selDepth}` : ''}
                  {finished ? '' : '…'}
                </span>
              </>
            )}
          </span>
        }
        actions={
          <>
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
              onCheckedChange={toggle}
              aria-label={t('Engine on/off')}
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
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setShowSettings(false);
          }}
        >
          <DialogContent title="Engine settings" icon={Settings2}>
            <EngineSettings />
          </DialogContent>
        </Dialog>
      )}

      {/* NOT gated on `enabled`, which is the whole point: a start that
          fails reports the failure and then turns the engine off, so a
          message that only shows while it is on is a message nobody can
          ever read. What it looked like instead was a switch that flicked
          on and back off by itself. The error is cleared by the next
          successful start, so it cannot outlive the thing it describes. */}
      {error && (
        <p className="text-destructive flex items-start gap-1.5 px-3 py-2 text-sm" role="alert">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {enabled && !error && (
        <>
          {/* Alternating tint down the lines, full-bleed like the game
              lists' stripe — as inset rounded-sm pills the one tinted row
              read as a selection, not as zebra (lanph3re's report). On
              the li, not the button, so hover still paints over it. */}
          <ul
            className={cn(
              'flex min-h-0 flex-col overflow-y-auto py-1 [&>li:nth-child(even)]:bg-foreground/[0.035]',
              // Docked, the lines are capped so the move list under them
              // keeps a panel to live in. Standing alone they are capped by
              // the pane instead: `min-h-0` in a flex column means the list
              // takes its own height while it fits and gives way when it
              // does not — so a short list keeps the current line directly
              // underneath rather than stranding it at the bottom, and a
              // long one scrolls with the line still on screen.
              standalone ? 'min-h-0' : 'max-h-44 max-lg:max-h-none',
            )}
          >
            {terminal ? (
              <li className="text-muted-foreground px-3 py-1 text-sm">
                {terminal.mate !== undefined
                  ? t('Checkmate. There is nothing left to search.')
                  : t('The game ends here. There is nothing left to search.')}
              </li>
            ) : visibleLines.length === 0 ? (
              <li className="text-muted-foreground px-3 py-1 text-sm">{t('Thinking…')}</li>
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
        </>
      )}
      {/* Where you actually are, under what the engine makes of it —
          below lg only, which is exactly where this block is a TAB.
          There the moves live behind a different tab, so reading a
          variation meant leaving the engine to see what it was a
          variation OF, and coming back. On a desktop the Moves panel is
          already the next thing down this same column and a second copy
          of the line would be a second copy of the line. */}
      {enabled && !error && standalone && <CurrentLine className="border-border border-t px-3 py-1.5" />}
      {/* Closes the expanded engine body so the Moves header below reads
          as its own section; when the engine is off the header's own
          bottom border already does the job. Nothing follows it when the
          block stands alone, so there is nothing to separate from — the
          rule just sat under the last row as a line to nowhere. */}
      {enabled && !standalone && <div className="border-border shrink-0 border-b" />}
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

  /**
   * Opened by the chevron, which exists only where there is no pointer to
   * hover with. A phone could not read past the first line of a variation
   * at all: the row truncates, hover-expansion is fine-pointer only for
   * the two reasons below it, and the other way in — focusing a ply — is
   * also the gesture that PLAYS the line, so there was no way to look
   * without acting.
   */
  const [open, setOpen] = useState(false);

  return (
    <li>
      {/* A div, not a button: the plies inside are the buttons now, and
          nesting them in one would be invalid. The hover tint stays HERE
          rather than moving up to the li, because the zebra stripe is set
          on the li by a parent selector that would outrank it. */}
      {/* No tip any more. It existed because the row truncated and hid the
          rest of the line — which hovering now shows in full, and a tip
          would have opened over the preview board this row's hover puts
          up beside it. */}
      <div
        className={cn(
          'group hover:bg-accent flex w-full items-baseline gap-2 px-3 py-1 text-left',
          'transition-colors duration-100',
        )}
      >
        {/* Same as the header's number: an evaluation is not an outcome,
            and three PV rows in green read as three good results rather
            than three lines to compare. The sign carries the direction. */}
        <span className="text-foreground w-[3.25rem] shrink-0 font-mono text-sm font-semibold tabular-nums">
          {formatScore(score)}
        </span>
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
            open && 'whitespace-normal',
          )}
        />
        {/* Coarse pointers only: a fine pointer has hover, and a second
            control in the row would be a target it never needs. Growth is
            deliberate here, so a row pushing the next one down is the
            answer to a press rather than something that happened while a
            thumb was on its way somewhere else. */}
        {/* aria-label and no tip: this button is `display:none` under a
            fine pointer, and neither kind of tooltip opens on touch — so
            the title it used to carry could not be shown to anyone. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={t(open ? 'Show one line' : 'Show the whole variation')}
          className={cn(
            // size-9: it only ever shows under a thumb, so it takes the
            // coarse floor (DESIGN.md, Buttons) outright rather than a
            // 24px box a thumb would miss.
            'text-muted-foreground hover:text-foreground -me-1 hidden size-9 shrink-0',
            'place-items-center rounded-md pointer-coarse:grid',
          )}
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform duration-150', open && 'rotate-180')}
          />
        </button>
      </div>
    </li>
  );
}

function EngineSettings() {
  const threads = useEngine((s) => s.threads);
  const hashMb = useEngine((s) => s.hashMb);
  const multiPv = useEngine((s) => s.multiPv);
  const depth = useEngine((s) => s.depth);
  const moveSeconds = useEngine((s) => s.moveSeconds);
  const threadsAvailable = useEngine((s) => s.threadsAvailable);
  const setOption = useEngine((s) => s.setOption);

  const maxThreads = Math.max(1, navigator.hardwareConcurrency || 4);

  return (
    <div className="border-border bg-muted/50 grid gap-3 border-b px-3 py-3">
      <Slider
        label="Threads"
        value={threads}
        min={1}
        max={maxThreads}
        disabled={!threadsAvailable}
        hint={threadsAvailable ? `of ${maxThreads} cores` : 'unavailable in this context'}
        onChange={(v) => setOption({ threads: v })}
      />
      <Slider
        label="Lines"
        value={multiPv}
        min={1}
        max={6}
        onChange={(v) => setOption({ multiPv: v })}
      />
      <Slider
        label="Depth"
        value={depth}
        min={10}
        max={40}
        onChange={(v) => setOption({ depth: v })}
      />
      {/* Under Depth, because it is a ceiling on what Depth costs and not a
          setting of its own: whichever comes first stops the search. Shown
          as "off" at 0 rather than "0 s", which would read as "no time". */}
      <Slider
        label="Time limit"
        value={moveSeconds}
        min={0}
        max={60}
        hint={moveSeconds === 0 ? t('off') : 's'}
        format={(v) => (v === 0 ? '—' : String(v))}
        onChange={(v) => setOption({ moveSeconds: v })}
      />
      <Slider
        label="Hash"
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
  format,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  /** How the number reads, when the digit is not the whole story. */
  format?: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field
      label={label}
      hint={
        <span className="text-foreground font-mono text-sm tabular-nums">
          {format ? format(value) : value}
          {hint ? <span className="text-muted-foreground ml-1 font-sans">{hint}</span> : null}
        </span>
      }
      className={cn(disabled && 'opacity-50')}
    >
      <UiSlider
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={t(label)}
        onValueChange={(v) => onChange(v as number)}
      />
    </Field>
  );
}
