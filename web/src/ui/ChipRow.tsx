import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

/**
 * THE horizontal filter row: single line, scrolls sideways, scrollbar
 * hidden. Touch devices pan it; fine-pointer devices can't, so they get
 * chevron nudge buttons (only while there is somewhere to go) and the
 * mouse wheel scrolls it horizontally on hover.
 */
export function ChipRow({
  className,
  innerClassName,
  children,
}: {
  /** Outer wrapper (borders, padding, margins). */
  className?: string;
  /** The scrolling line itself (defaults to the chip gap). */
  innerClassName?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState({ left: false, right: false });
  const update = (): void => {
    const el = ref.current;
    if (!el) return;
    setCan({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Vertical wheel pans the row while hovering it — the natural desktop
    // gesture; needs a non-passive native listener to preventDefault.
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0 || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attach once
  }, []);

  const nudge = (dir: -1 | 1): void => {
    // Plain scrollBy: smooth-behavior scrollBy silently no-ops on these
    // containers in Chrome, and an instant 180px hop reads fine.
    ref.current?.scrollBy(dir * 180, 0);
  };

  const arrow =
    'bg-surface/95 border-line text-subtle hover:text-fg absolute top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full border shadow-panel transition-colors pointer-coarse:hidden';

  return (
    <div className={cn('relative min-w-0', className)}>
      {can.left && (
        <button type="button" aria-label={t('Scroll left')} onClick={() => nudge(-1)} className={cn(arrow, 'left-0')}>
          <ChevronLeft className="size-3.5" />
        </button>
      )}
      <div
        ref={ref}
        onScroll={update}
        className={cn('flex items-center gap-1.5 overflow-x-auto scrollbar-hidden', innerClassName)}
      >
        {children}
      </div>
      {can.right && (
        <button type="button" aria-label={t('Scroll right')} onClick={() => nudge(1)} className={cn(arrow, 'right-0')}>
          <ChevronRight className="size-3.5" />
        </button>
      )}
    </div>
  );
}
