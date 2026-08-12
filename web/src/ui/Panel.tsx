import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

interface PanelProps {
  children: ReactNode;
  className?: string;
  /** Removes internal padding, for panels that own their own scroll area. */
  flush?: boolean;
  /**
   * Makes the panel height-resizable on desktop: a grip appears along the
   * bottom edge, and the chosen height persists in localStorage under this
   * key. Double-click the grip to return to the default.
   */
  resizeKey?: string;
  /**
   * Height (px) used on desktop while the user has not dragged their own —
   * the compact out-of-the-box size. Without it, resets return the panel
   * to plain flex sizing.
   */
  defaultHeight?: number;
  /**
   * Size to the content and never clip it.
   *
   * A panel is normally allowed to shrink (`min-h-0`) and hides what does
   * not fit (`overflow-hidden`), which is right for a scrolling list in a
   * fixed column. It is wrong for a short form: squeezed by a tall board
   * above it, the panel simply cut its own last row off with nothing to
   * scroll — the Start button, on a phone.
   */
  fit?: boolean;
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
export function Panel({
  children,
  className,
  flush = false,
  resizeKey,
  defaultHeight,
  fit = false,
}: PanelProps) {
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
  // screens keep their flex behaviour untouched. A user-dragged height is
  // exact; the default is only a CAP, so sparse content isn't padded out
  // to an empty box.
  const style =
    !lg || resizeKey === undefined
      ? undefined
      : height !== null
        ? { height, minHeight: 0, maxHeight: height, flex: 'none' as const }
        : defaultHeight !== undefined
          ? { minHeight: 0, maxHeight: defaultHeight, flex: 'none' as const }
          : undefined;

  return (
    <section
      ref={ref}
      style={style}
      className={cn(
        'bg-surface border-line rounded-xl border shadow-[var(--shadow-panel)]',
        'flex flex-col',
        fit ? 'min-h-max overflow-visible' : 'min-h-0 overflow-hidden',
        !flush && 'p-3',
        className,
      )}
    >
      {children}
      {resizeKey !== undefined && (
        <div
          title={t('Drag to resize · double-click to reset')}
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
            // mt-auto pins the grip to the panel's bottom edge even when a
            // dragged height leaves the panel taller than its content —
            // otherwise it floats mid-panel right under the last row.
            'border-line/60 hover:bg-surface-2 mt-auto hidden h-2.5 shrink-0 touch-none',
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
  /** For a header that wraps: `max-[560px]:w-full` sends the actions to
      their own line rather than letting them squeeze the title. */
  actionsClassName?: string;
  className?: string;
}

export function PanelHeader({ title, actions, actionsClassName, className }: PanelHeaderProps) {
  return (
    <header
      className={cn(
        'border-line flex h-10 shrink-0 items-center justify-between gap-2 border-b px-3',
        className,
      )}
    >
      {/* Translated HERE, not at every call site. A panel title is always
          user-facing, so a caller that forgets t() is a bug that renders
          fine in English and ships. Doing it once means it cannot be
          forgotten; a caller that already translated passes Korean, and
          t() on a string with no entry returns it unchanged. */}
      <h2 className="text-subtle min-w-0 flex-1 truncate text-[0.6875rem] font-semibold uppercase tracking-[0.08em]">
        {typeof title === 'string' ? t(title) : title}
      </h2>
      {/* The actions take exactly their own width and the title takes the
          rest. They used to `grow` while the title merely `shrink`: on a
          phone the buttons — every one of them shrink-0 — overflowed their
          box and painted over the opening name instead of squeezing it. */}
      {actions ? (
        <div className={cn('flex shrink-0 items-center justify-end gap-1', actionsClassName)}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
