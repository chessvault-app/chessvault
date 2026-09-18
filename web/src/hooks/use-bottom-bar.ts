import { useRef } from 'react';

/**
 * The phone's bottom bar tells the shell how tall it is.
 *
 * The bar is an overlay on the shell's row (shell/mobile-nav), not a
 * flex sibling of `main` any more, and `main` pads its bottom by
 * `--bottom-bar-h` (styles/shell.css) so a page still ends where the bar
 * begins. The number is measured rather than written down because the
 * bar is not one height: the tab bar is 56px plus the home indicator,
 * a page that claims it (components/mobile-action-bar) fills it with
 * its own controls at their own height, and an edited note claims it
 * with nothing at all. So the bar measures itself, the way a pinned
 * band does (hooks/use-pinned-band), and publishes its FOOTPRINT on the
 * root as `--bottom-bar-measured`: from its top edge to the bottom of
 * the row it is pinned in, which is its height for the docked bar and
 * height plus the lift for the capsule iOS floats above the home
 * indicator (shell/mobile-nav, "Platform-specific design" in
 * docs/design-principles.md). The stylesheet turns
 * that into `--bottom-bar-h` under md and zero elsewhere, and zero while
 * the keyboard is up, when the bar is display:none anyway.
 *
 * Two elements share the edge (the tab bar and the claimed slot), only
 * one of them shown at a time, and a hidden one measures zero; the
 * largest of the measurements is what is published, so the order the
 * two report in cannot matter. A callback ref, since the tab bar mounts
 * and unmounts as pages claim the edge.
 *
 * `hold` keeps the last measurement while true: the iOS capsule drops
 * 12px while it is closed on a scroll down (shell/mobile-nav), and a
 * footprint that followed it would reflow the page under the finger on
 * every scroll. The page pads for the open capsule throughout.
 */
const heights = new Map<Element, number>();
const holds = new Map<Element, boolean>();
let observer: ResizeObserver | null = null;

function publish(): void {
  let h = 0;
  for (const v of heights.values()) if (v > h) h = v;
  document.documentElement.style.setProperty('--bottom-bar-measured', `${Math.round(h)}px`);
}

function measure(el: Element): void {
  if (holds.get(el) && heights.has(el)) return;
  const rect = el.getBoundingClientRect();
  const row = el.parentElement?.getBoundingClientRect();
  // A hidden bar measures a zero box at the origin, and the row's bottom
  // minus that would be the whole screen.
  heights.set(el, rect.height === 0 || !row ? 0 : row.bottom - rect.top);
}

export function useBottomBarMeasure(hold = false): (el: HTMLElement | null) => void {
  const held = useRef<HTMLElement | null>(null);
  // The hold rides the callback: a new closure each render, which React
  // re-runs on commit (null, then the element), so the hold the element
  // carries is the one from the latest render, ahead of the observer's
  // next report.
  return (el: HTMLElement | null) => {
    const prev = held.current;
    if (prev) {
      observer?.unobserve(prev);
      heights.delete(prev);
      holds.delete(prev);
    }
    held.current = el;
    if (el) {
      holds.set(el, hold);
      // Not `??=`: the React Compiler refuses that operator (check:compiler).
      if (!observer) {
        observer = new ResizeObserver((entries) => {
          for (const entry of entries) measure(entry.target);
          publish();
        });
      }
      observer.observe(el);
      measure(el);
    }
    publish();
  };
}
