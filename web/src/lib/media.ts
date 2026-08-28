import { useEffect, useState } from 'react';

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
 */
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
  return !window.matchMedia('(pointer: coarse)').matches;
}

/**
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

/** JS mirror of the CSS `wide` variant (index.css): side-by-side layouts. */
const WIDE_MQ = '(min-width: 64rem), (orientation: landscape) and (min-width: 44rem)';

/**
 * Whether the app is laid out side by side, in JavaScript.
 *
 * Wanted wherever the two layouts differ in BEHAVIOUR and not only in what
 * is drawn — a trainer that analyses by itself on a desktop and waits to be
 * asked on a phone. It lived in puzzles/books/layout.ts, which is where the
 * second copy of the query got written rather than found.
 */
export function useWideLayout(): boolean {
  return useMediaQuery(WIDE_MQ);
}

/**
 * JS mirror of Tailwind's `lg`: the width where a board page's side column
 * stops being one pane at a time behind a tab strip and shows every pane
 * at once.
 *
 * Wanted for the same reason as the one above — a page that has to know
 * whether the moves panel (and so the navigation at its foot) is on screen
 * at all, which `pane` alone cannot say below lg and cannot say above it
 * either. Written once here rather than as a literal in each board page.
 */
export function useAllPanesShown(): boolean {
  return useMediaQuery('(min-width: 64rem)');
}
