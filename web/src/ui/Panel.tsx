import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Removes internal padding, for panels that own their own scroll area. */
  flush?: boolean;
  /**
   * Makes the panel height-resizable on desktop: a grip appears along the
   * bottom edge, and the chosen height persists in localStorage under this
   * key. Double-click the grip to return to the default flex sizing.
   */
  resizeKey?: string;
}

const storageKey = (key: string): string => `vault:panel-h:${key}`;

/** Tailwind's lg breakpoint — resizing only makes sense when every panel is
    on screen at once; below that the layouts flex a single visible pane. */
function useLgViewport(enabled: boolean): boolean {
  const [lg, setLg] = useState(
    () => enabled && window.matchMedia('(min-width: 64rem)').matches,
  );
  useEffect(() => {
    if (!enabled) return;
    const mq = window.matchMedia('(min-width: 64rem)');
    const update = (): void => setLg(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [enabled]);
  return lg;
}

/** The standard raised surface: every pane in the app sits in one of these. */
export function Panel({ children, className, flush = false, resizeKey }: PanelProps) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [height, setHeight] = useState<number | null>(() => {
    if (!resizeKey) return null;
    const stored = Number(localStorage.getItem(storageKey(resizeKey)));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });
  const lg = useLgViewport(resizeKey !== undefined);

  useEffect(() => {
    if (!resizeKey) return;
    if (height === null) localStorage.removeItem(storageKey(resizeKey));
    else localStorage.setItem(storageKey(resizeKey), String(Math.round(height)));
  }, [resizeKey, height]);

  // The inline style must beat whatever flex/min/max classes the call site
  // uses by default — but only on desktop, where the grip is visible; small
  // screens keep their flex behaviour untouched.
  const sized = resizeKey !== undefined && lg && height !== null;

  return (
    <section
      ref={ref}
      style={sized ? { height, minHeight: 0, maxHeight: height, flex: 'none' } : undefined}
      className={cn(
        'bg-surface border-line rounded-xl border shadow-[var(--shadow-panel)]',
        'flex min-h-0 flex-col overflow-hidden',
        !flush && 'p-3',
        className,
      )}
    >
      {children}
      {resizeKey !== undefined && (
        <div
          title="Drag to resize · double-click to reset"
          onDoubleClick={() => {
            drag.current = null;
            setHeight(null);
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            drag.current = { y: e.clientY, h: ref.current?.offsetHeight ?? 0 };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            // The buttons check drops stray moves delivered after release
            // (synthetic double-clicks emit them), which would otherwise
            // resurrect the height a reset just cleared.
            if (!drag.current || (e.buttons & 1) === 0) return;
            const next = drag.current.h + e.clientY - drag.current.y;
            setHeight(Math.min(Math.max(next, 100), window.innerHeight * 0.8));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          className={cn(
            'border-line/60 hover:bg-surface-2 hidden h-2.5 shrink-0 touch-none',
            'cursor-row-resize items-center justify-center border-t transition-colors lg:flex',
          )}
        >
          <div className="bg-line h-[3px] w-8 rounded-full" />
        </div>
      )}
    </section>
  );
}

interface PanelHeaderProps {
  title: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, actions, className }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'border-line flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3',
        className,
      )}
    >
      <h2 className="text-subtle min-w-0 shrink truncate text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {title}
      </h2>
      {actions ? <div className="flex min-w-0 items-center gap-1">{actions}</div> : null}
    </header>
  );
}
