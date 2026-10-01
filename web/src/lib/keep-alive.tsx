import {
  Activity,
  ViewTransition,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { departed, firstSlots, follow, nextSlots } from './keep-alive-slots';
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
 *
 * The other way round is what a cleanup cannot do: say that the page is
 * gone. It runs at the hide and at an unmount alike, and React runs each
 * cleanup once (it clears it as it calls it), so when a hidden page is
 * later let go of, by the budget or by a page around it going, nothing in
 * it runs at all. Work that should go on while its page is hidden and
 * stop when the page goes reads useSlotGone, whose signal fires then and
 * only then.
 */

/** The signal of the slot a component is drawn in, null outside any
    KeepAlive (see useSlotGone). */
const SlotGoneContext = createContext<AbortSignal | null>(null);

/**
 * A signal that fires when the kept page this component is drawn in is
 * gone, never when it is merely hidden: when the list lets go of the page
 * (the budget, or a page that is not kept leaving the screen), when the
 * KeepAlive holding it unmounts, or when a page around it goes (a list
 * kept inside a kept section). Null outside any KeepAlive, where an
 * effect's cleanup is an unmount and says so itself.
 *
 * It is the page's, not the component's: a component that unmounts
 * while its page stays (a tab switched inside the page) is not told by
 * this, and has to stop its own work in its cleanup.
 */
export function useSlotGone(): AbortSignal | null {
  return useContext(SlotGoneContext);
}

/**
 * The slots, as a list with the current one last and the hidden ones
 * before it in the order they were last shown, oldest first
 * (./keep-alive-slots holds the rules).
 *
 * Derived during render rather than in an effect, in the way the React
 * docs describe for "storing information from previous renders": the
 * render that changes `current` must already contain the page that was
 * current a moment ago, or React unmounts it in that same commit and
 * there is nothing left to keep. An effect would be one commit late.
 *
 * Which is why a slot's controller is aborted in an effect and not here:
 * a render can be thrown away, a commit cannot. The effect compares the
 * list it last saw with the one committed and aborts what left, however
 * it left, a layout effect so the abort lands in the commit that drops
 * the page. A KeepAlive that unmounts takes every slot with it; that is
 * caught by the slot on show (Slot, below), since an unmounting
 * KeepAlive runs no effect of its own that could tell it from a hide.
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
  const [slots, setSlots] = useState(() => firstSlots(current, data));
  const next = nextSlots(slots, current, data, keep, budget);
  if (next) setSlots(next);
  /** The controllers of the list as last committed. */
  const held = useRef<readonly AbortController[]>([]);
  useLayoutEffect(() => {
    const now = slots.map((s) => s.gone);
    for (const gone of departed(held.current, now)) gone.abort();
    held.current = now;
  }, [slots]);
  // A slot taken out of the document (Slot, below). One the list let go of
  // is out of `held` already, since the effect above is a layout effect
  // and the slot's word comes from a passive cleanup, which React runs
  // after the layout effects of the same commit. One still in it went
  // with the whole list, and so does every hidden slot beside it, whose
  // own cleanups ran at their hides.
  const outOfDocument = (gone: AbortController): void => {
    if (held.current.includes(gone)) for (const each of held.current) each.abort();
  };
  return slots.map((slot) => (
    // Keys hold each page to its instance as the list reorders.
    <Activity key={slot.key} mode={slot.key === current ? 'visible' : 'hidden'}>
      <Slot gone={slot.gone} outOfDocument={outOfDocument}>
        {render(slot.key, slot.key === current ? data : slot.data)}
      </Slot>
    </Activity>
  ));
}

/**
 * The box a kept page lives in.
 *
 * It is what Activity hides (it sets `display` on its host children, and
 * a page's own root is not always one element), what `visibleSlot`
 * finds, and `h-full` because the pages under main size themselves
 * against it. It hands the page its signal (useSlotGone), drawing no
 * element of its own to do it.
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
 *
 * A `scrollTop` is only a place while nothing above it changes height,
 * and while a page is hidden things do: the Games rows are
 * `content-visibility: auto`, whose offscreen rows stand at a placeholder
 * height (measured 69px against a real 85 in WebKit) unless the engine
 * kept their remembered size across `display: none`, and a list that
 * revalidates on show can gain a row. So each scroller is also saved with
 * an ANCHOR, the element at its middle and how far down the scroller it
 * stood, and the restore corrects `scrollTop` until the anchor stands
 * there again: once in the layout effect, and once a frame later, since
 * skipped rows take their real size only when they are next rendered.
 * lanph3re's report was the Games list coming back "moved a bit" on an
 * iPhone. It did not reproduce on the demo (Chromium and WebKit both
 * restored exactly), so the cause on the device is not established; what
 * is measured is the mechanism, with a row above the viewport forced
 * 115px taller while hidden: the anchor row came back 115px low before
 * this and in place after.
 */
