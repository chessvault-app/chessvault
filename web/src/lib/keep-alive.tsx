import { Activity, ViewTransition, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { parse, type Section } from './router';

/**
 * Pages that come back as they were left.
 *
 * A route change used to unmount the page: `<main>` drew whichever
 * section the hash named and nothing else, and each section did the same
 * again for its list and its leaf. Nothing survived the trip. Open a note
 * from the shelf, press Back, and the shelf redrew from a skeleton,
 * refetched its list and landed at the top with the search field empty.
 * The browser's own scroll restoration could not help: `<main>` never
 * scrolls, every page owns a nested scroller, and a scroller that has
 * just been created has nothing to restore.
 *
 * So the page is not unmounted. React's `<Activity>` (stable since 19.2)
 * keeps a hidden subtree mounted with `display: none` on its DOM, its
 * state intact and its effects unmounted until it is shown again, when
 * the effects run once more. State, filters, selection, fetched rows and
 * the scroller's own `scrollTop` all stay where they were; a mount effect
 * that refetches runs again on show and revalidates behind the rows that
 * are already drawn. This is how Next.js 16 keeps its last three routes,
 * and the budget below is theirs until a phone's heap says otherwise.
 *
 * What is kept is decided by the caller in two places. `App` keeps the
 * last few SECTIONS while another is open, so a tab tap brings a section
 * back as it was; a section shell keeps its LIST while a leaf is open,
 * so Back from a document lands on the shelf that was left. Leaves
 * themselves are never kept: a note's editor, a book's pdf.js pages and
 * the board's engine are the heavy things, and they are keyed by id, so
 * note A, the shelf, note B is two documents, not three kept ones.
 *
 * Effects run again on every show, not only on mount, which is the one
 * thing a kept page has to be written for: its load effect must
 * revalidate without blanking (`NoteList.refresh` keeps `loaded` true
 * through a refetch; every kept list was checked for the same), and
 * anything that must not survive the hide closes in a layout-effect
 * cleanup, which runs as the page is hidden. React 19.3 hides portal
 * contents (an open menu) inside a hidden Activity and keeps
 * `useSyncExternalStore` in step while hidden, so neither needs a hand
 * here.
 */

interface Slot<T> {
  key: string;
  /** What the slot was drawn with when it was last current. Frozen while
      hidden: the hash describes only the visible page. */
  data: T;
}

/**
 * The slots, as a list with the current one last and the hidden ones
 * before it in the order they were last shown, oldest first.
 *
 * Derived during render rather than in an effect, in the way the React
 * docs describe for "storing information from previous renders": the
 * render that changes `current` must already contain the page that was
 * current a moment ago, or React unmounts it in that same commit and
 * there is nothing left to keep. An effect would be one commit late.
 */
export function KeepAlive<T>({
  current,
  data,
  keep,
  budget,
  render,
}: {
  /** The key of the page on show. */
  current: string;
  /** Its live data (a route's params). The hidden slots keep their own. */
  data: T;
  /** Whether a page leaving the screen stays mounted at all. */
  keep: (key: string, data: T) => boolean;
  /** How many hidden pages stay; the least recently shown goes first. */
  budget: number;
  render: (key: string, data: T) => ReactNode;
}) {
  const [slots, setSlots] = useState<Slot<T>[]>(() => [{ key: current, data }]);
  const last = slots[slots.length - 1]!;
  if (last.key !== current) {
    const hidden = slots.filter((s) => s.key !== current && (s.key !== last.key || keep(last.key, last.data)));
    while (hidden.length > budget) hidden.shift();
    setSlots([...hidden, { key: current, data }]);
  } else if (last.data !== data) {
    setSlots([...slots.slice(0, -1), { key: current, data }]);
  }
  return slots.map((slot) => (
    // Keys hold each page to its instance as the list reorders.
    <Activity key={slot.key} mode={slot.key === current ? 'visible' : 'hidden'}>
      <Slot>{render(slot.key, slot.key === current ? data : slot.data)}</Slot>
    </Activity>
  ));
}

/**
 * The box a kept page lives in.
 *
 * It is what Activity hides (it sets `display` on its host children, and
 * a page's own root is not always one element), what `visibleSlot`
 * finds, and `h-full` because the pages under main size themselves
 * against it.
 *
 * It also keeps the page's scroll positions across the hide, because the
 * browser does not always. Measured 2026-09-14 on the demo, phone width:
 * the Notes shelf's scroller (PageShell's div) read 0 while hidden and
 * came back at its 300 in both Chromium and WebKit, but the Games list
 * (a `ul` whose rows carry `content-visibility: auto`, inside a container
 * query box) came back at 0 in Chromium, its 240 gone. So every scroller
 * the user has moved is written down as the page is hidden and put back
 * as it is shown, in layout effects, which Activity runs before the hide
 * and after the show, so the reads see a laid-out page and the write
 * lands before the first paint. The scrollers are collected from their
 * own `scroll` events (captured at the slot; they do not bubble), so
 * nothing walks the page.
 */
function Slot({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(new Set<Element>());
  const saved = useRef<{ el: Element; top: number; left: number }[]>([]);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const onScroll = (e: Event): void => {
      if (e.target instanceof Element) scrolled.current.add(e.target);
    };
    root.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => root.removeEventListener('scroll', onScroll, { capture: true });
  }, []);
  useLayoutEffect(() => {
    const root = ref.current;
    const scrollers = scrolled.current;
    for (const { el, top, left } of saved.current) {
      if (root?.contains(el)) {
        el.scrollTop = top;
        el.scrollLeft = left;
      }
    }
    saved.current = [];
    return () => {
      const list: { el: Element; top: number; left: number }[] = [];
      for (const el of scrollers) {
        if (el.isConnected && (el.scrollTop > 0 || el.scrollLeft > 0)) {
          list.push({ el, top: el.scrollTop, left: el.scrollLeft });
        }
      }
      saved.current = list;
    };
  }, []);
  // EXPERIMENT (vt-experiment branch): the page change as React's own
  // <ViewTransition>. A route change the router commits inside
  // startTransition with a `nav-push` or `nav-pop` type (lib/router)
  // makes this slot's show an enter and the other's hide an exit, each
  // on its own snapshot rather than the root's, with the classes below
  // naming the animation index.css draws for that direction. A change
  // outside a transition (a tab, a desktop, reduced motion) animates
  // nothing, which is the cut those already are.
  return (
    <ViewTransition
      default="none"
      enter={{ 'nav-push': 'vt-page-in', 'nav-pop': 'vt-page-under-in', default: 'none' }}
      exit={{ 'nav-push': 'vt-page-under-out', 'nav-pop': 'vt-page-out', default: 'none' }}
    >
      <div ref={ref} data-route-slot className="h-full">
        {children}
      </div>
    </ViewTransition>
  );
}

