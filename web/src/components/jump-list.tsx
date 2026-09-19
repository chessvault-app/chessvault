import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { scrollParent } from '@/lib/scroll';

/** One place a jump list can send the page: the element and its name. */
export type JumpTarget = { el: HTMLElement; title: string; /** 0 for a top-level name; each step indents the row. */ depth?: number };

/**
 * Which target is under the top of the window, and the jump to one.
 *
 * The current target is the last one whose top has passed the line a
 * scrolled-to target lands on, read on the targets' own scroller. A
 * target lands at the scroller's scroll-padding (a pinned band, where
 * the page has one) plus its own scroll-margin, so that is the line,
 * with a few pixels of slack for a fractional landing. It was a fixed
 * 80px, which on Settings from xl put the line 24px into whatever card
 * had just been scrolled to, so a card shorter than that handed the pill
 * to the one after it: click A, and B lit (lanph3re's report). Measured
 * on the demo at 1440x800: a jumped-to card's top sits 56px under the
 * scroller's.
 *
 * A click also names its target outright and holds it until that scroll
 * has ended, since the last targets on a page cannot reach the top and
 * the read alone would never light them; and where the scroll ended at
 * the page's floor, the name stays until the reader scrolls, because the
 * read would hand it straight back to the target above.
 */
export function useJumpTargets(targets: JumpTarget[]): { current: number; jump: (i: number) => void } {
  const [current, setCurrent] = useState(0);
  const held = useRef<number | null>(null);
  const floored = useRef(false);
  useEffect(() => {
    if (targets.length === 0) return;
    const scroller = scrollParent(targets[0]!.el);
    if (!scroller) return;
    const read = (): void => {
      if (held.current !== null) return;
      const pad = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
      const line = scroller.getBoundingClientRect().top + pad + 4;
      let at = 0;
      targets.forEach((c, i) => {
        const margin = parseFloat(getComputedStyle(c.el).scrollMarginTop) || 0;
        if (c.el.getBoundingClientRect().top - margin <= line) at = i;
      });
      setCurrent(at);
    };
    // scrollend where the platform has it; a timer stands in where it
    // does not (WebKit), and covers a click whose scroll had no distance
    // to travel and so fires neither event.
    let timer = 0;
    const release = (): void => {
      if (held.current === null) return;
      held.current = null;
      floored.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (!floored.current) read();
    };
    const onScroll = (): void => {
      if (held.current !== null) {
        window.clearTimeout(timer);
        timer = window.setTimeout(release, 150);
        return;
      }
      floored.current = false;
      read();
    };
    read();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('scrollend', release);
    return () => {
      window.clearTimeout(timer);
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('scrollend', release);
    };
  }, [targets]);
  const jump = (i: number): void => {
    held.current = i;
    setCurrent(i);
    targets[i]!.el.scrollIntoView({ block: 'start' });
    // No scroll to end (the target was already at the top): let go now.
    window.setTimeout(() => {
      if (held.current === i) held.current = null;
    }, 400);
  };
  return { current, jump };
}

/**
 * The names as a column for a page's margin, the current one wearing the
 * sidebar's current-row pill. Where it stands is the caller's: the box
 * it is put in differs by page (a sticky list inside a scrolling column
 * on Settings, a fixed one beside the scroller on a note).
 */
export function JumpColumn({
  label,
  targets,
  current,
  onJump,
  className,
}: {
  label: string;
  targets: JumpTarget[];
  current: number;
  onJump: (i: number) => void;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('pointer-events-auto flex flex-col gap-0.5 text-sm', className)}>
      {targets.map((c, i) => (
        <button
          key={`${i}:${c.title}`}
          type="button"
          aria-current={i === current ? 'true' : undefined}
          style={c.depth ? { paddingInlineStart: `${0.625 + c.depth * 0.75}rem` } : undefined}
          className={cn(
            'flex h-8 shrink-0 items-center rounded-md px-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring',
            i === current
              ? 'bg-nav-pill text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          onClick={() => onJump(i)}
        >
          <span className="truncate">{c.title}</span>
        </button>
      ))}
    </nav>
  );
}
