import { AlertTriangle, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getNode } from '@shared/tree';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { PanelHeader } from '@/ui/Panel';
import { Switch } from '@/ui/Switch';
import { cn } from '@/lib/cn';
import { EvalBar } from './EvalBar';
import { formatPv } from './pv.ts';
import { formatScore, toWhitePov, type PvLine } from './uci.ts';
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
  const playSan = useAnalysis((s) => s.playSan);

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

  // Re-analyse whenever the position changes, or the engine is switched on.
  useEffect(() => {
    analyse(node.fen);
  }, [node.fen, enabled, analyse]);

  // SPA leak guard: navigating away unmounts this block but nothing else
  // would halt an in-flight `go` — Stockfish would keep burning threads
  // with no UI attached. Stop the search; the worker stays warm and the
  // analyse effect above resumes it on remount.
  useEffect(() => () => useEngine.getState().stop(), []);

  // Only trust results that belong to the position on screen.
  const fresh = resultFen === node.fen;
  const visibleLines = fresh ? lines : [];
  const top = visibleLines[0];
  const score = top ? toWhitePov({ cp: top.cp, mate: top.mate }, turn) : null;

  return (
    // The identical header the standalone Engine panel had — the merge
    // must not change how the headers look (lanph3re's call), only remove the
    // extra panel chrome between engine and moves.
    <div className={cn('shrink-0', className)}>
      <PanelHeader
        title={
          <span className="flex items-center gap-1.5">
            Engine
            {enabled && top && (
              <span className="text-subtle font-mono normal-case tracking-normal">
                depth {top.depth}
                {top.selDepth ? `/${top.selDepth}` : ''}
                {finished ? '' : '…'}
              </span>
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
              onToggle={toggle}
              label={t('Engine on/off')}
              title={enabled ? t('Turn the engine off') : t('Turn the engine on')}
            />
          </>
        }
      />

      {enabled && showSettings && <EngineSettings />}

      {enabled && error && (
        <p className="text-bad flex items-start gap-1.5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {enabled && !error && (
        <>
          {/* The horizontal eval bar is redundant on phones — the board's
              vertical eval bar is always visible there — so hide it and give
              the room to the PV lines (three of them, multiPv=3). */}
          <div className="flex items-center gap-2 px-3 pt-2.5 max-lg:hidden">
            <span className="text-fg min-w-[3.75rem] font-mono text-lg font-semibold tabular-nums">
              {score ? formatScore(score) : '…'}
            </span>
            <EvalBar score={score} orientation="horizontal" className="flex-1" />
          </div>

          <ul className="flex max-h-44 min-h-0 flex-col gap-px overflow-y-auto px-1.5 py-2 max-lg:max-h-none">
            {visibleLines.length === 0 ? (
              <li className="text-subtle px-1.5 py-1 text-xs">{t('Thinking…')}</li>
            ) : (
              visibleLines.map((line) => (
                <PvRow
                  key={line.multipv}
                  line={line}
                  turn={turn}
                  fen={node.fen}
                  onPlay={playSan}
                />
              ))
            )}
          </ul>
        </>
      )}
      {/* Closes the expanded engine body so the Moves header below reads
          as its own section; when the engine is off the header's own
          bottom border already does the job. */}
      {enabled && <div className="border-line border-b" />}
    </div>
  );
}

/** A single principal variation, rendered in SAN and clickable. */
function PvRow({
  line,
  turn,
  fen,
  onPlay,
}: {
  line: PvLine;
  turn: 'white' | 'black';
  fen: string;
  onPlay: (san: string) => boolean;
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
      <button
        type="button"
        disabled={!pv.firstSan}
        onClick={() => {
          if (pv.firstSan) onPlay(pv.firstSan);
        }}
        // Full line in the tooltip, since the row itself truncates.
        title={pv.text}
        className={cn(
          'hover:bg-surface-2 flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left',
          'transition-colors duration-100 disabled:pointer-events-none',
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
        <span className="text-muted min-w-0 flex-1 truncate text-xs">{pv.text}</span>
      </button>
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
