import { describe, expect, it } from 'vitest';
import { inBand, pillAt, tabUnder } from '@/hooks/use-tab-scrub';

/**
 * The three rules the tab scrub is: which tab a finger is over, where the
 * pill stands while it holds one, and whether a finger that lifted is
 * still on the bar. All pure, for the same reason the pane swipe's are —
 * the hook around them is touch plumbing and one custom property, and the
 * decisions are here.
 */

/** A 390px phone's bar: five equal slots of 78px. */
const LEFT = 0;
const WIDTH = 390;
const COUNT = 5;
/** The pill, `w-14`. */
const PILL = 56;

describe('which tab a finger is over', () => {
  it('splits the bar into equal slots', () => {
    expect(tabUnder(0, LEFT, WIDTH, COUNT)).toBe(0);
    expect(tabUnder(77, LEFT, WIDTH, COUNT)).toBe(0);
    expect(tabUnder(78, LEFT, WIDTH, COUNT)).toBe(1);
    expect(tabUnder(389, LEFT, WIDTH, COUNT)).toBe(4);
  });

  it('holds at the ends rather than running off them', () => {
    // A thumb that carries on past the last tab is still asking for the
    // last tab, and there is nothing to wrap around to.
    expect(tabUnder(-40, LEFT, WIDTH, COUNT)).toBe(0);
    expect(tabUnder(600, LEFT, WIDTH, COUNT)).toBe(4);
  });

  it('reads slots from the bar, not from the screen', () => {
    // The bar is measured where it is: a phone with the page inset, or a
    // bar that is not the full width, still splits its own box.
    expect(tabUnder(120, 100, 200, COUNT)).toBe(0);
    expect(tabUnder(255, 100, 200, COUNT)).toBe(3);
    expect(tabUnder(295, 100, 200, COUNT)).toBe(4);
  });
});

describe('where the pill stands', () => {
  it('centres on the finger', () => {
    expect(pillAt(195, LEFT, WIDTH, PILL)).toBe(195 - PILL / 2);
  });

  it('stops at either end of the bar', () => {
    // Centred on a finger near the edge, the pill would hang off the bar
    // and draw over the page beside it.
    expect(pillAt(10, LEFT, WIDTH, PILL)).toBe(0);
    expect(pillAt(385, LEFT, WIDTH, PILL)).toBe(WIDTH - PILL);
  });
});

describe('whether a finger that lifted is still on the bar', () => {
  /** The bar on an 812px screen: 56px tall, on the bottom edge. */
  const TOP = 756;
  const BOTTOM = 812;

  it('takes a thumb that arced off the bar', () => {
    expect(inBand(TOP, TOP, BOTTOM)).toBe(true);
    expect(inBand(TOP - 30, TOP, BOTTOM)).toBe(true);
    expect(inBand(BOTTOM + 30, TOP, BOTTOM)).toBe(true);
  });

  it('refuses a finger that left for the page', () => {
    // A press that travels off its control does not fire it, and this is
    // a press on a control.
    expect(inBand(TOP - 80, TOP, BOTTOM)).toBe(false);
  });
});
