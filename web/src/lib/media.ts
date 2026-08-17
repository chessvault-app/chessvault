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
 * One carve-out, and it lives in ui/dialogFocus rather than here: a
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
