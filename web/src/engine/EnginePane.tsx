import { AlertTriangle, Database, Settings2, Thermometer } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { blackToMoveAtRoot, getNode, mainlineFrom, moveNumberLabel, pathTo } from '@shared/tree';
import type { MoveNode, NodeId } from '@shared/types';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { useExplain } from '@/store/explain';
import { Button } from '@/ui/Button';
import { PanelHeader } from '@/ui/Panel';
import { Modal } from '@/ui/Modal';
import { Switch } from '@/ui/Switch';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/media';
import { figurine } from '@/analysis/notation';
import { formatPv, type PvPly } from './pv.ts';
import { PvMoves } from './PvMoves.tsx';
import { PvPeek, usePvPeek } from './PvPeek.tsx';
import { lookupTablebase, tablebaseEligible, tbVerdict, type TbResult } from './tablebase.ts';
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

  const heatOn = useExplain((s) => s.heatOn);
  const heatUnsupported = useExplain((s) => s.heatUnsupported);
  const toggleHeat = useExplain((s) => s.toggleHeat);

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
              </>
            )}
          </span>
        }
        actions={
          <>
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

      {/* NOT gated on `enabled`, which is the whole point: a start that
          fails reports the failure and then turns the engine off, so a
          message that only shows while it is on is a message nobody can
          ever read. What it looked like instead was a switch that flicked
          on and back off by itself. The error is cleared by the next
          successful start, so it cannot outlive the thing it describes. */}
      {error && (
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
          <ul
            className={cn(
              'flex min-h-0 flex-col overflow-y-auto py-1 [&>li:nth-child(even)]:bg-fg/[0.035]',
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
        </>
      )}
      {/* Where you actually are, under what the engine makes of it —
          below lg only, which is exactly where this block is a TAB.
          There the moves live behind a different tab, so reading a
          variation meant leaving the engine to see what it was a
          variation OF, and coming back. On a desktop the Moves panel is
          already the next thing down this same column and a second copy
          of the line would be a second copy of the line. */}
      {enabled && !error && standalone && <CurrentLine />}
      {/* Closes the expanded engine body so the Moves header below reads
          as its own section; when the engine is off the header's own
          bottom border already does the job. Nothing follows it when the
          block stands alone, so there is nothing to separate from — the
          rule just sat under the last row as a line to nowhere. */}
      {enabled && !standalone && <div className="border-line shrink-0 border-b" />}
      <PvPeek peek={peek} orientation={orientation} />
    </div>
  );
}

/**
 * The line up to the cursor, as one wrapped strip of SAN.
 *
 * Deliberately one LINE and not the tree: this answers "what am I looking
 * at", which the Moves panel answers with columns, numbering, variations,
 * comments and NAGs. Repeating any of that here would be building a second
 * moves panel inside the engine — the point is a sentence you can read
 * without leaving the tab you are in.
 *
 * The whole line, though, and not just what leads up to the cursor: a
 * strip that shortened every time you stepped back would answer "how did
 * I get here" when the question is "where am I". So it runs from the root
 * through the cursor and on down the mainline, and moving about changes
 * which move is lit rather than how many there are.
 *
 * Clickable all the same, because a strip of moves that cannot be stepped
 * through is a picture of a list.
 */
function CurrentLine() {
  const tree = useAnalysis((s) => s.tree);
  const cursorId = useAnalysis((s) => s.cursorId);
  const setCursor = useAnalysis((s) => s.setCursor);
  const blackFirst = blackToMoveAtRoot(tree);

  // `forced` is for a move that follows a bracket, or opens one: a Black
  // move normally carries no number, and after "(2.d4 exd4 3.♘f3)" a bare
  // ♘c6 has lost the thread of where it belongs. PGN writes 2...♘c6 there
  // for exactly this reason.
  const chip = (id: NodeId, node: MoveNode, forced = false): ReactNode => {
    const numbered = forced || (node.ply + (blackFirst ? 1 : 0)) % 2 === 1;
    const on = id === cursorId;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setCursor(id)}
        className={cn(
          'rounded px-1 py-0.5 text-xs transition-colors duration-100',
          // The one you are on carries the accent, the same way a hovered
          // ply in a variation above does — one grammar for "this move" in
          // the whole panel.
          on ? 'text-primary font-semibold' : 'text-muted hover:text-fg hover:bg-surface-3',
        )}
      >
        {numbered && (
          <span className="text-subtle mr-0.5 font-mono">
            {moveNumberLabel(node.ply, blackFirst)}
          </span>
        )}
        {figurine(node.san ?? '')}
      </button>
    );
  };

  /**
   * A sideline, flat: its own moves and nothing else.
   *
   * One level deep on purpose. A bracket inside a bracket is a tree, and a
   * tree is what the Moves tab is for — this is a sentence you read at a
   * glance, and nesting is the first thing that stops it being one.
   *
   * Appended to a shared array rather than returned, because a bracket and
   * the moves inside it have to be one flat run of inline content: the
   * strip wraps, and a nested flex box would refuse to break in the middle
   * of a long variation.
   */
  const emit = (out: ReactNode[], firstId: NodeId): void => {
    let cur: NodeId | undefined = firstId;
    let first = true;
    while (cur) {
      const id: NodeId = cur;
      const node = getNode(tree, id);
      out.push(chip(id, node, first));
      first = false;
      cur = node.children[0];
    }
  };

  // The line THROUGH the cursor: what led here, and where it goes on from
  // here. Walked as one chain so a cursor sitting inside a variation reads
  // that variation as the line, which is what it is — and each move on it
  // carries what was played instead, in brackets, PGN's own shape. The
  // order matters: the alternative belongs beside the move it replaces,
  // not in front of it.
  const chain = [...pathTo(tree, cursorId).slice(1), ...mainlineFrom(tree, cursorId)];
  if (chain.length === 0) return null;
  const out: ReactNode[] = [];
  let forced = false;
  for (const id of chain) {
    const node = getNode(tree, id);
    out.push(chip(id, node, forced));
    forced = false;
    const parent = node.parentId === null ? null : getNode(tree, node.parentId);
    for (const alt of parent ? parent.children.filter((c) => c !== id) : []) {
      // Negative margins because the chips carry their own padding: the
      // bracket has to sit against the move, not a gap away from it.
      out.push(
        <span key={`${alt}-(`} className="text-subtle -mr-1 text-xs">
          (
        </span>,
      );
      emit(out, alt);
      out.push(
        <span key={`${alt}-)`} className="text-subtle -ml-1 text-xs">
          )
        </span>,
      );
      forced = true;
    }
  }

  return (
    // Capped and scrollable: a game with sidelines at every move would
    // otherwise grow this box until it had eaten the variations above it.
    <div className="border-line max-h-24 shrink-0 overflow-y-auto border-t px-3 py-1.5">
      <div className="flex flex-wrap items-baseline gap-x-0.5 gap-y-1">{out}</div>
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
  const moveSeconds = useEngine((s) => s.moveSeconds);
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
      {/* Under Depth, because it is a ceiling on what Depth costs and not a
          setting of its own: whichever comes first stops the search. Shown
          as "off" at 0 rather than "0 s", which would read as "no time". */}
      <Slider
        label={t('Time limit')}
        value={moveSeconds}
        min={0}
        max={60}
        hint={moveSeconds === 0 ? t('off') : 's'}
        format={(v) => (v === 0 ? '—' : String(v))}
        onChange={(v) => setOption({ moveSeconds: v })}
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
    <label className={cn('grid gap-1', disabled && 'opacity-50')}>
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-fg font-mono tabular-nums">
          {format ? format(value) : value}
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
