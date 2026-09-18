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
 * The iOS capsule gets smaller on a scroll down by a transform
 * (shell/mobile-nav), which a border box does not see, so the footprint
 * holds still while it does; a footprint that followed a shrinking box
 * would reflow the page under the finger on every scroll.
 */
const heights = new Map<Element, number>();
let observer: ResizeObserver | null = null;

let zeroPending = 0;

/**
 * A non-zero footprint is published at once. A ZERO waits a frame: when
 * a page claims the edge, the tab bar unmounts in one commit and the
 * slot that replaces it is still display:none until that commit's
 * classes land, so for one frame the largest measurement is nothing at
 * all, and main's padding collapsed by the bar's height and the whole
 * page jumped for that frame at the start of every push (measured on
 * the demo, 2026-09-18: pad 80px, 0px, 80px across three samples). A
 * zero that is still the answer a frame later (an edited note claiming
 * the edge with nothing; the keyboard and md are the stylesheet's zero
 * anyway) is published then.
 */
function publish(): void {
  let h = 0;
  for (const v of heights.values()) if (v > h) h = v;
  if (h > 0) {
    if (zeroPending) cancelAnimationFrame(zeroPending);
    zeroPending = 0;
    document.documentElement.style.setProperty('--bottom-bar-measured', `${Math.round(h)}px`);
    return;
  }
  if (zeroPending) return;
  zeroPending = requestAnimationFrame(() => {
    zeroPending = 0;
    let again = 0;
    for (const v of heights.values()) if (v > again) again = v;
    if (again === 0) document.documentElement.style.setProperty('--bottom-bar-measured', '0px');
  });
}

function measure(el: Element): void {
  // Offset geometry, not the client rect: the iOS capsule is scaled
  // while the page is read, and the client rect would follow the scale.
  // The bar is positioned on the row, so its offsets are the row's.
  const box = el as HTMLElement;
  const row = box.offsetParent as HTMLElement | null;
  // A hidden bar has no offset parent and no height.
  if (!row || box.offsetHeight === 0) {
    heights.set(el, 0);
    return;
  }
  heights.set(el, row.clientHeight - box.offsetTop);
}

export function useBottomBarMeasure(): (el: HTMLElement | null) => void {
  const held = useRef<HTMLElement | null>(null);
  return (el: HTMLElement | null) => {
    const prev = held.current;
    if (prev) {
      observer?.unobserve(prev);
      heights.delete(prev);
    }
    held.current = el;
    if (el) {
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
