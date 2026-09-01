import { describe, expect, it } from 'vitest';
import { dragOffset, gestureAxis, paneAfterSwipe } from '@/hooks/use-pane-swipe';

/**
 * The three rules the pane swipe is: which way a finished drag points,
 * whether a drag is horizontal at all, and where the row of panes sits
 * while it is being made. All pure, which is why they are separate from the
 * hook — the hook around them is event plumbing, two marked nodes and a
 * handful of custom properties a DOM would have to be stood up to
 * exercise, and the decisions are here.
 */

/** The board page's three panes, in the order the strip draws them. */
const PANES = ['moves', 'engine', 'explorer'] as const;

/** A pane's whole trip on a phone: a 348px column plus the 12px gutter the
    next pane waits beyond. */
const SPAN = 360;

describe('where a swipe lands', () => {
  it('turns left to the next pane and right to the previous', () => {
    expect(paneAfterSwipe(PANES, 'moves', -200, SPAN)).toBe('engine');
    expect(paneAfterSwipe(PANES, 'engine', 200, SPAN)).toBe('moves');
  });

  it('ignores a drag that did not get a third of the way across', () => {
    // A share of the trip rather than a fixed distance: the panes travel
    // the width of the column now, so what counts as most of the way is a
    // property of the column.
    expect(paneAfterSwipe(PANES, 'moves', -107, SPAN)).toBeNull();
    expect(paneAfterSwipe(PANES, 'moves', -108, SPAN)).toBe('engine');
  });

  it('turns on a flick that never got there', () => {
    // The gesture people actually use to page is fast, and a fast gesture
    // is a short one — without this the threshold refuses it.
    expect(paneAfterSwipe(PANES, 'moves', -20, SPAN, -0.6)).toBe('engine');
    expect(paneAfterSwipe(PANES, 'moves', -20, SPAN, -0.4)).toBeNull();
  });

  it('refuses a flick that was already on its way back', () => {
    // Dragged left, then thrown right: the finger left going the other
    // way, and turning left is not what it last asked for.
    expect(paneAfterSwipe(PANES, 'moves', -20, SPAN, 0.9)).toBeNull();
  });

  it('ignores a flick too small to be a gesture at all', () => {
    // Under the slop it is a tap that shifted, however fast.
    expect(paneAfterSwipe(PANES, 'moves', -7, SPAN, -2)).toBeNull();
  });

  it('stops at both ends rather than wrapping', () => {
    // The strip has a first tab and a last one; nothing on the page says
    // the row is a ring, so neither does this.
    expect(paneAfterSwipe(PANES, 'moves', 300, SPAN)).toBeNull();
    expect(paneAfterSwipe(PANES, 'explorer', -300, SPAN)).toBeNull();
  });

  it('lands nowhere when the open pane is not in the strip', () => {
    // Puzzles drop the Engine tab until the answer is in, and the page
    // keeps the id it was on — a swipe then has no row to move along.
    expect(paneAfterSwipe(['info', 'moves'] as const, 'engine' as 'info', -200, SPAN)).toBeNull();
  });
});

describe('where the row sits while the finger is down', () => {
  it('follows the finger one for one', () => {
    // The two panes are a row being held, so the offset IS the movement:
    // letting go only pulls in the gap that is left.
    expect(dragOffset(20, SPAN)).toBe(20);
    expect(dragOffset(-200, SPAN)).toBe(-200);
  });

  it('damps an overshoot past the arriving pane', () => {
    // Which is what stops one gesture turning two panes.
    expect(dragOffset(-400, SPAN)).toBe(-368);
    expect(dragOffset(-500, SPAN)).toBe(-384);
  });

  it('gives far less at an end of the strip', () => {
    // The only cue that this is the first tab or the last, and it arrives
    // during the gesture rather than after it.
    expect(dragOffset(-20, 0)).toBe(-4);
    expect(dragOffset(-400, 0)).toBe(-24);
  });

  it('leans nowhere at rest', () => {
    expect(dragOffset(0, SPAN)).toBe(0);
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
