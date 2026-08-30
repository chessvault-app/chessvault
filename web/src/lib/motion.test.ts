import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion } from './motion';

/** Stand in for a browser whose reduce query answers `matches`. */
function stubWindow(matches: boolean): void {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({ matches: query.includes('reduce') && matches }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prefersReducedMotion', () => {
  it('reports what the media query says', () => {
    stubWindow(true);
    expect(prefersReducedMotion()).toBe(true);
    stubWindow(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false where there is no window at all', () => {
    // The test env is `node`, so this is the state without a stub — and it
    // is what any non-DOM caller gets. Reading matchMedia off undefined
    // would throw instead of answering.
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is asked fresh each time, so a setting changed mid-session lands', () => {
    // The value must NOT be captured at import: a user turning the setting
    // on while the app is open gets the next board move without a slide,
    // not on their next launch.
    stubWindow(false);
    expect(prefersReducedMotion()).toBe(false);
    stubWindow(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});
