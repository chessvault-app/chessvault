import { describe, expect, it } from 'vitest';
import {
  canPull,
  pullAxis,
  pullCommits,
  pullDistance,
  pullGap,
  pullOwn,
  pullProgress,
  pullRest,
} from '@/hooks/use-pull-refresh';

/**
 * The four rules a pull to refresh is: whether the scroller is at a place
 * that can be pulled at all, whether a drag is a pull rather than a scroll
 * or a pane flick, how far the indicator has come for a finger that has
 * gone that far, and whether letting go asks again. All pure, which is why
 * they are separate from the hook — what is left there is event plumbing,
 * two custom properties and a promise, and none of that is a decision.
 */

describe('where a pull may start', () => {
  it('only from the very top', () => {
    expect(canPull(0)).toBe(true);
    // One line down is a list being read: a refresh there would take the
    // rows out from under the thumb.
    expect(canPull(1)).toBe(false);
    expect(canPull(400)).toBe(false);
  });

  it("counts iOS's rubber band as the top", () => {
    // Safari reports a negative scrollTop while the page is bouncing, and
    // a pull begun in the bounce is still a pull begun at the top.
    expect(canPull(-30)).toBe(true);
  });
});

describe('which gestures are pulls', () => {
  it('says nothing until the finger has travelled', () => {
    expect(pullAxis(0, 0)).toBeNull();
    expect(pullAxis(4, 7)).toBeNull();
  });

  it('claims a clearly downward drag', () => {
    expect(pullAxis(0, 40)).toBe('y');
    expect(pullAxis(10, 40)).toBe('y');
  });

  it('leaves a diagonal to the pane flick', () => {
    // Three halves: this gesture shares a page with a horizontal pane
    // swipe, and a diagonal it claimed would be a turn that refreshed.
    expect(pullAxis(30, 40)).toBe('x');
    expect(pullAxis(40, 40)).toBe('x');
    expect(pullAxis(20, 40)).toBe('y');
  });

  it('never claims a drag upwards', () => {
    // A drag up at the top of a list is a scroll with nowhere to go, and
    // swallowing it would swallow the flick.
    expect(pullAxis(0, -40)).toBe('x');
    expect(pullAxis(2, -80)).toBe('x');
  });
});

describe('how far the indicator follows', () => {
  it('answers the first pixels one to one', () => {
    // Discovered by pulling, not by pulling far enough.
    expect(pullDistance(4)).toBeCloseTo(3.9, 1);
  });

  it('costs more the further it goes', () => {
    const a = pullDistance(40) - pullDistance(20);
    const b = pullDistance(140) - pullDistance(120);
    expect(b).toBeLessThan(a);
  });

  it('never reaches its limit', () => {
    // 160 is an asymptote, not a stop the finger hits: a band with a
    // bottom reads as a drawer that has opened.
    expect(pullDistance(2000)).toBeLessThan(160);
    expect(pullDistance(2000)).toBeGreaterThan(140);
  });

  it('stays put for a finger going the other way', () => {
    expect(pullDistance(-50)).toBe(0);
  });
});

describe('who opens the gap', () => {
  it('is the curve alone where nothing bounces', () => {
    // Android, a desktop window, any scroller that reports 0 at its top:
    // the gap is what it always was, and the app opens all of it.
    expect(pullGap(60, 0)).toBeCloseTo(pullDistance(60), 5);
    expect(pullOwn(pullGap(60, 0), 0)).toBeCloseTo(pullDistance(60), 5);
  });

  it("takes Safari's band when the band is the wider", () => {
    // iOS reports the rubber band as a negative scrollTop; the hook hands
    // that here as a positive band. Where it has already opened more than
    // the curve would, the app adds nothing at all.
    expect(pullGap(20, 90)).toBe(90);
    expect(pullOwn(90, 90)).toBe(0);
  });

  it('adds only the difference otherwise', () => {
    // The two never both open the same pixel: whatever the browser did
    // comes off what the app does, so they cannot fight.
    const gap = pullGap(100, 30);
    expect(gap).toBeCloseTo(pullDistance(100), 5);
    expect(pullOwn(gap, 30) + 30).toBeCloseTo(gap, 5);
  });

  it('ignores a scroller that is genuinely scrolled', () => {
    // A positive scrollTop reaches this as a negative band, which is not
    // a gap and never shrinks one.
    expect(pullGap(50, -200)).toBeCloseTo(pullDistance(50), 5);
    expect(pullOwn(pullDistance(50), -200)).toBeCloseTo(pullDistance(50), 5);
  });
});

describe('where it rests while the refetch is out', () => {
  it('holds the content 56px down on iOS', () => {
    // UIRefreshControl's 60pt band, less the couple of points the 28px
    // indicator needs to sit centred in it.
    expect(pullRest(true)).toBe(56);
  });

  it('leaves the circle where it committed on Android', () => {
    // Material's content never moved, so there is nothing to hold, and
    // the release must not move the circle either.
    expect(pullRest(false)).toBe(64);
    expect(pullCommits(pullRest(false))).toBe(true);
  });
});

describe('what commits', () => {
  it('asks again at 64px of travel and not before', () => {
    expect(pullCommits(63.9)).toBe(false);
    expect(pullCommits(64)).toBe(true);
  });

  it('costs about 107px of finger', () => {
    // The curve's price for the threshold: a deliberate pull, not a
    // scroll that overran.
    expect(pullCommits(pullDistance(106))).toBe(false);
    expect(pullCommits(pullDistance(108))).toBe(true);
  });

  it('fills the dial over exactly that travel', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(32)).toBe(0.5);
    expect(pullProgress(64)).toBe(1);
    // And no further: past the threshold the dial is full and the extra
    // travel says nothing more.
    expect(pullProgress(120)).toBe(1);
  });
});
