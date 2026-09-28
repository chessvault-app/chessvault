/**
 * What the Databases tab's search box asks for when its debounce fires
 * (DatabaseGames' settleBox), stated apart so the rule can be held to
 * every path that ends on it without rendering the page.
 *
 * The box narrows whichever rows stand: a hunt when one does, the text
 * search otherwise. A fire that finds those rows ALREADY answering the
 * box asks for nothing. That one rule is what leaves a pending
 * keystroke with nothing to do after every other way the box gets
 * answered, instead of each of them having to cancel the timer: a typo
 * undone inside the debounce, a phone's Cancel on an empty box, a hunt
 * closed (which refetches the text rows itself when the box or the
 * filters moved under it), and the empty state's "Clear search and
 * filters" (which searches the emptied box itself).
 *
 * A hunt is compared trimmed, because the hunt request sends the box
 * trimmed; the text search sends it as it is, so it is compared as it
 * is.
 */
export function settledBoxAsks(
  box: string,
  /** The box as the standing hunt last read it, or null while no hunt
      stands. */
  huntRead: string | null,
  /** What the text rows last asked for, or null when they answer
      nothing current: that search failed, or the filters moved while a
      hunt stood over them. */
  searched: string | null,
): 'hunt' | 'search' | null {
  if (huntRead !== null) return box.trim() === huntRead ? null : 'hunt';
  return box === searched ? null : 'search';
}
