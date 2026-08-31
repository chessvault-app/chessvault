/**
 * The state behind the `[[` list, for whatever is being typed into.
 *
 * The split follows what each side can actually do. Spotting `[[` behind
 * the caret, knowing where to hang the list, and reaching the arrow keys
 * before the field's own handling are things only the editor knows.
 * Drawing an anchored, dismissible, collision-aware layer is a thing the
 * component library already does, and did better than the hand-rolled div
 * this replaced. So the editor keeps the knowledge and publishes it here;
 * `WikiSuggest` subscribes.
 *
 * Nothing in here is ProseMirror. It was written inside the TipTap
 * extension when a note was the only thing a link could be typed into, and
 * the only editor-shaped thing in it was `pick`, which dispatched a
 * transaction. That is now a callback the caller supplies — a textarea
 * replaces a range by rewriting its value — which is the whole of what a
 * move comment needed to reuse the list rather than grow a second one.
 */

/** Where to hang the list, in viewport coordinates. */
export interface SuggestAnchor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /**
   * Which edge of that box the list sits on.
   *
   * A note anchors to the caret's own line box and opens below it, so the
   * list follows the words being typed. A move comment anchors to the WHOLE
   * box and opens above: finding the caret inside a textarea means
   * measuring a mirror element built from twenty copied styles, which
   * drifts silently the first time a font or a padding changes, and the box
   * is two to eight lines in a narrow column — so tracking the caret inside
   * it would buy a precision nobody could see. Above rather than below
   * because that box sits at the foot of its panel with the move list
   * above it, which is the room there is.
   */
  readonly side: 'top' | 'bottom';
}

/**
 * What the popup draws. Replaced whole and never mutated, so a subscriber
 * can tell one snapshot from the next by identity alone.
 */
export interface SuggestSnapshot {
  readonly open: boolean;
  readonly items: readonly string[];
  readonly index: number;
  /** How many matched in all, so a shortened list can say it is one. */
  readonly total: number;
  readonly anchor: SuggestAnchor | null;
}

export const CLOSED: SuggestSnapshot = {
  open: false,
  items: [],
  index: 0,
  total: 0,
  anchor: null,
};

export interface SuggestStore {
  subscribe(fn: () => void): () => void;
  snapshot(): SuggestSnapshot;
  /** Replace the pending `[[query` with `id`, then close. */
  pick(id: string): void;
  close(): void;
}

/** Puts `text` in place of [`from`, `to`) in whatever is being typed into. */
export type ReplaceRange = (from: number, to: number, text: string) => void;

/** The half the editor drives. The component only ever sees `SuggestStore`. */
export interface OwnedSuggestStore extends SuggestStore {
  /** Arm at the caret: from here, results for `query` may arrive. */
  arm(
    replace: ReplaceRange,
    range: { from: number; to: number },
    query: string,
    anchor: SuggestAnchor | null,
  ): void;
  /** Results for `query`, dropped if the typist has moved past it. */
  offer(query: string, items: string[], total: number): void;
  move(delta: number): void;
  /** Take the active item, if there is one; reports whether it did. */
  commit(): boolean;
}

export function createSuggestStore(): OwnedSuggestStore {
  const listeners = new Set<() => void>();
  let state: SuggestSnapshot = CLOSED;
  let replace: ReplaceRange | null = null;
  let range: { from: number; to: number } | null = null;
  let query = '';

  function set(next: SuggestSnapshot): void {
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn();
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => state,
    arm(nextReplace, nextRange, nextQuery, anchor) {
      replace = nextReplace;
      range = nextRange;
      query = nextQuery;
      // The caret keeps moving while results are in flight; anchor to
      // where it is now, not to where the query was asked from.
      set(state.open ? { ...state, anchor } : { ...CLOSED, anchor });
    },
    offer(forQuery, items, total) {
      if (forQuery !== query || !range) return;
      if (items.length === 0) return set(CLOSED);
      set({
        open: true,
        items,
        index: Math.min(state.index, items.length - 1),
        total,
        anchor: state.anchor,
      });
    },
    move(delta) {
      if (!state.open) return;
      const n = state.items.length;
      set({ ...state, index: (state.index + delta + n) % n });
    },
    commit() {
      const id = state.items[state.index];
      if (!id) return false;
      this.pick(id);
      return true;
    },
    pick(id) {
      if (!replace || !range) return;
      replace(range.from, range.to, `${id}]]`);
      this.close();
    },
    close() {
      range = null;
      query = '';
      set(CLOSED);
    },
  };
}

/**
 * What is behind the caret, if it is an unfinished `[[`.
 *
 * One rule, asked by both editors, so the popup opens on the same text in
 * a note and in a move comment. `]` and `[` end it: the link is already
 * closed, or a second `[[` has started.
 */
export const PENDING_LINK = /\[\[([^[\]]*)$/;

/** How many names to show at once. */
export const SUGGEST_LIMIT = 8;