interface SavedScroll {
  el: Element;
  top: number;
  left: number;
  anchor: Element | null;
  /** The anchor's top, measured from the scroller's. */
  offset: number;
}

/**
 * The element standing across the scroller's middle: down through any
 * wrapper taller than the view, to the first box that fits in it (a row,
 * a card). Found by rect and not by `elementFromPoint`, which answers
 * with the root element while a View Transition is up (measured in
 * Chromium), and a page is hidden inside one.
 */
function anchorOf(el: Element, box: DOMRect): Element | null {
  const mid = box.top + box.height / 2;
  let found: Element | null = null;
  for (let node: Element = el; ; ) {
    let next: Element | null = null;
    for (const kid of node.children) {
      const r = kid.getBoundingClientRect();
      if (r.height > 0 && r.top <= mid && r.bottom > mid) {
        next = kid;
        break;
      }
    }
    if (!next) return found;
    found = next;
    if (next.getBoundingClientRect().height <= box.height) return found;
    node = next;
  }
}

/** How far the anchor has drifted from where it stood, put back. */
function holdAnchor({ el, anchor, offset }: SavedScroll): void {
  if (!anchor?.isConnected || !el.contains(anchor)) return;
  const now = anchor.getBoundingClientRect().top - el.getBoundingClientRect().top;
  if (Math.abs(now - offset) >= 1) el.scrollTop += now - offset;
}

function Slot({
  gone,
  outOfDocument,
  children,
}: {
  /** This slot's controller, the same one for the slot's whole life
      (keep-alive-slots). */
  gone: AbortController;
  /** Told when this slot's box has left the document (KeepAlive). */
  outOfDocument: (gone: AbortController) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolled = useRef(new Set<Element>());
  const saved = useRef<SavedScroll[]>([]);
  // What the page is handed (useSlotGone): this slot's own controller,
  // and, for a list kept inside a kept page, the signal of the page
  // around it, whose going takes this list with it while nothing in here
  // runs. Made once, from the controller the slot keeps for its life.
  const around = useContext(SlotGoneContext);
  const [signal] = useState(() => follow(around, gone.signal));
  // The one way out the list's own effect cannot see: the KeepAlive itself
  // unmounting, its pages with it. Its slot on show runs this cleanup and
  // finds its box out of the document, which a hide never does (Activity
  // hides with `display: none`, and StrictMode's rehearsal of an unmount
  // removes nothing either). A passive cleanup, because a deleted tree's
  // passive cleanups run after its nodes have been removed.
  useEffect(() => {
    const box = ref.current;
    return () => {
      if (!box?.isConnected) outOfDocument(gone);
    };
  }, [gone, outOfDocument]);
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
    const restored = saved.current.filter(({ el }) => root?.contains(el));
    for (const s of restored) {
      s.el.scrollTop = s.top;
      s.el.scrollLeft = s.left;
      holdAnchor(s);
    }
    saved.current = [];
    const again = requestAnimationFrame(() => restored.forEach(holdAnchor));
    return () => {
      cancelAnimationFrame(again);
      const list: SavedScroll[] = [];
      for (const el of scrollers) {
        if (el.isConnected && (el.scrollTop > 0 || el.scrollLeft > 0)) {
          const box = el.getBoundingClientRect();
          const anchor = anchorOf(el, box);
          list.push({
            el,
            top: el.scrollTop,
            left: el.scrollLeft,
            anchor,
            offset: anchor ? anchor.getBoundingClientRect().top - box.top : 0,
          });
        }
      }
      saved.current = list;
    };
  }, []);
  // The page change as React's own <ViewTransition> (2026-09-14; it was
  // the browser's on the root before). A route change the router commits inside
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
      <div ref={ref} data-route-slot className="h-full bg-background">
        <SlotGoneContext value={signal}>{children}</SlotGoneContext>
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
