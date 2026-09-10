import { describe, expect, it } from 'vitest';
import { decodeSegment, shapeOf } from './router.ts';

describe('decodeSegment', () => {
  it('undoes what encodeURIComponent did to an id', () => {
    for (const id of ['Openings/Catalan - the long diagonal', '100% prepared', '노트: 카탈란', 'a+b&c=d']) {
      expect(decodeSegment(encodeURIComponent(id))).toBe(id);
    }
  });

  it('keeps a segment whose percent escapes nothing, rather than throwing', () => {
    // A hand-typed or truncated link. decodeURIComponent throws URIError
    // here, and it used to do so during render.
    expect(() => decodeSegment('100%')).not.toThrow();
    expect(decodeSegment('100%')).toBe('100%');
    expect(decodeSegment('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('shapeOf', () => {
  it('reads a leaf under a list as a push and the way back as a pop', () => {
    expect(shapeOf('#/games', '#/games/abc')).toBe('push');
    expect(shapeOf('#/games/abc', '#/games')).toBe('pop');
  });

  it('reads one top-level page to another as a tab', () => {
    expect(shapeOf('#/games', '#/books')).toBe('tab');
    expect(shapeOf('#/puzzles/hub', '#/games')).toBe('tab');
  });

  it('reads the opening map switching colour as a tab, not a leaf', () => {
    // The two maps are one page in two colours; a slide in from the
    // right said the black map was a page under the white one.
    expect(shapeOf('#/openingmap', '#/openingmap/black')).toBe('tab');
    expect(shapeOf('#/openingmap/black', '#/openingmap')).toBe('tab');
    expect(shapeOf('#/openingmap/black', '#/openingmap/white')).toBe('tab');
  });
});