/**
 * The route slot that is on screen, under `root` (the page, or `main`).
 *
 * A hidden slot keeps its whole DOM, its scroller at the position it was
 * left at, so anything that looks for "the page's scroller" by walking
 * `main` has to look inside this one only: the tab bar's scroll-to-top
 * found the hidden shelf's scroller first, since it stood earlier in the
 * DOM with a `scrollTop` above zero, and reset the wrong page.
 */
export function visibleSlot(root: ParentNode = document): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-route-slot]')) {
    if (el.checkVisibility?.() ?? el.offsetParent !== null) return el;
  }
  return null;
}

/**
 * Where each section was last, for the tab that returns to it.
 *
 * A tab bar's tab opens its section where it was left: on iOS the stack
 * under a tab survives a visit to another tab, and with the section kept
 * mounted here the page under it does too, so the tab has to land on that
 * page rather than on the section's root over it. Recorded from the hash
 * on every route change (App), read by the sidebar and the bottom bar,
 * and never for a section that keeps its own state (the board, the
 * editor, the workspace), whose tabs open them plainly.
 */
const lastHash = new Map<Section, string>();

export function rememberRoute(section: Section, hash: string): void {
  lastHash.set(section, hash);
}

/** The section's last route as `[section, ...params]`, or null when it
    has not been visited this session. */
export function lastRouteOf(section: Section): [Section, ...string[]] | null {
  const hash = lastHash.get(section);
  if (!hash) return null;
  const route = parse(hash);
  return route.section === section ? [route.section, ...route.params] : null;
}
