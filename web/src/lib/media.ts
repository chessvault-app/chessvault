import { useEffect, useState } from 'react';

/**
 * Whether the pointer is a thumb rather than a mouse.
 *
 * The single most asked question in the app — eleven call sites had each
 * written the query out, several giving it a fresh local name, while a
 * twelfth exported it from games/shared — and the one every hit area,
 * hover affordance and auto-focus decision turns on.
 * `pointer-coarse:` is the CSS half of the same question; this is for the
 * decisions CSS cannot make.
 *
 * A function, not a hook: no pointer changes type mid-session that the
 * layout would need to follow, and every caller reads it once.
 */
export const isCoarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/**
 * Should a window focus its first field as it opens?
 *
 * Only where focusing is free. Under a mouse it saves a click and costs
 * nothing. Under a thumb it summons the on-screen keyboard, which takes
 * half the screen the moment the sheet arrives — so a window opened to be
 * READ (which PGN did I paste, which months are cached) opens already
 * covered, and the sheet has to be scrolled or dismissed before it can be
 * looked at. The field is one tap away for anyone who wanted it.
 *
 * One carve-out, and it lives in hooks/dialog-focus rather than here: a
 * dialog whose ONLY input field is a text field was opened to type, and
 * takes the focus on every device, thumb or not. This gate is for the
 * fields in windows that are more than their field.
 *
 * A function, not a hook: `autoFocus` is read once, at mount.
 */
export function autoFocusField(): boolean {
  return !isCoarsePointer();
}

/**
 * A media query as state, kept current as the window changes.
 *
 * For the cases a CSS class cannot reach: not "hide this at that size" but
 * "offer something different at that size". A menu whose items are merely
 * `lg:hidden` is still a menu of that many items — it renders a chevron
 * and a popover to show one row — so the list itself has to know.
 *
 * Read once at mount as well as subscribed, because the first paint is a
 * real paint: a menu that decides it is narrow and corrects itself a frame
 * later has already been seen.
 *
 * `enabled` lets a caller opt out wholesale — no initial read, no
 * subscription — for the hooks-must-be-unconditional case where the
 * feature the query gates is off (a Panel with no resize grip). While
 * disabled the answer is simply false, or whatever the last enabled read
 * said; nothing resets it, because nothing is listening.
 */
export function useMediaQuery(query: string, enabled = true): boolean {
  const [matches, setMatches] = useState(() => enabled && window.matchMedia(query).matches);
  useEffect(() => {
    if (!enabled) return;
    const mq = window.matchMedia(query);
    const update = (): void => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query, enabled]);
  return matches;
}

/**
 * JS mirror of the CSS `wide` variant (index.css): side-by-side layouts.
 *
 * It must be the SAME query, character for character once whitespace is
 * folded, because useWideLayout selects whole render trees (the trainer's
 * pane switcher, the book reader, the repertoire) while the `wide:`
 * classes select what is drawn inside them. It drifted once: the CSS lost
 * its `(min-width: 64rem)` branch so an upright iPad stacks, and this kept
 * it, so at 1024px portrait the JS rendered the side-by-side tree with
 * every `wide:` class off, and the phone pane switcher vanished with no
 * side column to replace it. media.test.ts reads index.css and fails if
 * the two part again.
 */
export const WIDE_MQ = '(orientation: landscape) and (min-width: 44rem)';

/**
 * Whether the app is laid out side by side, in JavaScript.
 *
 * Wanted wherever the two layouts differ in BEHAVIOUR and not only in what
 * is drawn — a trainer that analyses by itself on a desktop and waits to be
 * asked on a phone. It lived in puzzles/books/layout.ts, which is where the
 * second copy of the query got written rather than found.
 *
 * `.force-stacked` (index.css) is the one thing this cannot see: a
 * matchMedia query knows the viewport, not the DOM, so a board page
 * rendered inside a `.force-stacked` region reads `wide` here while every
 * `wide:` class inside it is off. Today every such region (the editor
 * beside the book reader's PDF, the position setup window) holds only
 * EditorView, which lays itself out with the variants and never asks
 * this hook; anything new rendered inside one has to do the same. No fix
 * is offered here because there is no cheap one: it would mean a ref and
 * a closest() walk at every call site.
 */
export function useWideLayout(): boolean {
  return useMediaQuery(WIDE_MQ);
}

/**
 * Whether the board pages that fold at `lg` are showing their panes one at
 * a time — the JS mirror of the `lg:hidden` their tab strip is drawn
 * behind (analysis, studies and games).
 *
 * Wanted by the swipe that turns from one pane to the next
 * (hooks/use-pane-swipe): a gesture must not move a row that is not on
 * screen. Named here rather than written out twice, for the reason
 * useWideLayout is — the second copy of a query is written, not found.
 * The pages that fold at `wide` instead (the trainers, the repertoire)
 * ask useWideLayout, which is a different question about a different
 * layout, not a second spelling of this one.
 */
export function useTabbedPanes(): boolean {
  return useMediaQuery('(max-width: 63.9375rem)');
}

/**
 * The workspace's gate: the viewport where board, moves, explorer AND the
 * games band earn showing at once.
 *
 * Wider than `lg` on purpose — three columns over a games table are
 * cramped at 64rem — and landscape-only for the same reason `wide` is:
 * every pane inside the workspace lays itself out with the wide/stacked
 * variants, and a portrait viewport would run their stacked halves inside
 * a page designed for none of them. Below this the page renders its gate
 * card instead of a squeezed layout: the workspace's whole premise is
 * simultaneity, and its panes already exist one per page as Board and
 * Games. A capability gate, not a platform sniff — the desktop shell
 * allows 480px windows and an iPad in landscape clears this honestly.
 */
export function useWorkspaceViewport(): boolean {
  return useMediaQuery('(orientation: landscape) and (min-width: 72rem)');
}

/**
 * Every one of these images fetched and decoded, capped at `capMs`.
 *
 * A shelf that renders its covers as they arrive flickers in one by one;
 * waiting for all of them and then drawing once does not. The cap is the
 * other half: one slow or missing image must not hold the shelf back, and
 * an onerror is as good as an onload for this purpose — the point is that
 * the browser has stopped working on it, not that it succeeded.
 */
export async function decodeImages(urls: string[], capMs = 2000): Promise<void> {
  if (urls.length === 0) return;
  const decoded = urls.map(
    (url) =>
      new Promise<void>((done) => {
        const img = new Image();
        img.onload = () => done();
        img.onerror = () => done();
        img.src = url;
      }),
  );
  await Promise.race([Promise.all(decoded), new Promise((r) => setTimeout(r, capMs))]);
}
