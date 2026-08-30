import { describe, expect, it } from 'vitest';
import { gestureAxis, paneAfterSwipe } from '@/hooks/use-pane-swipe';

/**
 * The two rules the pane swipe is: which way a finished drag points, and
 * whether a drag is horizontal at all. Both are pure, which is why they
 * are separate from the hook — the hook around them is event plumbing a
 * DOM would have to be stood up to exercise, and the decisions are here.
 */

/** The board page's three panes, in the order the strip draws them. */
const PANES = ['moves', 'engine', 'explorer'] as const;

describe('where a swipe lands', () => {
  it('turns left to the next pane and right to the previous', () => {
    expect(paneAfterSwipe(PANES, 'moves', -80)).toBe('engine');
    expect(paneAfterSwipe(PANES, 'engine', 80)).toBe('moves');
  });

  it('ignores a drag too short to mean it', () => {
    // A tap that slid a little, or the start of a scroll that never
    // committed: 55px is under the threshold, 56 is the threshold.
    expect(paneAfterSwipe(PANES, 'moves', -55)).toBeNull();
    expect(paneAfterSwipe(PANES, 'moves', -56)).toBe('engine');
  });

  it('stops at both ends rather than wrapping', () => {
    // The strip has a first tab and a last one; nothing on the page says
    // the row is a ring, so neither does this.
    expect(paneAfterSwipe(PANES, 'moves', 200)).toBeNull();
    expect(paneAfterSwipe(PANES, 'explorer', -200)).toBeNull();
  });

  it('lands nowhere when the open pane is not in the strip', () => {
    // Puzzles drop the Engine tab until the answer is in, and the page
    // keeps the id it was on — a swipe then has no row to move along.
    expect(paneAfterSwipe(['info', 'moves'] as const, 'engine' as 'info', -80)).toBeNull();
  });
});

describe('the axis a gesture commits to', () => {
  it('stays undecided until the finger has moved far enough to tell', () => {
    expect(gestureAxis(7, 7)).toBeNull();
    expect(gestureAxis(9, 2)).toBe('x');
  });

  it('gives a diagonal to the scroll', () => {
    // The panes under a board are scrolled far more often than they are
    // switched, so a tie is vertical.
    expect(gestureAxis(30, 30)).toBe('y');
    expect(gestureAxis(-30, 31)).toBe('y');
    expect(gestureAxis(-31, 30)).toBe('x');
  });
});
