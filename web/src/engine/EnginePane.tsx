import { AlertTriangle, Cpu, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getNode } from '@shared/tree';
import { useAnalysis } from '@/store/analysis';
import { useEngine } from '@/store/engine';
import { Button } from '@/ui/Button';
import { Panel, PanelHeader } from '@/ui/Panel';
import { cn } from '@/lib/cn';
import { EvalBar } from './EvalBar';
import { formatPv } from './pv.ts';
import { formatScore, toWhitePov, type PvLine } from './uci.ts';

export function EnginePane({ className }: { className?: string }) {
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

  // Only trust results that belong to the position on screen.
  const fresh = resultFen === node.fen;
  const visibleLines = fresh ? lines : [];
  const top = visibleLines[0];
  const score = top ? toWhitePov({ cp: top.cp, mate: top.mate }, turn) : null;

  return (
    <Panel flush className={className}>
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
              title="Engine settings"
            >
              <Settings2 className="size-3.5" />
            </Button>
            <EngineSwitch enabled={enabled} onToggle={toggle} />
          </>
        }
      />

      {showSettings && <EngineSettings />}

      {error && (
        <p className="text-bad flex items-start gap-1.5 px-3 py-2 text-xs">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {!enabled ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <Cpu className="text-subtle size-5" strokeWidth={1.75} />
          <p className="text-muted text-xs leading-relaxed">
            Engine is off. Turn it on to evaluate this position.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3 pt-2.5">
            <span className="text-fg min-w-[3.75rem] font-mono text-lg font-semibold tabular-nums">
              {score ? formatScore(score) : '…'}
            </span>
            <EvalBar score={score} orientation="horizontal" className="flex-1" />
          </div>

          <ul className="flex min-h-0 flex-col gap-px overflow-y-auto px-1.5 py-2">
            {visibleLines.length === 0 ? (
              <li className="text-subtle px-1.5 py-2 text-xs">Thinking…</li>
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

          {top && (
            <div className="border-line text-subtle flex shrink-0 items-center justify-between gap-2 border-t px-3 py-1.5 font-mono text-[0.625rem]">
              <span>{top.nodes ? `${(top.nodes / 1e6).toFixed(1)}M nodes` : ''}</span>
              <span>{top.nps ? `${(top.nps / 1e6).toFixed(1)}M nps` : ''}</span>
            </div>
          )}
        </>
      )}
    </Panel>
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
  // times a second, so memoise on the inputs that actually change it.
  const pv = useMemo(() => formatPv(fen, line.moves), [fen, line.moves]);
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

function EngineSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="Engine on/off"
      onClick={onToggle}
      title={enabled ? 'Turn the engine off' : 'Turn the engine on'}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        enabled ? 'bg-primary' : 'bg-surface-3',
      )}
    >
      {/* left-0 is load-bearing: without it the absolute knob's static
          position is not the pill's left edge and the translate overshoots. */}
      <span
        className={cn(
          'bg-knob absolute left-0 top-0.5 size-4 rounded-full shadow transition-transform duration-200',
          enabled ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
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
