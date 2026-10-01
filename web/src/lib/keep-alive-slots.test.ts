import { describe, expect, it } from 'vitest';
import { departed, firstSlots, follow, nextSlots, type KeptSlot } from './keep-alive-slots';

/**
 * KeepAlive's list, walked the way the router walks it: one `current` per
 * render. What is pinned is which pages stay and which slot's controller
 * goes with them, since a page's signal (useSlotGone) is only as right as
 * the controller it was handed: a hidden page coming back with a new one
 * would have its old one aborted under it while it is on screen.
 */
type Slots = KeptSlot<string>[];

const keys = (slots: Slots): string[] => slots.map((s) => s.key);

/** Walk `route` from a list that starts on its first entry. */
function walk(route: string[], keep: (key: string) => boolean, budget: number): Slots[] {
  let slots: Slots = firstSlots(route[0]!, `${route[0]}-data`);
  const lists = [slots];
  for (const current of route.slice(1)) {
    slots = nextSlots(slots, current, `${current}-data`, keep, budget) ?? slots;
    lists.push(slots);
  }
  return lists;
}

const goneBetween = (a: Slots, b: Slots): AbortController[] =>
  departed(
    a.map((s) => s.gone),
    b.map((s) => s.gone),
  );

describe('which pages stay', () => {
  it('keeps the least recently shown last in line, up to the budget', () => {
    const lists = walk(['games', 'notes', 'books', 'studies', 'puzzles'], () => true, 3);
    expect(keys(lists.at(-1)!)).toEqual(['notes', 'books', 'studies', 'puzzles']);
  });

  it('lets go of a page that is not kept the moment it leaves', () => {
    const lists = walk(['games', 'board', 'notes'], (key) => key !== 'board', 3);
    expect(keys(lists[1]!)).toEqual(['games', 'board']);
    expect(keys(lists[2]!)).toEqual(['games', 'notes']);
  });

  it('stands as it is when nothing moved', () => {
    const slots = firstSlots('games', 'a');
    expect(nextSlots(slots, 'games', 'a', () => true, 3)).toBeNull();
  });
});

describe("a slot's controller", () => {
  it('is kept across a hide and the show that follows', () => {
    const [first, , back] = walk(['games', 'board', 'games'], () => true, 3);
    expect(back!.at(-1)!.gone).toBe(first![0]!.gone);
    expect(goneBetween(first!, back!)).toEqual([]);
  });

  it('is kept when the page on show is handed new data', () => {
    const slots = firstSlots('settings', 'a');
    const next = nextSlots(slots, 'settings', 'b', () => true, 1)!;
    expect(next[0]!.data).toBe('b');
    expect(next[0]!.gone).toBe(slots[0]!.gone);
  });

  it('goes with a page let go of by the budget', () => {
    const lists = walk(['games', 'notes', 'books', 'studies', 'puzzles'], () => true, 3);
    const games = lists[0]![0]!.gone;
    expect(goneBetween(lists[3]!, lists[4]!)).toEqual([games]);
  });

  it('goes with a page that is not kept, in the list that stops showing it', () => {
    const lists = walk(['workspace', 'notes'], (key) => key !== 'workspace', 3);
    expect(goneBetween(lists[0]!, lists[1]!)).toEqual([lists[0]![0]!.gone]);
  });

  it('is a new one for a key that left and came back', () => {
    const lists = walk(['games', 'notes', 'books', 'games'], () => true, 1);
    // games was let go of at books, then shown again: a new page.
    expect(keys(lists[2]!)).toEqual(['notes', 'books']);
    const before = lists[0]![0]!.gone;
    const after = lists[3]!.at(-1)!.gone;
    expect(after).not.toBe(before);
    // Looked at only before and after (both moves inside a hidden page),
    // the old controller is still the one that went.
    expect(goneBetween(lists[0]!, lists[3]!)).toEqual([before]);
  });

  it('is the same for every page that stays, whatever the order', () => {
    const lists = walk(['a', 'b', 'c', 'a', 'b', 'c'], () => true, 3);
    const first = new Map(lists[2]!.map((s) => [s.key, s.gone]));
    for (const slot of lists.at(-1)!) expect(slot.gone).toBe(first.get(slot.key));
    expect(goneBetween(lists[2]!, lists.at(-1)!)).toEqual([]);
  });
});

describe('the signal of a list kept inside a kept page', () => {
  it("is the slot's own outside any other page", () => {
    const own = new AbortController();
    expect(follow(null, own.signal)).toBe(own.signal);
  });

  it('fires when the page around it goes', () => {
    const around = new AbortController();
    const own = new AbortController();
    const signal = follow(around.signal, own.signal);
    expect(signal.aborted).toBe(false);
    around.abort();
    expect(signal.aborted).toBe(true);
    expect(own.signal.aborted).toBe(false);
  });

  it('fires once when its own slot goes, whatever goes after', () => {
    const around = new AbortController();
    const own = new AbortController();
    let heard = 0;
    const signal = follow(around.signal, own.signal);
    signal.addEventListener('abort', () => (heard += 1));
    own.abort();
    around.abort();
    expect(signal.aborted).toBe(true);
    expect(heard).toBe(1);
  });

  it('is born fired when either already has', () => {
    const around = new AbortController();
    around.abort();
    expect(follow(around.signal, new AbortController().signal).aborted).toBe(true);
  });
});
