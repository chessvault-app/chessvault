/**
 * The slot list KeepAlive (./keep-alive) keeps, as rules with nothing of
 * React in them, so that node can hold them (keep-alive-slots.test.ts).
 */

export interface KeptSlot<T> {
  key: string;
  /** What the slot was drawn with when it was last current. Frozen while
      hidden: the hash describes only the visible page. */
  data: T;
  /**
   * Aborted when the slot is gone: let go of by the list, or the list
   * itself unmounted. One for the slot's whole life, which is the life of
   * the page instance in it: a hide, a show and a change of data keep it,
   * and only a key that left and comes back gets a new one, with a new
   * instance of its page. Its signal reaches the page through useSlotGone.
   */
  gone: AbortController;
}

/** The first list, for the page on show when KeepAlive mounts. */
export function firstSlots<T>(current: string, data: T): KeptSlot<T>[] {
  return [{ key: current, data, gone: new AbortController() }];
}

/**
 * The list after a render that shows `current` with `data`, or null when
 * it stands as it is: the current slot last, the hidden ones before it in
 * the order they were last shown, oldest first.
 *
 * The page leaving the screen stays only when `keep` says so; past
 * `budget` hidden pages the least recently shown goes. A hidden page
 * coming back is the same slot moved to the end, so it keeps its
 * controller: React keeps the instance, keyed by the slot's key, and the
 * signal that instance was handed has to stay the live one.
 */
export function nextSlots<T>(
  slots: readonly KeptSlot<T>[],
  current: string,
  data: T,
  keep: (key: string, data: T) => boolean,
  budget: number,
): KeptSlot<T>[] | null {
  const last = slots.at(-1)!;
  if (last.key !== current) {
    const back = slots.find((s) => s.key === current);
    const hidden = slots.filter((s) => s.key !== current && (s.key !== last.key || keep(last.key, last.data)));
    while (hidden.length > budget) hidden.shift();
    return [...hidden, { key: current, data, gone: back?.gone ?? new AbortController() }];
  }
  if (last.data !== data) return [...slots.slice(0, -1), { ...last, data }];
  return null;
}

/**
 * A signal that fires when either `own` or `around` does: what a slot of a
 * list kept inside a kept page hands its page, since the page around it
 * going takes the list with it while nothing in the list runs.
 *
 * AbortSignal.any by hand: that is Safari 17.4, and this runs as a kept
 * section first renders, where a missing function is the whole app. The
 * listeners come off once either fires, so a page that opens and closes
 * many leaves under one section leaves nothing behind on its signal.
 */
export function follow(around: AbortSignal | null, own: AbortSignal): AbortSignal {
  if (!around) return own;
  const both = new AbortController();
  if (around.aborted || own.aborted) {
    both.abort();
    return both.signal;
  }
  const stop = (): void => {
    around.removeEventListener('abort', stop);
    own.removeEventListener('abort', stop);
    both.abort();
  };
  around.addEventListener('abort', stop);
  own.addEventListener('abort', stop);
  return both.signal;
}

/**
 * The controllers in `before` that `after` no longer holds: the slots that
 * left between two lists. Compared by controller rather than by key, since
 * a key can leave and come back between two lists that were looked at
 * (both moves inside a page that was itself hidden): that is a slot gone
 * and a new one, and the old instance went with the first.
 */
export function departed(
  before: readonly AbortController[],
  after: readonly AbortController[],
): AbortController[] {
  return before.filter((gone) => !after.includes(gone));
}
